# Phase 1 summary: tenancy

Built 9 October 2026 on branch `dev`, left uncommitted for the owner to review. Phase 2 has not
been started. Built on the approved `/design` system: every screen uses its components, and the
pieces that lived only on the design page were extracted (the field-behind-glass stage is now
`components/auth/AuthStage`, the site card `components/sites/SiteCard`; both are what `/design`
shows).

## What was built

### Auth: Better Auth 1.7.7 (`lib/auth/`)

- Postgres through `pg`; every model mapped to snake_case `auth_*` tables (migration `0002`),
  database-generated uuid ids. An integration test asks Better Auth's own `getMigrations` whether
  our schema matches: nothing to create or add.
- **Magic link** (15 minutes, single use, token stored hashed) through Resend, or the server log
  in development, or an outbox directory in tests. **Google** sign-in configured, and switched
  off cleanly (button shown disabled, with the reason) while `GOOGLE_CLIENT_ID/SECRET` are unset.
- **Organization plugin** for workspaces, members, roles and invitations (7-day, email-bound,
  verified email required). **Admin plugin** for platform admins (Lumoras staff) and
  **impersonation** (30 minutes; admins cannot impersonate admins).
- **Roles:** platform admin (`auth_user.role = 'admin'`), owner, editor, viewer (= client
  reviewer). One **permission map** (`lib/auth/permissions.ts`) is used by every server action and
  route handler (`inWorkspace(slug, permission, action, fn)`), and Better Auth's organization roles
  are generated from the same map. The database refuses any other role name.
- **Cookies:** prefix `lumoras-growth`, httpOnly, SameSite=Lax, Secure whenever `BETTER_AUTH_URL`
  is https (production refuses plain http). No cookie cache, so revocation and the end of an
  impersonation apply on the next request.
- **Rate limits:** Better Auth per client IP, stored in Postgres (sign-in link 5/min, verify 10/min,
  social 10/min, invitations 20/min, organization create 5/min, impersonation 10/min, everything
  else 120/min) plus our own Postgres fixed windows that an attacker cannot reset by changing IP:
  sign-in links per email (5 per 15 min), crawls per site (6/h) and per workspace (30/h),
  invitations per workspace (50/h), workspaces per user (5/day), impersonations per admin (30/h).

### Workspace id mapping (decision)

**`workspace_id` = Better Auth organization id.** `workspaces.id` is a primary key that references
`auth_organization(id)`. A trigger on `auth_organization` creates the `workspaces` row in the same
transaction, so there is never an organization without a workspace. App-level fields (status,
onboarding step and site; later plan and budget) live on `workspaces`; name and slug stay on the
organization, where Better Auth manages them.

### Schema and row-level security (`migrations/0002`–`0005`)

- Tenant tables: `workspaces`, `sites`, `brand_profiles`, `authors`, `site_routes`, `crawl_runs`,
  `connections`, `notifications`, `audit_log`. Invitations are Better Auth's `auth_invitation`.
- **RLS enabled and FORCED on every tenant table**, one policy each:
  `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid` (`id` on
  `workspaces`). No workspace set → NULL → no rows, no writes.
- The app connects as `seo_app` (no superuser, no BYPASSRLS, owns nothing). The typed query layer
  `withWorkspace(pool, ctx, fn)` (`lib/db/tenant.ts`) opens a transaction and sets
  `app.workspace_id`, `app.actor_id`, `app.impersonator_id`, `app.request_id` with
  `set_config(…, true)` (transaction-local), and `tx.action("site.create")` names the intent.
  Typed helpers: `tx.many/one/maybe/exec/event`.
- Composite foreign keys `(workspace_id, site_id) → sites(workspace_id, id)`: a row cannot be
  attached to another workspace's site even by a buggy query.
- Better Auth's tables are not tenant tables (no RLS); the app role has plain DML on them through
  the init script's default privileges, which is exactly what Better Auth needs.

### Platform-admin path (decision)

Cross-workspace reads go only through **audited SECURITY DEFINER functions** in `0005_platform.sql`
(`platform_workspace_summaries`, `platform_workspace_members`, `platform_audit_log`). They run as
the owner role, whose **SELECT-only** policies target `pg_database_owner` (so no role name is
hard-coded in migrations and no BYPASSRLS role is needed). Each function first checks that the
actor is a platform admin, not banned and not impersonating, then writes a `platform.*` audit row,
then returns aggregates or the trail (never secrets). There is no cross-workspace write path:
staff change a workspace by impersonating one of its members.

### Audit log (`0003_audit.sql`)

- Written only by trigger functions, **in the same transaction** as the change: every tenant table
  (row level; `site_routes` gets one summary row per statement and site, because a crawl upserts
  thousands of rows), and Better Auth's `auth_organization`, `auth_member`, `auth_invitation`,
  `auth_user`, plus impersonation sessions (`impersonation.start`/`stop`, actor = the admin).
- Each row: when, workspace, actor, impersonator, action, entity, before, after, details, request id.
  Secret columns are replaced by a short fingerprint (`[redacted 1a2b3c4d]`): the trail shows that a
  credential changed without holding it.
- A tenant write without an actor is refused by the database. The app role cannot insert, update
  or delete audit rows (revoked in the migration).
- Better Auth writes are attributed through `runWithAudit()` (AsyncLocalStorage) and an audited pool
  wrapper that copies actor/impersonator/action into the session while Better Auth holds the
  connection, and clears it on release.
- Viewers: `/w/:slug/audit` (filters, before/after diff, impersonated rows marked) and
  `/agency/audit` for staff.

### Encryption (`lib/crypto/secrets.ts`)

AES-256-GCM, fresh 96-bit IV, `v<version>.<iv>.<tag>.<ciphertext>` plus a `key_version` column.
Keys from `ENCRYPTION_KEYS` (`1:…,2:…`) with `ENCRYPTION_KEY_CURRENT`, or a single
`ENCRYPTION_KEY`. AAD binds each secret to `connections:<workspace>:<row>`. Rotation:
`reencrypt()` / `rotateConnectionKeys()` (tested end to end in Postgres). Secrets never reach the
browser: list queries select only `has_secret` and `key_version`.

### Sitemap crawler with SSRF guard (`lib/net`, `lib/crawl`)

- `safeFetch`: http/https only, no credentials in URLs, ports 80/443/8080/8443; resolves **all**
  A/AAAA records and refuses if any is loopback, private, CGNAT, link-local, unique-local IPv6,
  site-local, multicast, documentation, benchmarking, reserved, Teredo, or cloud metadata
  (169.254.169.254, 169.254.170.2, 100.100.100.200, fd00:ec2::254); IPv4 embedded in IPv6
  (mapped, NAT64, 6to4) judged by the IPv4 inside; IP literals in every disguise (2130706433,
  0x7f.0.0.1, [::ffff:127.0.0.1]…). **Every redirect hop** is re-vetted (manual redirects, max 5).
  The socket's DNS lookup is **pinned** to the vetted address (no rebinding), TLS still verifies the
  host name. Body capped after decompression (gzip bombs), one deadline across hops, no connection
  reuse.
- Crawler: robots.txt `Sitemap:` lines (fallback `/sitemap.xml`) → sitemap indexes (depth 3) →
  sitemaps, including raw `.xml.gz`; at most 50 sitemap files and 50,000 URLs; only the site's own
  host (and `www.`). Then title, meta description, `og:site_name` and first `<h1>` of up to six
  key pages. Stored as `site_routes` (url, path, lastmod, discovered_at, last_seen_at), with a
  `crawl_runs` row and a notification. One crawl per site at a time. Refreshed on demand; the daily
  schedule is a `TODO(Phase 3)`.
- `POST /api/w/:slug/sites/:id/crawl` streams progress as NDJSON to the scan visual; no
  transaction is held open while fetching.

### Sites, brand profiles, authors, connections

CRUD with zod validation (domains normalised: scheme, `www.`, port and path stripped; IPs, single
labels and internal names refused). Brand profile has every section 6 field, with the crawl
filling only **empty** fields (overview from the homepage description, positioning from its
heading, key pages). Authors: name, role, bio, avatar URL (https) only; demo authors flagged
`is_demo` and badged. Connections: Git, WordPress and webhook can be saved with encrypted
credentials; Search Console, GA4 and social are shown as planned; "Test" buttons are disabled
until each connector's phase.

### Screens (Voice Core, both themes, 375 and 1440 px)

- `/sign-in`: particle field behind glass, magic link and Google; errors announced.
- `/accept-invitation/:id`: who invited whom to what role; sign in as the invited address; accept
  or decline.
- **Onboarding** (`/onboarding`, `/w/:slug/onboarding/:step`), its own full-screen flow with a step
  rail: workspace → first site → **sitemap scan** (radar sweep that turns only while live, route
  count, streamed log, then the designed "Domain overview: available once SEO data is connected"
  state) → brand profile pre-filled from the crawl → authors → Search Console & GA4, publishing,
  schedule & budget as designed, skippable "coming next" steps → done (summary and the first
  calendar, reading "queue empty" until a schedule exists).
- Workspace overview (KPIs that count up, sites as cards with a React `<ViewTransition>` morph into
  the site page), site pages (overview with routes and scan, brand profile, authors, connections
  with status lights, settings with danger zone), members and roles (role changes, invitations with
  copyable links, last-owner protection), audit log, agency home (every workspace with health at a
  glance; Phase 2–4 metrics as designed placeholders) with "Enter as…" impersonation and a flare
  banner while impersonating, platform audit.
- ⌘K jumps between workspaces, sites and pages; notifications bell; account menu; workspace
  switcher.

### Security hardening

- **CSP** (`proxy.ts`, `lib/security/csp.ts`): per-request nonce; `script-src 'self' 'nonce-…'
  'strict-dynamic'` (no `unsafe-inline`, no `unsafe-eval` in production); the pre-paint theme
  script carries the nonce (the root layout reads it), Next stamps its own scripts;
  `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`,
  `upgrade-insecure-requests` on https. Style attributes are allowed (`style-src-attr`), see
  open work.
- **CSRF**: Better Auth's origin check and Fetch-Metadata login-CSRF check on `/api/auth/*`;
  Next.js's built-in Origin-vs-Host check on every server action; our route handler requires a
  same-origin `Origin`, `Sec-Fetch-Site: same-origin` when sent, and a JSON content type; all on
  top of SameSite=Lax cookies. No separate token: every state-changing path is covered by an origin
  check that a cross-site page cannot satisfy.
- Rate limits as above; the proxy only does optimistic redirects, every page and action validates
  the session itself.

### Seed (`pnpm --filter seo seed`)

Idempotent, through the audited path as `system:seed`. **Lumoras** (owner, editor, viewer):
sonorch.ai, seasonx.ai, lumoras.ai with facts taken only from `prototypes/BRIEF.md` and
`docs/content-spec.md` (no invented numbers or competitors; lumoras.ai gets its known routes from
the content spec). **Northwind Dental (demo)** (owner, editor, viewer): a fictional practice on a
reserved `.example` domain, with a demo webhook connection. Platform admin
`staff@lumoras.example`. Every author is marked demo. Refuses to run next to an https
`BETTER_AUTH_URL`.

### Dependencies added (exact pins)

`better-auth` 1.7.7, `zod` 4.6.5 (already Better Auth's dependency; now used directly for
validation). Nothing else; no animation or chart library. Versions and docs read:
`docs/external-apis.md`.

## What was not built (by design)

Phase 2+ (providers, budgets, keywords, Search Console/GA4 OAuth, pipeline, publishers, live
connection tests, scheduling, daily crawl, measurement, billing). Email notifications (in-app only).
No Docker image built (no daemon), nothing deployed, apps/web and the shared packages untouched.

## Acceptance checks

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass (lockfile only gains entries) |
| `pnpm typecheck` / `pnpm lint` (ui-tokens, ui-field, web, seo) | pass, 0 warnings |
| `pnpm test` (apps/seo, unit + integration on PostgreSQL 16.15) | **158 / 158 pass, 0 skipped** |
| `pnpm build` (web and seo) | pass |
| `pnpm test:e2e` (production builds) | **apps/seo 41 / 41**, apps/web 1 / 1 |
| apps/web | `git diff --stat apps/web packages` is empty; apps/web e2e smoke passes |
| Two workspaces cannot see each other's data | proven red and green (below) |

**Test inventory.** Unit: permission map, AES-GCM (round trip, tamper, AAD binding, wrong key,
rotation, config), SSRF (54: classification of every refused range, schemes, ports, literals,
redirects, rebinding, size, gzip bomb, time), crawler and parsers against a local fake site,
validation, CSP and origin check, env (incl. test knobs refused on https). Integration (real
PostgreSQL, databases created with the real init script): RLS isolation (19), Better Auth on the
real schema (9: schema match, magic link single use and hashed, workspace creation with audit,
invitations and role enforcement, impersonation trail, per-email and per-IP limits, CSRF), seed and
data layer (4: idempotent seed, crawl storage and statement audit, pre-fill never overwrites,
key rotation in the database), migrations runner (7).

**E2E (Playwright, production build, fresh database, fake client site, no external calls):**
sign-in via the captured magic link; CSP header and nonce on every script; signed-out redirect;
onboarding end to end twice (dark 1440, light 375) including the live scan of the fake site,
brand pre-fill, a validation error that keeps typed values, authors, the skippable steps and the
database/audit assertions; a scan of an unresolvable domain failing cleanly; invite + accept
(two browsers, email captured); a viewer who cannot edit in the UI and is refused by the API; an
editor who cannot manage members; cross-workspace 404s; cross-site POST refused; platform-admin
impersonation visible in both audit logs and in the database; credentials never in the page;
⌘K; keyboard (skip link, switcher, Escape); phone drawer; every workspace and agency screen in
both themes at 375 and 1440 with no console errors and no sideways scroll; reduced motion;
`/design` (unchanged tests).

### Red before green

**(a) RLS isolation** (`RLS_TEST_SABOTAGE`, reproducible: `RLS_TEST_SABOTAGE=… pnpm --filter seo test:integration`):

| Sabotage | Result | What the failure names |
| --- | --- | --- |
| `bypassrls` (app role gets BYPASSRLS) | 15 of 19 fail | `sites: workspace A read 1 row(s) of workspace B (workspace_id = dac8e5b0-…): {"id":"60e5bbad-…","domain":"bravo.example",…}`; `brand_profiles: … "overview":"bravo private description"`; `Missing expected rejection: sites: workspace A inserted a row with workspace_id dac8e5b0-…` |
| `policy:site_routes` (policy replaced by `USING (true)`) | 4 fail | `site_routes: no policy keyed by app.workspace_id`; `site_routes: workspace A read 1 row(s) of workspace B (workspace_id = d0188fdc-…): {…"url":"https://bravo.example/secret-bravo"…}` |
| `noforce:connections` (RLS disabled) | 5 fail | `connections: row-level security is not enabled`; `connections: workspace A read 1 row(s) of workspace B …"kind":"webhook"…` |
| restored | 19 / 19 pass | |

**(b) SSRF guard** (guard broken by hand in `lib/net`, then restored; `git diff` clean afterwards):

| Sabotage | Result | Failure |
| --- | --- | --- |
| classifier allows every address | 38 of 54 fail | `refuses 127.0.0.1` … `Missing expected rejection: 127.0.0.1` |
| redirects not re-vetted after the first hop | 1 fails | `Missing expected rejection: followed /to-metadata → http://169.254.169.254/latest/meta-data/` |
| connection re-resolves the name (no pinning) | 1 fails | DNS-rebinding test: `request failed: connect ECONNREFUSED 127.0.0.1:…` (the socket followed the second, private answer) |
| restored | 54 / 54 pass | |

**(c) Permission map** (viewer given the editor set, editor given members and billing): 4 of 6
fail: `viewer can site:create`, `editor can member:manage`, `Missing expected exception`
(assertCan). Restored: 6 / 6. Also enforced end to end: Better Auth refuses (403) a viewer's
invitation and an editor's role change (integration); the crawl API refuses a viewer (403, e2e).

**(d) Encryption tamper detection** (GCM tag check bypassed): 3 of 8 fail:
`Missing expected exception (SecretDecryptError): a flipped bit in the ciphertext was not detected`,
plus the AAD-binding and wrong-key tests. Restored: 8 / 8.

## Screenshots

57 `seo-p1-*.png` in the build session's scratchpad `shots/` (production build, full page):
sign-in (dark/light × 1440/375); onboarding: workspace, site, **scan**, brand, authors, search,
publishing, schedule, done (dark 1440) and site + scan (light 375); overview, site, brand profile,
authors, connections, site settings, members, audit (dark/light × 1440/375); agency home and
platform audit (both themes, both widths); impersonation banner; reduced-motion authors.

## Questions for the owner

1. **Self-serve sign-up and workspace creation.** Today anyone who signs in with a magic link gets
   an account, and any signed-in user may create up to 5 workspaces a day (needed for invitations
   to new addresses and for the onboarding flow). Should workspace creation be limited to platform
   admins (Lumoras creates client workspaces and invites the client), or stay open for self-serve?
2. **Client approval rights.** Section 5 says a viewer/client reviewer "approves or rejects content
   when approval is required"; this phase's brief says a viewer cannot approve. Phase 1 has no
   content, so viewers cannot approve. Before Phase 3: a separate "client reviewer" role with a
   `content:review` permission, or give it to viewers?
3. **Lifetimes.** Sessions 7 days (refreshed daily), invitations 7 days, sign-in links 15 minutes,
   impersonation 30 minutes. Keep?
4. **Google sign-in.** Create the OAuth client (needs the host name, decision #1) and add the two
   env vars; until then the button shows, disabled, with the reason.
5. Still open from Phase 0: product and host name (#1), the database names and env-file path
   against `01-databases.sh`, and decisions #2–#5.
