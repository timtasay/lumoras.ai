#!/bin/bash
# Creates the Lumoras Growth database in the shared lumoras-postgres on VPS3 (PostGIS 16-3.4).
#
# Follows phonon-orchestration-hub/docker/vps3/postgres/init/01-databases.sh (branch
# marketing-split, read 10 October 2026): one login role named after its database owns that
# database, CONNECT is revoked from everyone else, and passwords live in
# /opt/lumoras/env/postgres.env as <NAME>_DB_PASSWORD. Lumoras Growth adds one thing the other
# projects do not need: a second, restricted app role, because row-level security only binds a
# role that does not own the tables.
#
#   seo        database, owned by role seo
#   seo        owner role: runs migrations (DATABASE_URL_OWNER), owns every object
#   seo_app    app role: what the web and worker connect as (DATABASE_URL);
#              not a superuser, cannot bypass row-level security, owns nothing
#
# FILES ONLY: nothing here has been run on a server. The owner runs it.
#
# 01-databases.sh only runs when the Postgres data directory is first created, and VPS3's
# already exists, so run this once against the running container:
#
#   # add SEO_DB_PASSWORD and SEO_APP_DB_PASSWORD to /opt/lumoras/env/postgres.env first
#   set -a; . /opt/lumoras/env/postgres.env; set +a
#   docker exec -i -e SEO_DB_PASSWORD -e SEO_APP_DB_PASSWORD lumoras-postgres \
#     bash -s < /opt/lumoras/src/lumoras.ai/apps/seo/deploy/postgres/10-seo-database.sh
#
# Then add "seo" to the database list in /opt/lumoras/scripts/backup-postgres.sh
# (hub: docker/vps3/scripts/backup-postgres.sh) so it is in the nightly dump.
#
# Idempotent: re-running it changes nothing except re-applying grants and the role
# passwords. Passwords come from the environment, never from this file.
set -euo pipefail

: "${SEO_DB_PASSWORD:?set SEO_DB_PASSWORD (owner role, in postgres.env)}"
: "${SEO_APP_DB_PASSWORD:?set SEO_APP_DB_PASSWORD (app role, in postgres.env)}"
PGUSER="${POSTGRES_USER:-postgres}"
DB="${SEO_DB_NAME:-seo}"
OWNER="${SEO_OWNER_ROLE:-seo}"
APP="${SEO_APP_ROLE:-seo_app}"

psql_admin() { psql -v ON_ERROR_STOP=1 --username "$PGUSER" "$@"; }

# Roles and database (cluster level). psql variables keep passwords out of the SQL text.
psql_admin --dbname postgres \
  -v owner="$OWNER" -v app="$APP" -v db="$DB" \
  -v owner_pw="$SEO_DB_PASSWORD" -v app_pw="$SEO_APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'owner')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'owner', :'owner_pw') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app', :'app_pw') \gexec
-- the app role cannot bypass row-level security, even on tables it is granted
SELECT format('ALTER ROLE %I NOBYPASSRLS', :'app') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', :'db', :'owner', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
-- as 01-databases.sh: nobody else may connect
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'db', :'app') \gexec
SQL

# Schema privileges inside the database. Tables come from migrations (as the
# owner); default privileges give the app role DML on them, never DDL.
psql_admin --dbname "$DB" -v owner="$OWNER" -v app="$APP" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', :'owner', :'app') \gexec
-- the job queue (pg-boss) lives in its own schema, owned by the owner role, which
-- installs and migrates it (scripts/migrate.ts); the app role only reads and writes jobs.
SELECT format('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION %I', :'owner') \gexec
SELECT format('GRANT USAGE ON SCHEMA pgboss TO %I', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO %I', :'owner', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA pgboss GRANT EXECUTE ON FUNCTIONS TO %I', :'owner', :'app') \gexec
-- re-running the script after pg-boss is installed grants what already exists, too
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO %I', :'app') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO %I', :'app') \gexec
SQL

echo "seo database ready: owner role $OWNER, app role $APP"
