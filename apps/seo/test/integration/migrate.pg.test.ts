/**
 * Migration runner against a real PostgreSQL 16.
 *
 * Needs TEST_DATABASE_URL: a role that can CREATE DATABASE and CREATE ROLE on a
 * throwaway server (never a shared or production one). Each test creates its
 * own database and drops it afterwards. Skipped automatically when the variable
 * is unset or the server cannot be reached.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  DEFAULT_MIGRATIONS_DIR,
  MigrationChecksumError,
  MigrationError,
  checksumOf,
  runMigrations,
} from "../../lib/db/migrate.ts";

const ADMIN_URL = process.env.TEST_DATABASE_URL;

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

const skipReason = await reachable(ADMIN_URL);

const suffix = () => randomBytes(4).toString("hex");
const created: { dbs: string[]; roles: string[]; dirs: string[] } = { dbs: [], roles: [], dirs: [] };

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** A fresh database owned by a fresh owner role, plus a non-superuser app role. */
async function freshDatabase() {
  const id = suffix();
  const db = `seo_mig_test_${id}`, owner = `seo_owner_${id}`, app = `seo_app_${id}`;
  const pw = randomBytes(12).toString("hex");
  await admin(async (c) => {
    await c.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await c.query(`CREATE ROLE ${app} LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await c.query(`CREATE DATABASE ${db} OWNER ${owner}`);
    await c.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await c.query(`GRANT CONNECT ON DATABASE ${db} TO ${app}`);
  });
  created.dbs.push(db);
  created.roles.push(app, owner);
  const at = (role: string) => {
    const u = new URL(ADMIN_URL!);
    u.username = role;
    u.password = pw;
    u.pathname = `/${db}`;
    return u.toString();
  };
  return { db, ownerUrl: at(owner), appUrl: at(app), owner, app };
}

async function tempMigrations(files: Record<string, string>, base = true) {
  const dir = await mkdtemp(path.join(tmpdir(), "seo-mig-"));
  created.dirs.push(dir);
  if (base) await cp(DEFAULT_MIGRATIONS_DIR, dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(dir, name), sql);
  return dir;
}

async function query<T extends pg.QueryResultRow>(url: string, sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

describe("migrations runner (PostgreSQL)", { skip: skipReason ?? false }, () => {
  after(async () => {
    if (skipReason) return;
    await admin(async (c) => {
      for (const db of created.dbs) await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      for (const r of created.roles) await c.query(`DROP ROLE IF EXISTS ${r}`);
    });
    for (const d of created.dirs) await rm(d, { recursive: true, force: true });
  });

  it("applies the real migrations as the owner and records filename, checksum and applied_at", async () => {
    const t = await freshDatabase();
    const r = await runMigrations({ connectionString: t.ownerUrl, dir: DEFAULT_MIGRATIONS_DIR });
    assert.deepEqual(r.applied, ["0001_bootstrap.sql"]);
    const rows = await query<{ filename: string; checksum: string; applied_by: string; applied_at: Date }>(
      t.ownerUrl,
      "SELECT filename, checksum, applied_by, applied_at FROM schema_migrations ORDER BY version",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].filename, "0001_bootstrap.sql");
    assert.match(rows[0].checksum, /^[0-9a-f]{64}$/);
    assert.equal(rows[0].applied_by, t.owner);
    assert.ok(rows[0].applied_at instanceof Date);
  });

  it("is idempotent: a second run applies nothing", async () => {
    const t = await freshDatabase();
    await runMigrations({ connectionString: t.ownerUrl, dir: DEFAULT_MIGRATIONS_DIR });
    const again = await runMigrations({ connectionString: t.ownerUrl, dir: DEFAULT_MIGRATIONS_DIR });
    assert.deepEqual(again.applied, []);
    assert.equal(again.upToDate, 1);
    const [{ n }] = await query<{ n: string }>(t.ownerUrl, "SELECT count(*) AS n FROM schema_migrations");
    assert.equal(Number(n), 1);
  });

  it("bootstrap leaves the app role unable to create objects", async () => {
    const t = await freshDatabase();
    await runMigrations({ connectionString: t.ownerUrl, dir: DEFAULT_MIGRATIONS_DIR });
    await assert.rejects(query(t.appUrl, "CREATE TABLE sneaky (id int)"), /permission denied for schema public/);
  });

  it("applies files in numeric order", async () => {
    const t = await freshDatabase();
    const dir = await tempMigrations({
      "0010_ten.sql": "INSERT INTO seq_probe VALUES (10);",
      "0002_probe.sql": "CREATE TABLE seq_probe (n int, at timestamptz DEFAULT clock_timestamp());",
      "0003_three.sql": "INSERT INTO seq_probe VALUES (3);",
    });
    const r = await runMigrations({ connectionString: t.ownerUrl, dir });
    assert.deepEqual(r.applied, ["0001_bootstrap.sql", "0002_probe.sql", "0003_three.sql", "0010_ten.sql"]);
    const rows = await query<{ n: number }>(t.ownerUrl, "SELECT n FROM seq_probe ORDER BY at");
    assert.deepEqual(rows.map((x) => x.n), [3, 10]);
  });

  it("rolls back a failing file completely and names it; earlier files stay applied", async () => {
    const t = await freshDatabase();
    const dir = await tempMigrations({
      "0002_half.sql": "CREATE TABLE half_done (id int);\nSELECT this_is_not_sql;",
      "0003_never.sql": "CREATE TABLE never_runs (id int);",
    });
    await assert.rejects(
      runMigrations({ connectionString: t.ownerUrl, dir }),
      (e: unknown) => e instanceof MigrationError && e.filename === "0002_half.sql" && /rolled back/.test(e.message),
    );
    const tables = await query<{ t: string }>(t.ownerUrl, "SELECT to_regclass('half_done')::text AS t UNION ALL SELECT to_regclass('never_runs')::text");
    assert.deepEqual(tables.map((x) => x.t), [null, null]);
    const applied = await query<{ filename: string }>(t.ownerUrl, "SELECT filename FROM schema_migrations");
    assert.deepEqual(applied.map((x) => x.filename), ["0001_bootstrap.sql"]);
  });

  it("refuses to continue when an applied file's checksum changed, naming the file", async () => {
    const t = await freshDatabase();
    const dir = await tempMigrations({ "0002_table.sql": "CREATE TABLE guarded (id int);" });
    await runMigrations({ connectionString: t.ownerUrl, dir });
    // edit an applied file and add a new pending one
    const [{ checksum: recorded }] = await query<{ checksum: string }>(
      t.ownerUrl,
      "SELECT checksum FROM schema_migrations WHERE filename = '0002_table.sql'",
    );
    await appendFile(path.join(dir, "0002_table.sql"), "\n-- sneaky edit\n");
    await writeFile(path.join(dir, "0003_pending.sql"), "CREATE TABLE must_not_exist (id int);");
    const onDisk = checksumOf(await readFile(path.join(dir, "0002_table.sql"), "utf8"));
    await assert.rejects(
      runMigrations({ connectionString: t.ownerUrl, dir }),
      (e: unknown) => e instanceof MigrationChecksumError && e.filename === "0002_table.sql",
      `${path.join(dir, "0002_table.sql")} was edited after it was applied (recorded checksum ${recorded.slice(0, 12)}…, ` +
        `on disk ${onDisk.slice(0, 12)}…): the runner must refuse to continue`,
    );
    const [{ t: pending }] = await query<{ t: string | null }>(t.ownerUrl, "SELECT to_regclass('must_not_exist')::text AS t");
    assert.equal(pending, null, "no later migration may run after a checksum mismatch");
  });

  it("serialises concurrent runners with the advisory lock: each file applies once", async () => {
    const t = await freshDatabase();
    const dir = await tempMigrations({
      "0002_slow.sql": "SELECT pg_sleep(0.4); CREATE TABLE slow_once (id int);",
    });
    const results = await Promise.all([
      runMigrations({ connectionString: t.ownerUrl, dir }),
      runMigrations({ connectionString: t.ownerUrl, dir }),
      runMigrations({ connectionString: t.ownerUrl, dir }),
    ]);
    const all = results.flatMap((r) => r.applied).sort();
    assert.deepEqual(all, ["0001_bootstrap.sql", "0002_slow.sql"]);
    const [{ n }] = await query<{ n: string }>(t.ownerUrl, "SELECT count(*) AS n FROM schema_migrations");
    assert.equal(Number(n), 2);
  });
});
