/**
 * Background worker entry point: same codebase and image as the web app,
 * started with a different command (`pnpm --filter seo worker`).
 *
 * Phase 0: validates its environment, logs, stays up, and shuts down cleanly
 * on SIGTERM/SIGINT (docker stop). It registers no jobs yet.
 *
 * TODO(Phase 3): start pg-boss on DATABASE_URL here (no Redis), register the
 * content-pipeline, runway-monitor and measurement queues, and stop it inside
 * shutdown() with a graceful timeout so in-flight jobs finish or are retried.
 * pg-boss is deliberately not installed until those jobs exist.
 */
import { EnvError, readWorkerEnv } from "../lib/env.ts";
import { createLogger, redactUrl, type Logger } from "../lib/log.ts";

type WorkerHandle = { stop(reason: string): Promise<void> };

function startWorker(env: ReturnType<typeof readWorkerEnv>, log: Logger): WorkerHandle {
  const startedAt = Date.now();
  // Keeps the process alive and proves liveness in the logs until real queues exist.
  const heartbeat = setInterval(() => {
    log.info("worker heartbeat", { uptimeS: Math.round((Date.now() - startedAt) / 1000), jobs: 0 });
  }, env.heartbeatMs);
  log.info("worker ready", { db: redactUrl(env.databaseUrl), jobs: 0, pid: process.pid });
  let stopping: Promise<void> | null = null;
  return {
    stop(reason) {
      stopping ??= (async () => {
        log.info("worker stopping", { reason });
        clearInterval(heartbeat);
        // Phase 3: await boss.stop({ graceful: true, timeout: 25_000 }) here.
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
