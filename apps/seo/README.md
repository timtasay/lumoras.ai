# Lumoras Growth (`apps/seo`)

A multi-client SEO, content and marketing platform: each client workspace connects its sites
and has research, writing, fact-checking, publishing and measurement run from one place.
"Lumoras Growth" is a working name (owner decision #1). The full brief is
[`docs/seo-platform-build-prompt.md`](../../docs/seo-platform-build-prompt.md).

**Status: Phase 0 (foundations).** What exists, what was verified and what is open:
[`docs/phase-0-summary.md`](docs/phase-0-summary.md). Deferred work and workarounds:
[`docs/open-work.md`](docs/open-work.md).

## What exists now

```
packages/ui-tokens   @lumoras/ui-tokens  Voice Core tokens (both themes), theme logic + <ThemeControl>
packages/ui-field    @lumoras/ui-field   the Spectrum particle field engine (canvas)
apps/web             lumoras.ai           imports both packages (unchanged pixels)
apps/seo             this app
  app/               Next.js 16.4 App Router: / (Phase 0 overview), /design (dev only), /api/health
  components/        ui/ (buttons, fields, status, KPI, table, tabs, toast, modal, ⌘K, calendar…),
                     charts/ (hand-written SVG), pipeline/ (run view), shell/ (app frame), design/
  lib/               env.ts (env validation), log.ts (JSON logs), db/migrate.ts (runner), ui/ (motion, format, contrast)
  migrations/        numbered SQL files (0001_bootstrap.sql)
  scripts/migrate.ts applies migrations as the owner role
  worker/index.ts    background worker entry (same image, different command)
  test/unit, test/integration   node --test + tsx
  e2e/               Playwright
  deploy/            docker-compose.yml, Caddyfile.snippet, postgres/10-seo-database.sh (files only)
  Dockerfile, docker/start-web.sh
```

Conventions match `apps/web`: plain CSS on design tokens (no Tailwind, no CSS-in-JS), strict
TypeScript, `eslint-config-next`, every dependency pinned to an exact version.

### Planned (later phases)

Phase 1 tenancy (Better Auth, workspaces, roles, row-level security on every tenant table keyed by
`workspace_id`, audit log, sites, brand profiles, onboarding), Phase 2 research (`SeoDataProvider`,
budgets, research log), Phase 3 the content pipeline (pg-boss jobs in `worker/`, the ten steps,
publishers), Phase 4 measurement, Phase 5 WordPress, social and backlinks, Phase 6 billing.
Each phase starts only when the owner approves the previous one.

## Local setup

Requirements: Node 22, pnpm 10.28 (`corepack enable`), PostgreSQL 16.

```bash
pnpm install                       # from the repository root
cp apps/seo/.env.example apps/seo/.env.local
```

### Postgres

With Docker:

```bash
docker run -d --name seo-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
# create the seo database, the owner role and the app role (same script as production)
docker exec -i -e SEO_OWNER_PASSWORD=owner-dev -e SEO_APP_PASSWORD=app-dev seo-pg \
  bash -s < apps/seo/deploy/postgres/10-seo-database.sh
```

Without Docker (any local PostgreSQL 16 where you are a superuser):

```bash
PGHOST=localhost PGUSER=postgres SEO_OWNER_PASSWORD=owner-dev SEO_APP_PASSWORD=app-dev \
  bash apps/seo/deploy/postgres/10-seo-database.sh
```

Then in `apps/seo/.env.local`:

```
DATABASE_URL=postgres://seo_app:app-dev@localhost:5432/seo
DATABASE_URL_OWNER=postgres://seo_owner:owner-dev@localhost:5432/seo
```

Seed data (two demo workspaces) arrives with the tenant tables in Phase 1; Phase 0 has none.

### Run

```bash
pnpm dev:seo                       # http://localhost:3007, /design is on in development
pnpm --filter seo migrate          # apply migrations (reads DATABASE_URL_OWNER)
pnpm --filter seo migrate --dry-run
pnpm --filter seo worker           # the worker process (Ctrl+C or SIGTERM stops it cleanly)
```

Next.js loads `.env.local` for `dev` and `start`; the `migrate` and `worker` scripts do not, so
export the variables in your shell first (`set -a; . apps/seo/.env.local; set +a`).

## Migrations

- One file per change in `migrations/`, named `NNNN_snake_case.sql`, applied in numeric order.
- Each file runs in its own transaction together with its `schema_migrations` row
  (`filename`, `version`, `checksum` sha256, `applied_at`, `applied_by`, `duration_ms`).
- The run holds a PostgreSQL advisory lock, so two containers starting together apply each file once.
- **Applied files are immutable.** If an applied file's checksum changes, a file goes missing,
  or a new file sorts before the last applied one, the runner refuses to run anything. Add a new
  file instead of editing an old one.
- Migrations run as the **owner role** (`DATABASE_URL_OWNER`). The runner refuses if that is the
  same role as `DATABASE_URL`. The app role never owns objects, so row-level security binds it.
- In the container, `docker/start-web.sh` runs the migrations, then starts the web server; a
  failed migration stops the container. The worker starts only after the web container is healthy.
- Statements that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`) are not supported
  yet; see `docs/open-work.md`.

## Tests

```bash
pnpm --filter seo test:unit        # node --test + tsx: migration planning, env, worker SIGTERM
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  pnpm --filter seo test           # unit + integration (real PostgreSQL; skipped when unset/unreachable)
pnpm --filter seo build && pnpm --filter seo test:e2e   # Playwright against the production build
```

`TEST_DATABASE_URL` must point at a throwaway server: the integration test creates and drops
its own databases and roles. Playwright downloads its browser with
`pnpm --filter seo exec playwright install chromium`, or uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

From the repository root, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and
`pnpm test:e2e` run across the workspace; CI (`.github/workflows/ci.yml`) runs the same.

## Design system

`/design` shows every token, component and motion pattern in both themes, with live WCAG
contrast ratios. It exists in development, and in a production build only with
`ENABLE_DESIGN_ROUTE=1`; otherwise it is a 404.

Tokens live in `@lumoras/ui-tokens` (`tokens.css`): Part 1 is lumoras.ai's palette, moved verbatim
(changing it changes lumoras.ai); Part 2 adds the product scales (motion durations and easings,
radii, spacing, type, semantic states, chart series, elevation). Motion rules: feedback
120–200 ms, panels and routes 250–400 ms, ease-out entering and ease-in leaving, transform and
opacity only, a reduced-motion equivalent for everything, canvas paused when hidden or off screen.

## Deploy (files only)

`deploy/docker-compose.yml` defines `lumoras-seo` (web, port 3007) and `lumoras-seo-worker` from
one image on the external `lumoras_internal` network. `deploy/Caddyfile.snippet` is the route
(host name placeholder `growth.lumoras.ai`, pending owner decision #1).
`deploy/postgres/10-seo-database.sh` creates the database and roles. Nothing has been deployed;
the owner deploys.

```bash
docker build -f apps/seo/Dockerfile -t lumoras-seo .   # from the repository root
```

## Adding a publisher or a data provider

The interfaces arrive with their phases (`SeoDataProvider` in Phase 2, `Publisher` in Phase 3,
`SocialPublisher` in Phase 5). The plan: one module per implementation under `lib/providers/` or
`lib/publishers/`, registered in one map, with recorded fixtures for tests (no real credits in the
suite). This section will describe the concrete steps once the first implementation exists.
