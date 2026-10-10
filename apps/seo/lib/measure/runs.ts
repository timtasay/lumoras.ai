/**
 * Measurement run bookkeeping (measurement_runs): claim a window
 * idempotently, finish it, read recent runs, and tell people when something
 * fails. Every function takes a Tx from withWorkspace(): row-level security
 * applies to all of it.
 */
import type pg from "pg";
import type { Tx } from "../db/tenant.ts";
import { notify } from "../data/workspaces.ts";
import type { Logger } from "../log.ts";
import type { Enqueue } from "../pipeline/deps.ts";
import type { GoogleDeps } from "../google/service.ts";
import type { SeoDataProvider } from "../providers/types.ts";
import type { RunMark } from "./cadence.ts";

export type RunKind = "rank" | "audit" | "backlinks" | "gsc" | "ga4" | "inspect";
export type RunStatus = "running" | "waiting" | "succeeded" | "failed" | "refused" | "skipped";
export type RunTrigger = "schedule" | "manual" | "seed" | "connect" | "cli";

/** What the measurement jobs need (a subset of PipelineDeps, so the worker passes its deps as they are). */
export type MeasureDeps = {
  db: pg.Pool;
  seo: SeoDataProvider | null;
  google: GoogleDeps | null;
  now: () => Date;
  log: Logger;
  enqueue?: Enqueue;
  /** Minimum milliseconds between two Google requests for one property (default 200: 5 per second, under Search Console's 1,200 per minute). */
  googlePauseMs?: number;
};

export const RUN_LABEL: Record<RunKind, string> = {
  rank: "Rank check",
  audit: "Site audit",
  backlinks: "Backlinks baseline",
  gsc: "Search Console sync",
  ga4: "GA4 sync",
  inspect: "URL inspection",
};

export type RunRow = {
  id: string;
  kind: RunKind;
  window_key: string;
  trigger: RunTrigger;
  status: RunStatus;
  detail: string | null;
  attempts: number;
  estimate_micros: string;
  cost_micros: string;
  provider_ref: string | null;
  stats: Record<string, unknown>;
  started_at: Date;
  finished_at: Date | null;
  retry_after: Date | null;
};

/**
 * Claims (site, kind, window) for this attempt. A new window inserts a
 * running row; a refused or failed run whose retry_after has passed is
 * re-opened (attempts + 1); anything else returns null: the work is done,
 * running, or must wait. The unique key makes a second delivery of the same
 * job a no-op.
 */
export async function claimRun(tx: Tx, workspaceId: string, siteId: string, kind: RunKind, windowKey: string, trigger: RunTrigger, actor: string, now: Date): Promise<{ id: string; retry: boolean } | null> {
  const ins = await tx.maybe<{ id: string }>(
    `INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, trigger, created_by, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (site_id, kind, window_key) DO NOTHING RETURNING id`,
    [workspaceId, siteId, kind, windowKey, trigger, actor, now],
  );
  if (ins) return { id: ins.id, retry: false };
  const cur = await tx.one<{ id: string; status: RunStatus; retry_after: Date | null }>("SELECT id, status, retry_after FROM measurement_runs WHERE site_id = $1 AND kind = $2 AND window_key = $3 FOR UPDATE", [siteId, kind, windowKey]);
  if ((cur.status === "refused" || cur.status === "failed") && (!cur.retry_after || cur.retry_after.getTime() <= now.getTime())) {
    await tx.exec("UPDATE measurement_runs SET status = 'running', attempts = attempts + 1, detail = NULL, started_at = $2, finished_at = NULL, retry_after = NULL, trigger = $3 WHERE id = $1", [cur.id, now, trigger]);
    return { id: cur.id, retry: true };
  }
  return null;
}

export async function finishRun(
  tx: Tx,
  runId: string,
  status: RunStatus,
  f: { detail?: string | null; estimateMicros?: number; costMicros?: number; stats?: Record<string, unknown>; providerRef?: string | null; retryAfter?: Date | null; now: Date },
): Promise<void> {
  await tx.exec(
    `UPDATE measurement_runs SET status = $2, detail = coalesce($3, detail), estimate_micros = coalesce($4, estimate_micros), cost_micros = coalesce($5, cost_micros),
       stats = stats || coalesce($6::jsonb, '{}'::jsonb), provider_ref = coalesce($7, provider_ref), retry_after = $8,
       finished_at = CASE WHEN $2 IN ('running', 'waiting') THEN NULL ELSE $9::timestamptz END
     WHERE id = $1`,
    [runId, status, f.detail ? f.detail.slice(0, 1000) : null, f.estimateMicros ?? null, f.costMicros ?? null, f.stats ? JSON.stringify(f.stats) : null, f.providerRef ?? null, f.retryAfter ?? null, f.now],
  );
}

/** The latest runs of one kind for a site, newest first (cadence decisions and screens). */
export function recentRuns(tx: Tx, siteId: string, kind: RunKind, limit = 12): Promise<(RunRow & RunMark)[]> {
  return tx.many<RunRow & RunMark>(
    `SELECT id, kind, window_key, trigger, status, detail, attempts, estimate_micros::text, cost_micros::text, provider_ref, stats, started_at, finished_at, retry_after
     FROM measurement_runs WHERE site_id = $1 AND kind = $2 ORDER BY started_at DESC LIMIT $3`,
    [siteId, kind, limit],
  );
}

export async function workspaceSlug(tx: Tx, workspaceId: string): Promise<string> {
  return (await tx.one<{ slug: string }>("SELECT slug FROM auth_organization WHERE id = $1", [workspaceId])).slug;
}

/**
 * Tells the workspace's owners and editors (in-app) that measurement failed or
 * was refused, once: not again while the previous run of the same kind had
 * already failed (the dashboard keeps showing it).
 */
export async function alertRun(tx: Tx, workspaceId: string, site: { id: string; domain: string }, kind: RunKind, runId: string, title: string, body: string, tab: string): Promise<boolean> {
  const prev = await tx.maybe<{ status: RunStatus }>(
    "SELECT status FROM measurement_runs WHERE site_id = $1 AND kind = $2 AND id <> $3 ORDER BY started_at DESC LIMIT 1",
    [site.id, kind, runId],
  );
  if (prev && (prev.status === "failed" || prev.status === "refused")) return false;
  const recipients = await tx.many<{ id: string }>("SELECT m.user_id AS id FROM auth_member m WHERE m.organization_id = $1 AND m.role IN ('owner', 'editor')", [workspaceId]);
  if (!recipients.length) return false;
  const slug = await workspaceSlug(tx, workspaceId);
  await notify(tx, workspaceId, recipients.map((r) => r.id), { kind: `measure-${kind}`, title: `${site.domain}: ${title}`.slice(0, 200), body: body.slice(0, 1000), href: `/w/${slug}/sites/${site.id}${tab}` });
  return true;
}

/** Waits so that calls sharing `key` are at least `ms` apart (a per-property rate limit inside one process). */
const lastCall = new Map<string, number>();
export async function pace(key: string, ms: number): Promise<void> {
  if (ms <= 0) return;
  const now = Date.now();
  const next = Math.max(now, (lastCall.get(key) ?? 0) + ms);
  lastCall.set(key, next);
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}
