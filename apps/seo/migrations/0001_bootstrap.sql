-- 0001 bootstrap
-- Database-wide groundwork for Lumoras Growth. Tenant tables (with row-level
-- security keyed by workspace_id) arrive in Phase 1.
--
-- schema_migrations itself is created by scripts/migrate.ts before any file
-- runs (it has to exist to record this file); its definition lives in
-- lib/db/migrate.ts (SCHEMA_MIGRATIONS_DDL).
--
-- Applied files are immutable: the runner refuses to start if this file's
-- checksum changes. Add 0002_… instead.

-- Only the owner role creates objects. The app role connects, reads and writes
-- through grants given per table in later migrations, and never owns anything,
-- so row-level security always applies to it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

COMMENT ON TABLE schema_migrations IS
  'Applied SQL migrations: filename, version, sha256 checksum, applied_at, applying role. Written only by scripts/migrate.ts as the owner role.';
