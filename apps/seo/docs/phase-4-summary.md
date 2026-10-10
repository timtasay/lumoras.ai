# Phase 4 summary: measurement

Built 10 October 2026, left uncommitted for the orchestrator to commit. Phase 5 has not been started.
No real Google, SEO data provider, model or website was called and no real credit was spent (local
fakes only), nothing was deployed, `apps/web` and `packages/` are unchanged, and the sonorch.ai /
seasonx.ai repositories were not touched. No new dependency was added (every version is as in Phase 3).

## Acceptance status: real Search Console data on sonorch.ai

**Pending the owner's Google setup. Not passed.** There are no Google OAuth credentials in the build
environment, so sonorch.ai's real Search Console data has never been read. Everything that leads up to it
is built and tested against a local fake Google that answers in the documented API shapes (versions and
doc dates in `docs/external-apis.md`): the OAuth connect, the 16-month backfill, the daily sync with
Google's 2–3 day lag, the dashboard and the CLI below. The runbook turns it into a real check in about
fifteen minutes once the owner has a Google OAuth client.

### Owner runbook: sonorch.ai on real data

1. **Google Cloud project** (any; one per product is tidy). APIs & Services → Library: enable
   **Google Search Console API**, **Google Analytics Admin API** and **Google Analytics Data API**.
2. **OAuth consent screen**: external, app name and support email, the production host (decision #1) as
   authorised domain, scopes `https://www.googleapis.com/auth/webmasters.readonly` and
   `https://www.googleapis.com/auth/analytics.readonly` only. While it is in *Testing*, add the Google
   account that owns sonorch.ai's Search Console as a test user (refresh tokens then expire after 7 days;
   publish the app, with Google's verification for sensitive scopes, before clients connect).
3. **Credentials → OAuth client ID → Web application**, authorised redirect URI
   `<BETTER_AUTH_URL>/api/google/callback` (e.g. `https://growth.lumoras.ai/api/google/callback`).
4. Put `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `/opt/lumoras/env/lumoras-seo.env`
   (web **and** worker read it) and restart both containers. Leave `GOOGLE_API_TEST_ORIGIN` and
   `GOOGLE_PACE_MS` unset.
5. Sign in as an owner or editor of the Lumoras workspace → sonorch.ai → **Connections** → *Connect Search
   Console*, approve with the Google account that has access to the property, choose
   `sc-domain:sonorch.ai` (or the URL-prefix property). Optionally *Connect GA4* and choose the property.
   Connecting queues the first sync in the worker automatically.
6. Or run it by hand and watch it (the site id is in the URL `/w/lumoras/sites/<id>`):

   ```bash
   docker exec lumoras-seo-worker node --import tsx scripts/gsc-sync.ts --site <id> --ga4 --inspect
   # locally: set -a; . apps/seo/.env.local; set +a; pnpm --filter seo gsc:sync -- --site <id>
   ```

   It prints each backfill step, then the last 28 days (clicks, impressions, weighted position) and the
   dashboard link. Exit code 0 on success; 2 for a missing or malformed `--site`; 1 for anything else
   (no such site, not connected or no property chosen, Google OAuth not configured, a Google or database
   error), with the reason printed and tokens never.
7. **Check**: open the sonorch.ai dashboard. Organic clicks and impressions (last 28 days) must equal
   Search Console → Performance → Search results, *Web*, custom date range = the 28 days ending yesterday
   (Pacific time), which is the dashboard's window. The two or three newest days are provisional on both
   sides (banded on the chart) and can differ slightly until Google finalises them; the next daily syncs
   re-read them, so compare again two days later if they do. Average position may differ in the second decimal (we weight by impressions the way Search
   Console does). The 90-day chart should show the same shape. Then record the result here and in
   `docs/open-work.md`.

## What was built

### Data model (`migrations/0008_measurement.sql`)

15 new tenant tables, each with `workspace_id`, a composite foreign key to `sites (workspace_id, id)`,
RLS **enabled and forced** with the `<table>_tenant_isolation` and `<table>_platform_read` policies, and
audit triggers:

| Table | What |
| --- | --- |
| `measurement_runs` | one row per (site, kind, window): status running / waiting / succeeded / failed / refused / skipped, trigger, retry_after, stats, provider ref. **The idempotency key.** |
| `rank_trackers`, `rank_snapshots` | provider tracker per site; one row per check and keyword (source published / saved, cluster, position or null = not ranking, URL, SERP features, device, location) |
| `search_sync_state` | per site and kind: backfill range and cursor, newest final day, health, failure count |
| `gsc_daily`, `gsc_page_daily`, `gsc_query_daily` | Search Console totals by day (with `final`), by page and by query+page per day |
| `ga4_daily`, `ga4_landing_daily`, `ga4_event_daily` | GA4 sessions by channel, organic landing pages, organic key events, per day |
| `url_inspections` | latest URL Inspection result per URL (verdict, coverage, last crawl, canonicals) |
| `audits`, `audit_issues`, `tasks` | audit runs; issues per audit (normalised type, severity, count, examples, assignee, task); tasks (one open task per site and issue type, partial unique index) |
| `backlink_snapshots` | per run and domain (site or competitor): referring domains, backlinks, rank, new / lost against the previous snapshot, a referring sample |

Plus measurement settings on `sites` (rank cadence weekly, device desktop, depth 30, max 100 keywords;
audit monthly, 200 pages; backlinks quarterly; Search sync on; URL Inspection 20 a day), a statement-level
audit trigger for the bulk daily tables (one audit row per write statement with the days touched, instead
of thousands of row entries), and `platform_workspace_health()`, the agency home's one cross-workspace
read: `SECURITY DEFINER`, checks `platform_require_admin()`, writes `platform.health.read` to the audit log
first, revoked from `PUBLIC`.

### Search Console sync (`lib/measure/search.ts`, `gsc-sync.ts`)

- **Plan** (pure, unit tested): the first sync reads date totals for the whole retention window (16
  months back from today in Pacific time, one day of margin) and details (query+page, page) for the newest
  30 days; later syncs re-read every day not yet final plus the last 4 days, and continue the backfill 30
  days a job until the 16-month limit, then stop.
- **Lag**: requests use `dataState: "all"`; a day is stored `final = false` while it is on or after
  Google's `metadata.first_incomplete_date` and re-read on every sync until Google calls it final. Today is
  never read (it reads like a drop). Pacific dates throughout, because that is Search Console's day.
- **Row limits**: details are fetched one day at a time, 25,000 rows a page (`startRow`), up to the
  documented 50,000 rows a day; requests are paced per property (`GOOGLE_PACE_MS`, default 200 ms).
- **Idempotency**: a sync replaces whole days (delete the day's rows, insert, upsert totals) in one
  transaction per batch; running the same window twice stores the same numbers (proved red below). Days
  Google no longer returns are deleted.
- **Failures**: 429 / 5xx / network errors rethrow for pg-boss's retry with backoff (the state keeps a
  failure count); an invalid or revoked grant marks the sync state and the connection red, stops retrying
  and notifies owners and editors once.
- A property change resets the stored rows (they belonged to another property).

### GA4 (`lib/measure/ga4-sync.ts`, `health.ts`)

- Daily: sessions by default channel group, organic landing pages, organic key events (Data API), web
  streams and key-event definitions (Admin API). 90 days on the first sync, then the last 7 days every
  time (GA4 data can arrive up to 7 days late). Dates in the property's own time zone.
- **Measurement health**: no sessions for 14 days, sessions stopped, a sharp drop, no web stream, a stream
  on another domain, organic sessions far below Search Console's clicks, many `(not set)` landing pages, no
  key events. An error reads **"GA4 is not measuring this site: zero here does not mean zero traffic."**,
  is announced (`role="alert"`) on the dashboard and the Search tab, turns the GA4 connection red and
  notifies people once.

### URL Inspection (`lib/measure/inspect.ts`)

Daily, read-only: published articles first, then key pages and the top Search Console pages, skipping
URLs inspected recently (age depends on verdict), capped per site per day (default 20; Google allows 2,000),
one request a second, stops on 429. Results feed the "Indexed pages" KPI and the Search tab's index table.
**Never the Indexing API**: every Google URL passes `assertGoogleUrl()` (`lib/google/allowlist.ts`) before
`fetch`; Indexing hosts, `urlNotifications` and the `auth/indexing` scope are refused, and a unit test scans
the shipped source for them.

### Rank tracking (`lib/measure/rank.ts`)

- Keywords: published articles' target keywords (from `rank_tracking_queue`, filled after publishing)
  first, then saved keywords marked targeted / published / ranking, by volume, up to the site's cap.
- **Priced first**: `quoteCall()` → `estimateCost()` (never calls anything paid) → budget decision. Below
  the reserve (or over the ceiling) the run is **refused**: nothing reaches the provider, nothing is
  charged, the run says why, retries a day later, owners and editors get one notification. Otherwise one
  `meteredCall()` (cache, hold, ledger, research log, audit) with snapshots written in the same settle
  transaction. Async providers are polled (`rank-poll`). A tracker the provider no longer knows is replaced.
- Cadence per site (default weekly; off / daily / weekly / every two weeks / monthly).

### Site audit and tasks (`lib/measure/audit.ts`, `audit-groups.ts`)

Monthly by default via `siteAudit.run` (priced and metered like rank checks) → `status` polled
(`site-audit-poll`) → `issues`. Issue types are normalised and grouped (links and status codes, titles and
descriptions, content, performance, indexing, other) with severity critical / warning / notice and plain
task titles ("Shorten 17 titles over 60 characters"). Each issue is assignable to a workspace member
(checked); **Fix** creates one task (one open task per site and issue type, enforced by the database), which
carries across audits until marked done.

### Backlinks (`lib/measure/backlinks.ts`)

Baseline on first run, then quarterly: overview + referring-domain profile for the site, overview for up to
five brand-profile competitors. All operations are quoted and the **sum** is checked against the budget
before anything is bought. Snapshots store new and lost referring domains against the previous quarter.

### Jobs (`lib/jobs/measure.ts`, `lib/measure/scheduler.ts`)

`measure-tick` runs hourly (cron `23 * * * *`) and asks each active site what is due (`dueWork`): Search
Console daily (Pacific day), GA4 and URL Inspection daily (site day) when connected, rank / audit /
backlinks on their cadences when a provider is configured. Each kind has its own queue (`gsc-sync`,
`ga4-sync`, `url-inspect`, `rank-run`, `rank-poll`, `site-audit`, `site-audit-poll`, `backlinks-run`) with
retries and backoff. **Idempotency**: the window key (`d:2026-10-10`, `w:2026-W41`, `m:2026-10`,
`q:2026-Q4`) is both the pg-boss singleton key and the unique key on `measurement_runs`, so a double tick or
a redelivered job does the work once; a minimum gap stops back-to-back runs across a window edge; refused
and failed runs retry after `retry_after`. Manual "Run now" / "Sync now" buttons (editors and owners,
rate-limited 12 an hour per site) use a one-off window. Failures show as failing connections (Connections
tab, agency home) and notifications.

### Screens

- **Site dashboard** (the site's first tab): 7 KPIs that count up (organic clicks with a 12-week sparkline,
  impressions, weighted average position, indexed pages, articles live, runway, credits this month), a
  dash instead of zero when Search Console is not connected; 90-day clicks and impressions charts with the
  provisional days banded; next up (three slots); striking distance (positions 4–20, last 28 days); rank
  movements; open audit issues; the measurement strip (each kind's last run, cadence, next run, Run now);
  the GA4 health warning on top when it is not ok.
- **Rankings**: inverted position chart (#1 at the top, page-one band, gaps where not ranking) for up to
  four chosen keywords; cluster filter; published / saved toggle; movement badges (up, down, entered,
  lost, new); SERP features; Check now with its price.
- **Search**: Search Console KPIs and charts, striking distance, zero-click pages, top queries and pages,
  index status per URL, GA4 health, organic landing pages, key events.
- **Audit**: KPIs, groups, assign, Fix → task, task status. **Backlinks**: referring domains over time,
  new and lost per quarter, competitors as horizontal bars, new / lost lists.
- **Workspace overview**: combined KPIs (organic clicks, impressions, articles live, awaiting review, credits this month, sites) and site
  cards with 28-day clicks and a sparkline. **Agency home**: per workspace runway, published this month,
  organic clicks (28 days, weekly sparkline), awaiting review, budget, failing; read only through
  `platform_workspace_health()` (admin only, audited); 404 for everyone else.
- Settings → **Measurement** (cadences and limits, audited). Designed states with the next action as the
  primary button: not configured on this server, not connected, choose a property, first sync running,
  failing, no provider, nothing to track, no audit yet. Staggered reveal, count-up, chart draw-in and
  shimmer skeletons (route `loading.tsx`); all off under reduced motion. Every chart is hand-written SVG with
  a hidden data table. `/design` gained the measurement components.
- Former site overview (route inventory, scan) moved to the **Routes** tab.

### Dev and test fakes

`test/helpers/fake-google.ts` + `fake-google-data.ts`: deterministic synthetic data (16 months, weekday
rhythm, growth, the two newest days provisional, 18% anonymised clicks, paging, three GA4 properties, one
with a broken tag). `pnpm --filter seo fakes` serves it on :4573; the seed connects sonorch.ai and
Northwind to it when it runs. The fake SEO provider got a clock so positions drift week to week and
backlinks grow by quarter.

## Not built (by scope or deliberately)

- Phase 5+: link prospecting and outreach, social, WordPress. The nav shows them as "P5".
- Real Google data on sonorch.ai: pending the owner (above).
- Search types other than web, country/device splits, Discover/News; GA4 beyond 90 days of backfill.
- A workspace-wide task list; email for measurement failures (in-app only); per-person notification settings.
- Scheduled keyword-metrics refresh. See `docs/open-work.md` for the full list.

## Tests

Final runs (10 October 2026, from the repository root, throwaway PostgreSQL 16 under `/var/tmp`):

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok, lockfile unchanged |
| `pnpm typecheck` | ok |
| `pnpm lint` | ok |
| `TEST_DATABASE_URL=… pnpm test` | **396 / 396 pass, 0 skipped** (Phase 3 ended at 333) |
| `pnpm build` | ok |
| `pnpm test:e2e` | apps/seo **75 / 75** (13 new Phase 4 tests), apps/web smoke 1 / 1 |

New suites: `test/unit/measure.test.ts` (cadence windows incl. DST and ISO weeks, `isDue` / `nextDueAt`,
Pacific dates, retention start, sync plan, final days, impression-weighted aggregation, movement, chart
scales / ticks / paths, GA4 health, audit groups, new/lost diff, due work), `test/unit/google-guard.test.ts`
(the Indexing API guard), `test/integration/measure.pg.test.ts` (15 tests on a fixed clock: first sync,
idempotency, backfill to the limit, lag, rate limit and revoked grant, GA4 ok and broken, rank refused below
the reserve, charged checks, tracker replacement, audit → task, backlinks, URL Inspection, the tick, the
agency health read), `test/integration/gsc-cli.pg.test.ts` (the CLI end to end), RLS isolation extended to
all 15 new tables (53 tests), `e2e/measure.spec.ts` (dashboard count-up + 90-day chart, rankings chart and
filters, audit Fix → task and viewer limits, backlinks / search / GA4, broken-tag warning, empty and
not-connected states, agency home for an admin and 404 for others, reduced motion, both themes at 1440 and
375 with no console errors and no sideways scroll, measurement settings).

### Red → green evidence

Each guard was broken on purpose (`scratchpad/red/sabotage.py` patched one line, ran the suite, restored the
file and ran it again); RLS used the existing `RLS_TEST_SABOTAGE` switch.

| Guard | Sabotage | Red | Green |
| --- | --- | --- | --- |
| Rank priced first | call `rankTracker.run` before pricing | 14/15, "the provider was called for a refused rank check" | 15/15 |
| Refused below the reserve | `decide()` ignores the reserve | 12/15, "a rank check below the reserve was not refused: {status: succeeded, costMicros: 18000…}" | 15/15 |
| GSC sync idempotency | `gsc_daily` upsert adds instead of replacing | 13/15, "re-running the same days changed the stored totals: {c: 29064…} → {c: 29541…}" | 15/15 |
| Agency path admin-only | drop `platform_require_admin()` | 14/15, "Missing expected rejection." | 15/15 |
| Agency path audited | drop the `platform.health.read` audit event | 14/15, audit row missing | 15/15 |
| No Indexing API (code) | empty `FORBIDDEN_GOOGLE` | 3/4, "Missing expected exception (GoogleEndpointRefused): …auth%2Findexing" | 4/4 |
| No Indexing API (source) | add an `indexing.googleapis.com/…urlNotifications:publish` constant | 3/4, "lib/google/api.ts:17: export const NOTIFY = …" | 4/4 |
| RLS, new table | `policy:gsc_query_daily` | 49/53, "gsc_query_daily: workspace A read 1 row(s) of workspace B" | 53/53 |
| RLS, new table | `policy:rank_snapshots` | 50/53 | 53/53 |
| RLS forced | `noforce:tasks` | 49/53, "tasks: row-level security is not enabled" | 53/53 |
| RLS role | `bypassrls` | 8/53 | 53/53 |
| GSC date lag | `isFinalDay` always true | 39/41, provisional days lost | 41/41 |
| Cadence windows | `isDue` ignores the window's run | 24/26 | 26/26 |

### Screenshots

`seo-p4-*.png` (43 files): site dashboard, rankings, search, audit, backlinks, workspace overview, agency
home and site settings in dark and light at 1440 and 375; GA4 health warning (dashboard and Search tab);
empty / not-connected dashboard, rankings and search; reduced-motion dashboard. Reviewed and polished:
KPI layout (seven tiles, the first spanning two rows), select styling, cluster filter, phone tables (the
ranking URL hidden under 640 px), chart axis steps, quarter labels, agency spacing, and dashes instead
of zeros when nothing is connected.

## Key decisions (made within scope; easy to change)

- **Sync design**: totals by date for the whole window in one request; details per day (the only way to
  reach Google's per-day row cap); replace whole days for idempotency; store provisional days with a flag
  and keep re-reading them; never read today.
- **Lag and backfill**: Pacific dates; `dataState: "all"` + `first_incomplete_date`; 4-day lookback; 16
  months in 30-day chunks chained as jobs 20 s apart, so the first sync finishes in minutes without
  hitting quota.
- **Cadence**: calendar windows in the site's time zone (Search Console: Pacific), one run per window
  enforced by the database, minimum gaps, retry after refusal or failure.
- **Cost**: every paid check is priced first with the published price table and refused below the
  reserve before the provider sees it; backlinks are priced as a whole. Free Google reads are not metered
  in money but are rate-limited and audited.
- **Agency data path**: one audited `SECURITY DEFINER` function returning aggregates only (no rows from
  tenant tables); the dashboard and the agency home use the same window (28 days ending yesterday, Pacific),
  so their numbers agree.

## Questions for the owner

1. **Google OAuth client** (needs the host name, decision #1) and Google verification of the two read-only
   scopes, then the runbook above. Which Google account owns sonorch.ai's Search Console?
2. **Paid cadence defaults**: rank checks weekly at top 30 for up to 100 keywords, audits monthly at 200
   pages, backlinks quarterly. At DataForSEO list prices (`DFS_PRICES`) that is, per site with all 100
   keywords: $0.60 a rank check (100 × 3 SERP pages × $0.002; about $2.60 a month), $0.03 an audit
   (200 pages × $0.00015) and about $0.17 a quarter for backlinks (site profile + six overviews). Keep, or change per plan (#5)?
3. **Competitors for backlinks**: taken from each brand profile (up to five). Are sonorch.ai's and
   seasonx.ai's real competitors known? The seed uses `.example` placeholders.
4. **GA4 backfill depth** (90 days) and **URL Inspection cap** (20 a day per site): enough?
5. **Decision #3** (provider) still decides whether rank checks, audits and backlinks run at all in
   production (`SEO_PROVIDER=none` skips them, and the screens say so).
6. Decisions #1, #2, #4 and #5 remain open and were not decided here.
