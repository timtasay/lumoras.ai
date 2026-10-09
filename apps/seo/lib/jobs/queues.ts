/**
 * pg-boss (12.37.1, docs read 9 October 2026 at pgboss.io: constructor,
 * queues, scheduling, workers) on the same PostgreSQL, schema "pgboss".
 *
 * The schema is installed and migrated by the OWNER role at deploy time
 * (scripts/migrate.ts → installJobSchema), exactly like our SQL migrations;
 * the web and worker processes connect as the app role with migrate: false,
 * createSchema: false, so they never need DDL rights. The app role reaches
 * the pgboss schema through the grants in deploy/postgres/10-seo-database.sh.
 *
 * Queues hold ids only (workspace, site, run, item); the work itself runs
 * inside withWorkspace(), so row-level security applies to every job.
 */
import type { Queue } from "pg-boss";
import { QUEUES, type QueueName } from "../pipeline/deps.ts";

export const JOB_SCHEMA = "pgboss";

type QueueDef = Omit<Queue, "name"> & { name: QueueName };

/** Every queue, with its retry policy. `short`: at most one waiting job per singleton key. */
export const QUEUE_DEFS: QueueDef[] = [
  { name: QUEUES.tick, policy: "short", retryLimit: 0, expireInSeconds: 300 },
  { name: QUEUES.plan, policy: "short", retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
  // a step that hits a rate limit or a 5xx goes back to pending and the job retries with backoff
  { name: QUEUES.run, policy: "standard", retryLimit: 4, retryDelay: 60, retryBackoff: true, retryDelayMax: 1800, expireInSeconds: 3600 },
  { name: QUEUES.sitemaps, policy: "short", retryLimit: 0, expireInSeconds: 300 },
  { name: QUEUES.crawl, policy: "short", retryLimit: 1, retryDelay: 600, expireInSeconds: 600 },
  { name: QUEUES.links, policy: "short", retryLimit: 1, retryDelay: 600, expireInSeconds: 900 },
  { name: QUEUES.runway, policy: "short", retryLimit: 1, retryDelay: 300, expireInSeconds: 600 },
  { name: QUEUES.postPublish, policy: "standard", retryLimit: 2, retryDelay: 600, retryBackoff: true, expireInSeconds: 600 },
];

/** Recurring schedules (UTC cron). Minutes off the hour so the cluster is not hit on :00 by everyone. */
export const SCHEDULES: { queue: QueueName; cron: string; what: string }[] = [
  { queue: QUEUES.tick, cron: "*/5 * * * *", what: "lay out slots, wake rolling generation, release due publishes (per site)" },
  { queue: QUEUES.sitemaps, cron: "17 3 * * *", what: "daily sitemap refresh of every active site" },
  { queue: QUEUES.links, cron: "41 4 * * *", what: "daily external link checks for upcoming articles" },
  { queue: QUEUES.runway, cron: "7 6 * * *", what: "daily runway monitor and alerts" },
];
