# External APIs and libraries: versions and when their docs were read

Build prompt section 17: read the documentation of every external API before integrating it,
and record the version and the date. Newest first.

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
