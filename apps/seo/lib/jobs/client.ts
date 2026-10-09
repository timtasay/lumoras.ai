/**
 * The web process's side of the job queue: it only sends (a reviewer's
 * approval schedules the publish, "Run now" queues a run, a retry queues the
 * step). One lazily started pg-boss instance per process, with no
 * maintenance and no cron clock (the worker owns those) and no DDL.
 * Server-side only.
 */
import type { PgBoss } from "pg-boss";
import { log, webEnv } from "../config.ts";
import { bossFor, enqueueWith, fetcherFrom, outboundPolicy } from "./wire.ts";
import type { Enqueue, PipelineDeps } from "../pipeline/deps.ts";
import { pool } from "../db/pool.ts";
import { keyring } from "../config.ts";
import { createProvider } from "../providers/registry.ts";

const g = globalThis as { __seoBoss?: Promise<PgBoss> };

function producer(): Promise<PgBoss> {
  g.__seoBoss ??= (async () => {
    const b = bossFor(webEnv().databaseUrl, { worker: false, max: 2 });
    b.on("error", (e) => log().warn("job queue error (web)", { err: e instanceof Error ? e.message : String(e) }));
    await b.start();
    return b;
  })().catch((e) => {
    g.__seoBoss = undefined;
    throw e;
  });
  return g.__seoBoss;
}

export const enqueue: Enqueue = async (queue, data, opts) => enqueueWith(await producer())(queue, data, opts);

/**
 * Deps for the parts of the pipeline the web process runs itself: the lint
 * after an edit, a publisher's Test button, starting or retrying a run (which
 * only queues). Model calls never happen in the web process: `llm` refuses.
 */
export function webPipelineDeps(): PipelineDeps {
  const env = webEnv();
  const policy = outboundPolicy(env.outbound, env.crawlerTestOrigins);
  let ring = null;
  try {
    ring = keyring();
  } catch {
    ring = null;
  }
  return {
    db: pool(),
    llm: {
      name: "fake",
      label: "The web process does not call models",
      async turn() {
        throw new Error("model calls run in the worker");
      },
    },
    prices: env.llm.prices,
    models: env.llm.models,
    seo: createProvider(env.seoProvider),
    keyring: ring,
    fetcher: fetcherFrom(env.outbound, policy),
    outbound: policy,
    google: null,
    enqueue,
    mail: async () => {},
    now: () => new Date(),
    log: log(),
    baseUrl: env.baseUrl,
  };
}
