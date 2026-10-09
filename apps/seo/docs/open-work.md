# Open work (Lumoras Growth)

Things deferred, worked around, or waiting on someone. Each item says what it stands in for.
Phase 0, 9 October 2026.

## Waiting on the owner

- **Product name and host name** (decision #1). "Lumoras Growth" and `growth.lumoras.ai` are
  placeholders in `components/shell/nav.ts`, `deploy/Caddyfile.snippet` and the docs.
- **Postgres init style.** The prompt asks for the database to be created "the same way as"
  `phonon-orchestration-hub/docker/vps3/postgres/init/01-databases.sh`. That repository was not
  accessible to this session, so `deploy/postgres/10-seo-database.sh` is self-contained (roles
  `seo_owner` / `seo_app`, database `seo`). Compare it with `01-databases.sh` and align names,
  password handling and style before running it on VPS3.
- **Server env file.** `deploy/docker-compose.yml` expects `/opt/lumoras/env/lumoras-seo.env`
  (by analogy with `lumoras-web.env`). It does not exist; the owner creates it from `.env.example`.

## Deferred to a later phase

- **Content Security Policy.** `next.config.ts` sets baseline headers only. A strict, nonce-based
  CSP (the pre-paint theme script is inline) lands with auth in Phase 1, together with CSRF
  protection and rate limits.
- **Tenant tables, RLS, seed data.** Phase 0 creates only `schema_migrations` and locks down
  `CREATE` on `public`. Two demo workspaces arrive with the tenant tables in Phase 1.
- **pg-boss.** Not installed. `worker/index.ts` has a `TODO(Phase 3)` where the boss starts and
  stops; the worker currently only validates env, logs a heartbeat and exits cleanly on SIGTERM.
- **Non-transactional migrations.** Every file runs inside a transaction, so
  `CREATE INDEX CONCURRENTLY` cannot be used yet. Add a header marker (for example
  `-- migrate:no-transaction`) when the first such migration is needed.
- **Interfaces for providers and publishers** (`SeoDataProvider`, `Publisher`,
  `SocialPublisher`) and the README section on adding one: Phases 2, 3 and 5.
- **Pipeline run view data.** `/design` simulates the run with timers and sample data
  (`components/pipeline/steps.ts`). Phase 3 replaces the timers with server-sent events from
  persisted `pipeline_steps`.
- **Icons.** `apps/seo/components/Icons.tsx` repeats the apps/web sprite pattern and the brand
  mark with a larger icon set. If both apps keep growing icons, move the sprite into a shared
  package.

## Workarounds and environment notes

- **Docker image not built here.** The Docker daemon was not running in the build session, so
  neither `Dockerfile` (root, web) nor `apps/seo/Dockerfile` was built with `docker build`.
  Instead, each image's install and build steps were reproduced in a clean directory containing
  exactly the files the Dockerfile copies (`pnpm install --frozen-lockfile --filter <app>...`,
  then `pnpm --filter <app> build`), and `docker/start-web.sh` was run from that directory
  against a local PostgreSQL 16 (migrations applied, server answered `/api/health`). Run
  `docker build` once before the first deploy.
- **Throwaway Postgres location.** The integration test cluster could not live under the session
  scratchpad (its parent directory is private to root and the `postgres` user could not reach
  it), so it ran from `/var/tmp/lumoras-seo-pg` and was stopped and deleted afterwards.
- **Playwright pinned to 1.56.1** to match the Chromium build available offline in the build
  environment (chromium-1194). CI installs the matching browser. Upgrade Playwright on purpose,
  not by accident.
- **`tsx` at runtime.** The image runs `scripts/migrate.ts` and `worker/index.ts` through `tsx`
  (a pinned runtime dependency) rather than a separate compile step. Revisit if start-up time or
  image size matters.
- **Chart draw-in uses `stroke-dashoffset`.** The motion rule is "transform and opacity only".
  Drawing a line along its path needs `stroke-dashoffset` on a `pathLength=1` path; it is a
  paint-only property (no layout, no shift). Bars grow with `transform: scaleY` as the rule
  asks.
- **`pnpm approve-builds`.** pnpm 10 skips install scripts for `esbuild` and `unrs-resolver`.
  Neither needs them here (tsx resolves the platform esbuild binary from its optional
  dependency), and everything built and ran without them. If a future install fails on this,
  add them to `pnpm.onlyBuiltDependencies` in the root `package.json`.
