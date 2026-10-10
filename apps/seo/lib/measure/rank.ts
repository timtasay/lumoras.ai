/**
 * Rank tracking (rule 12, section 9): every published article's target
 * keyword (queued by the pipeline's after-publish step) plus the site's saved
 * keywords that are targeted, published or ranking, checked on the site's
 * cadence (weekly by default).
 *
 * Paid data, so it goes through the one metered path:
 *   1. price first: quoteCall() prices the check with the provider's
 *      estimateCost and reads the budget; below the reserve (or without a
 *      budget) the run is recorded as refused, people are told, and the
 *      provider is never called;
 *   2. meteredCall() with the quoted price as the ceiling (a higher fresh
 *      price is refused), which holds the estimate under the workspace lock,
 *      calls the provider, settles at the real cost and writes the research
 *      log and the ledger;
 *   3. the snapshots are written in the same transaction as the charge
 *      (onSettled), so a charge never exists without its data.
 * Providers that check asynchronously (OpenSEO) answer with a run id; the run
 * waits and a poll job reads the positions with the free rankTracker.get.
 */
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { getSiteSettings, type SiteSettings } from "../data/sites.ts";
import { BudgetRefusedError, meteredCall, quoteCall, type MeterDeps } from "../metering/metered.ts";
import { ProviderError, type Market, type RankPosition } from "../providers/types.ts";
import { marketFor } from "../research/market.ts";
import { normalizeKeyword } from "../research/keywords.ts";
import { formatMicros } from "../research/money.ts";
import { QUEUES } from "../pipeline/deps.ts";
import { alertRun, claimRun, finishRun, type MeasureDeps, type RunTrigger } from "./runs.ts";

export type TrackedKeyword = { keyword: string; source: "published" | "saved"; itemId: string | null; cluster: string; volume: number | null };

/** The keywords a site tracks: published targets first, then saved keywords by volume; deduplicated; capped. */
export async function trackedKeywords(tx: Tx, siteId: string, cap: number): Promise<TrackedKeyword[]> {
  const rows = await tx.many<{ keyword: string; source: "published" | "saved"; item_id: string | null; cluster: string | null; volume: number | null }>(
    `SELECT q.keyword, 'published' AS source, q.item_id, coalesce(nullif(k.cluster, ''), ci.cluster, '') AS cluster, k.search_volume AS volume, 0 AS o
       FROM rank_tracking_queue q
       LEFT JOIN keywords k ON k.site_id = q.site_id AND k.keyword = q.keyword
       LEFT JOIN content_items ci ON ci.id = q.item_id
      WHERE q.site_id = $1 AND q.status <> 'removed'
     UNION ALL
     SELECT k.keyword, 'saved', NULL, k.cluster, k.search_volume, 1
       FROM keywords k WHERE k.site_id = $1 AND k.status IN ('targeted', 'published', 'ranking')
     ORDER BY o, volume DESC NULLS LAST, keyword`,
    [siteId],
  );
  const seen = new Set<string>();
  const out: TrackedKeyword[] = [];
  for (const r of rows) {
    const k = normalizeKeyword(r.keyword);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ keyword: k, source: r.source, itemId: r.item_id, cluster: r.cluster ?? "", volume: r.volume });
  }
  return out.slice(0, cap);
}

type Tracker = { id: string; provider_tracker_id: string };

async function ensureTracker(deps: MeasureDeps, meter: MeterDeps, ctx: TenantContext, site: SiteSettings, market: Market): Promise<Tracker> {
  const provider = meter.provider.name;
  const found = await withWorkspace(deps.db, ctx, (tx) => tx.maybe<Tracker>("SELECT id, provider_tracker_id FROM rank_trackers WHERE site_id = $1 AND provider = $2 AND market = $3 AND device = $4", [site.id, provider, market.label, site.rank_device]), { readOnly: true });
  if (found) return found;
  const made = await meteredCall(meter, { ...ctx, siteId: site.id }, { op: "rankTracker.create", params: { domain: site.domain, market, depth: site.rank_depth } });
  return withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("rank.tracker_create");
    return tx.one<Tracker>(
      `INSERT INTO rank_trackers (workspace_id, site_id, provider, provider_tracker_id, market, location_code, language_code, device, depth)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (site_id, provider, market, device) DO UPDATE SET depth = EXCLUDED.depth RETURNING id, provider_tracker_id`,
      [ctx.workspaceId, site.id, provider, made.data.trackerId, market.label, market.locationCode, market.languageCode.toLowerCase().slice(0, 3), site.rank_device, site.rank_depth],
    );
  });
}

export type RankOutcome =
  | { status: "skipped"; reason: string; runId: string | null }
  | { status: "refused"; reason: string; runId: string; estimateMicros: number }
  | { status: "succeeded"; runId: string; tracked: number; ranking: number; costMicros: number; estimateMicros: number }
  | { status: "waiting"; runId: string; providerRunId: string | null }
  | { status: "failed"; runId: string; reason: string };

/** Writes one snapshot row per tracked keyword (positions the provider did not return count as not ranking). */
async function writeSnapshots(tx: Tx, ctx: TenantContext, site: SiteSettings, trackerId: string, runId: string, market: Market, kws: TrackedKeyword[], positions: RankPosition[], at: Date): Promise<number> {
  const by = new Map(positions.map((p) => [normalizeKeyword(p.keyword), p]));
  const rows = kws.map((k) => {
    const p = by.get(k.keyword);
    const pos = p?.position ?? null;
    return { ...k, position: pos !== null && Number.isFinite(pos) && pos >= 1 && pos <= 200 ? Math.round(pos) : null, url: p?.url && /^https?:\/\//.test(p.url) ? p.url.slice(0, 2048) : null, features: (p?.serpFeatures ?? []).map((f) => String(f).slice(0, 40)).slice(0, 12) };
  });
  await tx.exec(
    `INSERT INTO rank_snapshots (workspace_id, site_id, tracker_id, run_id, keyword, source, item_id, cluster, position, url, serp_features, device, location, captured_at)
     SELECT $1, $2, $3, $4, r.keyword, r.source, r.item_id, r.cluster, r.position, r.url, ARRAY(SELECT jsonb_array_elements_text(r.features)), $5, $6, $7
     FROM jsonb_to_recordset($8::jsonb) AS r(keyword text, source text, item_id uuid, cluster text, position smallint, url text, features jsonb)
     ON CONFLICT (run_id, keyword) DO NOTHING`,
    [ctx.workspaceId, site.id, trackerId, runId, site.rank_device, market.label, at, JSON.stringify(rows.map((r) => ({ keyword: r.keyword, source: r.source, item_id: r.itemId, cluster: r.cluster.slice(0, 80), position: r.position, url: r.url, features: r.features })))],
  );
  await tx.exec("UPDATE rank_tracking_queue SET status = 'tracking' WHERE site_id = $1 AND status = 'queued'", [site.id]);
  // a published keyword that now ranks is "ranking" in the keywords table
  const ranking = rows.filter((r) => r.position !== null).map((r) => r.keyword);
  if (ranking.length) await tx.exec("UPDATE keywords SET status = 'ranking' WHERE site_id = $1 AND status = 'published' AND keyword = ANY($2)", [site.id, ranking]);
  return ranking.length;
}

export async function runRankTracking(deps: MeasureDeps, ctx: TenantContext, siteId: string, opts: { windowKey: string; trigger: RunTrigger }): Promise<RankOutcome> {
  const now = deps.now();
  const { site, kws } = await withWorkspace(deps.db, ctx, async (tx) => {
    const site = await getSiteSettings(tx, siteId);
    return { site, kws: await trackedKeywords(tx, siteId, site.rank_max_keywords) };
  }, { readOnly: true });
  if (opts.trigger === "schedule" && (site.rank_cadence === "off" || site.status !== "active")) return { status: "skipped", reason: "rank tracking is off for this site", runId: null };

  const claimed = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("rank.run");
    return claimRun(tx, ctx.workspaceId, siteId, "rank", opts.windowKey, opts.trigger, ctx.actorId, now);
  });
  if (!claimed) return { status: "skipped", reason: `already done for ${opts.windowKey}`, runId: null };
  const runId = claimed.id;
  const finish = (status: "skipped" | "refused" | "failed" | "succeeded" | "waiting", f: Parameters<typeof finishRun>[3], alert?: [string, string]) =>
    withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action(`rank.${status}`);
      await finishRun(tx, runId, status, f);
      if (alert) await alertRun(tx, ctx.workspaceId, site, "rank", runId, alert[0], alert[1], "/rankings");
    });

  if (!deps.seo) {
    await finish("skipped", { detail: "No SEO data provider is configured, so rankings cannot be checked yet.", now });
    return { status: "skipped", reason: "no provider", runId };
  }
  if (!kws.length) {
    await finish("skipped", { detail: "Nothing to track yet: publish an article or mark saved keywords as targeted.", now });
    return { status: "skipped", reason: "no keywords", runId };
  }
  const meter: MeterDeps = { db: deps.db, provider: deps.seo, now: deps.now };
  const mctx = { ...ctx, siteId };
  const market = marketFor(site);
  try {
    let tracker = await ensureTracker(deps, meter, ctx, site, market);
    try {
      await meteredCall(meter, mctx, { op: "rankTracker.add", params: { trackerId: tracker.provider_tracker_id, keywords: kws.map((k) => k.keyword) } });
    } catch (e) {
      // the provider no longer knows the tracker (deleted at OpenSEO, or a different provider instance): make a new one; history stays ours
      if (!(e instanceof ProviderError && e.opts.status === 404)) throw e;
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("rank.tracker_replace");
        await tx.exec("UPDATE rank_trackers SET provider_tracker_id = $2 WHERE id = $1", [tracker.id, `stale:${tracker.id}`]);
      });
      const made = await meteredCall(meter, mctx, { op: "rankTracker.create", params: { domain: site.domain, market, depth: site.rank_depth } });
      tracker = await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("rank.tracker_replace");
        return tx.one<Tracker>("UPDATE rank_trackers SET provider_tracker_id = $2 WHERE id = $1 RETURNING id, provider_tracker_id", [tracker.id, made.data.trackerId]);
      });
      await meteredCall(meter, mctx, { op: "rankTracker.add", params: { trackerId: tracker.provider_tracker_id, keywords: kws.map((k) => k.keyword) } });
    }
    const op = { op: "rankTracker.run" as const, params: { trackerId: tracker.provider_tracker_id, domain: site.domain, market, keywords: kws.map((k) => k.keyword), depth: site.rank_depth } };

    // 1. price first: nothing reaches the provider unless the budget allows the quoted price
    const quote = await quoteCall(meter, mctx, op);
    if (quote.refusal) {
      const text = `${quote.refusalText} The check of ${kws.length} keyword${kws.length === 1 ? "" : "s"} would cost about ${formatMicros(quote.estimate.micros)}.`;
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("rank.refuse");
        await tx.event("rank.refused", "measurement_runs", runId, { reason: quote.refusal, estimate_micros: quote.estimate.micros, keywords: kws.length });
      });
      await finish("refused", { detail: text, estimateMicros: quote.estimate.micros, retryAfter: new Date(now.getTime() + 24 * 3_600_000), now }, ["rank check refused by the budget", text]);
      return { status: "refused", reason: quote.refusal, runId, estimateMicros: quote.estimate.micros };
    }

    // 2. the metered call, held to the quoted price; 3. snapshots written with the charge
    let ranking = 0;
    const res = await meteredCall(meter, mctx, op, {
      confirmMaxMicros: quote.estimate.micros,
      onSettled: async (tx, data) => {
        if (data.positions) ranking = await writeSnapshots(tx, ctx, site, tracker.id, runId, market, kws, data.positions, now);
      },
    });
    if (!res.data.positions) {
      await finish("waiting", { detail: "The provider is checking positions; they are read when it finishes.", estimateMicros: quote.estimate.micros, costMicros: res.costMicros, providerRef: res.data.runId ?? tracker.provider_tracker_id, stats: { tracked: kws.length, trackerId: tracker.id }, now });
      if (deps.enqueue) await deps.enqueue(QUEUES.rankPoll, { workspaceId: ctx.workspaceId, siteId, runId }, { startAfter: new Date(now.getTime() + 3 * 60_000), singletonKey: `rank-poll:${runId}:1` });
      return { status: "waiting", runId, providerRunId: res.data.runId };
    }
    await finish("succeeded", { detail: `${ranking} of ${kws.length} keywords ranking in the top ${site.rank_depth}.`, estimateMicros: quote.estimate.micros, costMicros: res.costMicros, stats: { tracked: kws.length, ranking, cached: res.status === "cached" }, now });
    return { status: "succeeded", runId, tracked: kws.length, ranking, costMicros: res.costMicros, estimateMicros: quote.estimate.micros };
  } catch (e) {
    if (e instanceof BudgetRefusedError) {
      const text = `${e.message} (estimate ${formatMicros(e.estimateMicros)}).`;
      await finish("refused", { detail: text, estimateMicros: e.estimateMicros, retryAfter: new Date(now.getTime() + 24 * 3_600_000), now }, ["rank check refused by the budget", text]);
      return { status: "refused", reason: e.reason, runId, estimateMicros: e.estimateMicros };
    }
    const retryable = e instanceof ProviderError && !!e.opts.retryable;
    const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
    await finish("failed", { detail: `The rank check failed: ${msg}`, retryAfter: retryable ? now : new Date(now.getTime() + 6 * 3_600_000), now }, retryable ? undefined : ["rank check failed", msg]);
    if (retryable) throw e; // the queue retries with backoff
    return { status: "failed", runId, reason: msg };
  }
}

/** For asynchronous providers: read the positions of a waiting run (free) and finish it. */
export async function pollRankRun(deps: MeasureDeps, ctx: TenantContext, data: { siteId: string; runId: string; attempt?: number }): Promise<RankOutcome> {
  const now = deps.now();
  const run = await withWorkspace(deps.db, ctx, (tx) => tx.maybe<{ status: string; stats: { trackerId?: string }; started_at: Date }>("SELECT status, stats, started_at FROM measurement_runs WHERE id = $1 AND kind = 'rank'", [data.runId]), { readOnly: true });
  if (!run || run.status !== "waiting" || !deps.seo || !run.stats.trackerId) return { status: "skipped", reason: "not waiting", runId: data.runId };
  const { site, kws, tracker } = await withWorkspace(deps.db, ctx, async (tx) => {
    const site = await getSiteSettings(tx, data.siteId);
    return { site, kws: await trackedKeywords(tx, data.siteId, site.rank_max_keywords), tracker: await tx.one<Tracker>("SELECT id, provider_tracker_id FROM rank_trackers WHERE id = $1", [run.stats.trackerId]) };
  }, { readOnly: true });
  const meter: MeterDeps = { db: deps.db, provider: deps.seo, now: deps.now };
  const got = await meteredCall(meter, { ...ctx, siteId: site.id }, { op: "rankTracker.get", params: { trackerId: tracker.provider_tracker_id } });
  const fresh = got.data.lastCheckedAt && new Date(got.data.lastCheckedAt).getTime() >= run.started_at.getTime() - 60_000;
  if (!fresh) {
    const attempt = (data.attempt ?? 1) + 1;
    if (attempt > 20 || now.getTime() - run.started_at.getTime() > 24 * 3_600_000) {
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("rank.failed");
        await finishRun(tx, data.runId, "failed", { detail: "The provider did not finish the rank check within a day.", retryAfter: new Date(now.getTime() + 6 * 3_600_000), now });
        await alertRun(tx, ctx.workspaceId, site, "rank", data.runId, "rank check did not finish", "The provider did not finish the rank check within a day.", "/rankings");
      });
      return { status: "failed", runId: data.runId, reason: "timeout" };
    }
    if (deps.enqueue) await deps.enqueue(QUEUES.rankPoll, { workspaceId: ctx.workspaceId, siteId: site.id, runId: data.runId, attempt }, { startAfter: new Date(now.getTime() + Math.min(30, 2 ** attempt) * 60_000), singletonKey: `rank-poll:${data.runId}:${attempt}` });
    return { status: "waiting", runId: data.runId, providerRunId: null };
  }
  const ranking = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("rank.succeeded");
    const n = await writeSnapshots(tx, ctx, site, tracker.id, data.runId, marketFor(site), kws, got.data.positions, now);
    await finishRun(tx, data.runId, "succeeded", { detail: `${n} of ${kws.length} keywords ranking in the top ${site.rank_depth}.`, stats: { ranking: n }, now });
    return n;
  });
  return { status: "succeeded", runId: data.runId, tracked: kws.length, ranking, costMicros: 0, estimateMicros: 0 };
}
