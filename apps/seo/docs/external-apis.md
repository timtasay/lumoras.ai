# External APIs and libraries: versions and when their docs were read

Build prompt section 17: read the documentation of every external API before integrating it,
and record the version and the date. Newest first.

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
  - Plugins: `organization` (roles owner/editor/viewer built with `createAccessControl` from our
    permission map), `magicLink` (15 minutes, token stored hashed), `admin` (platform admins,
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
