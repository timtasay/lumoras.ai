/**
 * Phase 4 queue handlers: measurement. Plain functions over MeasureDeps and
 * job data (ids, a window key and a trigger only), working inside
 * withWorkspace() as "system:worker". A handler that fails for a reason a
 * retry can fix (a rate limit, a 5xx, a network error) throws, and pg-boss
 * retries with backoff; anything else is recorded on the run, the
 * connection or a notification, and the job completes.
 */
import { withWorkspace } from "../db/tenant.ts";
import { GoogleApiError } from "../google/api.ts";
import { ProviderError } from "../providers/types.ts";
import type { Enqueue } from "../pipeline/deps.ts";
import { startSiteAudit, pollSiteAudit } from "../measure/audit.ts";
import { runBacklinks } from "../measure/backlinks.ts";
import { syncGa4 } from "../measure/ga4-sync.ts";
import { syncSearchConsole } from "../measure/gsc-sync.ts";
import { inspectSite } from "../measure/inspect.ts";
import { pollRankRun, runRankTracking } from "../measure/rank.ts";
import { claimRun, type MeasureDeps, type RunKind, type RunTrigger } from "../measure/runs.ts";
import { ctxFor, measureTick } from "../measure/scheduler.ts";

export type MeasureJob = { workspaceId: string; siteId: string; windowKey?: string; trigger?: RunTrigger; backfill?: boolean };

export const isRetryable = (e: unknown) =>
  (e instanceof GoogleApiError && (e.status === 0 || e.status === 429 || e.status >= 500)) || (e instanceof ProviderError && !!e.opts.retryable);

/** Rethrows what a retry can fix; logs and swallows the rest (it is already recorded where people see it). */
async function guarded<T>(deps: MeasureDeps, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isRetryable(e)) throw e;
    deps.log.warn(`${what} failed`, { err: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return null;
  }
}

export const handleMeasureTick = (deps: MeasureDeps & { enqueue: Enqueue }) => measureTick(deps);

export function handleRank(deps: MeasureDeps, d: MeasureJob) {
  return guarded(deps, "rank check", () => runRankTracking(deps, ctxFor(d.workspaceId), d.siteId, { windowKey: d.windowKey ?? "manual", trigger: d.trigger ?? "schedule" }));
}
export function handleRankPoll(deps: MeasureDeps, d: MeasureJob & { runId: string; attempt?: number }) {
  return guarded(deps, "rank poll", () => pollRankRun(deps, ctxFor(d.workspaceId), { siteId: d.siteId, runId: d.runId, attempt: d.attempt }));
}
export function handleAudit(deps: MeasureDeps, d: MeasureJob) {
  return guarded(deps, "site audit", () => startSiteAudit(deps, ctxFor(d.workspaceId), d.siteId, { windowKey: d.windowKey ?? "manual", trigger: d.trigger ?? "schedule" }));
}
export function handleAuditPoll(deps: MeasureDeps, d: MeasureJob & { runId: string; attempt?: number }) {
  return guarded(deps, "audit poll", () => pollSiteAudit(deps, ctxFor(d.workspaceId), { siteId: d.siteId, runId: d.runId, attempt: d.attempt }));
}
export function handleBacklinks(deps: MeasureDeps, d: MeasureJob) {
  return guarded(deps, "backlinks", () => runBacklinks(deps, ctxFor(d.workspaceId), d.siteId, { windowKey: d.windowKey ?? "manual", trigger: d.trigger ?? "schedule" }));
}

/** Claims the run for a windowed job (daily syncs, inspection); backfill steps run without one. */
async function claimed(deps: MeasureDeps, d: MeasureJob, kind: RunKind): Promise<string | null | false> {
  if (d.backfill || !d.windowKey) return null;
  const ctx = ctxFor(d.workspaceId);
  const r = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action(`${kind === "inspect" ? "inspect" : "search"}.claim`);
    return claimRun(tx, d.workspaceId, d.siteId, kind, d.windowKey!, d.trigger ?? "schedule", ctx.actorId, deps.now());
  });
  return r ? r.id : false;
}

export async function handleGscSync(deps: MeasureDeps, d: MeasureJob) {
  const runId = await claimed(deps, d, "gsc");
  if (runId === false) return { skipped: "already synced in this window" };
  return guarded(deps, "Search Console sync", () => syncSearchConsole(deps, ctxFor(d.workspaceId), d.siteId, { trigger: d.trigger ?? "schedule", runId }));
}

export async function handleGa4Sync(deps: MeasureDeps, d: MeasureJob) {
  const runId = await claimed(deps, d, "ga4");
  if (runId === false) return { skipped: "already synced in this window" };
  return guarded(deps, "GA4 sync", () => syncGa4(deps, ctxFor(d.workspaceId), d.siteId, { trigger: d.trigger ?? "schedule", runId }));
}

export async function handleInspect(deps: MeasureDeps, d: MeasureJob) {
  const runId = await claimed(deps, d, "inspect");
  if (runId === false) return { skipped: "already inspected in this window" };
  return guarded(deps, "URL inspection", () => inspectSite(deps, ctxFor(d.workspaceId), d.siteId, { trigger: d.trigger ?? "schedule", runId }));
}
