/**
 * What each queue does. Handlers take PipelineDeps and plain job data (ids
 * only), work inside withWorkspace() as "system:worker" (row-level security
 * applies), and are plain functions so tests can call them without a queue.
 */
import { randomUUID } from "node:crypto";
import { withActor, withWorkspace, isUuid, type TenantContext } from "../db/tenant.ts";
import { crawlSite } from "../crawl/crawler.ts";
import { CrawlBusyError, finishCrawlRun, startCrawlRun } from "../data/crawl.ts";
import { getItem } from "../data/content.ts";
import { getSiteSettings } from "../data/sites.ts";
import { checkRunway, planSite } from "../content/planner.ts";
import { executeRun, RetryableStepError } from "../pipeline/runner.ts";
import { runLint } from "../pipeline/run-steps.ts";
import { QUEUES, type PipelineDeps } from "../pipeline/deps.ts";
import { createPublisher, publisherFor } from "../publishers/registry.ts";
import { inspectUrl } from "../google/service.ts";
import type { SafeFetchOptions } from "../net/safe-fetch.ts";

export const WORKER_ACTOR = "system:worker";

export type JobSite = { workspace_id: string; site_id: string; domain: string; timezone: string; status: string; schedule_active: boolean };

const ctxFor = (workspaceId: string): TenantContext => {
  if (!isUuid(workspaceId)) throw new Error("job data: bad workspace id");
  return { workspaceId, actorId: WORKER_ACTOR, requestId: randomUUID() };
};

/** Every site the worker visits (ids and schedule fields only; 0007 job_sites()). */
export function jobSites(deps: Pick<PipelineDeps, "db">): Promise<JobSite[]> {
  return withActor(deps.db, { actorId: WORKER_ACTOR }, (tx) => tx.many<JobSite>("SELECT * FROM job_sites()"), { readOnly: true });
}

export async function handleTick(deps: PipelineDeps): Promise<number> {
  const sites = (await jobSites(deps)).filter((s) => s.status === "active");
  for (const s of sites) await deps.enqueue(QUEUES.plan, { workspaceId: s.workspace_id, siteId: s.site_id }, { singletonKey: `plan:${s.site_id}` });
  return sites.length;
}

export async function handlePlan(deps: PipelineDeps, data: { workspaceId: string; siteId: string }) {
  return planSite(deps, ctxFor(data.workspaceId), data.siteId);
}

export async function handleRun(deps: PipelineDeps, data: { workspaceId: string; runId: string }) {
  try {
    return await executeRun(deps, ctxFor(data.workspaceId), data.runId);
  } catch (e) {
    // put back by the runner; rethrow so the queue retries with backoff
    if (e instanceof RetryableStepError) throw e;
    throw e;
  }
}

export async function handleSitemaps(deps: PipelineDeps): Promise<number> {
  const sites = (await jobSites(deps)).filter((s) => s.status === "active");
  for (const s of sites) await deps.enqueue(QUEUES.crawl, { workspaceId: s.workspace_id, siteId: s.site_id }, { singletonKey: `crawl:${s.site_id}` });
  return sites.length;
}

/** The daily sitemap refresh (deferred from Phase 1): the same crawler and storage as "Scan again". */
export async function handleCrawl(deps: PipelineDeps, data: { workspaceId: string; siteId: string }, fetch: SafeFetchOptions = {}, origins: Map<string, { origin: string }> = new Map()) {
  const ctx = ctxFor(data.workspaceId);
  let run;
  let site;
  try {
    ({ site, run } = await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("crawl.scheduled");
      const s = await getSiteSettings(tx, data.siteId);
      return { site: s, run: await startCrawlRun(tx, data.workspaceId, s.id) };
    }));
  } catch (e) {
    if (e instanceof CrawlBusyError) return { skipped: "busy" };
    throw e;
  }
  const result = await crawlSite(site.domain, { fetch: { ...fetch, policy: { ...fetch.policy, ...deps.outbound } }, origin: origins.get(site.domain)?.origin });
  const stored = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("crawl.store");
    return finishCrawlRun(tx, data.workspaceId, site.id, run.id, result);
  });
  return { status: result.status, routes: result.routes.length, added: stored.added };
}

/** Daily: re-check external links (and the whole lint) of articles that are written but not yet published. */
export async function handleLinks(deps: PipelineDeps): Promise<number> {
  let n = 0;
  for (const s of await jobSites(deps)) {
    const ctx = ctxFor(s.workspace_id);
    const items = await withWorkspace(deps.db, ctx, (tx) => tx.many<{ id: string }>("SELECT id FROM content_items WHERE site_id = $1 AND status IN ('awaiting_review', 'changes_requested', 'approved') AND body_md <> ''", [s.site_id]), { readOnly: true });
    if (!items.length) continue;
    const site = await withWorkspace(deps.db, ctx, (tx) => getSiteSettings(tx, s.site_id), { readOnly: true });
    for (const it of items) {
      await runLint(deps, ctx, site, it.id);
      n++;
    }
  }
  return n;
}

export async function handleRunway(deps: PipelineDeps): Promise<number> {
  const sites = (await jobSites(deps)).filter((s) => s.status === "active");
  for (const s of sites) await checkRunway(deps, ctxFor(s.workspace_id), s.site_id);
  return sites.length;
}

/** After publishing: was the pull request merged? Does the live URL answer 200? What does Search Console say? */
export async function handlePostPublish(deps: PipelineDeps, data: { workspaceId: string; siteId: string; itemId: string; hours?: number }) {
  const ctx = ctxFor(data.workspaceId);
  const { item, site, pub } = await withWorkspace(
    deps.db,
    ctx,
    async (tx) => ({
      item: await getItem(tx, data.itemId),
      site: await getSiteSettings(tx, data.siteId),
      pub: await tx.maybe<{ id: string; status: string; connection_id: string | null; path: string | null; remote_id: string | null; branch: string | null; pr_number: number | null; commit_sha: string | null }>(
        "SELECT id, status, connection_id, path, remote_id, branch, pr_number, commit_sha FROM publications WHERE item_id = $1 AND status IN ('open', 'merged', 'published') ORDER BY created_at DESC LIMIT 1",
        [data.itemId],
      ),
    }),
    { readOnly: true },
  );
  if (!pub) return { skipped: "no publication" };
  const out: Record<string, unknown> = {};
  if (pub.status === "open" && pub.connection_id && deps.keyring) {
    const st = await withWorkspace(deps.db, ctx, (tx) => publisherFor(tx, deps.keyring!, data.workspaceId, pub.connection_id!, { domain: site.domain }, deps.outbound, deps.publisherFactory ?? createPublisher), { readOnly: true }).then(({ publisher }) =>
      publisher.status({ path: pub.path, remoteId: pub.remote_id, branch: pub.branch, prNumber: pub.pr_number, commitSha: pub.commit_sha }),
    );
    out.publication = st;
    if (st.status !== "open") {
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("content.publication_status");
        await tx.exec("UPDATE publications SET status = $2 WHERE id = $1", [pub.id, st.status === "merged" ? "merged" : st.status === "closed" ? "closed" : pub.status]);
      });
    }
  }
  if (item.live_url) {
    const r = await deps.fetcher.checkLink(item.live_url);
    out.live = r;
    let indexing: unknown = null;
    if (r.ok && deps.google) indexing = await inspectUrl(deps.google, ctx, site.id, item.live_url).catch((e: unknown) => ({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }));
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("content.live_check");
      await tx.exec("UPDATE publications SET live_status = $2, live_checked_at = $3, indexing = coalesce($4::jsonb, indexing) WHERE id = $1", [pub.id, r.status, deps.now(), indexing ? JSON.stringify(indexing) : null]);
    });
    out.indexing = indexing;
  }
  return out;
}
