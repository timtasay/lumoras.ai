/**
 * Background worker: same codebase and image as the web app, started with a
 * different command (`pnpm --filter seo worker`).
 *
 * Runs pg-boss (lib/jobs) on DATABASE_URL as the app role: the content
 * pipeline, the per-site schedule (slots, rolling generation, publishing at
 * the slot time), the daily sitemap refresh, external link checks, the runway
 * monitor and post-publish checks. The schema was installed by the owner role
 * (scripts/migrate.ts) before this starts; the worker never runs DDL.
 *
 * Start-up waits for the database (retrying), so a worker started before
 * PostgreSQL is ready does not crash-loop. SIGTERM/SIGINT (docker stop) stop
 * taking new jobs, let running ones finish for up to 25 s, then exit 0; a
 * job cut off mid-step is resumed by the next worker (the step goes back to
 * pending after 15 minutes, or immediately on a retry).
 */
import pg from "pg";
import type { PgBoss } from "pg-boss";
import { EnvError, readWorkerEnv, type WorkerEnv } from "../lib/env.ts";
import { createLogger, redactUrl, type Logger } from "../lib/log.ts";
import { bossFor, enqueueWith, registerWorkers, workerDeps } from "../lib/jobs/wire.ts";

type WorkerHandle = { stop(reason: string): Promise<void> };

function startWorker(env: WorkerEnv, log: Logger): WorkerHandle {
  const startedAt = Date.now();
  let stopped = false;
  let boss: PgBoss | null = null;
  const db = new pg.Pool({ connectionString: env.databaseUrl, application_name: "lumoras-seo-worker", max: Math.max(4, env.concurrency * 2), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  db.on("error", (err) => log.warn("idle database connection lost", { err: err.message }));
  const heartbeat = setInterval(() => log.info("worker heartbeat", { uptimeS: Math.round((Date.now() - startedAt) / 1000), ready: !!boss }), env.heartbeatMs);
  log.info("worker starting", { db: redactUrl(env.databaseUrl), llm: env.llm.provider, seo: env.seoProvider.kind, fetch: env.outbound.fetchMode, pid: process.pid });

  const boot = async () => {
    for (let attempt = 1; !stopped; attempt++) {
      const b = bossFor(env.databaseUrl, { worker: true, max: 4 });
      b.on("error", (e) => log.error("job queue error", { err: e instanceof Error ? e.message : String(e) }));
      try {
        await b.start();
        if (stopped) {
          await b.stop({ graceful: false, close: true });
          return;
        }
        const deps = workerDeps(env, db, log, enqueueWith(b));
        await registerWorkers(b, deps, env);
        boss = b;
        log.info("worker ready", { queues: 8, concurrency: env.concurrency, llm: deps.llm.label });
        return;
      } catch (e) {
        await b.stop({ graceful: false, close: true }).catch(() => {});
        const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        log.warn("worker waiting for the database", { attempt, retryInMs: wait, err: e instanceof Error ? e.message.slice(0, 200) : String(e) });
        await new Promise((r) => setTimeout(r, wait).unref());
      }
    }
  };
  const booting = boot();

  let stopping: Promise<void> | null = null;
  return {
    stop(reason) {
      stopping ??= (async () => {
        log.info("worker stopping", { reason });
        stopped = true;
        clearInterval(heartbeat);
        if (boss) await boss.stop({ graceful: true, timeout: 25_000, close: true }).catch((e: unknown) => log.warn("job queue stop", { err: e instanceof Error ? e.message : String(e) }));
        await Promise.race([booting, new Promise((r) => setTimeout(r, 1000))]);
        await db.end().catch(() => {});
        log.info("worker stopped", { uptimeS: Math.round((Date.now() - startedAt) / 1000) });
      })();
      return stopping;
    },
  };
}

function main() {
  let env;
  try {
    env = readWorkerEnv();
  } catch (err) {
    createLogger("worker").error("invalid environment", { problems: err instanceof EnvError ? err.problems : String(err) });
    process.exitCode = 1;
    return;
  }
  const log = createLogger("worker", { level: env.logLevel });
  const worker = startWorker(env, log);
  const onSignal = (sig: NodeJS.Signals) => {
    worker.stop(sig).then(
      () => process.exit(0),
      (err) => {
        log.error("worker shutdown failed", { err });
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
}

main();
