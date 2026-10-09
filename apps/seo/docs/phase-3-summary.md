# Phase 3 summary: the content pipeline

Built 9 October 2026 on branch `dev`, left uncommitted for the orchestrator to commit. Phase 4 has not
been started. No model was called (no API key exists here: every article was written by `FakeLlm`), no
real credit was spent, no real GitHub, Gitea, Google or website was reached (local fakes and recorded
pages), nothing was deployed, `apps/web` and `packages/` are unchanged, and the sonorch.ai / seasonx.ai
repositories were not touched (owner decision #2 is still open).

## Owner decision implemented: the reviewer role

`owner` > `editor` > `reviewer` > `viewer` (`lib/auth/permissions.ts`, the one map):

- **reviewer**: sees everything, comments, approves / rejects / requests changes on articles awaiting
  review. Cannot edit text, run the pipeline or research (no spending), schedule, or manage connections,
  members, budget or settings.
- **viewer**: reads and comments. Cannot approve.

Wired through Better Auth's organization roles (derived from the map), the database (`0007_content.sql`
widens the `auth_member` and `auth_invitation` role checks), the member and invitation UI (role picker with
one-line explanations), the review screens, the docs and the tests (viewer cannot approve; reviewer can
approve but cannot edit or spend; viewer ⊂ reviewer ⊂ editor ⊂ owner; the split is exactly
`content:approve`). Both demo workspaces have a `reviewer@` member.

## What was built

### Jobs and the worker (`lib/jobs/`, `worker/index.ts`)

- **pg-boss 12.37.1** (exact pin) in schema `pgboss`: created by `deploy/postgres/10-seo-database.sh`
  (owner-owned, DML granted to the app role with default privileges), installed and migrated by
  `scripts/migrate.ts` **as the owner role**; web and worker connect as the app role with no DDL
  (`migrate: false`, `createSchema: false`, `reindex: false`).
- Queues: `schedule-tick` (every 5 minutes: per-site planning), `site-plan` (lay out slots over the
  horizon, skip missed empty slots, wake rolling generation `lead_days` before each slot, release approved
  articles at their slot, recompute runway), `pipeline-run` (one run; retries with backoff for rate limits
  and 5xx), `sitemap-refresh` + `sitemap-crawl` (daily refresh of every active site, deferred from Phase 1),
  `link-check` (daily external link checks), `runway-check` (daily monitor and alerts),
  `post-publish-check`. Jobs carry ids only; all work runs inside `withWorkspace()` (RLS applies). The
  worker's only cross-workspace read is `job_sites()`, a SECURITY DEFINER function that refuses any actor
  but `system:worker`.
- The worker waits for the database with backoff, logs "worker ready", and on SIGTERM stops taking jobs,
  lets running ones finish (25 s) and exits 0. A step cut off mid-way goes back to pending (stale after
  15 minutes) and the next worker resumes it.

### Calendar and schedule (`lib/content/schedule.ts`, `planner.ts`, `runway.ts`)

- Per-site schedule: weekdays + local time + IANA zone (default **Tuesday and Friday 09:00 site time**),
  active flag, generation mode **rolling** (default, written `lead_days` = 3 days ahead) or **batch**,
  horizon (42 days). Slots are laid out on local calendar days: 09:00 stays 09:00 across DST; a time in the
  spring-forward gap moves forward by the gap, one in the fall-back overlap takes the first occurrence.
- **No back-dating by default** (rule 3): slots are never laid out or moved into the past, and an article
  written after its slot date is dated the day it goes out. Turning back-dating on needs a ticked
  acknowledgement under a warning about `datePublished`.
- **Runway** (rule 1): days from today to the last slot of the unbroken run that will go out (written,
  in review, or writable: schedule on, an author, a working publishing connection, model budget, topics
  left). Amber below the site's threshold (default 10), red when nothing is covered. Alerts in-app and by
  email (Resend; logged when not configured) on a worsening level and weekly while it stays short; shown as
  a banner on the dashboard and calendar, on each site card and in the calendar's runway band.

### The ten-step pipeline (`lib/pipeline/`)

Persisted in `pipeline_runs` / `pipeline_steps` (input, output, model, tokens incl. cache reads/writes,
cost, duration, attempt, error); retry or resume from any step without redoing (or re-buying) earlier ones.

1. **Context**: brand profile, rules, inventory, existing targets.
2. **Opportunity scan**: Search Console striking-distance queries and ranked keywords when connected.
3. **Topic** (review model): candidates come only from the seed backlog and saved ideas that pass rules
   4–7 in code; the model may call two paid tools (keyword metrics, SERP; capped, metered); **code has the
   last word** (an off-list pick is replaced, a duplicate head term fails the step); unused bought keywords
   are saved as ideas (rule 4).
4. **Brief**: outline, 3–6 internal links that exist **on the publish date** (inventory, published, or our
   own articles scheduled on or before it; rule 9), claims to source, cover.
5. **Draft** (draft model).
6. **Fact-check** (review model, a separate call): every claim needs a primary source with a quote found on
   the fetched page (SSRF-guarded fetch, recorded pages in dev/test) or the brand's own product facts;
   otherwise it is rewritten, removed, or marked **unverifiable, which blocks approval and publishing**
   (rule 8; checked again in the publish step).
7. **Lint**: 15 deterministic rules from the brand profile (rule 13): title length, keyword in title,
   description length, slug, heading structure / no H1, direct answer first, word count, banned words,
   em dashes and emoji, internal link count, internal links live on the publish date, external links 200
   (an unchecked link holds the article), no duplicate head term (rule 5, also a unique index in the
   database), configured author (a demo placeholder warns), cover spec (lumoras.ai's `art.kind` /
   `art.chips`).
8. **Review gate**: approval required by default; the people who may approve are notified (in-app and
   email). **Autopilot is off by default**, needs an acknowledgement recorded on the site (database check
   constraint), and still holds anything that fails lint or fact-check.
9. **Publish** at the slot (pg-boss `startAfter`): through the site's publishing connection.
10. **After publishing**: live URL checked for 200, URL Inspection (Search Console, read-only; never the
    Indexing API) when connected, keyword queued for rank tracking (Phase 4), runway updated, social hook
    (records "Phase 5").

**Untrusted content**: SERPs and fetched pages reach the model wrapped in `<untrusted_data>` (the wrapper
cannot be closed from inside), every system prompt says it is data, no tool can publish, edit or change
settings, and **paid tools close as soon as untrusted content is in the conversation** (tested with a
model that tries to buy more after reading a SERP).

### Models (`lib/llm/`)

`LlmProvider` with `AnthropicLlm` (`@anthropic-ai/sdk` 0.133.0; server-side fallback beta, adaptive
thinking, explicit effort, JSON-schema output, prompt caching on the system prompt, strict tools; the
claude-api reference was loaded first) and `FakeLlm` (fixtures, realistic token usage incl. cache). Models
from `LLM_MODEL_DRAFT` (claude-sonnet-5-5) and `LLM_MODEL_REVIEW` (claude-opus-5-5, topic and
fact-check). Every turn goes through `meteredTurn()`: priced first (upper bound), held under the
workspace's budget lock in category `llm_tokens`, **refused below the reserve before any call**, settled at
the real usage (each billed model at its own price, integer micro-dollars rounded up). Prices are a
configurable table (`LLM_PRICES_JSON`); unknown models are priced at the most expensive entry.

### Content model (`migrations/0007_content.sql`)

`content_items` (status machine in `lib/content/status.ts`), `content_versions` and `content_reviews`
(append-only: UPDATE/DELETE revoked), `content_comments`, `pipeline_runs`, `pipeline_steps`,
`publications`, `rank_tracking_queue`, `link_checks`; site schedule/review/runway/feed columns. Every
table: forced RLS, platform-read policy, audit trigger (article text, briefs, model inputs/outputs are
fingerprinted, not copied, into the audit log), composite foreign keys so a row cannot point into another
workspace.

### Publishers (`lib/publishers/`)

- **Git, file per post**, GitHub (REST API version 2026-03-10) and Gitea (API v1): pull request by default
  (branch `lumoras-growth/<slug>`), or commit; frontmatter template with placeholders written as quoted
  YAML (an article cannot inject keys); idempotent on retry (no second branch, file or PR); refuses to
  overwrite a page it did not publish; update and unpublish as PRs; status follows the PR (open, merged,
  closed). The **lumoras.ai profile** writes `apps/web/content/insights/<slug>.md` with the content spec's
  frontmatter (`title`, `description`, `date`, `readingMinutes`, `keyword`, `tags`, `art.kind`, `art.chips`).
- **Webhook**: JSON with Markdown and HTML, `X-Lumoras-Signature: v1=HMAC-SHA256(secret, "<timestamp>.<raw
  body>")`, five-minute replay window, constant-time verification (`verifyWebhook()` is the reference for
  receivers), SSRF-guarded delivery; 5xx/429 retry.
- **Feeds**: per-site JSON Feed 1.1 and RSS 2.0 at `/api/feeds/<64-hex token>/feed.json|rss.xml`, off by
  default, published articles only, read in the site's workspace scope.
- **Live Test** on the Connections tab (and in onboarding): read-only checks (repository, token, push
  permission, branch, folder, template, file name) or a signed ping; sets the status light.

### Screens (both themes, 375 and 1440 px, reduced motion, keyboard)

- **Content calendar** (`/w/:slug/content`): month and list views, site chips with runway, runway band
  (ion → amber → red, hatched gap), drag and drop, keyboard move (focus an article, **M**, arrows, Enter,
  Escape; announced in a live region), a date field per row in list view, past days refused unless the
  site allows back-dating; slot panel with Open, Pipeline run, **Run now**, Skip.
- **Pipeline run view** (`/w/:slug/runs/:id`): the shared graph component, live over server-sent events
  from persisted steps (this replaces Phase 1's simulated timers in the product; `/design` keeps a timed
  replay of a recorded sample run through the same graph component, so the motion can be reviewed without
  a worker); expandable step detail (inputs, outputs, model, tokens, cache, cost, duration, evidence, lint,
  links), retry/resume from a step. Runs list at `/w/:slug/runs`.
- **Article editor** (`/w/:slug/content/:id`): Markdown with live preview, the lint panel re-run in the
  browser on every keystroke, fact-check evidence per claim, internal links with their status on the
  publish date, versions with a diff and restore, comments, approve / request changes / reject by role
  (blockers listed; Approve disabled until lint and fact-check pass), publication status.
- **Review queue** (`/w/:slug/review`).
- **Site settings**: schedule, lead days, generation mode, review mode with the autopilot warning and
  acknowledgement, back-dating with its warning, runway threshold, where articles publish, the public feed.
- **Connections**: Git (host, repository, API address, branch, site format preset, mode, folder, file name,
  live path, frontmatter template) and webhook fields; live Test with per-check results; "Use for publishing".
- **Onboarding steps 7–8** are real: connect and test a publisher; set the schedule (defaults shown,
  autopilot refused without the tick). The done page shows publishing, schedule and the first calendar.
- Dashboard: runway banner, "Awaiting review" tile, runway bar on each site card. Nav: Content calendar,
  Review queue, Pipeline runs.

### Seed: lumoras.ai onboarded

Brand profile, product facts and SEO rules from `docs/content-spec.md` / `prototypes/BRIEF.md`; route
inventory from `fixtures/lumoras.ai/sitemap.xml` (30 routes, generated from `apps/web/content`); its
existing article keywords marked published (rule 5); a **demo author placeholder**; a Git connection
(insights profile, pull requests) pointing at a **local fake GitHub**; Tuesday/Friday schedules on all
three Lumoras sites; pipeline runs with FakeLlm (see the README).

## Dependencies added (exact pins)

`pg-boss` 12.37.1, `@anthropic-ai/sdk` 0.133.0, `unified` 11.0.5, `remark-parse` 11.0.0, `remark-gfm` 4.0.1,
`remark-rehype` 11.1.2, `rehype-stringify` 10.0.1; dev: `gray-matter` 4.0.3. `pnpm-lock.yaml` updated;
`pnpm install --frozen-lockfile` passes. Versions and doc-reading dates: [`external-apis.md`](external-apis.md).

## Acceptance evidence

**lumoras.ai, one generated article through all ten steps, landing as a pull request on the fake GitHub.**
`test/integration/pipeline.pg.test.ts` › "ACCEPTANCE" (green), on the seeded workspace: every step
`succeeded` with output and duration; topic and fact-check on `claude-opus-5-5`, draft on
`claude-sonnet-5-5`, tokens and cost recorded; context, lint, review and publish free; one open pull
request `Article: AI Receptionist for Small Business: What It Handles` from
`lumoras-growth/ai-receptionist-for-small-business` into `main`, nothing committed to `main`; the file
`apps/web/content/insights/ai-receptionist-for-small-business.md` parses with lumoras.ai's frontmatter
(title ≤ 60, description 140–155, ISO date, `readingMinutes`, `keyword`, `tags`, `art.kind` = `call`,
two `art.chips` ≤ 22 characters, no H1 in the body); every GitHub call carried
`X-GitHub-Api-Version: 2026-03-10`; the publication row is `open`, PR #1; **the `llm_tokens` ledger charged
exactly the sum the steps recorded**; the keyword is in `rank_tracking_queue`. The fake GitHub saw:
`GET contents (404) ×2 → GET ref lumoras-growth/… (404) → GET ref main → POST git/refs (201) → PUT contents (201) → POST pulls (201)`.

**lumoras.ai builds with it.** `ACCEPTANCE_OUT=<dir>` wrote the article; it was copied into a git worktree
of this repository at `/home/user/lumoras-acceptance` (detached at the current `HEAD`, outside `apps/web` of
the working copy), then `pnpm install --frozen-lockfile --offline` → **`pnpm --filter web typecheck`: exit 0**
→ **`pnpm --filter web build`: exit 0**, with `● /insights/ai-receptionist-for-small-business` and its
`opengraph-image` prerendered; the HTML has `<h1 class="art-title">AI Receptionist for Small Business: What
It Handles` and `"datePublished":"2026-10-09"`. The worktree was removed afterwards.

**The runway alert fires.** Integration: "rule 1: the runway alert fires (in-app and email) when the queue
is short, once, and again when it gets worse" (green). E2E: the dashboard banner (red for seasonx.ai, amber
for sonorch.ai), the in-app notification, and the calendar's red and amber bands
(`seo-p3-runway-banner-dark-1440.png`, `seo-p3-calendar-runway-red-dark-1440.png`,
`seo-p3-calendar-runway-amber-dark-1440.png`).

**The worker end to end** (`test/integration/jobs.pg.test.ts`, a real worker process on pg-boss as the app
role): "worker ready" with the four cron schedules; a schedule tick lays out 14 days of slots and wakes only
the slot inside its one-day lead window, which the worker writes up to the review gate; an acknowledged
autopilot site has its article approved and **published at its slot** through the signed webhook (the
receiver verified the signature); SIGTERM exits 0 and the password is never logged.

## Tests

Final run, `TEST_DATABASE_URL` set (throwaway PostgreSQL 16 under `/var/tmp`):

- `pnpm --filter seo test` (unit + integration): **333 tests, 333 pass, 0 fail, 0 skipped**.
  New: `test/unit/lint.test.ts` (every lint rule fails on its own and passes in the baseline; links on the
  publish date; head terms), `schedule.test.ts` (slot math across New York's and London's DST changes,
  gap/overlap times, a half-hour zone, local-day slots, lead-day wake-ups, no back-dating, runway levels
  and alerts), `llm.test.ts` (prices, rounding, fallback billing, unknown models, `LLM_PRICES_JSON`,
  estimate ≥ real cost, model per purpose, the untrusted wrapper), `publishers.test.ts` (frontmatter
  round-trip with gray-matter, YAML injection, file-name traversal, GitHub and Gitea fakes: Test, PR
  idempotency, overwrite refusal, update, unpublish, commit mode, status after merge; webhook signature
  incl. tampering, wrong secret, stale both ways, signed timestamp, malformed; publisher vs a verifying
  receiver incl. 401 and retryable 503; SSRF refusal; JSON Feed and RSS), `content-model.test.ts`
  (status machine, diff, schedule settings defaults and acknowledgements, Phase 3 env), the permission
  tests (reviewer/viewer), `test/integration/pipeline.pg.test.ts` (acceptance, rolling model + DST +
  webhook publishing, rule 5 in code and in the database, rule 8, autopilot, untrusted content and paid
  tools, retry from a step, the model reserve, runway alerts), `jobs.pg.test.ts`, and the RLS suite
  extended to the **nine new tables** (read/update/delete/insert across workspaces, no-workspace
  invisibility, append-only versions and reviews, article text fingerprinted in the audit log, the
  worker-only and feed functions).
- `pnpm --filter seo test:e2e` (Playwright, production build, the worker running): **62 passed**. New
  `e2e/content.spec.ts`: a viewer reads and comments but has no Approve and cannot edit; a reviewer
  approves (audited as `content.approve`, role `reviewer`) and cannot edit; the editor's live lint panel
  (a title edit flips "Keyword in the title" to fail and back), evidence, a new version and its diff
  (+2 −0); calendar **drag and drop** and **keyboard** reschedule (checked in the database) and refusal
  of a past day; **Run now → live run view**: a running node, then each step done and the run waiting at
  review, a step expanded; the runway banner; the Git connector's live Test; every Phase 3 screen in
  **dark and light at 1440 and 375** with no sideways scroll and no console errors; **reduced motion**
  (no transitions or animations on the run view and calendar). Updated: onboarding (steps 7–8 real: a
  webhook connector created, tested live and chosen; autopilot refused without the tick; schedule saved),
  members (invite a reviewer), research (ledger counts scoped to sonorch.ai, since the pipeline now writes
  ledger rows in the same workspace).
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm test:e2e`
  from the repository root: all exit 0 (apps/web e2e smoke 1 passed). `git status apps/web packages`: empty.
  The Phase 1 ⌘K e2e test failed once in the first final run (a known flake, see open-work.md); it now retries
  the shortcut until the palette has focus and passed on the rerun.

### Red before green (each guard broken on purpose, the suite run, the source restored, run again)

Script: each sabotage is a literal string replacement in one file, restored afterwards (verified by grep).

| Guard | Sabotage | Red | Green |
| --- | --- | --- | --- |
| Link validator (rule 9) | `links.ts`: scheduled pages count whatever their date; "later" never reported | lint suite 19/21: `internal_links_resolve did not fail: … "All 3 resolve on 2026-10-13."` | 21/21 |
| Duplicate head term, code (rule 5) | `headTermConflicts()` returns `[]` | lint suite 19/21: `duplicate_head_term did not fail` | 21/21 |
| Duplicate head term, database | `content_items_head_term_once` made non-unique | pipeline "rule 5": `Missing expected rejection` (a second article with the same head term was inserted) | 2/2 |
| Unverifiable blocks approval (rule 8) | `approvalBlockers()` ignores unverifiable claims | pipeline "rule 8": the refusal no longer names the unverifiable claim (only the fact-check fallback held it) | pass |
| Unverifiable blocks publishing | publish step's last-moment check removed | pipeline "rule 8": run `succeeded` instead of `failed` (the article was delivered) | pass |
| Autopilot off by default | `scheduleInput` defaults to autopilot, acknowledgement not required | `'autopilot' !== 'approval'`; "Missing expected exception" | 8/8 |
| Autopilot holds failing articles | review gate treats every article as ready | pipeline "autopilot": `'approved'` instead of `'awaiting_review'` ("autopilot never publishes an article with an unverifiable claim") | pass |
| Webhook signature | replay window removed; any 32-byte signature accepted | publishers 19/21: tampered body `{ ok: true }` instead of `mismatch`; "Missing expected rejection" from the receiver | 21/21 |
| Reviewer/viewer split | viewer gets `content:approve`, reviewer gets `content:edit` + `pipeline:run` | permissions 5/8: `viewer can content:approve`, reviewer may edit/spend, split ≠ `content:approve` | 8/8 |
| RLS on new tables | `RLS_TEST_SABOTAGE=policy:content_items`, `noforce:content_reviews`, `policy:publications` | 33/37 each: `content_items: no policy keyed by app.workspace_id`; `content_reviews: row-level security is not enabled`; "workspace A inserted a row with workspace_id …" | 37/37 |

## Screenshots

`/tmp/claude-0/-home-user-lumoras-ai/210165ed-cbee-598f-9516-a2207deb0db0/scratchpad/shots/seo-p3-*.png`
(written by the e2e suite with `SCREENSHOT_DIR`): calendar month, list, amber and red runway (each dark and
light, 1440 and 375) plus keyboard move; run view live, expanded node, completed (both themes, both widths);
runs list; editor with lint, evidence and diff, and the editor at both widths and themes; review queue;
connections (publishing Test results) and site settings (schedule and publishing); dashboard runway banner;
onboarding steps 7 and 8 (dark 1440, light 375).

## Not built (by design or deferred)

- The sonorch.ai and seasonx.ai publishers (owner decision #2); WordPress and social (Phase 5); rank
  tracking and audits (Phase 4; the queue is filled). See [`open-work.md`](open-work.md).

## Questions for the owner

1. **Bylines:** lumoras.ai's content spec signs articles "Lumoras team"; rule 10 asks for real people.
   Is a team byline acceptable, or who signs? (The seed uses a flagged demo placeholder.)
2. **The real lumoras.ai repository** (owner/name) and who issues the fine-grained token (Contents and Pull
   requests, that repository only). Pull requests (default) or direct commits?
3. **Decision #2** (sonorch.ai / seasonx.ai): Git, webhook, or something else, and in which repositories.
4. **Model budget:** a monthly `llm_tokens` ceiling and reserve per workspace (a FakeLlm article costs
   about $0.08 at list prices; real articles will differ), and approval to set `LLM_PROVIDER=anthropic`
   with a key.
5. **Autopilot:** may any client use it, and what written agreement is required (it stays off and needs
   an acknowledgement in the product either way)?
6. **Reviewer seats:** should client reviewers count as paid seats or be free (pricing, decision #5)?
7. Decisions #1 (name and host) and #3 (provider) remain open as before.
