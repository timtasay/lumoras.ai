# Lumoras Growth (`apps/seo`)

A multi-client SEO, content and marketing platform: each client workspace connects its sites
and has research, writing, fact-checking, publishing and measurement run from one place.
"Lumoras Growth" is a working name (owner decision #1). The full brief is
[`docs/seo-platform-build-prompt.md`](../../docs/seo-platform-build-prompt.md).

**Status: Phase 2 (research).** What exists, what was verified and what is open:
[`docs/phase-2-summary.md`](docs/phase-2-summary.md) (Phase 1: [`docs/phase-1-summary.md`](docs/phase-1-summary.md),
Phase 0: [`docs/phase-0-summary.md`](docs/phase-0-summary.md)). The SEO data provider choice (owner
decision #3) is argued in [`docs/provider-decision.md`](docs/provider-decision.md); OpenSEO's real MCP
tools are listed in [`docs/openseo-tools.md`](docs/openseo-tools.md).
Deferred work and workarounds: [`docs/open-work.md`](docs/open-work.md). External API versions
and when their docs were read: [`docs/external-apis.md`](docs/external-apis.md).

## What exists now

```
packages/ui-tokens   @lumoras/ui-tokens  Voice Core tokens (both themes), theme logic + <ThemeControl>
packages/ui-field    @lumoras/ui-field   the Spectrum particle field engine (canvas)
apps/web             lumoras.ai           imports both packages (unchanged pixels)
apps/seo             this app
  proxy.ts           per-request CSP nonce, request id, optimistic sign-in redirect
  app/(auth)/        /sign-in, /accept-invitation/:id (field behind glass)
  app/(focus)/       /onboarding and /w/:slug/onboarding/:step (the guided setup)
  app/(app)/         signed-in screens in the shell: /w/:slug (overview), /w/:slug/sites/… (overview,
                     keywords, brand, authors, connections, settings), /w/:slug/keywords,
                     /w/:slug/settings (members), /w/:slug/settings/budget, /w/:slug/audit, /agency, /agency/audit
  app/(design)/      /design (dev only)
  app/api/           auth/[...all] (Better Auth), w/:slug/sites/:id/crawl (NDJSON stream),
                     google/callback (Search Console / GA4 OAuth), w/:slug/usage (ledger CSV), health
  components/        ui/, charts/, pipeline/, shell/ (AppShell, LiveShell), auth/, onboarding/,
                     forms/ (site, brand, authors, connections, members), scan/, sites/, audit/,
                     research/ (research panel, cost confirm, keywords, log, backlog, domain overview),
                     budget/, google/ (connections, opportunities, provider status)
  lib/
    env.ts config.ts         validated environment (web, worker, migrate), read lazily
    db/                      migrate.ts (runner), pool.ts, tenant.ts (withWorkspace: the typed query layer)
    auth/                    server.ts (Better Auth), permissions.ts (the permission map),
                             app.ts (session, workspace access), audit-context.ts + audited-pool.ts
    data/                    repositories: sites, brand, authors, crawl, connections, workspaces, audit
    crypto/secrets.ts        AES-256-GCM, versioned keys, rotation
    net/                     ip.ts (address classification), safe-fetch.ts (SSRF guard)
    crawl/                   parse.ts, crawler.ts (robots → sitemaps → routes, key pages), prefill.ts
    providers/               SeoDataProvider (types.ts), fake.ts + fixtures.ts, dataforseo.ts, openseo.ts +
                             mcp-client.ts, operations.ts (cache keys, price table), registry.ts (SEO_PROVIDER)
    metering/                metered.ts (THE one call path), budget.ts (budget and reserve arithmetic)
    research/                keywords.ts (rule 6), offering.ts (rule 7), seeds.ts (rule 4), money.ts (micro-USD),
                             market.ts, service.ts, app.ts
    google/                  oauth.ts (PKCE + state), api.ts, analysis.ts, service.ts (Search Console, GA4)
    security/                csp.ts, origin.ts (CSRF check for route handlers)
    rate-limit.ts seed.ts validation.ts email.ts actions.ts
  migrations/        0001 bootstrap · 0002 auth · 0003 audit · 0004 tenancy · 0005 platform · 0006 research
  scripts/           migrate.ts, seed.ts, grant-admin.ts
  worker/index.ts    background worker entry (jobs arrive in Phase 3)
  test/unit, test/integration, test/helpers   node --test + tsx
  e2e/               Playwright (serve.ts builds a fresh database, seed and fake site per run)
  deploy/            docker-compose.yml, Caddyfile.snippet, postgres/10-seo-database.sh (files only)
```

### Architecture in one page

- **Workspace = Better Auth organization.** `workspaces.id` *is* `auth_organization.id`; a trigger
  creates the `workspaces` row in the same transaction as the organization. Roles live on
  `auth_member` (owner, editor, viewer = client reviewer); platform admins (Lumoras staff) are
  `auth_user.role = 'admin'`.
- **Tenant isolation is the database's job.** Every tenant table has row-level security enabled
  **and forced**, with one policy: `workspace_id = current_setting('app.workspace_id', true)::uuid`.
  The app connects as `seo_app` (no superuser, no BYPASSRLS, owns nothing). Every tenant query runs
  in `withWorkspace(pool, ctx, fn)` (`lib/db/tenant.ts`), which sets the workspace, actor,
  impersonator and request id with `set_config(…, true)` (transaction-local). Forget it and you see
  nothing. Better Auth's own tables are not tenant tables and have no RLS.
- **Permissions:** `lib/auth/permissions.ts` is the one map; server actions go through
  `inWorkspace(slug, permission, action, fn)` (`lib/actions.ts`); Better Auth's organization roles
  are derived from the same map.
- **Audit log:** trigger functions write `audit_log` (who, impersonator, what, before, after,
  workspace, request) in the same transaction as each write, on every tenant table and on Better
  Auth's organization, member, invitation, user and impersonation-session rows. Secrets are
  redacted to a fingerprint. The app role cannot insert, update or delete audit rows.
- **Platform admin path:** cross-workspace reads only through audited `platform_*` SECURITY DEFINER
  functions (0005), which check the actor is a platform admin and log the read first. To act inside
  a workspace, staff impersonate a member (Better Auth admin plugin), recorded as
  `impersonation.start`/`stop`.
- **Secrets:** AES-256-GCM per connection, bound to workspace and row (AAD), versioned keys
  (`ENCRYPTION_KEYS`), never sent to the browser.
- **Crawler:** robots.txt → sitemap indexes → sitemaps (gzip too) → route inventory; key pages'
  titles/descriptions pre-fill the brand profile. Every fetch goes through `safeFetch` (DNS checked
  on every hop, connection pinned to the vetted IP, size and time caps).
- **Paid data goes through one door.** `meteredCall()` (`lib/metering/metered.ts`) prices the call,
  checks the workspace's cache (provider + operation + normalised parameters; a hit is free and is
  logged as a zero-cost "cached" ledger entry), checks the provider's balance, reserves the estimate
  under a per-workspace advisory lock (so concurrent calls cannot overspend), calls the provider with no
  transaction open, then settles at the provider's actual cost and writes the research log, the ledger,
  the cache and the audit trail in one transaction. Money is integer micro-USD everywhere. The cache is
  workspace-scoped: a hit never tells one client what another researched.
- **Research rules as code:** rule 4 (no second purchase of a seed inside the site's maximum age, seed
  backlog rotation), rule 6 (near-duplicate and geographic variants collapse to one target), rule 7
  (sells / does-not-sell), all pure functions with unit tests.
- **Search Console and GA4** are connected per site with the client's own Google account (OAuth code flow
  with PKCE and state, read-only scopes, refresh token encrypted in `connections`). Never the Indexing API.
- **Security headers:** strict nonce-based CSP from `proxy.ts`; CSRF: Better Auth's origin check
  on `/api/auth/*`, Next's origin check on server actions, `lib/security/origin.ts` on our route
  handlers; SameSite=Lax httpOnly cookies; rate limits in Postgres.

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
ENCRYPTION_KEY=<openssl rand -base64 32>
```

`BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` default to development values; leave
`RESEND_API_KEY` empty and sign-in links are printed in the server log.

### Seed data (two demo workspaces)

```bash
set -a; . apps/seo/.env.local; set +a
pnpm --filter seo migrate
pnpm --filter seo seed             # idempotent; refuses next to an https BETTER_AUTH_URL
```

| Workspace | Members (sign in with a magic link from the server log) | Sites |
| --- | --- | --- |
| Lumoras | owner@ / editor@ / viewer@lumoras.example | sonorch.ai, seasonx.ai, lumoras.ai (facts from `prototypes/BRIEF.md` and `docs/content-spec.md`) |
| Northwind Dental (demo) | owner@ / editor@ / viewer@northwind-dental.example | northwind-dental.example (fictional) |

Phase 2 adds budgets for both workspaces (Lumoras: $25 SEO data a month with a $5 reserve), a seed
backlog per site, and demo research for sonorch.ai bought through the metered path from the fake
provider (synthetic fixtures; no network, no real money): three seeds, a SERP and its free repeat, the
domain overview and a dozen saved keywords. With `SEO_PROVIDER` unset in development, research runs on
the same fake provider and every screen says "Demo data".

`staff@lumoras.example` is a platform admin (agency home, impersonation). Every seeded author is
marked as demo and must be replaced by a real person. In production, make a real staff member a
platform admin with `pnpm --filter seo admin:grant name@lumoras.ai` (they must have signed in once;
recorded in the audit log).

### Run

```bash
pnpm dev:seo                       # http://localhost:3007 (sign in; /design is on in development)
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
pnpm --filter seo test:unit        # node --test + tsx: permissions, encryption, SSRF guard, crawler, validation, CSP, env,
                                   # research rules, providers (vs fake DataForSEO / OpenSEO), Google OAuth (vs fake Google)…
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  pnpm --filter seo test           # unit + integration: RLS isolation, Better Auth, audit, seed, migrations,
                                   # the metered path (cache, reserve, concurrency), Google connections
pnpm --filter seo build && TEST_DATABASE_URL=… pnpm --filter seo test:e2e   # Playwright against the production build
```

`TEST_DATABASE_URL` must point at a throwaway server: integration tests and the e2e web server
create and drop their own databases and roles (with the real init script, so `psql` must be on
PATH). Integration suites skip when it is unset locally and fail in CI. Playwright downloads its
browser with `pnpm --filter seo exec playwright install chromium`, or uses
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`; set `SCREENSHOT_DIR` to save `seo-p1-*.png` / `seo-p2-*.png` screenshots.
No test ever calls DataForSEO, OpenSEO or Google: they are local fakes (`test/helpers/fake-*.ts`).

**Proving the metering guards red:** `CACHE_TEST_SABOTAGE=shared` with the metering suite makes the
cache visible across workspaces; the reserve, cache-key and lock guards were broken by hand (see
`docs/phase-2-summary.md` for the commands and outputs).

**Proving the isolation test red:** `RLS_TEST_SABOTAGE=bypassrls` (or `policy:<table>`,
`noforce:<table>`) with `pnpm --filter seo test:integration` breaks a guard on purpose; the suite
must fail naming the table and the leaked row.

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

## Adding a tenant table

1. In a new migration: `workspace_id uuid NOT NULL`, a composite foreign key to
   `sites (workspace_id, id)` if it belongs to a site, `ENABLE` **and** `FORCE ROW LEVEL SECURITY`,
   the `<table>_tenant_isolation` policy and the `<table>_platform_read` policy (copy 0004), and
   the `audit` trigger (`audit_row_change('workspace_id', <secret columns…>)`).
2. Add it, with a seeded row for both workspaces, to `EXPECTED_TENANT_TABLES` in
   `test/integration/rls.pg.test.ts`. The suite discovers tenant tables from the catalog and fails
   if one is missing from the list or lacks forced RLS.
3. Query it only through a `Tx` from `withWorkspace()`.

## Adding a data provider

1. Implement `SeoDataProvider` (`lib/providers/types.ts`) in `lib/providers/<name>.ts`: every operation
   returns `{ data, costMicros, units }` in our shapes (validate the provider's response defensively; it
   is untrusted), `costMicros` = what the provider says it billed (null if it does not say),
   `estimateCost()` never calls anything paid, `balance()` returns null when unknown. Throw
   `ProviderError` (with `billedMicros` when a failure was still billed) or `ProviderUnsupportedError`.
2. Add it to `createProvider()` in `lib/providers/registry.ts` and to `readSeoProviderEnv()` in
   `lib/env.ts` (credentials from env, documented in `.env.example`, never sent to a browser).
3. Never call it directly: everything goes through `meteredCall()`, which prices, budgets, caches, logs
   and charges.
4. Test it against a local fake of the provider's API (see `test/helpers/fake-dataforseo.ts`,
   `fake-openseo.ts` and `test/unit/providers.test.ts`). No real credits in the suite.

## Adding a publisher

The `Publisher` interface arrives in Phase 3 (`SocialPublisher` in Phase 5): one module per
implementation under `lib/publishers/`, registered in one map, with recorded fixtures for tests.
