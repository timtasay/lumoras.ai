/**
 * The hourly measurement tick: for every active site, decide which
 * measurement work is due (pure: dueWork) and enqueue it with an idempotency
 * key (kind, site, cadence window), so a tick that fires twice, or overlaps a
 * manual run, never does the work twice.
 *
 *   rank       the site's rank cadence (weekly by default), with a provider
 *   audit      monthly by default, with a provider
 *   backlinks  quarterly by default, with a provider; a site with no snapshot
 *              yet is due at once (the onboarding baseline, or the first tick
 *              after a provider is configured)
 *   gsc        daily (Pacific day), when Search Console is connected with a property
 *   ga4        daily (site day), when GA4 is connected with a property
 *   inspect    daily (site day), when Search Console is connected
 */
import { randomUUID } from "node:crypto";
import { withActor, withWorkspace, type TenantContext } from "../db/tenant.ts";
import { getSiteSettings, type SiteSettings } from "../data/sites.ts";
import { QUEUES, type Enqueue, type QueueName } from "../pipeline/deps.ts";
import { GSC_TZ, isDue, type RunMark } from "./cadence.ts";
import { recentRuns, type MeasureDeps, type RunKind } from "./runs.ts";

export const WORKER = "system:worker";

export type DueInput = {
  site: Pick<SiteSettings, "timezone" | "status" | "rank_cadence" | "audit_cadence" | "backlinks_cadence" | "search_sync">;
  provider: boolean;
  google: boolean;
  gscReady: boolean;
  ga4Ready: boolean;
  runs: Partial<Record<RunKind, RunMark[]>>;
};

export type DueItem = { kind: RunKind; windowKey: string; retry: boolean };

export function dueWork(i: DueInput, now: Date): DueItem[] {
  if (i.site.status !== "active") return [];
  const out: DueItem[] = [];
  const add = (kind: RunKind, cadence: Parameters<typeof isDue>[0], tz: string) => {
    const d = isDue(cadence, now, tz, i.runs[kind] ?? []);
    if (d.due) out.push({ kind, windowKey: d.windowKey, retry: d.retry });
  };
  if (i.google && i.site.search_sync) {
    if (i.gscReady) add("gsc", "daily", GSC_TZ);
    if (i.ga4Ready) add("ga4", "daily", i.site.timezone);
    if (i.gscReady) add("inspect", "daily", i.site.timezone);
  }
  if (i.provider) {
    add("rank", i.site.rank_cadence, i.site.timezone);
    add("audit", i.site.audit_cadence, i.site.timezone);
    add("backlinks", i.site.backlinks_cadence, i.site.timezone);
  }
  return out;
}

export const QUEUE_FOR: Record<RunKind, QueueName> = {
  rank: QUEUES.rank,
  audit: QUEUES.audit,
  backlinks: QUEUES.backlinks,
  gsc: QUEUES.gscSync,
  ga4: QUEUES.ga4Sync,
  inspect: QUEUES.inspect,
};

export const ctxFor = (workspaceId: string): TenantContext => ({ workspaceId, actorId: WORKER, requestId: randomUUID() });

/** Reads what dueWork needs for one site, inside its workspace (row-level security applies). */
export async function dueInputFor(deps: Pick<MeasureDeps, "db" | "seo" | "google">, ctx: TenantContext, siteId: string): Promise<DueInput> {
  return withWorkspace(deps.db, ctx, async (tx) => {
    const site = await getSiteSettings(tx, siteId);
    const conns = await tx.many<{ kind: string; property: string | null }>("SELECT kind, config->>'property' AS property FROM connections WHERE site_id = $1 AND kind IN ('search_console', 'ga4')", [siteId]);
    const ready = (k: string) => conns.some((c) => c.kind === k && !!c.property);
    const runs: Partial<Record<RunKind, RunMark[]>> = {};
    for (const k of ["rank", "audit", "backlinks", "gsc", "ga4", "inspect"] as RunKind[]) runs[k] = await recentRuns(tx, siteId, k, 6);
    return { site, provider: !!deps.seo, google: !!deps.google, gscReady: ready("search_console"), ga4Ready: ready("ga4"), runs };
  }, { readOnly: true });
}

/** The tick: due work for every active site, enqueued once per window. */
export async function measureTick(deps: MeasureDeps & { enqueue: Enqueue }): Promise<{ siteId: string; due: DueItem[] }[]> {
  const sites = await withActor(deps.db, { actorId: WORKER }, (tx) => tx.many<{ workspace_id: string; site_id: string; status: string }>("SELECT workspace_id, site_id, status FROM job_sites()"), { readOnly: true });
  const now = deps.now();
  const out: { siteId: string; due: DueItem[] }[] = [];
  for (const s of sites.filter((x) => x.status === "active")) {
    const input = await dueInputFor(deps, ctxFor(s.workspace_id), s.site_id);
    const due = dueWork(input, now);
    for (const d of due) {
      await deps.enqueue(QUEUE_FOR[d.kind], { workspaceId: s.workspace_id, siteId: s.site_id, windowKey: d.windowKey, trigger: "schedule" }, { singletonKey: `${d.kind}:${s.site_id}:${d.windowKey}${d.retry ? ":retry" : ""}` });
    }
    if (due.length) out.push({ siteId: s.site_id, due });
  }
  return out;
}
