# Open work (Lumoras Growth)

Things deferred, worked around, or waiting on someone. Each item says what it stands in for.
Phases 0, 1 and 2, 9 October 2026.

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
  Phase 1 adds required production variables: `BETTER_AUTH_URL` (https), `BETTER_AUTH_SECRET`,
  `RESEND_API_KEY` + `EMAIL_FROM` (a Resend-verified sender), `ENCRYPTION_KEYS` +
  `ENCRYPTION_KEY_CURRENT`. Without them the web container refuses to start with a list of what is
  missing. Google sign-in stays off until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` exist (an OAuth
  client with redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`).
- **First platform admin.** After the first deploy, a Lumoras staff member signs in once and the
  owner runs `docker exec lumoras-seo node --import tsx scripts/grant-admin.ts <email>`
  (recorded in the audit log as `system:cli`).
- **Decision #3: SEO data provider.** Phase 2 runs on `SEO_PROVIDER=fake` in development and tests and
  `none` in production. Recommendation in `docs/provider-decision.md` (DataForSEO directly). Production
  needs `SEO_PROVIDER` plus `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` (or `OPENSEO_MCP_URL`). Ask DataForSEO
  in writing about multi-client use (their ToS is silent).
- **Google OAuth client for Search Console and GA4.** Create a Web OAuth client (needs the host name,
  decision #1), add the redirect URI `<BETTER_AUTH_URL>/api/google/callback`, enable the Search Console
  API, Analytics Admin API and Analytics Data API, configure the consent screen with the two read-only
  scopes (Google verification is needed for sensitive scopes before external users connect), and set
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`. Until then the Connect buttons show "not configured". While the
  consent screen is in "Testing" status Google expires refresh tokens after 7 days.
- **Phase 1 decisions** listed under "Questions for the owner" in `docs/phase-1-summary.md`
  (self-serve sign-up and workspace creation, client-reviewer approval rights, invitation and
  session lifetimes).

## Deferred to a later phase

- **Daily sitemap refresh.** The crawler runs on demand (onboarding, "Scan again" on the site
  page). A pg-boss cron job that refreshes every active site daily arrives with the worker's queues
  in Phase 3 (`TODO(Phase 3)` in `lib/crawl/crawler.ts`).
- **Connection tests.** Search Console and GA4 have live tests (Phase 2). Git and webhook tests arrive
  in Phase 3, WordPress and social in Phase 5; those buttons stay disabled.
- **Agency health metrics.** Budget is live (Phase 2); runway and articles Phase 3, clicks Phase 4.
- **Rank tracking and site audits in the product.** The `SeoDataProvider` has `rankTracker.*` and
  `siteAudit.*` (implemented for all three providers, tested against fakes), but no screen or job uses
  them yet: `rank_trackers`/`rank_snapshots` and `audits`/`audit_issues` tables and their screens are
  Phase 4. With DataForSEO direct, tracker state lives in our tables, so `rankTracker.get` is
  unsupported at the provider by design.
- **Keyword metrics refresh, SERP competitors, backlinks screens.** Operations exist and are metered;
  their screens are Phase 3–5. Full topic selection (rule 5, head-term collisions against published
  and scheduled items) is Phase 3; Phase 2 ships the normalisation, variant collapse (rule 6) and
  sells/does-not-sell filter (rule 7) it builds on.
- **Stale holds and settle failures.** A hold whose settle never ran (a crash between the provider call
  and the settle transaction) is settled at its estimate after an hour, the next time that workspace
  reserves (conservative: money is counted as spent). A worker job that reconciles holds against
  DataForSEO's `id_list` (actual billed cost per task) belongs with the Phase 3 worker.
- **Price table refresh.** Estimates use DataForSEO's published list prices (`DFS_PRICES`). Reading the
  account's own `price` object from `appendix/user_data` once a day would keep them exact; add with the
  Phase 3 worker. Settlements always use the cost DataForSEO reports, so this only affects how early a
  call near the reserve is refused.
- **OpenSEO actual costs.** Self-hosted OpenSEO reports neither per-call cost nor balance, so with
  `SEO_PROVIDER=openseo` the ledger charges the estimate (`detail` says so). See provider-decision.md.
- **Provider credentials from encrypted platform settings.** Credentials come from the environment
  only. Storing them encrypted in the database (editable by platform admins) can follow if the owner
  wants rotation without a redeploy.
- **Month boundaries in UTC.** Budgets reset on the first of the month, UTC, for every workspace.
  Per-workspace time zones for billing periods are a Phase 6 (billing) question.
- **Search Console / GA4 dashboards.** Phase 2 reads striking-distance queries, zero-click pages, organic
  landing pages and measurement health on demand (cached 10 minutes in memory per process). Daily
  snapshots into the database and the dashboards are Phase 4.
- **Unconfirmed live behaviour.** PKCE on Google's web-server flow, DataForSEO response shapes and
  OpenSEO's live MCP answers were verified against documentation, source and local fakes only (no keys
  in the build environment, no real calls by design). Do one supervised real call per operation on the
  sandbox (`DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com`) and one real Google connect before
  relying on them.
- **Key rotation runner.** `rotateConnectionKeys()` re-seals a workspace's secrets under the
  current key (tested); there is no CLI for it yet. Add `scripts/rotate-keys.ts` before the first
  real rotation.
- **Notifications** are minimal: in-app only (crawl finished, member joined). Email alerts arrive
  with the runway monitor in Phase 3.
- **pg-boss.** Not installed. `worker/index.ts` has a `TODO(Phase 3)` where the boss starts and
  stops; the worker currently only validates env, logs a heartbeat and exits cleanly on SIGTERM.
- **Non-transactional migrations.** Every file runs inside a transaction, so
  `CREATE INDEX CONCURRENTLY` cannot be used yet. Add a header marker (for example
  `-- migrate:no-transaction`) when the first such migration is needed.
- **Interfaces for publishers** (`Publisher`, `SocialPublisher`): Phases 3 and 5. (`SeoDataProvider`
  exists since Phase 2.)
- **Pipeline run view data.** `/design` simulates the run with timers and sample data
  (`components/pipeline/steps.ts`). Phase 3 replaces the timers with server-sent events from
  persisted `pipeline_steps`.
- **Icons.** `apps/seo/components/Icons.tsx` repeats the apps/web sprite pattern and the brand
  mark with a larger icon set. If both apps keep growing icons, move the sprite into a shared
  package.

## Workarounds and environment notes

- **Better Auth schema warning.** `getMigrations` logs that `auth_rate_limit.last_request` "has a
  different type in the database. Expected number but got int8". Better Auth's own generator makes
  this column `bigint`; its type check knows the name `bigint` but not PostgreSQL's `int8`. Cosmetic:
  the rate limiter works on it (integration-tested). Recorded in `docs/external-apis.md`.
- **Style attributes in the CSP.** `style-src-attr 'unsafe-inline'` is allowed because components
  pass CSS custom properties (`--i`, `--n`) and view-transition names through `style=""`. Scripts are
  nonce-only; style *elements* need the nonce. Moving those properties into classes would let us
  drop it.
- **Test-only settings.** `EMAIL_OUTBOX_DIR`, `CRAWLER_TEST_ORIGINS`, `RATE_LIMIT_SCALE`,
  `GOOGLE_API_TEST_ORIGIN` and `SEO_PROVIDER=fake` (in a production build) exist so e2e can run the
  production build without a mail provider, the internet, real Google, a paid data provider or many
  IPs. Each one is refused at start-up next to an https `BETTER_AUTH_URL`, and logs a warning when set.
- **FakeProvider fixtures are synthetic.** No provider key existed to record real responses, so the
  fixtures (`lib/providers/fixtures.ts`) are invented but shaped like DataForSEO's; competitor domains are
  reserved `.example` names so no real company gets invented rankings. Screens say "Demo data". Replace
  with scrubbed recorded responses after the first real calls. The dev/e2e seed buys demo research for
  sonorch.ai through the metered path with this provider.
- **A Phase 1 e2e flake.** `⌘K jumps between workspaces and sites` (e2e/screens.spec.ts) failed once in
  about ten full Playwright runs during Phase 2 (the Audit log heading did not appear within 15 s under
  three parallel workers) and passed on every other run. Not investigated further; watch it in CI.
- **Metering test hook.** `MeterDeps.afterBudgetRead` lets the concurrency test widen the race window
  inside the reservation; production never sets it. `CACHE_TEST_SABOTAGE` (metering test) and
  `RLS_TEST_SABOTAGE` (RLS test) break guards on purpose for red runs and are read only by tests.

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
