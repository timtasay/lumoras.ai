/**
 * Plain-SQL migrations runner.
 *
 * - Files live in apps/seo/migrations, named NNNN_snake_name.sql, and are
 *   applied in numeric order. Other .sql names are an error; non-.sql files
 *   (a README) are ignored.
 * - Each file runs in its own transaction together with its schema_migrations
 *   row, so a failing file leaves nothing behind.
 * - The whole run holds a session advisory lock, so two containers starting at
 *   once apply each file exactly once.
 * - schema_migrations records filename, version, sha256 checksum, applied_at
 *   and the applying role. If a file that was already applied has changed on
 *   disk (checksum mismatch), or has disappeared, or a new file sorts before
 *   the last applied one, the runner refuses to do anything.
 * - It must be run as the owner role (DATABASE_URL_OWNER); see lib/env.ts.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { Logger } from "../log.ts";

export const MIGRATION_FILE_RE = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

/** pg_advisory_lock(int, int) key: "LMRS" namespace, slot 1 = schema migrations. */
export const MIGRATION_LOCK = [0x4c4d5253, 1] as const;

export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text        PRIMARY KEY,
  version     integer     NOT NULL UNIQUE,
  checksum    text        NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text        NOT NULL DEFAULT current_user,
  duration_ms integer     NOT NULL DEFAULT 0
)`;

export type MigrationFile = {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
};

export type AppliedMigration = { filename: string; version: number; checksum: string };

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly filename?: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export class MigrationChecksumError extends MigrationError {
  constructor(
    filename: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Checksum mismatch for already-applied migration ${filename}: recorded ${expected.slice(0, 12)}…, file on disk ${actual.slice(0, 12)}…. ` +
        `Applied migrations are immutable; restore the file and add a new migration instead.`,
      filename,
    );
    this.name = "MigrationChecksumError";
  }
}

/** sha256 of the file with CRLF normalised to LF, so a Windows checkout does not trip the guard. */
export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** Parses and orders migration files. Throws on bad names or duplicate versions. */
export function parseMigrationFiles(entries: { filename: string; sql: string }[]): MigrationFile[] {
  const out: MigrationFile[] = [];
  for (const { filename, sql } of entries) {
    if (!filename.endsWith(".sql")) continue;
    const m = MIGRATION_FILE_RE.exec(filename);
    if (!m) throw new MigrationError(`Bad migration filename ${filename}: expected NNNN_snake_case_name.sql`, filename);
    out.push({ version: Number(m[1]), name: m[2], filename, sql, checksum: checksumOf(sql) });
  }
  out.sort((a, b) => a.version - b.version);
  for (let i = 1; i < out.length; i++) {
    if (out[i].version === out[i - 1].version) {
      throw new MigrationError(
        `Duplicate migration version ${String(out[i].version).padStart(4, "0")}: ${out[i - 1].filename} and ${out[i].filename}`,
        out[i].filename,
      );
    }
  }
  return out;
}

/**
 * Decides what to apply. Pure, so the guards are unit-tested without a database.
 * Refuses (throws) when history and disk disagree; otherwise returns the
 * pending files in order (empty when up to date).
 */
export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationFile[] {
  const byName = new Map(files.map((f) => [f.filename, f]));
  let maxApplied = 0;
  for (const a of applied) {
    const f = byName.get(a.filename);
    if (!f) throw new MigrationError(`Applied migration ${a.filename} is missing from the migrations directory`, a.filename);
    if (f.checksum !== a.checksum) throw new MigrationChecksumError(a.filename, a.checksum, f.checksum);
    maxApplied = Math.max(maxApplied, a.version);
  }
  const done = new Set(applied.map((a) => a.filename));
  const pending = files.filter((f) => !done.has(f.filename));
  const early = pending.find((f) => f.version < maxApplied);
  if (early) {
    throw new MigrationError(
      `Migration ${early.filename} sorts before the latest applied migration (version ${maxApplied}); renumber it after that one`,
      early.filename,
    );
  }
  return pending;
}

export async function loadMigrationsDir(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql"));
  const entries = await Promise.all(
    names.map(async (filename) => ({ filename, sql: await readFile(path.join(dir, filename), "utf8") })),
  );
  return parseMigrationFiles(entries);
}

export type RunResult = { applied: string[]; upToDate: number; pending: string[] };

type Queryable = Pick<pg.Client, "query">;

async function readApplied(client: Queryable): Promise<AppliedMigration[]> {
  const r = await client.query<AppliedMigration>(
    "SELECT filename, version, checksum FROM schema_migrations ORDER BY version",
  );
  return r.rows;
}

/**
 * Applies pending migrations from `dir` using a dedicated connection.
 * Resolves with what was applied; rejects with a MigrationError naming the file
 * on any guard failure or SQL error (earlier files stay applied).
 */
export async function runMigrations(opts: {
  connectionString: string;
  dir: string;
  log?: Logger;
  /** Only report; apply nothing. */
  dryRun?: boolean;
}): Promise<RunResult> {
  const { dir, log } = opts;
  const client = new pg.Client({ connectionString: opts.connectionString, application_name: "lumoras-seo-migrate" });
  await client.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::int, $2::int)", [...MIGRATION_LOCK]);
    locked = true;
    await client.query(SCHEMA_MIGRATIONS_DDL);
    const files = await loadMigrationsDir(dir);
    const applied = await readApplied(client);
    const pending = planMigrations(files, applied);
    log?.info("migrations planned", { onDisk: files.length, applied: applied.length, pending: pending.map((p) => p.filename) });
    if (opts.dryRun) return { applied: [], upToDate: applied.length, pending: pending.map((p) => p.filename) };

    const done: string[] = [];
    for (const f of pending) {
      const t0 = Date.now();
      try {
        await client.query("BEGIN");
        await client.query(f.sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, version, checksum, duration_ms) VALUES ($1, $2, $3, $4)",
          [f.filename, f.version, f.checksum, Date.now() - t0],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        throw new MigrationError(`Migration ${f.filename} failed and was rolled back: ${msg}`, f.filename);
      }
      done.push(f.filename);
      log?.info("migration applied", { file: f.filename, ms: Date.now() - t0 });
    }
    return { applied: done, upToDate: applied.length, pending: [] };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [...MIGRATION_LOCK]).catch(() => {});
    await client.end().catch(() => {});
  }
}

/** Absolute path of apps/seo/migrations (works under tsx and in the image). */
export const DEFAULT_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations");
