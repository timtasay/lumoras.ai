# Phase 2 summary: research

Built 9 October 2026 on branch `dev`, left uncommitted for the owner to review. Phase 3 has not been
started. No real paid call was made anywhere (no provider keys exist in the build environment, and the
suite only ever talks to local fakes). Nothing was deployed.

## Step A: OpenSEO, DataForSEO and their terms (owner decision #3)

- [`openseo-tools.md`](openseo-tools.md): OpenSEO's **actual** MCP tools (76 at v0.1.12, commit
  `89e5a00`, read 9 October 2026 from source and the hosted `tools/list`), parameters, return shapes,
  auth modes, how it calls DataForSEO, how credits are computed, and what self-hosting exposes.
- [`provider-decision.md`](provider-decision.md): gap table, the terms of service quoted with URLs and
  dates, operational trade-offs, and a recommendation.

Findings in short:

- Self-hosted OpenSEO **does** expose MCP over HTTP (`POST /mcp`, Streamable HTTP, stateless), but the
  Docker mode has **no authentication** at all (`AUTH_MODE=local_noauth`), and self-hosted OpenSEO
  **does not meter**: no per-call cost in responses, `whoami.creditsRemaining` is `null`. Every client's
  research would sit in one shared OpenSEO workspace. `find_serp_competitors` needs keywords (no
  domain-based competitors); only rank tracking has a price-before-call tool.
- DataForSEO returns the billed `cost` on every response and the balance and price table from the free
  `appendix/user_data`; there is no "price this call" endpoint anywhere, so pricing first means applying
  the price table, which we do for every provider.
- **OpenSEO hosted ToS** (8/23/2026) allows "SEO work for your own websites and for your clients" and
  client deliverables, but not reselling results "as a standalone data product or use them to build a
  competing product or service"; 2.2(a) bars distributing or hosting the Site's content. Do not build on
  the hosted plan. The self-hosted code is MIT.
- **DataForSEO ToS** (12 June 2026) has **no clause on resale or white-label** (ambiguous by silence);
  7.1 forbids using SERP data to compete with or harm search engines; 8.1 lets them close accounts at
  their discretion. Get written confirmation before charging clients.
- **Recommendation: DataForSEO directly** (`SEO_PROVIDER=dataforseo`), OpenSEO kept as an optional
  adapter. The owner decides.

## What was built (Step B)

### The provider layer (`lib/providers/`)

- `SeoDataProvider` exactly as section 4 lists it: `keywordIdeas`, `keywordMetrics`, `serp`,
  `domainOverview`, `rankedKeywords`, `serpCompetitors`, `backlinksOverview`, `backlinksProfile`,
  `rankTracker.create/add/run/get`, `siteAudit.run/status/issues`, `estimateCost(operation)`, `balance()`.
  Results are our own validated shapes; provider output is untrusted data.
- **FakeProvider**: fixtures for the seeded sites plus deterministic generated data; charges exactly
  what DataForSEO would for the rows it returns; call counters, latency and failure knobs for tests.
  The fixtures are **synthetic** (no key to record real ones) and marked "Demo data" on every screen.
- **OpenSeoProvider**: our own minimal MCP client (no SDK added), mapped to the real tool names
  (`research_keywords`, `get_keyword_metrics`, `get_serp_results`, `get_domain_overview`,
  `get_ranked_keywords`, `find_serp_competitors`, `get_backlinks_overview`, `get_backlinks_profile`,
  `create_rank_tracker`, `add_rank_tracking_keywords`, `estimate_rank_tracker_cost` + `run_rank_tracker`,
  `get_rank_tracker`, `run_site_audit`, `get_audit_status`, `get_audit_issues`, `whoami`,
  `list_projects`, `create_project`). One OpenSEO project per site domain, found or created for free.
- **DataForSeoProvider** (built because OpenSEO cannot report cost or balance, and lacks domain
  competitors): Labs, SERP, Backlinks, On-Page and `appendix/user_data`; actual `cost` settles the ledger.
- `SEO_PROVIDER=none|fake|openseo|dataforseo`: `fake` by default in development and tests, `none` in
  production; credentials from env only, never to the browser or a model.

### One metered call path (`lib/metering/metered.ts`)

Order: estimate → workspace cache (a hit is free and logged as a zero-cost `cached` ledger entry and a
`cached` research-log line, no provider call) → confirmed-price check → provider balance → **reserve**
(per-workspace, per-category `pg_advisory_xact_lock`, this month's settled + held usage, refuse below or
across the reserve, insert a HOLD for the estimate) → provider call with no transaction open →
**settle** (hold → actual cost, research log, cache upsert, audit rows, `onSettled` follow-ups, all in one
transaction). Failures are released, or charged what the provider says it billed. Holds older than an
hour are settled at their estimate (money is counted as spent). Refusals are written to the research
log and the audit log before they are thrown.

- **Units:** integer **micro-US-dollars** (µUSD, 1 USD = 1,000,000) in the database (`bigint`), the
  ledger, estimates and budgets; DataForSEO's smallest price ($0.000036/row) is 36 µUSD. Social posts
  are budgeted in posts.
- **Cache scope: workspace-scoped**, by decision. A free hit would otherwise tell client B that client A
  researched the same thing, and A's spend would subsidise B. The key is sha256 of provider + operation
  + normalised parameters (keywords normalised and sorted, markets reduced to location + language), so a
  switch from demo data can never answer for a real provider; RLS confines entries to their workspace.
- **Concurrency:** the advisory lock serialises reservations per workspace and category; the second of
  two concurrent calls sees the first's hold. Proven by a test that holds ten calls inside the
  reservation window at once (below).
- The ledger is append-only for the app role (no DELETE), settled/released rows are immutable (trigger);
  the research log is insert-only (no UPDATE/DELETE).

### Research rules (pure functions, unit-tested)

- Rule 4 (`lib/research/seeds.ts`): a seed researched within the site's maximum age (new per-site
  setting, default 90 days) is not bought again: the logged result is shown instead, free, with no
  ledger entry; backlog rotation (never-researched by priority, then the stalest; skipped and fresh
  seeds never).
- Rule 5/6 groundwork (`lib/research/keywords.ts`): keyword normalisation; variant keys that fold
  places (states, codes, countries, cities, "near me"), word order, plurals and filler words;
  `collapseVariants` returns one target per group with the places to handle inside it.
- Rule 7 (`lib/research/offering.ts`): free-text sells / does-not-sell lists split into terms;
  does-not-sell wins; unmatched keywords are "unclear fit". Excluded keywords can never be saved (the
  server re-checks).

### Schema (`migrations/0006_research.sql`)

`budgets`, `usage_ledger`, `research_log`, `provider_cache`, `seed_backlog`, `keywords` (saved, metrics,
intent, cluster, variant key, fit, status idea/targeted/published/ranking); `sites.research_max_age_days`;
one Search Console and one GA4 connection per site. Every table: RLS enabled **and forced**, the tenant
policy, the owner's platform-read policy, the audit trigger (research results fingerprinted, not
copied). New audited platform function `platform_workspace_budgets()` for the agency home.

### Search Console and GA4 (`lib/google/`, `app/api/google/callback`)

Per site, with the client's own Google account: authorization-code flow with **PKCE (S256)** and
**state**, sealed together in a 10-minute HttpOnly SameSite=Lax cookie on `/api/google`; the callback
checks cookie authenticity and expiry, state (constant time), the signed-in user, and that they may still
manage connections; code exchanged with the verifier; read-only scopes only (`webmasters.readonly`,
`analytics.readonly`), a grant without them or without a refresh token is refused. Refresh tokens
encrypted (AES-256-GCM, AAD-bound) in `connections`; access tokens only in memory; `invalid_grant` turns
the light red. Property selection (GSC `sites.list`, GA4 Admin `accountSummaries`, with the site's own
property suggested), live **Test** with status light, disconnect revokes at Google. Reads: striking
distance (positions 4–20), pages with impressions but no clicks, GA4 organic landing pages and
measurement health. **No Indexing API.** Env-gated with a designed "not configured" state.

### Screens (both themes, 375 and 1440, reduced motion, keyboard, charts with hidden tables)

- **Keywords** (site tab, and `/w/:slug/keywords`): KPI tiles; Research panel (keyword ideas or a SERP)
  that shows the price, the arithmetic and a budget meter (used · this lookup · reserve) before
  anything is bought; designed refusal states; "already researched" (rule 4); results grouped by
  variant with fit badges, excluded rows hidden unless asked; save to keywords. Saved-keywords table
  with status/intent/cluster filters, search, sort, bulk status/cluster/remove. Research log tab (costs,
  cache hits, refusals). **Seed backlog** tab (add, priority, skip/requeue, remove, "up next", research
  link).
- **Workspace settings → Budget and usage**: per-category ceiling and reserve (owners), month-to-date
  KPIs, daily spend chart with its data table, ledger, CSV export (formula-safe).
- **Site → Connections**: Search Console and GA4 cards (not configured / not connected / choose
  property / working / failing), and the SEO data provider status for platform admins (also on the
  agency home, which now shows each workspace's SEO budget use).
- **Onboarding step 6** is real (connect or skip); the scan step's **domain overview** is real when a
  provider is configured (priced, budgeted; a new workspace without a budget gets the designed refusal).
- **Site overview**: search opportunities from Search Console when connected, GA4 health, and the
  domain overview panel.
- Permissions: new `research:run`, `keyword:manage` (editors), `budget:read` (everyone), `budget:manage`
  (owners). Rate limits: research per member (40/10 min) and per workspace (200/h); Google connects per
  site (10/h) and tests (60/h).

## Not built (by design or deferred)

Rank tracking and site-audit screens and tables (Phase 4; the provider operations exist and are
tested), keyword-metrics refresh, competitor and backlink screens, full topic selection (Phase 3),
daily GSC/GA4 snapshots and dashboards (Phase 4), the worker job that reconciles holds and refreshes the
price table, provider credentials in encrypted platform settings. See `open-work.md`.

## Acceptance evidence

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass (no new dependency; lockfile unchanged) |
| `pnpm typecheck` / `pnpm lint` | pass, 0 warnings (ui-tokens, ui-field, web, seo) |
| `pnpm test` (PostgreSQL 16 throwaway cluster) | **232 / 232 pass, 0 skipped** (was 158) |
| `pnpm build` | pass (web and seo) |
| `pnpm test:e2e` (production builds) | **apps/seo 51 / 51** (was 41), apps/web 1 / 1; the full seo suite green on four consecutive runs after the last change |
| apps/web and packages | `git status apps/web packages` empty |

New suites: `test/unit/research-rules.test.ts` (rules 4, 6, 7, money, budget arithmetic, cache keys,
prices, CSV), `test/unit/providers.test.ts` (DataForSEO vs a fake DataForSEO, OpenSEO vs a fake MCP
server incl. SSE, FakeProvider, env), `test/unit/google.test.ts` (PKCE, state, token exchange vs a fake
Google, reads), `test/integration/metering.pg.test.ts` (15), `test/integration/google.pg.test.ts` (6),
and the RLS isolation suite now covers the six new tables (26 tests). E2E `e2e/research.spec.ts`:
research with the cost confirm, rule 4, rule 7, a free cache hit, save and bulk status, seed backlog;
budget refusal UX; Budget and usage + CSV; connect GSC and GA4 through the fake Google OAuth (plus a
forged callback refused); a viewer who cannot run research; every Phase 2 screen in both themes at 375
and 1440 with no console errors and no sideways scroll; reduced motion.

### Red before green (each guard broken on purpose, then restored; sources compared byte for byte)

| Guard broken | Result | Failure message |
| --- | --- | --- |
| Cache **lookup** (`expires_at > now` → `<`) | 4 of 15 fail | `keywordIdeas("salon pos"): a repeat within expiry was charged $0.0137 (13680 micros, status ok) and the provider was called 2 time(s); expected free from the cache and 1 call` |
| Cache **key** (raw seed instead of the normalised one) | 1 fails | same message: the differently spelled repeat was charged $0.0137 |
| **Reserve** check (decision ignores the reserve) | 2 fail | `keywordIdeas("no show policy") (estimate $0.0300) was allowed and charged $0.0131 (status ok) with only $0.0263 spendable above a $0.0200 reserve; expected a "would_cross_reserve" refusal` · `serp("salon pos") (estimate $0.0020) was allowed and charged $0.0020 (status ok) with $0.0063 left against a $0.0100 reserve; expected a "below_reserve" refusal` |
| **Concurrency** (advisory lock removed) | 1 fails | `10 of 10 concurrent keywordIdeas calls (estimate $0.0300 each) passed a budget with room for one; spent $0.14 against $0.0300 spendable` |
| Cache **tenant isolation** (`CACHE_TEST_SABOTAGE=shared`: policy `USING (true)`) | 1 fails | `B's quote says the result is cached because A bought it: the cache tells B what A researched` |
| RLS `policy:provider_cache` | 4 fail | `provider_cache: no policy keyed by app.workspace_id` · `provider_cache: workspace A read 1 row(s) of workspace B (…): {"cache_key":"b3a3…"…}` · `provider_cache: 3 row(s) visible with no workspace set` |
| RLS `noforce:usage_ledger` | 4 fail | `usage_ledger: row-level security is not enabled` · `Missing expected rejection: usage_ledger: workspace A inserted a row with workspace_id 3e4e…` |
| RLS `policy:keywords` | 4 fail | `keywords: no policy keyed by app.workspace_id` |
| RLS `bypassrls` | most fail | every table incl. `budgets`, `usage_ledger`, `research_log`, `provider_cache`: `workspace A read 1 row(s) of workspace B …` |
| OAuth **state** check removed | 1 fails | the forged-state callback is accepted (`'ok'` instead of `'state_mismatch'`) |
| **PKCE** not checked by the token endpoint (fake Google) | 1 fails | `a code is useless without the right verifier`: `Missing expected rejection.` |
| restored | 15 / 15, 26 / 26, 9 / 9 | |

Commands: `pnpm --filter seo test:integration` with `CACHE_TEST_SABOTAGE=shared` or
`RLS_TEST_SABOTAGE=…`; the other guards by editing `lib/metering/budget.ts`, `lib/metering/metered.ts`,
`lib/providers/operations.ts`, `lib/google/oauth.ts` and `test/helpers/fake-google.ts` as described,
then restoring from a copy.

Two causes found and fixed while stabilising the suite: (1) a server-action `redirect()` to Google made
Next's client router try to fetch Google's page as an RSC payload first (a console error, then a
fallback navigation); the action now returns the consent URL and the browser navigates to it plainly;
(2) the app's `pg` pool had no `error` listener, so an idle connection dropped by Postgres (a restart,
or a test database being dropped) would crash the process; it now logs and lets the pool replace it.
One Phase 1 test (`⌘K jumps between workspaces and sites`) failed once in about ten full runs under
parallel load (the audit page heading did not appear in time) and passed on every other run; noted in
open-work.

Also proven: tokens encrypted at rest (`v1.` ciphertext, refresh token absent from the row, the audit log
and the page); the app role cannot delete ledger rows or edit the research log; settled ledger rows
cannot change; a refused or price-changed call never reaches the provider; a free cache hit is served
even below the reserve.

## Screenshots

44 `seo-p2-*.png` in the build session's scratchpad `shots/`: keywords table, research cost confirm,
research results, research log, seed backlog, budget and usage, budget refusal, connections (Google
disconnected, connected, working/failing states, not configured), keywords with no provider, onboarding
step 6 and the onboarding domain overview refusal, site overview with opportunities; dark and light;
1440 and 375; one reduced-motion run.

## Questions for the owner

1. **Decision #3:** DataForSEO directly (recommended) or a self-hosted OpenSEO? Then the credentials in
   the server env file, and whether to enable the Backlinks API on the account.
2. **DataForSEO's terms are silent on multi-client use.** Will you ask them in writing (and whether they
   want a reseller agreement) before clients are charged for research?
3. **Default budgets for new workspaces.** Today a new workspace has no SEO budget (paid lookups refused
   until an owner sets one, including the onboarding domain overview). Keep that, or give every new
   workspace a default (for example $10 a month with a $2 reserve)?
4. **Cache scope.** Workspace-scoped (no cross-client leak, each client pays for its own data). A global
   cache would be cheaper for us but leaks "someone researched this". Confirm.
5. **Google OAuth client:** create it (needs the host name, decision #1), with the redirect URI
   `<BETTER_AUTH_URL>/api/google/callback`, and plan Google's verification of the read-only sensitive
   scopes before external clients connect.
6. Rule 4 maximum age default (90 days) and cache lifetimes (ideas/metrics 30 days, SERP/domain 7 days):
   keep?
7. Still open: decisions #1, #2, #4, #5, and the Phase 1 questions (self-serve sign-up, client approval
   rights, lifetimes).
