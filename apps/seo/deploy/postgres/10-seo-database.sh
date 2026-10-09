#!/bin/bash
# Creates the Lumoras Growth database in the shared lumoras-postgres (PostgreSQL 16):
#   seo        database, owned by seo_owner
#   seo_owner  owner role: runs migrations (DATABASE_URL_OWNER), owns every object
#   seo_app    app role: what the web and worker connect as (DATABASE_URL);
#              not a superuser, cannot bypass row-level security, owns nothing
#
# FILES ONLY: the build session did not run this on any server.
#
# The prompt asks for this to match phonon-orchestration-hub/docker/vps3/postgres/
# init/01-databases.sh. That repository was not accessible to the build session,
# so this is a self-contained script in the same spirit; compare it with
# 01-databases.sh and adapt names/style before use.
#
# Use either way:
#   1. Fresh volume: mount it into /docker-entrypoint-initdb.d/ (runs once, as POSTGRES_USER).
#   2. Existing cluster (the usual case):
#        docker exec -i -e SEO_OWNER_PASSWORD=… -e SEO_APP_PASSWORD=… lumoras-postgres \
#          bash -s < apps/seo/deploy/postgres/10-seo-database.sh
#
# Idempotent: re-running it changes nothing except re-applying grants and the
# role passwords. Passwords come from the environment, never from this file.
set -euo pipefail

: "${SEO_OWNER_PASSWORD:?set SEO_OWNER_PASSWORD}"
: "${SEO_APP_PASSWORD:?set SEO_APP_PASSWORD}"
PGUSER="${POSTGRES_USER:-postgres}"
DB="${SEO_DB_NAME:-seo}"
OWNER="${SEO_OWNER_ROLE:-seo_owner}"
APP="${SEO_APP_ROLE:-seo_app}"

psql_admin() { psql -v ON_ERROR_STOP=1 --username "$PGUSER" "$@"; }

# Roles and database (cluster level). psql variables keep passwords out of the SQL text.
psql_admin --dbname postgres \
  -v owner="$OWNER" -v app="$APP" -v db="$DB" \
  -v owner_pw="$SEO_OWNER_PASSWORD" -v app_pw="$SEO_APP_PASSWORD" <<'SQL'
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
-- Phase 3: the job queue (pg-boss) lives in its own schema, owned by the owner role, which
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
