/**
 * Wiring: environment → PipelineDeps, and the queues → handlers on a pg-boss
 * instance. Used by the worker process (worker/index.ts); the web process
 * only enqueues (lib/jobs/client.ts).
 */
import type pg from "pg";
import { PgBoss } from "pg-boss";
import { readKeyring, type Keyring } from "../crypto/secrets.ts";
import type { LlmEnv, OutboundEnv, WorkerEnv } from "../env.ts";
import { sendEmailWith } from "../email.ts";
import { googleEndpoints } from "../google/oauth.ts";
import { AnthropicLlm } from "../llm/anthropic.ts";
import { OpenRouterLlm } from "../llm/openrouter.ts";
import { FakeLlm } from "../llm/fake.ts";
import { RECORDED_PAGES } from "../llm/fixtures.ts";
import type { LlmProvider } from "../llm/types.ts";
import type { Logger } from "../log.ts";
import { LiveFetcher, RecordedFetcher, type PageFetcher } from "../net/fetcher.ts";
import type { SafeFetchPolicy } from "../net/safe-fetch.ts";
import { createProvider } from "../providers/registry.ts";
import { QUEUES, type Enqueue, type PipelineDeps } from "../pipeline/deps.ts";
import { handleCrawl, handleLinks, handlePlan, handlePostPublish, handleRun, handleRunway, handleSitemaps, handleTick } from "./handlers.ts";
import { JOB_SCHEMA, SCHEDULES } from "./queues.ts";
import { handleAudit, handleAuditPoll, handleBacklinks, handleGa4Sync, handleGscSync, handleInspect, handleMeasureTick, handleRank, handleRankPoll, type MeasureJob } from "./measure.ts";

/** The SSRF policy for outbound calls: test hosts resolve to loopback only when configured (tests). */
export function outboundPolicy(o: OutboundEnv, crawlerOrigins: Map<string, { address: string }> = new Map()): SafeFetchPolicy {
  const testResolve = new Map<string, string>([...o.testHosts.map((h) => [h, "127.0.0.1"] as const), ...[...crawlerOrigins].map(([d, v]) => [d, v.address] as const)]);
  return testResolve.size ? { testResolve } : {};
}

export function llmFrom(cfg: LlmEnv): LlmProvider | null {
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicLlm({ apiKey: cfg.apiKey!, baseURL: cfg.baseURL ?? undefined });
    case "openrouter":
      return new OpenRouterLlm({ apiKey: cfg.apiKey!, baseURL: cfg.baseURL ?? undefined, appUrl: process.env.BETTER_AUTH_URL?.trim() || undefined });
    case "fake":
      return new FakeLlm({ latencyMs: Number(process.env.FAKE_LLM_LATENCY_MS ?? 0) || 0 });
    default:
      return null;
  }
}

export function fetcherFrom(o: OutboundEnv, policy: SafeFetchPolicy): PageFetcher {
  return o.fetchMode === "live" ? new LiveFetcher(policy) : new RecordedFetcher(RECORDED_PAGES);
}

/** A model provider that refuses: LLM_PROVIDER=none (writing stays off and the run says why). */
const NO_LLM: LlmProvider = {
  name: "fake",
  label: "No model configured",
  async turn() {
    const { LlmError } = await import("../llm/types.ts");
    throw new LlmError("No model provider is configured (LLM_PROVIDER), so articles cannot be written yet.");
  },
};

export function workerDeps(env: WorkerEnv, db: pg.Pool, log: Logger, enqueue: Enqueue): PipelineDeps {
  let keyring: Keyring | null = null;
  try {
    keyring = readKeyring();
  } catch (e) {
    log.warn("no encryption keys: publishing (which needs stored credentials) is unavailable", { err: e instanceof Error ? e.message : String(e) });
  }
  const policy = outboundPolicy(env.outbound, env.crawlerTestOrigins);
  return {
    db,
    llm: llmFrom(env.llm) ?? NO_LLM,
    prices: env.llm.prices,
    models: env.llm.models,
    seo: createProvider(env.seoProvider),
    keyring,
    fetcher: fetcherFrom(env.outbound, policy),
    outbound: policy,
    google: env.googleOAuth && keyring ? { db, ring: keyring, endpoints: googleEndpoints(env.googleApiTestOrigin), client: env.googleOAuth } : null,
    enqueue,
    mail: (m) => sendEmailWith(env.email, { to: m.to, subject: m.subject, text: m.text, kind: m.kind }, log),
    now: () => new Date(),
    log,
    baseUrl: env.baseUrl,
  };
}

export function bossFor(databaseUrl: string, opts: { worker: boolean; max?: number }): PgBoss {
  return new PgBoss({
    connectionString: databaseUrl,
    schema: JOB_SCHEMA,
    // the owner role installs and migrates the schema (scripts/migrate.ts); this role has no DDL rights
    migrate: false,
    createSchema: false,
    // only the worker runs maintenance and the cron clock; the web process only sends
    supervise: opts.worker,
    schedule: opts.worker,
    // index rebuilds need the index owner (the owner role); never from the app role
    reindex: false,
    max: opts.max ?? 4,
    application_name: opts.worker ? "lumoras-seo-worker" : "lumoras-seo-web-jobs",
  } as ConstructorParameters<typeof PgBoss>[0]);
}

export const enqueueWith =
  (boss: PgBoss): Enqueue =>
  async (queue, data, opts = {}) => {
    await boss.send(queue, data, { ...(opts.startAfter ? { startAfter: opts.startAfter } : {}), ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}) });
  };

/** Registers every queue's handler and the recurring schedules. */
export async function registerWorkers(boss: PgBoss, deps: PipelineDeps, env: Pick<WorkerEnv, "concurrency" | "crawlerTestOrigins"> & { googlePauseMs?: number }): Promise<void> {
  const each = <T>(fn: (data: T) => Promise<unknown>) => async (jobs: { data: T }[]) => {
    for (const j of jobs) await fn(j.data);
  };
  const poll = { pollingIntervalSeconds: 2 };
  await boss.work(QUEUES.tick, poll, each(() => handleTick(deps)));
  await boss.work(QUEUES.plan, { ...poll, localConcurrency: 2 }, each((d: { workspaceId: string; siteId: string }) => handlePlan(deps, d)));
  await boss.work(QUEUES.run, { ...poll, localConcurrency: env.concurrency }, each((d: { workspaceId: string; runId: string }) => handleRun(deps, d)));
  await boss.work(QUEUES.sitemaps, poll, each(() => handleSitemaps(deps)));
  await boss.work(QUEUES.crawl, poll, each((d: { workspaceId: string; siteId: string }) => handleCrawl(deps, d, {}, env.crawlerTestOrigins)));
  await boss.work(QUEUES.links, poll, each(() => handleLinks(deps)));
  await boss.work(QUEUES.runway, poll, each(() => handleRunway(deps)));
  await boss.work(QUEUES.postPublish, poll, each((d: { workspaceId: string; siteId: string; itemId: string }) => handlePostPublish(deps, d)));
  // Phase 4: measurement
  const m = { ...deps, googlePauseMs: env.googlePauseMs };
  await boss.work(QUEUES.measureTick, poll, each(() => handleMeasureTick(m)));
  await boss.work(QUEUES.rank, { ...poll, localConcurrency: 2 }, each((d: MeasureJob) => handleRank(m, d)));
  await boss.work(QUEUES.rankPoll, poll, each((d: MeasureJob & { runId: string; attempt?: number }) => handleRankPoll(m, d)));
  await boss.work(QUEUES.gscSync, { ...poll, localConcurrency: 2 }, each((d: MeasureJob) => handleGscSync(m, d)));
  await boss.work(QUEUES.ga4Sync, { ...poll, localConcurrency: 2 }, each((d: MeasureJob) => handleGa4Sync(m, d)));
  await boss.work(QUEUES.inspect, poll, each((d: MeasureJob) => handleInspect(m, d)));
  await boss.work(QUEUES.audit, poll, each((d: MeasureJob) => handleAudit(m, d)));
  await boss.work(QUEUES.auditPoll, poll, each((d: MeasureJob & { runId: string; attempt?: number }) => handleAuditPoll(m, d)));
  await boss.work(QUEUES.backlinks, poll, each((d: MeasureJob) => handleBacklinks(m, d)));
  for (const s of SCHEDULES) await boss.schedule(s.queue, s.cron, {}, { tz: "UTC" });
}
