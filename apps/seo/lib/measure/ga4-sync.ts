/**
 * The GA4 daily sync (section 9): sessions and key events (all channels and
 * organic search), organic landing pages, organic key events by name, and
 * the measurement health that decides whether any of it can be trusted.
 *
 *   - Dates use GA4's relative ranges ("89daysAgo" … "yesterday"), which the
 *     Data API resolves in the property's own time zone. Google says daily
 *     data is ready in about 12 hours and can arrive up to 7 days late, so
 *     each sync re-reads the last 7 days (the first one 90 days); a day is
 *     final once it is more than two days old.
 *   - Idempotent: the days read are replaced in one transaction.
 *   - The health check (lib/measure/health.ts) also reads the property's web
 *     data streams and key events (Admin API, read-only) and compares GA4's
 *     organic sessions with Search Console's clicks. A broken tag turns the
 *     connection red with "zero here does not mean zero traffic".
 */
import { withWorkspace, type TenantContext } from "../db/tenant.ts";
import { getSite } from "../data/sites.ts";
import { ga4ReportAll, listDataStreams, listKeyEvents } from "../google/api.ts";
import { GoogleNotReadyError, setStatus, withGoogle } from "../google/service.ts";
import { assessHealth, type MeasurementHealth } from "./health.ts";
import { failSync, stateFor } from "./gsc-sync.ts";
import { cleanText } from "./search.ts";
import { alertRun, finishRun, pace, type MeasureDeps, type RunTrigger } from "./runs.ts";

export const GA4_BACKFILL_DAYS = 90;
export const GA4_REFRESH_DAYS = 7;
const ORGANIC = "Organic Search";

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s);
const n0 = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
const k2 = (v: unknown) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100);

export type Ga4SyncResult = { status: "ok" | "skipped"; detail: string; days: number; landingRows: number; eventRows: number; requests: number; health: MeasurementHealth | null };

export async function syncGa4(deps: MeasureDeps, ctx: TenantContext, siteId: string, opts: { trigger: RunTrigger; runId?: string | null } = { trigger: "schedule" }): Promise<Ga4SyncResult> {
  const now = deps.now();
  const skip = async (detail: string): Promise<Ga4SyncResult> => {
    if (opts.runId) await withWorkspace(deps.db, ctx, async (tx) => { await tx.action("search.sync_skip"); await finishRun(tx, opts.runId!, "skipped", { detail, now }); });
    return { status: "skipped", detail, days: 0, landingRows: 0, eventRows: 0, requests: 0, health: null };
  };
  if (!deps.google) return skip("Google is not configured on this server (GOOGLE_OAUTH_CLIENT_ID).");
  const site = await withWorkspace(deps.db, ctx, (tx) => getSite(tx, siteId), { readOnly: true });
  let requests = 0;
  try {
    return await withGoogle(deps.google, ctx, siteId, "ga4", async (token, conn) => {
      const state = await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("search.sync_start");
        const s = await stateFor(tx, ctx.workspaceId, siteId, "ga4", conn.property);
        await tx.exec("UPDATE search_sync_state SET status = 'syncing', last_attempt_at = $2 WHERE id = $1", [s.id, now]);
        return s;
      });
      const back = state.last_success_at ? GA4_REFRESH_DAYS : GA4_BACKFILL_DAYS;
      const range = { startDate: `${back - 1}daysAgo`, endDate: "yesterday" };
      const e = deps.google!.endpoints, f = deps.google!.fetch;
      const pause = () => pace(`ga4:${conn.property}`, deps.googlePauseMs ?? 200);
      const byChannel = await ga4ReportAll(e, token, conn.property, { ...range, dimensions: ["date", "sessionDefaultChannelGroup"], metrics: ["sessions", "keyEvents"] }, { pause, fetch: f });
      const landing = await ga4ReportAll(e, token, conn.property, { ...range, dimensions: ["date", "landingPage"], metrics: ["sessions", "keyEvents"], filter: { field: "sessionDefaultChannelGroup", value: ORGANIC } }, { pause, fetch: f });
      const events = await ga4ReportAll(e, token, conn.property, { ...range, dimensions: ["date", "eventName"], metrics: ["keyEvents"], filter: { field: "sessionDefaultChannelGroup", value: ORGANIC }, positiveMetric: "keyEvents" }, { pause, fetch: f });
      await pause();
      const streams = await listDataStreams(e, token, conn.property, f).catch(() => null);
      await pause();
      const keyEventNames = await listKeyEvents(e, token, conn.property, f).catch(() => null);
      requests += byChannel.requests + landing.requests + events.requests + 2;

      // the days this sync covers, in the property's zone (the report says which); yesterday is the newest
      const tz = byChannel.timeZone ?? landing.timeZone ?? "UTC";
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      const end = addDay(today, -1);
      const days: string[] = [];
      for (let i = back - 1; i >= 0; i--) days.push(addDay(end, -i));
      const daily = new Map(days.map((d) => [d, { sessions: 0, key: 0, organic: 0, organicKey: 0 }]));
      for (const r of byChannel.rows) {
        const d = daily.get(ymd(String(r.date)));
        if (!d) continue;
        d.sessions += n0(r.sessions);
        d.key += k2(r.keyEvents);
        if (r.sessionDefaultChannelGroup === ORGANIC) {
          d.organic += n0(r.sessions);
          d.organicKey += k2(r.keyEvents);
        }
      }
      const landingRows = landing.rows
        .map((r) => ({ day: ymd(String(r.date)), landing_page: cleanText(r.landingPage, 2048) || "(not set)", sessions: n0(r.sessions), key_events: k2(r.keyEvents) }))
        .filter((r) => daily.has(r.day));
      const eventRows = events.rows.map((r) => ({ day: ymd(String(r.date)), event_name: cleanText(r.eventName, 200), key_events: k2(r.keyEvents) })).filter((r) => daily.has(r.day) && r.event_name);
      // GA4 can repeat a landing page that differs only in letters it then folds together; merge per (day, page)
      const merged = new Map<string, (typeof landingRows)[number]>();
      for (const r of landingRows) {
        const k = `${r.day}\u0000${r.landing_page}`;
        const m = merged.get(k);
        if (m) {
          m.sessions += r.sessions;
          m.key_events += r.key_events;
        } else merged.set(k, { ...r });
      }

      const health = await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("search.sync_analytics");
        await tx.exec("DELETE FROM ga4_daily WHERE site_id = $1 AND day = ANY($2::date[])", [siteId, days]);
        await tx.exec("DELETE FROM ga4_landing_daily WHERE site_id = $1 AND day = ANY($2::date[])", [siteId, days]);
        await tx.exec("DELETE FROM ga4_event_daily WHERE site_id = $1 AND day = ANY($2::date[])", [siteId, days]);
        await tx.exec(
          `INSERT INTO ga4_daily (workspace_id, site_id, day, sessions, key_events, organic_sessions, organic_key_events, final, synced_at)
           SELECT $1, $2, r.day, r.sessions, r.key, r.organic, r.organic_key, r.final, $4 FROM jsonb_to_recordset($3::jsonb) AS r(day date, sessions int, key numeric, organic int, organic_key numeric, final boolean)`,
          [ctx.workspaceId, siteId, JSON.stringify([...daily].map(([day, d]) => ({ day, sessions: d.sessions, key: d.key, organic: d.organic, organic_key: d.organicKey, final: day < addDay(end, -1) }))), now],
        );
        const lr = [...merged.values()];
        for (let i = 0; i < lr.length; i += 5000) {
          await tx.exec(
            `INSERT INTO ga4_landing_daily (workspace_id, site_id, day, landing_page, sessions, key_events)
             SELECT $1, $2, r.day, r.landing_page, r.sessions, r.key_events FROM jsonb_to_recordset($3::jsonb) AS r(day date, landing_page text, sessions int, key_events numeric)`,
            [ctx.workspaceId, siteId, JSON.stringify(lr.slice(i, i + 5000))],
          );
        }
        if (eventRows.length) {
          await tx.exec(
            `INSERT INTO ga4_event_daily (workspace_id, site_id, day, event_name, key_events)
             SELECT $1, $2, r.day, r.event_name, sum(r.key_events) FROM jsonb_to_recordset($3::jsonb) AS r(day date, event_name text, key_events numeric) GROUP BY r.day, r.event_name`,
            [ctx.workspaceId, siteId, JSON.stringify(eventRows)],
          );
        }
        // health over the last 14 days we hold, against Search Console's clicks on the same days
        const last14 = await tx.many<{ day: string; sessions: number; organic: number }>(
          "SELECT to_char(d::date, 'YYYY-MM-DD') AS day, coalesce(g.sessions, 0) AS sessions, coalesce(g.organic_sessions, 0) AS organic FROM generate_series($2::date - 13, $2::date, '1 day') d LEFT JOIN ga4_daily g ON g.site_id = $1 AND g.day = d::date ORDER BY d",
          [siteId, end],
        );
        const gsc = await tx.maybe<{ c: string | null; n: number }>("SELECT sum(clicks)::text AS c, count(*)::int AS n FROM gsc_daily WHERE site_id = $1 AND day BETWEEN $2::date - 13 AND $2::date", [siteId, end]);
        const notSet = await tx.one<{ n: string }>("SELECT coalesce(sum(sessions), 0)::text AS n FROM ga4_landing_daily WHERE site_id = $1 AND day BETWEEN $2::date - 13 AND $2::date AND landing_page = '(not set)'", [siteId, end]);
        const h = assessHealth({
          days: last14,
          // compare only when Search Console covers (nearly) the same fortnight
          gscClicks: gsc && gsc.n >= 10 && gsc.c !== null ? Number(gsc.c) : null,
          streams: streams ? streams.map((s) => ({ type: s.type, defaultUri: s.defaultUri })) : null,
          keyEvents: keyEventNames ? keyEventNames.length : null,
          notSetSessions: Number(notSet.n),
          domain: site.domain,
          checkedAt: now,
        });
        const detail = `Synced ${days[0]} to ${end} (${tz}). ${h.headline}`;
        await tx.exec(
          `UPDATE search_sync_state SET status = 'ok', detail = $2, newest_day = $3, final_through = $4, backfill_from = coalesce(backfill_from, $5), backfill_cursor = coalesce(backfill_cursor, $5),
             backfilled_at = coalesce(backfilled_at, $6), last_success_at = $6, rows_written = rows_written + $7, requests = requests + $8, failures = 0, health = $9::jsonb
           WHERE id = $1`,
          [state.id, detail, end, addDay(end, -2), days[0], now, days.length + merged.size + eventRows.length, requests, JSON.stringify(h)],
        );
        // the connection's light follows the measurement health: a broken tag is a failing connection
        await setStatus(tx, conn.id, h.state, h.headline);
        if (opts.runId) {
          await finishRun(tx, opts.runId, "succeeded", { detail, stats: { days: days.length, landingRows: merged.size, eventRows: eventRows.length, requests, health: h.state }, now });
          if (h.state === "error" && (state.health as { state?: string } | null)?.state !== "error") await alertRun(tx, ctx.workspaceId, site, "ga4", opts.runId, "GA4 is not measuring the site", h.signals.map((s) => s.text).join(" "), "/search");
        }
        return h;
      });
      return { status: "ok" as const, detail: health.headline, days: days.length, landingRows: merged.size, eventRows: eventRows.length, requests, health };
    }, { retryFailing: true });
  } catch (e) {
    if (e instanceof GoogleNotReadyError) return skip(e.message);
    return failSync(deps, ctx, site, "ga4", e, requests, opts.runId ?? null);
  }
}

const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
