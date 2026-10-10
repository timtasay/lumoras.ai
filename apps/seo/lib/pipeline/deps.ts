/**
 * Everything a pipeline run and the scheduling jobs need, passed in (never
 * read from globals), so the worker, the web app and the tests wire the same
 * code to real or fake parts.
 */
import type pg from "pg";
import type { Keyring } from "../crypto/secrets.ts";
import type { GoogleDeps } from "../google/service.ts";
import type { LlmModels, LlmProvider } from "../llm/types.ts";
import type { PriceTable } from "../llm/prices.ts";
import type { Logger } from "../log.ts";
import type { PageFetcher } from "../net/fetcher.ts";
import type { SafeFetchPolicy } from "../net/safe-fetch.ts";
import type { SeoDataProvider } from "../providers/types.ts";
import type { PublisherFactory } from "../publishers/registry.ts";

export const QUEUES = {
  /** Every few minutes: one site.plan job per site. */
  tick: "schedule-tick",
  /** Lay out slots, wake rolling generation, release due publishes, recompute the runway (one site). */
  plan: "site-plan",
  /** Execute (or resume) a pipeline run. */
  run: "pipeline-run",
  /** Daily: refresh every active site's route inventory from its sitemaps. */
  sitemaps: "sitemap-refresh",
  crawl: "sitemap-crawl",
  /** Daily: re-check external links of upcoming articles. */
  links: "link-check",
  /** Daily: runway monitor and alerts for every site. */
  runway: "runway-check",
  /** After publishing: PR merged? live URL 200? Search Console inspection. */
  postPublish: "post-publish-check",
  // Phase 4: measurement
  /** Hourly: for every site, enqueue the measurement work that is due (cadences, daily syncs). */
  measureTick: "measure-tick",
  /** One rank check of a site (priced first, metered). */
  rank: "rank-run",
  /** Asynchronous providers: read the positions of a waiting rank check. */
  rankPoll: "rank-poll",
  /** Search Console daily sync (and backfill steps). */
  gscSync: "gsc-sync",
  /** GA4 daily sync and measurement health. */
  ga4Sync: "ga4-sync",
  /** URL Inspection of new publications (read-only, rate-limited). */
  inspect: "url-inspect",
  /** Start a site audit (priced first, metered). */
  audit: "site-audit",
  /** Poll a running audit; read its issues when done. */
  auditPoll: "site-audit-poll",
  /** Backlinks baseline / quarterly snapshot for the site and its competitors. */
  backlinks: "backlinks-run",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type EnqueueOptions = { startAfter?: Date; singletonKey?: string };
export type Enqueue = (queue: QueueName, data: Record<string, unknown>, opts?: EnqueueOptions) => Promise<void>;

export type Mail = { to: string; subject: string; text: string; kind: "runway-alert" | "review-request" };
export type Mailer = (m: Mail) => Promise<void>;

export type PipelineDeps = {
  db: pg.Pool;
  llm: LlmProvider;
  prices: PriceTable;
  models: LlmModels;
  /** The SEO data provider (null: paid research unavailable; topic selection then uses saved ideas and free signals only). */
  seo: SeoDataProvider | null;
  keyring: Keyring | null;
  fetcher: PageFetcher;
  /** SSRF policy for publishers (test hosts only in tests). */
  outbound: SafeFetchPolicy;
  google: GoogleDeps | null;
  enqueue: Enqueue;
  mail: Mailer;
  now: () => Date;
  log: Logger;
  /** Public origin of the app (links in emails). */
  baseUrl: string;
  publisherFactory?: PublisherFactory;
};

export class StepError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "StepError";
  }
}
