# Lumoras Growth (`apps/seo`)

A multi-client SEO, content and marketing platform: each client workspace connects its sites
and has research, writing, fact-checking, publishing and measurement run from one place.
"Lumoras Growth" is a working name (owner decision #1). The full brief is
[`docs/seo-platform-build-prompt.md`](../../docs/seo-platform-build-prompt.md).

**Status: Phase 4 (measurement).** What exists, what was verified and what is open:
[`docs/phase-4-summary.md`](docs/phase-4-summary.md) (real Search Console acceptance is **pending the owner's
Google setup**; the runbook is in that file). Phase 3: [`docs/phase-3-summary.md`](docs/phase-3-summary.md), Phase 2: [`docs/phase-2-summary.md`](docs/phase-2-summary.md),
Phase 1: [`docs/phase-1-summary.md`](docs/phase-1-summary.md), Phase 0: [`docs/phase-0-summary.md`](docs/phase-0-summary.md)). The SEO data provider choice (owner
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
  app/(app)/         signed-in screens in the shell: /w/:slug (overview), /w/:slug/sites/… (dashboard,
                     rankings, search, audit, backlinks, keywords, routes, brand, authors, connections,
                     settings), /w/:slug/keywords,
                     /w/:slug/content (calendar), /w/:slug/content/:id (article editor), /w/:slug/review,
                     /w/:slug/runs, /w/:slug/runs/:id (live run view),
                     /w/:slug/settings (members), /w/:slug/settings/budget, /w/:slug/audit, /agency, /agency/audit
  app/(design)/      /design (dev only)
  app/api/           auth/[...all] (Better Auth), w/:slug/sites/:id/crawl (NDJSON stream),
                     google/callback (Search Console / GA4 OAuth), w/:slug/usage (ledger CSV),
                     w/:slug/runs/:id/events (run view, server-sent events), feeds/:token/feed.json + rss.xml, health
  components/        ui/, charts/, pipeline/, shell/ (AppShell, LiveShell), auth/, onboarding/,
                     forms/ (site, brand, authors, connections, members), scan/, sites/, audit/,
                     research/ (research panel, cost confirm, keywords, log, backlog, domain overview),
                     budget/, google/ (connections, opportunities, provider status),
                     content/ (calendar, article editor, schedule form, feed, runway banner), pipeline/ (graph, live run),
                     measure/ (states, health panel, rankings view, audit actions, run-now, cadence settings),
                     charts/ (area with provisional band, rank chart, new/lost, horizontal bars; hand-written SVG)
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
    google/                  oauth.ts (PKCE + state), api.ts, analysis.ts, service.ts (Search Console, GA4, URL Inspection)
    content/                 schedule.ts (slot math, DST, lead days, no back-dating), runway.ts, status.ts (state machine),
                             lint.ts (15 deterministic rules), links.ts (rule 9), headterm.ts (rule 5), markdown.ts,
                             diff.ts, planner.ts (slots, wake-ups, runway alerts), review.ts (the review gate)
    llm/                     LlmProvider (types.ts), anthropic.ts (@anthropic-ai/sdk), fake.ts + fixtures.ts (FakeLlm),
                             prices.ts, metered.ts (model usage on the ledger), loop.ts (tool loop, untrusted data)
    pipeline/                the ten steps (run-steps.ts), runner.ts (persisted, resumable), prompts.ts, view.ts
    publishers/              Publisher (types.ts), git.ts (GitHub + Gitea), webhook.ts (HMAC), feed.ts, frontmatter.ts
    measure/                 Phase 4: cadence.ts (windows, due, next), search.ts (sync plan, lag, aggregation),
                             gsc-sync.ts, ga4-sync.ts, health.ts (GA4 measurement health), inspect.ts (URL Inspection),
                             rank.ts, audit.ts (+ tasks), backlinks.ts, runs.ts (measurement_runs, alerts),
                             scheduler.ts (the hourly tick), dashboard.ts (screen queries), movement.ts, audit-groups.ts
    ui/chart-math.ts         scales, ticks and paths for the SVG charts (pure, unit tested)
    google/allowlist.ts      every Google endpoint the app may call; the Indexing API is refused
    jobs/                    pg-boss: queues.ts, install.ts (owner role), handlers.ts, wire.ts, client.ts (web producer)
    security/                csp.ts, origin.ts (CSRF check for route handlers)
    rate-limit.ts seed.ts validation.ts email.ts actions.ts
  migrations/        0001 bootstrap · 0002 auth · 0003 audit · 0004 tenancy · 0005 platform · 0006 research · 0007 content
                     · 0008 measurement
  scripts/           migrate.ts, seed.ts, grant-admin.ts, fakes.ts (dev fake GitHub, webhook receiver, fake Google),
                     gsc-sync.ts (`pnpm --filter seo gsc:sync -- --site <id>`)
  fixtures/          lumoras.ai/sitemap.xml (the seeded route inventory)
  worker/index.ts    the worker: pg-boss queues (schedule tick, pipeline runs, sitemaps, link checks, runway, post-publish;
                     Phase 4: measure tick, Search Console / GA4 sync, URL inspection, rank checks, audits, backlinks)
  test/unit, test/integration, test/helpers   node --test + tsx
  e2e/               Playwright (serve.ts builds a fresh database, seed and fake site per run)
  deploy/            docker-compose.yml, Caddyfile.snippet, postgres/10-seo-database.sh (files only)
```

### Architecture in one page

- **Workspace = Better Auth organization.** `workspaces.id` *is* `auth_organization.id`; a trigger
  creates the `workspaces` row in the same transaction as the organization. Roles live on
  `auth_member` (owner, editor, reviewer, viewer); platform admins (Lumoras staff) are
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
- **The content pipeline (Phase 3)** runs in the worker on pg-boss (schema `pgboss`, installed by the
  owner role; the app role has no DDL). A site's schedule (Tuesday and Friday 09:00 site time by default)
  becomes slots; rolling generation wakes each slot `lead_days` (3) before it. A run is ten persisted
  steps (context, opportunity scan, topic, brief, draft, fact-check, lint, review gate, publish, after
  publishing), each with input, output, model, tokens, cost and duration, resumable from any step. Model
  calls go through `meteredTurn()` on the same budget, reserve and ledger as paid data (category
  `llm_tokens`). Web pages and SERPs reach the model wrapped as untrusted data, and paid tools close once
  they are in the conversation. Lint is code. Approval is required by default; autopilot needs an explicit,
  recorded acknowledgement and still holds anything that fails lint or fact-check. Unverifiable claims
  block approval and publishing (rule 8).
- **Measurement (Phase 4)** runs in the worker. An hourly tick (`measure-tick`, cron `23 * * * *`) asks
  each site what is due (`lib/measure/scheduler.ts`): Search Console daily (Pacific day), GA4 and URL Inspection
  daily (site day), rank checks weekly, audits monthly and backlinks quarterly by default (site settings →
  Measurement). Every run is a `measurement_runs` row unique on (site, kind, window): the window key is the
  idempotency key and the pg-boss singleton key, so a double tick or a redelivered job does the work once.
  Rank checks, audits and backlinks are paid: priced first with `estimateCost`, refused below the budget's
  reserve (retried a day later, owners and editors notified once), then bought through `meteredCall()`.
  Search Console sync reads totals by date for the whole 16-month window, then query+page and page detail
  day by day (paginated, 25,000 rows a page), stores days as provisional until Google's
  `first_incomplete_date` passes them, re-reads the last four days every time, and backfills 30 days per job.
  Writes replace whole days, so a re-run never double counts. Google endpoints are allowlisted
  (`lib/google/allowlist.ts`); the Indexing API is refused in code and by a static test.
- **Roles:** owner, editor, reviewer (approves, rejects, requests changes; cannot edit or spend),
  viewer (reads and comments).
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
| Lumoras | owner@ / editor@ / reviewer@ / viewer@lumoras.example | sonorch.ai, seasonx.ai, lumoras.ai (facts from `prototypes/BRIEF.md` and `docs/content-spec.md`) |
| Northwind Dental (demo) | owner@ / editor@ / reviewer@ / viewer@northwind-dental.example | northwind-dental.example (fictional) |

Phase 2 adds budgets for both workspaces (Lumoras: $25 SEO data a month with a $5 reserve), a seed
backlog per site, and demo research for sonorch.ai bought through the metered path from the fake
provider (synthetic fixtures; no network, no real money): three seeds, a SERP and its free repeat, the
domain overview and a dozen saved keywords. With `SEO_PROVIDER` unset in development, research runs on
the same fake provider and every screen says "Demo data".

Phase 3 onboards lumoras.ai fully: the brand profile and SEO rules from `docs/content-spec.md`, the
route inventory from `fixtures/lumoras.ai/sitemap.xml`, a demo author placeholder, a Git connection
(file per post into `apps/web/content/insights/<slug>.md`, pull requests) pointing at a **local fake
GitHub**, and Tuesday/Friday schedules on the three Lumoras sites. The seed runs the pipeline with
FakeLlm: one lumoras.ai article through all ten steps (published as a pull request when the fakes are
running), the next lumoras.ai slot and two sonorch.ai slots waiting for review (one with an unverifiable
claim), and the runway checked for every site (seasonx.ai has no publishing connection: red).
For the full demo, start the fakes first and export `OUTBOUND_TEST_HOSTS=github.test,webhook.test`:

```bash
pnpm --filter seo fakes            # fake GitHub on :4571 (github.test), webhook receiver on :4572 (webhook.test)
```

`staff@lumoras.example` is a platform admin (agency home, impersonation). Every seeded author is
marked as demo and must be replaced by a real person. In production, make a real staff member a
platform admin with `pnpm --filter seo admin:grant name@lumoras.ai` (they must have signed in once;
recorded in the audit log).

### Run

```bash
pnpm dev:seo                       # http://localhost:3007 (sign in; /design is on in development)
pnpm --filter seo migrate          # apply migrations (reads DATABASE_URL_OWNER)
pnpm --filter seo migrate --dry-run
pnpm --filter seo worker           # the worker: pipeline, schedule, sitemaps, runway (Ctrl+C or SIGTERM stops it)
```

Without the worker nothing is written or published on schedule ("Run now" queues a run for it).
In development the worker writes with FakeLlm (`LLM_PROVIDER` unset) and serves fact-check sources
from recorded pages (`OUTBOUND_FETCH` unset); no model or website is called.

**Measurement in development.** `pnpm --filter seo fakes` also starts a **fake Google** on :4573 with
16 months of synthetic Search Console data and GA4 properties (sonorch.ai healthy, Northwind's tag broken).
Export the three variables it prints (`GOOGLE_API_TEST_ORIGIN=http://127.0.0.1:4573` and the fake OAuth client id and
secret) before seeding and the seed connects sonorch.ai and Northwind and syncs them; without it, Phase 4 screens show
their not-connected states. Rank checks, audits and backlinks run on the fake SEO provider (12 weekly rank checks,
two audits and three backlink quarters for sonorch.ai). Sync one site by hand:

```bash
pnpm --filter seo gsc:sync -- --site <site id> [--ga4] [--inspect] [--no-backfill]
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
                                   # the metered path (cache, reserve, concurrency), Google connections,
                                   # the content pipeline (FakeLlm, fake GitHub, webhooks), the worker + pg-boss,
                                   # measurement (rank pricing/refusal, GSC sync idempotency, agency health, CLI)
pnpm --filter seo build && TEST_DATABASE_URL=… pnpm --filter seo test:e2e   # Playwright against the production build
```

`TEST_DATABASE_URL` must point at a throwaway server: integration tests and the e2e web server
create and drop their own databases and roles (with the real init script, so `psql` must be on
PATH). Integration suites skip when it is unset locally and fail in CI. Playwright downloads its
browser with `pnpm --filter seo exec playwright install chromium`, or uses
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`; set `SCREENSHOT_DIR` to save `seo-p1-*.png` … `seo-p4-*.png` screenshots.
No test ever calls DataForSEO, OpenSEO, Google, Anthropic, GitHub or Gitea: they are local fakes
(`test/helpers/fake-*.ts`, `lib/llm/fake.ts`). The e2e server also starts the worker.

**Acceptance build of a generated article:** `ACCEPTANCE_OUT=<dir>` with the pipeline suite writes the
generated lumoras.ai article (and the fake pull request) to `<dir>`; copy it into a git worktree of this
repository under `apps/web/content/insights/` and run `pnpm --filter web typecheck && pnpm --filter web build`
there (see `docs/phase-3-summary.md`).

**Proving the Phase 3 guards red:** the link validator, the duplicate head term (code and database),
unverifiable claims, autopilot defaults, webhook signatures and the reviewer/viewer split were each
broken on purpose; the commands and outputs are in `docs/phase-3-summary.md`.

**Proving the Phase 4 guards red:** rank pricing order, the reserve, Search Console idempotency, the
agency path's admin check and audit row, the Indexing API guard, RLS on the new tables, the date-lag and
cadence rules were each broken on purpose; the outputs are in `docs/phase-4-summary.md`.

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

1. Implement `Publisher` (`lib/publishers/types.ts`): `validate()` (the Test button: read-only checks),
   `publish()`, `update()`, `unpublish()`, `status()`. Receive the article as data and the decrypted
   credential from the caller; talk to the outside only through `requestJson()` / `safeFetch()` (SSRF guard).
   Make `publish()` idempotent: a retried step must not create a second post or pull request.
2. Register it in `createPublisher()` (`lib/publishers/registry.ts`), add its connection fields to
   `connectionInput` (`lib/validation.ts`) and to `components/forms/ConnectionsPanel.tsx`.
3. Test it against a local fake of the target API (see `test/helpers/fake-git.ts`, `fake-webhook.ts` and
   `test/unit/publishers.test.ts`), including its exact output format.

### Receiving the webhook (for client developers)

Each delivery is a JSON POST with `X-Lumoras-Event` (`article.published`, `article.updated`,
`article.unpublished`, `ping`), `X-Lumoras-Delivery` (unique id), `X-Lumoras-Timestamp` (Unix seconds) and
`X-Lumoras-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`. Verify over the raw body
with a constant-time compare and reject timestamps more than five minutes from now (replay window);
`verifyWebhook()` in `lib/publishers/webhook.ts` is the reference. The body carries the article's
Markdown and HTML, metadata, author, cover and sources.
