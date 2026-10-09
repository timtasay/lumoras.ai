import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MigrationChecksumError,
  MigrationError,
  checksumOf,
  loadMigrationsDir,
  parseMigrationFiles,
  planMigrations,
  DEFAULT_MIGRATIONS_DIR,
  type AppliedMigration,
} from "../../lib/db/migrate.ts";

const f = (filename: string, sql = `-- ${filename}\nSELECT 1;`) => ({ filename, sql });
const appliedFrom = (files: ReturnType<typeof parseMigrationFiles>): AppliedMigration[] =>
  files.map(({ filename, version, checksum }) => ({ filename, version, checksum }));

describe("parseMigrationFiles: ordering and names", () => {
  it("orders by numeric version, not by input order", () => {
    const files = parseMigrationFiles([f("0010_ten.sql"), f("0002_two.sql"), f("0001_bootstrap.sql"), f("0003_three.sql")]);
    assert.deepEqual(files.map((x) => x.filename), ["0001_bootstrap.sql", "0002_two.sql", "0003_three.sql", "0010_ten.sql"]);
    assert.deepEqual(files.map((x) => x.version), [1, 2, 3, 10]);
  });

  it("ignores non-SQL files such as a README", () => {
    const files = parseMigrationFiles([f("README.md"), f("0001_bootstrap.sql")]);
    assert.equal(files.length, 1);
  });

  it("rejects badly named SQL files, naming the file", () => {
    for (const bad of ["1_short.sql", "0001-dash.sql", "0001_Upper.sql", "0001_.sql", "init.sql"]) {
      assert.throws(() => parseMigrationFiles([f(bad)]), (e: unknown) => e instanceof MigrationError && e.filename === bad, bad);
    }
  });

  it("rejects two files with the same version", () => {
    assert.throws(
      () => parseMigrationFiles([f("0002_a.sql"), f("0002_b.sql")]),
      (e: unknown) => e instanceof MigrationError && /Duplicate migration version 0002/.test(e.message),
    );
  });
});

describe("checksumOf", () => {
  it("is sha256 hex and ignores CRLF vs LF", () => {
    assert.match(checksumOf("SELECT 1;\n"), /^[0-9a-f]{64}$/);
    assert.equal(checksumOf("SELECT 1;\r\nSELECT 2;\r\n"), checksumOf("SELECT 1;\nSELECT 2;\n"));
    assert.notEqual(checksumOf("SELECT 1;"), checksumOf("SELECT 2;"));
  });
});

describe("planMigrations", () => {
  const files = parseMigrationFiles([f("0001_bootstrap.sql"), f("0002_two.sql"), f("0003_three.sql")]);

  it("returns every file, in order, for an empty database", () => {
    assert.deepEqual(planMigrations(files, []).map((x) => x.filename), ["0001_bootstrap.sql", "0002_two.sql", "0003_three.sql"]);
  });

  it("returns only the files not yet applied", () => {
    assert.deepEqual(planMigrations(files, appliedFrom(files.slice(0, 1))).map((x) => x.filename), ["0002_two.sql", "0003_three.sql"]);
  });

  it("is idempotent: nothing to do once everything is applied", () => {
    assert.deepEqual(planMigrations(files, appliedFrom(files)), []);
  });

  it("refuses when an applied file's checksum changed, and names the file", () => {
    const applied = appliedFrom(files);
    const edited = parseMigrationFiles([f("0001_bootstrap.sql"), f("0002_two.sql", "SELECT 'edited';"), f("0003_three.sql")]);
    assert.throws(
      () => planMigrations(edited, applied),
      (e: unknown) =>
        e instanceof MigrationChecksumError &&
        e.filename === "0002_two.sql" &&
        e.expected === applied[1].checksum &&
        e.actual === checksumOf("SELECT 'edited';") &&
        e.message.includes("0002_two.sql"),
      `0002_two.sql was edited after it was applied (recorded checksum ${applied[1].checksum.slice(0, 12)}…, ` +
        `on disk ${checksumOf("SELECT 'edited';").slice(0, 12)}…): planMigrations must refuse`,
    );
  });

  it("refuses when an applied file was deleted", () => {
    assert.throws(
      () => planMigrations(files.slice(1), appliedFrom(files)),
      (e: unknown) => e instanceof MigrationError && e.filename === "0001_bootstrap.sql",
    );
  });

  it("refuses a new file that sorts before the latest applied one", () => {
    const withGap = parseMigrationFiles([f("0001_bootstrap.sql"), f("0003_three.sql")]);
    const late = parseMigrationFiles([f("0001_bootstrap.sql"), f("0002_late.sql"), f("0003_three.sql")]);
    assert.throws(
      () => planMigrations(late, appliedFrom(withGap)),
      (e: unknown) => e instanceof MigrationError && e.filename === "0002_late.sql",
    );
  });
});

describe("the real migrations directory", () => {
  it("parses, starts with 0001_bootstrap.sql and has no gaps", async () => {
    const files = await loadMigrationsDir(DEFAULT_MIGRATIONS_DIR);
    assert.equal(files[0]?.filename, "0001_bootstrap.sql");
    files.forEach((m, i) => assert.equal(m.version, i + 1, `${m.filename} should be version ${i + 1}`));
  });
});
