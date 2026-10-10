# External APIs and libraries: versions and when their docs were read

Build prompt section 17: read the documentation of every external API before integrating it,
and record the version and the date. Newest first.

## Google Search Console, GA4 Data and Admin APIs (Phase 4 measurement, `lib/google/`, `lib/measure/`)

All read 10 October 2026 on developers.google.com / support.google.com; "updated" is the page's own
last-updated date. Scopes stay the Phase 2 read-only pair: `webmasters.readonly`, `analytics.readonly`.

| API, version | Method / page (updated) | What we rely on |
| --- | --- | --- |
| Search Console API **v3** (`www.googleapis.com/webmasters/v3`) | `searchanalytics.query` (2026-08-11) | `dimensions` date / query / page; `dataState: "all"` includes fresh data and the response then carries `metadata.first_incomplete_date` (snake_case) when grouped by date; `rowLimit` ≤ 25,000 with `startRow` paging; dates are Pacific (PT) calendar days |
| Search Console help | "Getting all your data" how-to (2025-08-28) | at most 50,000 rows per day per search type: query one day at a time to get them all; data is typically 2–3 days behind; 16 months retained |
| Search Console API usage limits | (2025-08-28) | Search Analytics 1,200 QPM per site and per user; URL Inspection 2,000 QPD and 600 QPM per site |
| URL Inspection API **v1** (`searchconsole.googleapis.com/v1`) | `urlInspection.index.inspect` (2024-07-23), `UrlInspectionResult` (2025-01-21) | `inspectionResult.indexStatusResult` verdict, coverageState, lastCrawlTime, googleCanonical / userCanonical, pageFetchState, robotsTxtState; `inspectionResultLink`. Read-only: it never requests indexing |
| GA4 Data API **v1beta** (`analyticsdata.googleapis.com`) | `properties.runReport` (2026-04-23) | `dateRanges` with relative dates (`NdaysAgo`, `yesterday`) in the property's time zone; `limit` ≤ 250,000 with `offset`; `rowCount`; `metadata.timeZone`, `dataLossFromOtherRow`, `emptyReason`; `dimensionFilter` on `sessionDefaultChannelGroup` = "Organic Search"; metric `keyEvents` |
| GA4 Admin API **v1beta** (`analyticsadmin.googleapis.com`) | `properties.dataStreams.list` (2025-04-02), `properties.keyEvents.list` (2026-04-14) | web streams and their `defaultUri` (tag on the right domain?), whether any key event is defined |
| GA4 help | Data freshness (support page, read same day) | intraday 2–6 h, daily ~12 h, events up to 7 days late: we re-read the last 7 days on every sync |

- **Indexing API: never.** `lib/google/allowlist.ts` lists every Google host and path the app may call
  (OAuth, Search Console sites / searchAnalytics, URL Inspection, Admin accountSummaries / dataStreams /
  keyEvents, Data runReport); `assertGoogleUrl()` runs before every Google request, and
  `indexing.googleapis.com`, `urlNotifications` and the `auth/indexing` scope are refused outright.
  `test/unit/google-guard.test.ts` also scans the source tree for them.
- **Not called by any test or by this build session** (no Google credentials exist here).
  `test/helpers/fake-google.ts` + `fake-google-data.ts` answer in the documented shapes with deterministic
  synthetic data (16 months, Pacific dates, `first_incomplete_date` = today − 2, paging, a GA4 property
  whose tag is broken). **Before go-live:** the owner runbook in `docs/phase-4-summary.md` (connect
  sonorch.ai, run `gsc:sync`, compare the dashboard's 28-day clicks with Search Console's own Performance
  report for the same Pacific dates).

## SEO data provider operations used by measurement (Phase 4)

No new provider endpoints: rank checks (`rankTracker.create/add/run`; DataForSEO SERP
`google/organic/live/advanced`, one task per keyword), site audits (`siteAudit.run/status/issues`;
On-Page `task_post` / `summary`) and backlinks (`backlinks.overview/profile`; Backlinks
`summary/live`, `backlinks/live`) are the Phase 2 operations and prices above, now called on a cadence.
DataForSEO SERP results also give the non-organic item types (SERP features), stored per rank snapshot.

## Anthropic Messages API, `@anthropic-ai/sdk` 0.133.0 (Phase 3, `lib/llm/anthropic.ts`)

- **Version:** `@anthropic-ai/sdk` **0.133.0**, pinned exactly. Models from env: `LLM_MODEL_DRAFT`
  (default `claude-sonnet-5-5`, briefs and drafts) and `LLM_MODEL_REVIEW` (default `claude-opus-5-5`,
  topic selection and fact-checking).
- **Docs read:** 9 October 2026, the claude-api reference (cached 2026-10-06) loaded before writing the
  integration: `beta.messages.create` with the `server-side-fallback-2026-07-01` beta and
  `fallbacks: "default"` (a declined turn re-runs on a fallback model in the same call;
  `usage.iterations` bills each model separately), adaptive thinking (`thinking: {type: "adaptive"}`,
  the only mode on these models), `output_config.effort` (explicit; Opus 5.5 defaults to medium) and
  `output_config.format` (JSON schema for the final answer), prompt caching (`cache_control` on the system
  block; usage `cache_read_input_tokens` / `cache_creation_input_tokens`), strict tool schemas,
  `tool_choice` auto only (forced tool choice is refused by these models), replaying the assistant turn
  verbatim including thinking blocks, stop reasons (`refusal`, `pause_turn`, `max_tokens`), error classes
  and retries (408/409/429/5xx retried twice by the SDK), non-streaming limit (we keep `max_tokens` ≤ 16,000).
  List prices the same day: Opus 5.5 $4 / $20 per million input/output tokens, Sonnet 5.5 $2 / $10,
  cache reads $0.20, five-minute cache writes 1.25× input (`lib/llm/prices.ts`; override with `LLM_PRICES_JSON`).
- **Never called** in tests, development or this build session (no key exists here): `LLM_PROVIDER`
  defaults to `fake` outside production and `none` in production. `FakeLlm` (`lib/llm/fake.ts`) answers
  from recorded-shape fixtures with realistic token usage. **Before go-live:** one supervised real run
  per step on a test workspace with a small `llm_tokens` budget; compare the ledger with the Anthropic
  console's usage; re-read the price page.

## pg-boss 12.37.1 (Phase 3, `lib/jobs/`)

- **Version:** `pg-boss` **12.37.1**, pinned exactly. Docs read 9 October 2026 at pgboss.io (constructor
  options, queues and policies, `send` with `singletonKey`/`startAfter`, `work` with
  `localConcurrency`/`pollingIntervalSeconds`, `schedule` (cron with `tz`), maintenance/supervision,
  migrations).
- **How we use it:** schema `pgboss` in the `seo` database, created by `deploy/postgres/10-seo-database.sh`
  (owned by `seo_owner`, usage and DML granted to `seo_app` with default privileges) and installed or
  migrated by `scripts/migrate.ts` as the owner role. The web process only sends (`supervise`/`schedule`
  off); the worker works the queues and owns the cron clock; neither runs DDL (`migrate: false`,
  `createSchema: false`, `reindex: false`). Verified as the app role against PostgreSQL 16:
  send/work/schedule, `short` policy de-duplication, retries (`test/integration/jobs.pg.test.ts`).

## GitHub REST API 2026-03-10 and Gitea API v1 (Phase 3, `lib/publishers/git.ts`)

- **GitHub:** REST API with `X-GitHub-Api-Version: 2026-03-10` (docs read 9 October 2026): repositories
  (`GET /repos/{o}/{r}`, `permissions.push`), git refs (`GET /git/ref/heads/{b}`, `POST /git/refs`),
  contents (`GET|PUT|DELETE /contents/{path}`, base64 bodies, `sha` for updates), pulls
  (`POST /pulls`, `GET /pulls/{n}`, `GET /pulls?head=owner:branch&state=open`). Auth: a fine-grained
  personal access token or GitHub App token with Contents read/write and Pull requests read/write on the
  one repository, sent as `Authorization: Bearer`.
- **Gitea:** API v1 as of Gitea 28.1 (docs read 9 October 2026 at docs.gitea.com/api): repositories,
  branches, contents (`POST/PUT/DELETE /contents/{path}` with `new_branch` to branch off), pulls. Auth
  `Authorization: token <token>`.
- **Not called by any test:** `test/helpers/fake-git.ts` implements both APIs (including the API-version
  header check) for unit, integration and e2e tests; the seeded lumoras.ai connection points at the
  local fake (`http://github.test:4571`). **Before go-live:** one supervised PR against a scratch
  repository with the production token.

## Search Console URL Inspection API v1 (Phase 3, after publishing)

- `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` with `inspectionUrl` and
  `siteUrl` (docs page updated 2024-07-23, read 9 October 2026), scope `webmasters.readonly` (the same
  connection as Phase 2). Used once after an article is live to record Google's index status; it does
  not request indexing. **The Indexing API is never used.** Not called by any test (the fake Google
  answers it).

## Webhook signing, JSON Feed 1.1, RSS 2.0 (Phase 3, `lib/publishers/webhook.ts`, `feed.ts`)

- Our own scheme (no external API): `X-Lumoras-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`
  with `X-Lumoras-Timestamp` and a five-minute replay window, the same construction as Stripe's and
  Slack's signatures. Receivers' instructions are in the README.
- Feeds follow JSON Feed 1.1 (jsonfeed.org/version/1.1, read 9 October 2026) and RSS 2.0
  (rssboard.org/rss-specification).

## Markdown: unified 11.0.5, remark-parse 11.0.0, remark-gfm 4.0.1, remark-rehype 11.1.2, rehype-stringify 10.0.1 (Phase 3)

- Parse articles for the lint (headings, links, words, sentences) and render the editor preview, the
  webhook HTML and the feeds. Raw HTML in Markdown is dropped (not passed through). `gray-matter` 4.0.3
  (dev only) parses frontmatter in tests, as lumoras.ai's own content loader does.

## DataForSEO API v3 (Phase 2, `lib/providers/dataforseo.ts`)

- **Version:** REST API v3 (`https://api.dataforseo.com/v3/…`; free sandbox `https://sandbox.dataforseo.com`). No SDK.
- **Docs read:** 9 October 2026: docs.dataforseo.com for `appendix/user_data` (free; `money.balance`,
  the per-endpoint `price` table with `cost_type` per request or per result), DataForSEO Labs Google
  `keyword_ideas/live`, `keyword_overview/live`, `ranked_keywords/live`, `domain_rank_overview/live`,
  `competitors_domain/live`; SERP `google/organic/live/advanced` (and `task_post`/`task_get` for the
  cheaper queue); Backlinks `summary/live`, `backlinks/live`; On-Page `task_post`, `summary/{id}`.
  Pricing pages (same day): Labs $0.012 per task + $0.00012 per item (×2 with clickstream); SERP live
  $0.002, priority $0.0012, standard $0.0006 per 10 results; Backlinks $0.024 per request +
  $0.000036 per row; On-Page basic crawl $0.00015 per page. Terms of Service "UPDATED: 12 JUNE, 2026"
  (quoted in `docs/provider-decision.md`).
- **How we use it:** HTTP Basic (`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`), POST arrays of one task,
  `redirect: "error"`, 60 s timeout. Every envelope's `cost` (USD) becomes integer micro-dollars and
  settles the ledger; a failed task that DataForSEO still billed is charged what it billed. There is
  **no price-before-call endpoint**: we price with the published table (`DFS_PRICES` in
  `lib/providers/operations.ts`), an upper bound.
- **Not called by any test:** `test/helpers/fake-dataforseo.ts` answers in the documented envelope.
- **Re-read before go-live:** the account's own `price` object (prices can differ per account) and
  whether the Backlinks API needs enabling on the account.

## OpenSEO MCP (Phase 2, `lib/providers/openseo.ts`, `lib/providers/mcp-client.ts`)

- **Version:** source `every-app/open-seo` v0.1.12 (commit `89e5a00`, 8 October 2026), MCP server
  `0.0.12` on `@modelcontextprotocol/server` 2.0.0 and `agents` 0.22.0; hosted `tools/list` read the
  same day. Details and every tool: `docs/openseo-tools.md`.
- **How we use it:** our own minimal Streamable HTTP client (no SDK dependency): stateless
  `tools/call` POSTs carrying the 2026-07-28 protocol's per-request `_meta` and `Mcp-Method`/`Mcp-Name`
  headers; JSON or SSE answers; only `structuredContent` is read. Optional bearer token or Cloudflare
  Access service token. Not called by any test (`test/helpers/fake-openseo.ts`).

## Google OAuth 2.0, Search Console API, GA4 Admin and Data APIs (Phase 2, `lib/google/`)

- **Docs read:** 9 October 2026:
  - OAuth 2.0 for web server apps (developers.google.com/identity/protocols/oauth2/web-server, last
    updated 2026-09-14): `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`,
    `access_type=offline`, `prompt=consent`, `state`, `include_granted_scopes`; token endpoint
    `https://oauth2.googleapis.com/token` (`authorization_code` and `refresh_token` grants); revoke
    `POST https://oauth2.googleapis.com/revoke` with `token=`. PKCE (`code_challenge`,
    `code_challenge_method=S256`, `code_verifier`) is documented in Google's installed-app guide and
    accepted by the same endpoints; we send it on our web flow too (verify on the first real connect,
    see open-work).
  - Search Console API: `searchanalytics.query`
    (`POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`, last
    updated 2026-08-11; rowLimit up to 25,000; `type`, `dimensions`, `dataState`) and `sites.list`
    (`GET …/webmasters/v3/sites`). Scope `webmasters.readonly`.
  - GA4 Admin API v1beta `accountSummaries.list` (last updated 2026-06-18) and GA4 Data API v1beta
    `properties.runReport` (last updated 2026-04-23). Scope `analytics.readonly`. Dimensions
    `landingPage`, `date`, `sessionDefaultChannelGroup`; metrics `sessions`, `keyEvents`.
  - **Not used:** the Indexing API (job postings and livestreams only).
- **How we use it:** one OAuth client (`GOOGLE_OAUTH_CLIENT_ID/SECRET`), redirect URI
  `<BETTER_AUTH_URL>/api/google/callback`; state and verifier sealed (AES-256-GCM) in a 10-minute
  HttpOnly SameSite=Lax cookie on `/api/google`; refresh tokens encrypted per connection; access
  tokens in memory only. Reads are cached in memory for 10 minutes.
- **Not called by any test:** `test/helpers/fake-google.ts` (consent redirect, token endpoint that
  checks the PKCE verifier, revoke, sites.list, searchAnalytics.query, accountSummaries, runReport),
  wired through `GOOGLE_API_TEST_ORIGIN`.

## Better Auth 1.7.7 (Phase 1)

- **Version:** `better-auth` **1.7.7**, pinned exactly (published 30 September 2026; `latest` on
  npm on 9 October 2026). Pulls in `zod` 4.6.5 (also pinned directly in apps/seo) and `kysely` 0.29.6.
- **Docs read:** 9 October 2026, from better-auth.com/docs: PostgreSQL adapter, Database
  (schema, `modelName`/`fields`, `generateId`, `getMigrations`), Organization plugin (options,
  hooks, access control, API), Admin plugin (roles, impersonation), Magic link plugin, Rate limit,
  Security (CSRF, cookies, IP handling, open redirects), Next.js integration (route handler,
  `nextCookies`, Next 16 proxy), Options reference. Type definitions in the installed package
  were checked where the web pages were silent (`schema` options of the organization and admin
  plugins, `account.encryptOAuthTokens`, `getSessionCookie`, Kysely dialect detection).
- **How we use it** (`lib/auth/server.ts`):
  - Database: a `pg` pool of the app role, passed as an object with `connect()` (Better Auth then
    uses Kysely's `PostgresDialect`). The object is our audited wrapper (`lib/auth/audited-pool.ts`).
  - Every model and field mapped to snake_case `auth_*` tables (migration `0002_auth.sql`); ids
    are database-generated uuids (`advanced.database.generateId: "uuid"`).
  - Plugins: `organization` (roles owner/editor/reviewer/viewer built with `createAccessControl` from our
    permission map; reviewer added in Phase 3), `magicLink` (15 minutes, token stored hashed), `admin` (platform admins,
    impersonation for 30 minutes), `nextCookies` last.
  - Google sign-in only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are both set; OAuth tokens
    encrypted at rest (`account.encryptOAuthTokens`).
  - Cookies: prefix `lumoras-growth`, httpOnly, SameSite=Lax, Secure when `BETTER_AUTH_URL` is https.
  - Rate limiting enabled in every environment, stored in Postgres (`auth_rate_limit`).
  - Telemetry off.
- **Checked against the docs, in tests** (`test/integration/auth.pg.test.ts`): `getMigrations`
  reports nothing to create or add for our schema; magic link single use and hashed storage;
  invitation flow; organization role checks; impersonation start/stop; per-IP rate limit; the
  origin (CSRF) check.
- **Quirks found:**
  - `getMigrations` logs "Field last_request in table auth_rate_limit has a different type in
    the database. Expected number but got int8." Better Auth's own generator creates this column
    as `bigint` (it holds a millisecond timestamp), but its type check lists the name `bigint`
    while PostgreSQL introspection reports `int8`. The warning is cosmetic: the limiter works on
    the column (proved by the per-IP test). Nothing to change on our side.
  - Behind a proxy Better Auth reads the client IP from `X-Forwarded-For` and does not trust
    comma-separated chains. Caddy sets a single address, so this works on VPS3; if another proxy
    is added in front, set `advanced.ipAddress.trustedProxies`.
- **Re-read** before upgrading: the changelog for schema changes (the integration test catches
  new fields), and the organization/admin plugin permission names.

## Resend (Phase 1, email)

- Same integration as `apps/web/lib/email.ts` (REST `POST https://api.resend.com/emails`,
  bearer key). No SDK. Docs last read for apps/web; the request shape used here is identical.
  Not called by any test: tests and e2e write mail to `EMAIL_OUTBOX_DIR` instead.

## Next.js 16.4.0 (Phase 0 and 1)

- Bundled docs (`node_modules/next/dist/docs`) read 9 October 2026 for: Content Security Policy
  with nonces via `proxy.ts`, the `proxy` file convention (renamed from middleware), and View
  Transitions (`<ViewTransition>` from React 19.3, no config needed).
