# Open work (Lumoras Growth)

Things deferred, worked around, or waiting on someone. Each item says what it stands in for.
Phases 0 to 3, 9 October 2026.

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
  (self-serve sign-up and workspace creation, invitation and session lifetimes). The client-reviewer
  question was decided in October 2026 and is built in Phase 3 (the `reviewer` role).
- **Decision #2: sonorch.ai / seasonx.ai publishing.** Not built, by instruction: no adapter for either
  repository, and neither repository was touched. Both sites have schedules in the seed but no publishing
  connection, so seasonx.ai's runway reads red ("No publishing connection is set") and sonorch.ai's
  articles stop at the review gate. When the owner decides, each gets a Git (file per post) or webhook
  connection like lumoras.ai.
- **The real lumoras.ai repository and token.** The seeded Git connection points at a local fake GitHub
  with `https://github.com/lumoras/lumoras.ai` as a placeholder owner/name. Production needs the real
  repository address and a fine-grained token (Contents read/write and Pull requests read/write on that
  repository only), entered on the site's Connections tab and checked with Test. Pull requests are the
  default; merging stays with lumoras.ai's own review and CI.
- **Bylines (rule 10) vs. lumoras.ai's content spec.** The seed uses a demo author placeholder ("Demo
  author for lumoras.ai", flagged in the editor and as a non-blocking lint warning). The content spec's
  articles are signed "Lumoras team"; rule 10 asks for real people. The owner decides whether a team
  byline is acceptable or names the people who sign.
- **Writing model and its budget.** Production runs with `LLM_PROVIDER=none` until the owner sets
  `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`, and gives each workspace an `llm_tokens` budget
  (Budget and usage). Without a budget, runs stop at the topic step with "No monthly budget is set".
- **Autopilot.** Off for every site; turning it on records who acknowledged the warning and when. Whether
  any client may use it at all (and with what written agreement) is an owner/commercial question (#5).

## Deferred to a later phase

- **Connection tests.** Search Console and GA4 (Phase 2), Git and webhook (Phase 3) have live tests.
  WordPress and social arrive in Phase 5; those buttons stay disabled.
- **Agency health metrics.** Budget (Phase 2) and runway per site (Phase 3, on the workspace overview)
  are live; the agency home does not show runway across workspaces yet; clicks are Phase 4.
- **After publishing, Phase 4 and 5 hooks.** The keyword is queued in `rank_tracking_queue` (Phase 4
  consumes it), the live URL is checked for a 200 and inspected once with Search Console's URL
  Inspection API when connected; the social hook (`AFTER_PUBLISH_HOOKS` in `lib/pipeline/run-steps.ts`)
  records "social: Phase 5" and does nothing else.
- **Live run view transport.** `/api/w/:slug/runs/:id/events` is a server-sent-events stream that polls the
  persisted run every 750 ms (one small indexed query) rather than LISTEN/NOTIFY. Simple and correct for
  a handful of viewers; switch to NOTIFY if many people watch runs at once.
- **Touch devices and drag and drop.** HTML5 drag and drop does not start from a touch. On phones the
  calendar's list view has a "Move to" date field per article, and the keyboard path (M, arrows, Enter)
  works everywhere; long-press dragging is not built.
- **External link checks.** Run by the worker daily and before lint; a link nobody has checked yet holds
  the article (blocking warning). In development and tests pages come from recorded fixtures
  (`OUTBOUND_FETCH=recorded`), so real links are only checked in production.
- **Feed token rotation.** Each site's public feed has an unguessable token and can be switched off; there
  is no "new address" button yet (rotate with SQL if a token leaks).
- **Review-request email.** Reviewers get an in-app notification when an article waits for them; the
  email (kind `review-request`) is sent only when Resend is configured, like every other email.
- **Rank tracking and site audits in the product.** The `SeoDataProvider` has `rankTracker.*` and
  `siteAudit.*` (implemented for all three providers, tested against fakes), but no screen or job uses
  them yet: `rank_trackers`/`rank_snapshots` and `audits`/`audit_issues` tables and their screens are
  Phase 4. With DataForSEO direct, tracker state lives in our tables, so `rankTracker.get` is
  unsupported at the provider by design.
- **Keyword metrics refresh, SERP competitors, backlinks screens.** Operations exist and are metered;
  their screens are Phase 3–5. Full topic selection (rule 5, head-term collisions against published
  and scheduled items) is Phase 3; Phase 2 ships the normalisation, variant collapse (rule 6) and
  sells/does-not-sell filter (rule 7) it builds on.
- **Stale holds and settle failures.** A hold whose settle never ran (a crash between the provider or
  model call and the settle transaction) is settled at its estimate after an hour, the next time that
  workspace reserves (conservative: money is counted as spent). A worker job that reconciles holds against
  DataForSEO's `id_list` (actual billed cost per task) is not built yet (the worker exists since Phase 3).
- **Price table refresh.** Estimates use DataForSEO's published list prices (`DFS_PRICES`). Reading the
  account's own `price` object from `appendix/user_data` once a day would keep them exact; a worker job
  for it is not built yet. Model prices come from `lib/llm/prices.ts` / `LLM_PRICES_JSON`. Settlements always use the cost DataForSEO reports, so this only affects how early a
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
- **Notifications:** in-app (crawl finished, member joined, article waiting for review, runway) and, with
  Resend configured, email for runway alerts and review requests. No per-person notification settings yet.
- **Non-transactional migrations.** Every file runs inside a transaction, so
  `CREATE INDEX CONCURRENTLY` cannot be used yet. Add a header marker (for example
  `-- migrate:no-transaction`) when the first such migration is needed.
- **`SocialPublisher`** (Phase 5). `Publisher` exists since Phase 3 (Git and webhook); WordPress is Phase 5.
- **`/design`'s pipeline** is a recorded replay built on the same graph component as the live run view
  (`components/pipeline/PipelineGraph.tsx`); the product's run view reads persisted steps over SSE.
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
  `GOOGLE_API_TEST_ORIGIN`, `SEO_PROVIDER=fake`, `LLM_PROVIDER=fake`, `OUTBOUND_FETCH=recorded` and
  `OUTBOUND_TEST_HOSTS` (in a production build) exist so e2e can run the production build without a mail
  provider, the internet, real Google, a paid data provider, a model, GitHub or many IPs. Each one is refused at start-up next to an https `BETTER_AUTH_URL`, and logs a warning when set.
- **FakeProvider fixtures are synthetic.** No provider key existed to record real responses, so the
  fixtures (`lib/providers/fixtures.ts`) are invented but shaped like DataForSEO's; competitor domains are
  reserved `.example` names so no real company gets invented rankings. Screens say "Demo data". Replace
  with scrubbed recorded responses after the first real calls. The dev/e2e seed buys demo research for
  sonorch.ai through the metered path with this provider.
- **FakeLlm fixtures are synthetic.** No model key existed, so `lib/llm/fixtures.ts` writes plausible,
  rule-following articles from the brief's own data (topic, outline, product facts), and the recorded
  source pages (`RECORDED_PAGES`) are invented on reserved `.example` hosts plus the brand's own facts.
  Every generated screen says "Demo model". Prompt quality is unproven until the first supervised real
  runs; the prompts are in `lib/pipeline/prompts.ts`.
- **The pg-boss schema on an existing database.** `deploy/postgres/10-seo-database.sh` creates schema
  `pgboss` with the grants the app role needs. It runs on a fresh volume; on a database created before
  Phase 3, run its `pgboss` section once by hand (or re-run the script: it is idempotent) before the
  worker starts, then `migrate` installs pg-boss's tables as the owner role.
- **Chromium cannot start a drag from a `<button>`.** Calendar articles are `div role="button"` with
  `tabIndex=0` (Enter/Space select, M moves) so a pointer drag starts; found by the e2e drag test.
- **The Phase 1 ⌘K e2e flake** (`⌘K jumps between workspaces and sites`) failed again once in Phase 3: the
  second Control+K landed while the previous client-side navigation was still settling. The test now
  retries the shortcut until the palette's input has focus (passed 4/4 repeated and in the full runs);
  the shortcut itself was never broken.
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
