/**
 * The Search Console daily sync (section 9): clicks, impressions, CTR and
 * position by day, page and query, stored per site.
 *
 *   - Dates are Pacific days; Google's data lags two to three days. Each
 *     sync reads with dataState "all" and marks every day from
 *     metadata.first_incomplete_date on as provisional (final = false); those
 *     days are read again on the next syncs until Google calls them final.
 *   - First connect: totals for the full 16 months in one request, then the
 *     detail rows (query × page and page, one day at a time, paginated with
 *     rowLimit/startRow up to Google's 50,000 rows per day) newest first, in
 *     chunks; the job re-queues itself until the backfill reaches 16 months.
 *   - Idempotent: totals are upserted by (site, day); detail rows of the days
 *     read are replaced in one transaction. Running the same day twice stores
 *     the same rows, never double counts.
 *   - Read-only scope; every request passes the endpoint allowlist (never the
 *     Indexing API); requests for one property are paced (deps.googlePauseMs).
 */
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { getSite } from "../data/sites.ts";
import { GoogleApiError, gscQueryAll } from "../google/api.ts";
import { GoogleAuthError } from "../google/oauth.ts";
import { GoogleNotReadyError, setStatus, withGoogle } from "../google/service.ts";
import { QUEUES } from "../pipeline/deps.ts";
import { pacificDate } from "./cadence.ts";
import { cleanText, isFinalDay, planGscSync, type SyncPlan } from "./search.ts";
import { alertRun, finishRun, pace, type MeasureDeps, type RunTrigger } from "./runs.ts";

export type SyncState = {
  id: string;
  property: string;
  status: "pending" | "syncing" | "ok" | "error";
  detail: string | null;
  backfill_from: string | null;
  backfill_cursor: string | null;
  backfilled_at: Date | null;
  final_through: string | null;
  newest_day: string | null;
  last_success_at: Date | null;
  last_attempt_at: Date | null;
  rows_written: string;
  requests: string;
  failures: number;
  health: unknown;
};

const STATE_COLS = `id, property, status, detail, to_char(backfill_from, 'YYYY-MM-DD') AS backfill_from, to_char(backfill_cursor, 'YYYY-MM-DD') AS backfill_cursor, backfilled_at,
  to_char(final_through, 'YYYY-MM-DD') AS final_through, to_char(newest_day, 'YYYY-MM-DD') AS newest_day, last_success_at, last_attempt_at, rows_written::text, requests::text, failures, health`;

export function getSyncState(tx: Tx, siteId: string, kind: "search_console" | "ga4"): Promise<SyncState | null> {
  return tx.maybe<SyncState>(`SELECT ${STATE_COLS} FROM search_sync_state WHERE site_id = $1 AND kind = $2`, [siteId, kind]);
}

/** The state row for a property; a different property than before starts over (its rows belong to another property). */
export async function stateFor(tx: Tx, workspaceId: string, siteId: string, kind: "search_console" | "ga4", property: string): Promise<SyncState> {
  const cur = await getSyncState(tx, siteId, kind);
  if (cur && cur.property === property) return cur;
  if (cur) {
    const tables = kind === "search_console" ? ["gsc_daily", "gsc_page_daily", "gsc_query_daily"] : ["ga4_daily", "ga4_landing_daily", "ga4_event_daily"];
    for (const t of tables) await tx.exec(`DELETE FROM ${t} WHERE site_id = $1`, [siteId]);
    await tx.exec("DELETE FROM search_sync_state WHERE id = $1", [cur.id]);
  }
  return tx.one<SyncState>(`INSERT INTO search_sync_state (workspace_id, site_id, kind, property) VALUES ($1, $2, $3, $4) RETURNING ${STATE_COLS}`, [workspaceId, siteId, kind, property]);
}

export type GscSyncResult = {
  status: "ok" | "skipped" | "error";
  detail: string;
  plan: SyncPlan | null;
  totalDays: number;
  detailRows: number;
  requests: number;
  firstIncomplete: string | null;
  backfillRemaining: boolean;
};

type DetailRow = { day: string; query: string; page: string; clicks: number; impressions: number; position: number };
type PageRow = { day: string; page: string; clicks: number; impressions: number; position: number };

const n0 = (v: number) => Math.max(0, Math.round(v));
const p2 = (v: number) => Math.max(0, Math.round(v * 100) / 100);

/** One sync step. With `runId` the measurement run is finished here too. */
export async function syncSearchConsole(deps: MeasureDeps, ctx: TenantContext, siteId: string, opts: { trigger: RunTrigger; runId?: string | null; chunkDays?: number } = { trigger: "schedule" }): Promise<GscSyncResult> {
  const now = deps.now();
  const skip = async (detail: string): Promise<GscSyncResult> => {
    if (opts.runId) await withWorkspace(deps.db, ctx, async (tx) => { await tx.action("search.sync_skip"); await finishRun(tx, opts.runId!, "skipped", { detail, now }); });
    return { status: "skipped", detail, plan: null, totalDays: 0, detailRows: 0, requests: 0, firstIncomplete: null, backfillRemaining: false };
  };
  if (!deps.google) return skip("Google is not configured on this server (GOOGLE_OAUTH_CLIENT_ID).");
  const site = await withWorkspace(deps.db, ctx, (tx) => getSite(tx, siteId), { readOnly: true });
  const pauseMs = deps.googlePauseMs ?? 200;
  let requests = 0;
  try {
    return await withGoogle(deps.google, ctx, siteId, "search_console", async (token, conn) => {
      const state = await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("search.sync_start");
        const s = await stateFor(tx, ctx.workspaceId, siteId, "search_console", conn.property);
        await tx.exec("UPDATE search_sync_state SET status = 'syncing', last_attempt_at = $2 WHERE id = $1", [s.id, now]);
        return s;
      });
      const plan = planGscSync(pacificDate(now), { backfillCursor: state.backfill_cursor, backfillFrom: state.backfill_from, finalThrough: state.final_through }, { chunkDays: opts.chunkDays });
      const pause = () => pace(`gsc:${conn.property}`, pauseMs);
      const f = deps.google!.fetch;

      // 1. totals by date (one request covers ≤ 16 months)
      const totals = await gscQueryAll(deps.google!.endpoints, token, conn.property, { startDate: plan.totals.start, endDate: plan.totals.end, dimensions: ["date"], dataState: "all" }, { pause, fetch: f });
      requests += totals.requests;
      const first = totals.firstIncompleteDate;

      // 2. details, one day at a time, written in batches (each batch one transaction)
      let detailRows = 0;
      let buf: { days: string[]; q: DetailRow[]; p: PageRow[] } = { days: [], q: [], p: [] };
      const flush = async () => {
        if (!buf.days.length) return;
        const b = buf;
        buf = { days: [], q: [], p: [] };
        await withWorkspace(deps.db, ctx, async (tx) => {
          await tx.action("search.sync_details");
          await tx.exec("DELETE FROM gsc_query_daily WHERE site_id = $1 AND day = ANY($2::date[])", [siteId, b.days]);
          await tx.exec("DELETE FROM gsc_page_daily WHERE site_id = $1 AND day = ANY($2::date[])", [siteId, b.days]);
          for (let i = 0; i < b.q.length; i += 5000) {
            await tx.exec(
              `INSERT INTO gsc_query_daily (workspace_id, site_id, day, query, page, clicks, impressions, position)
               SELECT $1, $2, r.day, r.query, r.page, r.clicks, r.impressions, r.position FROM jsonb_to_recordset($3::jsonb) AS r(day date, query text, page text, clicks int, impressions int, position numeric)
               ON CONFLICT (site_id, day, query, page) DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, position = EXCLUDED.position`,
              [ctx.workspaceId, siteId, JSON.stringify(b.q.slice(i, i + 5000))],
            );
          }
          for (let i = 0; i < b.p.length; i += 5000) {
            await tx.exec(
              `INSERT INTO gsc_page_daily (workspace_id, site_id, day, page, clicks, impressions, position)
               SELECT $1, $2, r.day, r.page, r.clicks, r.impressions, r.position FROM jsonb_to_recordset($3::jsonb) AS r(day date, page text, clicks int, impressions int, position numeric)
               ON CONFLICT (site_id, day, page) DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, position = EXCLUDED.position`,
              [ctx.workspaceId, siteId, JSON.stringify(b.p.slice(i, i + 5000))],
            );
          }
        });
      };
      for (const day of plan.detailDays) {
        const q = await gscQueryAll(deps.google!.endpoints, token, conn.property, { startDate: day, endDate: day, dimensions: ["query", "page"], dataState: "all" }, { pause, fetch: f });
        const p = await gscQueryAll(deps.google!.endpoints, token, conn.property, { startDate: day, endDate: day, dimensions: ["page"], dataState: "all" }, { pause, fetch: f });
        requests += q.requests + p.requests;
        // the same (query, page) can only appear once per day; keep the first if Google ever repeats one
        const seen = new Set<string>();
        for (const r of q.rows) {
          const query = cleanText(r.keys[0], 500), page = cleanText(r.keys[1], 2048);
          const k = `${query}\u0000${page}`;
          if (!query || !page || seen.has(k)) continue;
          seen.add(k);
          buf.q.push({ day, query, page, clicks: n0(r.clicks), impressions: n0(r.impressions), position: p2(r.position) });
        }
        const seenP = new Set<string>();
        for (const r of p.rows) {
          const page = cleanText(r.keys[0], 2048);
          if (!page || seenP.has(page)) continue;
          seenP.add(page);
          buf.p.push({ day, page, clicks: n0(r.clicks), impressions: n0(r.impressions), position: p2(r.position) });
        }
        buf.days.push(day);
        detailRows += q.rows.length;
        if (buf.q.length + buf.p.length >= 20_000) await flush();
      }
      await flush();

      // 3. totals and the state, in one transaction
      const totalRows = totals.rows
        .map((r) => ({ day: String(r.keys[0]), clicks: n0(r.clicks), impressions: n0(r.impressions), ctr: Math.min(1, Math.max(0, r.ctr)), position: p2(r.position) }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
      const newest = totalRows.map((r) => r.day).sort().pop() ?? state.newest_day;
      const finalThrough = first ? (first > plan.totals.start ? addDay(first, -1) : state.final_through) : plan.totals.end;
      const detail = plan.backfillDone ? `Synced through ${newest ?? plan.totals.end}${first ? ` (from ${first} provisional)` : ""}.` : `Backfilling: details stored back to ${plan.cursorAfter}; continuing to ${plan.backfillFrom}.`;
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("search.sync_totals");
        await tx.exec(
          `INSERT INTO gsc_daily (workspace_id, site_id, day, clicks, impressions, ctr, position, final, synced_at)
           SELECT $1, $2, r.day, r.clicks, r.impressions, r.ctr, r.position, r.final, $4 FROM jsonb_to_recordset($3::jsonb) AS r(day date, clicks int, impressions int, ctr numeric, position numeric, final boolean)
           ON CONFLICT (site_id, day) DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, position = EXCLUDED.position, final = EXCLUDED.final, synced_at = EXCLUDED.synced_at`,
          [ctx.workspaceId, siteId, JSON.stringify(totalRows.map((r) => ({ ...r, final: isFinalDay(r.day, first) }))), now],
        );
        // a day Google no longer reports in the range (revised to nothing) does not linger
        await tx.exec("DELETE FROM gsc_daily WHERE site_id = $1 AND day BETWEEN $2 AND $3 AND NOT (day = ANY($4::date[]))", [siteId, plan.totals.start, plan.totals.end, totalRows.map((r) => r.day)]);
        await tx.exec(
          `UPDATE search_sync_state SET status = 'ok', detail = $2, backfill_from = $3, backfill_cursor = $4, backfilled_at = CASE WHEN $5 THEN coalesce(backfilled_at, $6) ELSE backfilled_at END,
             final_through = $7, newest_day = $8, last_success_at = $6, rows_written = rows_written + $9, requests = requests + $10, failures = 0
           WHERE id = $1`,
          [state.id, detail, plan.backfillFrom, plan.cursorAfter, plan.backfillDone, now, finalThrough, newest, totalRows.length + detailRows, requests],
        );
        if (conn.status !== "ok") await setStatus(tx, conn.id, "ok", `Syncing ${conn.property} daily. ${detail}`);
        if (opts.runId) await finishRun(tx, opts.runId, "succeeded", { detail, stats: { totals: totalRows.length, detailDays: plan.detailDays.length, detailRows, requests, firstIncomplete: first }, now });
      });
      if (!plan.backfillDone && deps.enqueue) {
        await deps.enqueue(QUEUES.gscSync, { workspaceId: ctx.workspaceId, siteId, backfill: true }, { startAfter: new Date(now.getTime() + 20_000), singletonKey: `gsc-backfill:${siteId}:${plan.cursorAfter}` });
      }
      return { status: "ok" as const, detail, plan, totalDays: totalRows.length, detailRows, requests, firstIncomplete: first, backfillRemaining: !plan.backfillDone };
    }, { retryFailing: true });
  } catch (e) {
    if (e instanceof GoogleNotReadyError) return skip(e.message);
    return failSync(deps, ctx, site, "search_console", e, requests, opts.runId ?? null);
  }
}

const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Retryable (rate limit, 5xx, network): count it and rethrow for the queue's backoff. Otherwise: the sync and the connection turn red and people are told once. */
export async function failSync(deps: MeasureDeps, ctx: TenantContext, site: { id: string; domain: string }, kind: "search_console" | "ga4", e: unknown, requests: number, runId: string | null): Promise<never> {
  const now = deps.now();
  const status = e instanceof GoogleApiError ? e.status : 0;
  const retryable = e instanceof GoogleApiError && (status === 0 || status === 429 || status >= 500);
  const auth = e instanceof GoogleAuthError || status === 401 || status === 403;
  const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
  const label = kind === "search_console" ? "Search Console" : "GA4";
  const detail = retryable ? `${label} is busy or unreachable (${msg}); retrying with backoff.` : auth ? `${label} refused access (${msg}). Connect again under Connections.` : `${label} sync failed: ${msg}`;
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("search.sync_fail");
    await tx.exec(
      `UPDATE search_sync_state SET status = CASE WHEN $3 THEN status ELSE 'error' END, detail = $2, failures = failures + 1, requests = requests + $4, last_attempt_at = $5 WHERE site_id = $1 AND kind = $6`,
      [site.id, detail, retryable, requests, now, kind],
    );
    if (!retryable) {
      const conn = await tx.maybe<{ id: string }>("SELECT id FROM connections WHERE site_id = $1 AND kind = $2", [site.id, kind]);
      if (conn) await setStatus(tx, conn.id, "error", detail);
    }
    if (runId) {
      await finishRun(tx, runId, "failed", { detail, retryAfter: retryable ? now : new Date(now.getTime() + 6 * 3_600_000), now });
      if (!retryable) await alertRun(tx, ctx.workspaceId, site, kind === "search_console" ? "gsc" : "ga4", runId, `${label} sync failed`, detail, "/connections");
    }
  });
  throw e;
}
