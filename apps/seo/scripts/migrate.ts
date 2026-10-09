/**
 * Applies pending SQL migrations as the owner role, then installs or migrates
 * the job queue's schema (pg-boss, schema "pgboss") and its queues, also as
 * the owner: the web and worker connect as the app role and never run DDL.
 *
 *   pnpm --filter seo migrate            apply pending migrations
 *   pnpm --filter seo migrate --dry-run  show what would be applied
 *
 * Env: DATABASE_URL_OWNER (required), DATABASE_URL (optional, used only to
 * check the roles differ), LOG_LEVEL. Exit code 1 on any failure, so the
 * container start command stops before the web server boots.
 */
import { EnvError, readMigrateEnv } from "../lib/env.ts";
import { createLogger, redactUrl } from "../lib/log.ts";
import { DEFAULT_MIGRATIONS_DIR, MigrationError, runMigrations } from "../lib/db/migrate.ts";
import { installJobSchema } from "../lib/jobs/install.ts";

async function main(): Promise<number> {
  let env;
  try {
    env = readMigrateEnv();
  } catch (err) {
    createLogger("migrate").error("invalid environment", { problems: err instanceof EnvError ? err.problems : String(err) });
    return 1;
  }
  const log = createLogger("migrate", { level: env.logLevel });
  const dryRun = process.argv.includes("--dry-run");
  log.info("migrate start", { db: redactUrl(env.ownerUrl), dir: DEFAULT_MIGRATIONS_DIR, dryRun });
  try {
    const r = await runMigrations({ connectionString: env.ownerUrl, dir: DEFAULT_MIGRATIONS_DIR, log, dryRun });
    if (dryRun) log.info("migrate dry run: nothing applied", { wouldApply: r.pending, previouslyApplied: r.upToDate });
    else log.info(r.applied.length ? "migrate done" : "migrate: up to date", { applied: r.applied, previouslyApplied: r.upToDate });
    if (!dryRun) await installJobSchema(env.ownerUrl, (msg, fields) => log.info(msg, fields));
    return 0;
  } catch (err) {
    log.error("migrate failed", {
      file: err instanceof MigrationError ? err.filename : undefined,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
