/**
 * Integration-test databases. Needs TEST_DATABASE_URL: an admin role on a
 * THROWAWAY PostgreSQL 16 server (CREATEDB + CREATEROLE). Each call creates a
 * fresh database and fresh owner/app roles with the real init script
 * (deploy/postgres/10-seo-database.sh), applies every migration as the owner,
 * and returns connection URLs. dropAll() removes everything it created.
 * When the variable is unset or the server is unreachable, `skipReason` says why
 * and the suites skip.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { DEFAULT_MIGRATIONS_DIR, runMigrations } from "../../lib/db/migrate.ts";
import { installJobSchema } from "../../lib/jobs/install.ts";

const run = promisify(execFile);
export const ADMIN_URL = process.env.TEST_DATABASE_URL;
const INIT_SCRIPT = path.resolve(import.meta.dirname, "../../deploy/postgres/10-seo-database.sh");

async function reachable(url: string | undefined): Promise<string | null> {
  if (!url) return "TEST_DATABASE_URL is not set";
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.query("SELECT 1");
    return null;
  } catch (e) {
    return `cannot reach TEST_DATABASE_URL (${e instanceof Error ? e.message : e})`;
  } finally {
    await c.end().catch(() => {});
  }
}

export const skipReason = await reachable(ADMIN_URL);
// In CI the database is part of the job: a missing or unreachable one is a failure, not a skip.
if (skipReason && process.env.CI) throw new Error(`integration tests need TEST_DATABASE_URL in CI: ${skipReason}`);

const created: { dbs: string[]; roles: string[] } = { dbs: [], roles: [] };

export async function adminQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = [], database?: string) {
  const u = new URL(ADMIN_URL!);
  if (database) u.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

export type TestDb = { name: string; owner: string; app: string; ownerUrl: string; appUrl: string; adminUrl: string };

export async function createTestDatabase(opts: { migrate?: boolean; jobs?: boolean } = {}): Promise<TestDb> {
  const id = randomBytes(4).toString("hex");
  const name = `seo_t_${id}`, owner = `seo_owner_${id}`, app = `seo_app_${id}`;
  const pw = randomBytes(12).toString("hex");
  const a = new URL(ADMIN_URL!);
  created.dbs.push(name);
  created.roles.push(app, owner);
  await run("bash", [INIT_SCRIPT], {
    env: {
      PATH: process.env.PATH ?? "",
      PGHOST: a.hostname,
      PGPORT: a.port || "5432",
      PGPASSWORD: decodeURIComponent(a.password),
      POSTGRES_USER: decodeURIComponent(a.username),
      SEO_DB_NAME: name,
      SEO_OWNER_ROLE: owner,
      SEO_APP_ROLE: app,
      SEO_OWNER_PASSWORD: pw,
      SEO_APP_PASSWORD: pw,
    } as unknown as NodeJS.ProcessEnv,
  });
  const at = (role: string) => {
    const u = new URL(ADMIN_URL!);
    u.username = role;
    u.password = pw;
    u.pathname = `/${name}`;
    return u.toString();
  };
  const adminUrl = (() => {
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${name}`;
    return u.toString();
  })();
  const t = { name, owner, app, ownerUrl: at(owner), appUrl: at(app), adminUrl };
  if (opts.migrate !== false) await runMigrations({ connectionString: t.ownerUrl, dir: DEFAULT_MIGRATIONS_DIR });
  // the job queue schema, as the owner (scripts/migrate.ts does the same at deploy)
  if (opts.migrate !== false && opts.jobs !== false) await installJobSchema(t.ownerUrl);
  return t;
}

export async function dropAll() {
  if (skipReason) return;
  for (const db of created.dbs.splice(0)) await adminQuery(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  for (const r of created.roles.splice(0)) await adminQuery(`DROP ROLE IF EXISTS ${r}`);
}
