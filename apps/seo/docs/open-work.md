# Open work (Lumoras Growth)

Things deferred, worked around, or waiting on someone. Each item says what it stands in for.
Phases 0 to 4 and the owner decisions of 10 October 2026 (`owner-decisions.md`).

## Waiting on the owner

- **Product name and host name** (decision #1). "Lumoras Growth" and `growth.lumoras.ai` are
  placeholders in `components/shell/nav.ts`, `deploy/Caddyfile.snippet` and the docs.
- **Create the database on VPS3.** `deploy/postgres/10-seo-database.sh` now follows the hub's
  `docker/vps3/postgres/init/01-databases.sh` (branch `marketing-split`): database `seo` owned by
  a role named `seo`, CONNECT revoked from PUBLIC, passwords in `/opt/lumoras/env/postgres.env`
  as `SEO_DB_PASSWORD` (owner) and `SEO_APP_DB_PASSWORD` (the extra restricted app role
  `seo_app`, which row-level security needs). The init script only runs on a fresh data
  directory, so the owner runs this one once with `docker exec` (command in the script header).
- **Hub changes (phonon-orchestration-hub).** Add `seo` to the database list in
  `docker/vps3/scripts/backup-postgres.sh`; optionally add `seo`/`seo_app` to
  `postgres/init/01-databases.sh` for fresh installs; copy `deploy/docker-compose.yml` to
  `docker/vps3/lumoras-seo/docker-compose.yml` beside `lumoras.ai/`.
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
- **Decision #3: SEO data provider — decided: hosted OpenSEO; the key is pending.** Built: `OPENSEO_MODE=hosted`.
  The owner sets in the server env file `SEO_PROVIDER=openseo`, `OPENSEO_MODE=hosted` and
  `OPENSEO_API_KEY=oseo_…` (optionally `OPENSEO_PROJECT_ID`, and per-site projects under Site settings). Until
  then production runs with `SEO_PROVIDER=none`. **Terms:** use it for Lumoras's own sites and staff-run
  client work; before clients run research themselves, get OpenSEO's written OK or move to self-hosted
  OpenSEO with a DataForSEO key (nothing in code stops a client role from starting research today: it is a
  policy the provider card states to platform admins). Not yet verified against the real hosted service (no
  key here): first use should be one `whoami` and one small research call, checking the ledger detail.
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
- **The lumoras.ai token.** The connection now points at `timtasay/lumoras.ai`, base branch `dev`, pull
  requests (owner decision, 10 October 2026) and shows "Token needed". The owner creates a fine-grained token
  (Contents read/write and Pull requests read/write on that repository only), pastes it on lumoras.ai →
  Connections → Save token, and runs Test. Merging stays with lumoras.ai's own review and CI. Until then
  lumoras.ai's runway reads "The publishing connection (lumoras.ai repository) needs its access token" and
  rolling generation does not start for it. An existing production database seeded before this change keeps
  its old connection: change it by adding a new one with the "lumoras.ai insights" preset and removing the old.
- **Bylines — decided and built.** "Lumoras team" is an organization byline (schema.org `Organization`).
  lumoras.ai's `content-spec.md` frontmatter has no author field (apps/web renders "Lumoras team" and its own
  `Organization` JSON-LD), so the Git file for lumoras.ai carries no byline; other sites can add
  `{{author.name}}`, `{{author.type}}` or `{{author.kind}}` to their frontmatter template, and webhook receivers
  get `article.structuredData` (a BlogPosting with the author typed). sonorch.ai and seasonx.ai still have
  flagged demo people until decision #2.
- **Writing model and its budget.** Production runs with `LLM_PROVIDER=none` until the owner sets
  `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`, and gives each workspace an `llm_tokens` budget
  (Budget and usage). Without a budget, runs stop at the topic step with "No monthly budget is set".
- **Autopilot.** Off for every site; turning it on records who acknowledged the warning and when. Whether
  any client may use it at all (and with what written agreement) is an owner/commercial question (#5).

## Resolved on 10 October 2026

- **Demo data consistency.** Fixed in the seed and in code: Rankings labels a keyword
  "Published" only while its article is published (`trackedKeywords`), and the seed no longer queues sonorch.ai's
  or lumoras.ai's existing pages as published targets (they are saved keywords). Checked for every seeded site by
  `test/helpers/consistency.ts` (seed and pipeline suites) and in the browser (`e2e/decisions.spec.ts`). Keyword
  status "published" on the Keywords tab still means "an existing page targets it" (rule 5), which is a
  different thing from "Articles live" (published through Lumoras Growth).

## Deferred to a later phase

- **Connection tests.** Search Console and GA4 (Phase 2), Git and webhook (Phase 3) have live tests.
  WordPress and social arrive in Phase 5; those buttons stay disabled.
- **After publishing, Phase 5 hooks.** The keyword is queued in `rank_tracking_queue` (rank tracking
  picks it up at the next check, Phase 4), the live URL is checked for a 200 and inspected once with Search Console's URL
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
- **Rank tracking with DataForSEO direct.** DataForSEO has no tracker object: each check is one SERP task
  per keyword and the history lives in `rank_snapshots`, so `rankTracker.get` is unsupported at the
  provider by design. With a provider that keeps trackers (OpenSEO, the fake), a tracker the provider no
  longer knows is replaced automatically.
- **Keyword metrics refresh, SERP competitors.** Operations exist and are metered; the periodic refresh
  is not scheduled. Backlinks for link prospecting and outreach are Phase 5 (Phase 4 stores baselines and
  quarterly snapshots, new/lost referring domains, for the site and up to five brand-profile competitors). Full topic selection (rule 5, head-term collisions against published
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
- **OpenSEO actual costs.** Self-hosted OpenSEO reports neither per-call cost nor balance, so the ledger charges
  the estimate (`detail` starts "estimate:"). Hosted OpenSEO reports the balance (`whoami`) and its result schema
  has `creditsCharged`, which we record ("provider-reported: …") — but v0.1.12's paid tools do not fill it yet,
  so hosted calls are charged our estimate (list × 1.28) until they do. A periodic reconciliation against the
  `whoami` balance delta is not built.
- **Provider credentials from encrypted platform settings.** Credentials come from the environment
  only. Storing them encrypted in the database (editable by platform admins) can follow if the owner
  wants rotation without a redeploy.
- **Month boundaries in UTC.** Budgets reset on the first of the month, UTC, for every workspace.
  Per-workspace time zones for billing periods are a Phase 6 (billing) question.
- **Measurement limits chosen without the owner** (Phase 4, all per-site settings or constants, easy to change):
  rank checks weekly, top 30, desktop, at most 100 keywords; audits monthly, 200 pages; backlinks quarterly;
  URL Inspection at most 20 URLs a day per site (Google allows 2,000); GA4 backfills 90 days (Search
  Console backfills its full 16 months, 30 days per job). Paid cadences are refused below the budget's
  reserve and retried a day later.
- **Search Console row caps.** Detail rows (query+page, page) are read per day up to Google's 50,000-row
  daily cap; anonymised queries never appear in query rows, so query totals are lower than date totals by
  design (the dashboard's KPIs use the date totals). Search type is web only (no image, video, news,
  Discover or country/device splits yet).
- **Measurement failures** notify owners and editors in the app (and mark the connection failing on the
  Connections tab and the agency home); there is no email for them yet, and no per-person notification
  settings.
- **Tasks** are created by an audit issue's Fix action (assignable, status open / in progress / done). There
  is no workspace-wide task list yet; tasks are on each site's Audit tab.
- **Phase 2's on-demand Google reads** (`lib/google/service.ts` insights, cached 10 minutes in memory) are
  still the fallback while a site's first sync has not finished; after it, screens read the stored days.
- **Real Search Console acceptance (Phase 4) is pending the owner's Google setup.** The sync, the lag
  handling and the dashboards were built and tested against a local fake Google with the documented
  shapes; the runbook to run it on sonorch.ai is in `docs/phase-4-summary.md`.
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
- **`GOOGLE_PACE_MS=0`** (no pause between Google requests) is what the e2e worker uses against the local
  fake; it is a valid setting, not refused in production, so leave it unset (200 ms) on the server.
- **Fake Google data is synthetic.** `test/helpers/fake-google-data.ts` generates 16 months of plausible,
  deterministic Search Console rows (weekday rhythm, growth, Pacific dates, provisional last two days, 18%
  anonymised clicks) and GA4 reports for the seeded sites, plus one property whose tag is broken. The seed
  uses it in development when the fakes run; nothing in it describes real traffic.
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
  the shortcut itself was never broken. It failed once more in Phase 4's final run for a different reason:
  the test typed into the palette while it was still animating closed after the first jump (the heavier
  site dashboard made that window wider); it now waits for the dialog to be gone (6/6 repeated).
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
- **`/favicon.ico` is rewritten to `/icon.svg`** (`next.config.ts`): Chromium occasionally probes
  `/favicon.ico` despite the icon link, and the 404 surfaced as a console error in one e2e run.
- **`pnpm approve-builds`.** pnpm 10 skips install scripts for `esbuild` and `unrs-resolver`.
  Neither needs them here (tsx resolves the platform esbuild binary from its optional
  dependency), and everything built and ran without them. If a future install fails on this,
  add them to `pnpm.onlyBuiltDependencies` in the root `package.json`.
