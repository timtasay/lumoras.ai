#!/bin/sh
# Web container start: apply pending migrations as the owner role
# (DATABASE_URL_OWNER), then hand PID 1 to the Next.js server so it receives
# SIGTERM directly. A failed or refused migration exits non-zero and the web
# server never starts on a schema it does not match.
set -eu
node --import tsx scripts/migrate.ts
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3007}"
