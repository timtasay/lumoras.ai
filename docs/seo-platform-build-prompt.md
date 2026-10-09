# Build prompt: Lumoras Growth, a multi-client marketing platform (`apps/seo`)

You are building a new application inside the `lumoras.ai` repository, at `apps/seo`. Read this
whole document before writing any code. Where it says "stop and ask", stop and ask; do not
pick on the owner's behalf.

---

## 1. What we are building, and why

Lumoras runs three marketing sites today: sonorch.ai (salons), seasonx.ai (restaurants) and
lumoras.ai (the company). Each has an "Insights" section of SEO articles. Those articles are
produced by hand: someone opens a Claude Code session, the session uses the OpenSEO MCP
connector to research keywords (search volume, keyword difficulty, CPC, SERPs), picks targets,
writes ten articles at a time, fact-checks them, commits them to that site's git repo, and
deploys. The only "schedule" is a `publishedAt` date on each post: a post dated in the future
stays hidden until the date passes, and the site revalidates hourly. Nothing writes new posts
automatically, so when the pre-written queue runs out the section silently goes stale. It ran
dry on sonorch.ai on 7 October 2026.

That process works, but it is tied to one person, one Claude account, one OpenSEO account and
one site at a time. We want to turn it into a product: a customer-facing web app where many
businesses (our clients) each get their own dashboard, connect one or more websites, and have
their SEO, content, social posting and backlink work planned, produced, scheduled, published
and measured from one place. Lumoras staff operate it for clients; clients log in to see
results and approve work.

The app must look like a premium product: modern, animated, with a futuristic "control room"
feel that matches lumoras.ai. Design quality is a requirement, not polish for later.

**The first three tenants are our own sites.** sonorch.ai, seasonx.ai and lumoras.ai must be
onboarded and run through the platform as the proof that it works. Treat them as the
acceptance test.

## 2. The lessons the manual process already paid for

These rules were learned from real mistakes on our sites. Build each one into the product as
behaviour, not as documentation.

1. **The queue must never run dry silently.** Every site has a "runway": the number of days of
   scheduled content left. Show it on the dashboard, and alert (email plus an in-app banner)
   when it drops below a per-site threshold, default 10 days.
2. **Write close to the publish date, not months ahead.** Generate each article a few days
   before its slot (default 3 days ahead, configurable), so topic choice reacts to the latest
   rank, Search Console and backlink data. This is the rolling model. A batch mode may exist,
   but rolling is the default.
3. **No back-dating by default.** A post dated before it was written puts a false
   `datePublished` in structured data that Google can compare against the date it first saw
   the URL. Back-dating is a per-site setting, off by default, with a warning that explains
   this.
4. **Never buy the same research twice.** Keep a per-site research log of every seed, keyword
   and SERP fetched, with cost and date. Rotate through a backlog of seeds, and never re-run a
   seed that is already in the log unless the data is older than a configurable age (default 90
   days).
5. **No two articles target the same head term.** Before accepting a topic, check it against
   every published and scheduled article's primary keyword for that site, plus the site's
   ranked pages. Two pages for one term compete with each other.
6. **No geographic doorway variants.** "esthetician salary california / texas / ohio" is one
   article that handles states inside it, never forty near-identical pages. Detect and collapse
   near-duplicate keyword variants into one target.
7. **Only write about what the business actually offers.** Each site's brand profile lists
   what the business sells and what it explicitly does not (we never wrote HVAC or dental
   content however good the CPC looked, because we do not serve them). Topic selection must
   respect both lists.
8. **Every factual claim is checked against a primary source.** Our tax, labour and texting
   articles needed IRS, DOL, FCC and FTC sources, and several widely repeated claims turned out
   to be wrong. The pipeline has a separate fact-check step: every claim either gets a cited
   primary source or is removed. Unverifiable claims block publishing.
9. **Internal links must resolve on the day the post goes live.** A link to a post that is
   scheduled for a later date 404s until then. Validate every internal link against the site's
   real route inventory (crawled from its sitemap) as of the publish date.
10. **Bylines are real people, with no invented credentials.** A byline is published as
    `Person` structured data. Authors are configured per site by the client; the generator may
    only use configured authors and may never invent a title, tenure or credential.
11. **Paid data has a budget and a reserve.** SEO data costs credits. Every paid call is priced
    first where the provider allows it, charged to the workspace's ledger, and refused once the
    workspace is below its reserve. Check the balance before any paid step.
12. **Measure what was published.** Every published article's target keyword goes into rank
    tracking automatically, and the dashboard shows whether it moved. Writing without measuring
    is how we went months without knowing whether anything worked.
13. **Writing rules are data, not code.** Each site has its own voice rules (for lumoras.ai, see
    `docs/content-spec.md`: title ≤ 60 characters, description 140–155, a 2–3 sentence direct
    answer first, `##` sections, 3–6 internal links, no hype words, no em-dash asides, no
    emoji). Store these in the brand profile and enforce them in a lint step.

## 3. Tech stack (match the existing lumoras.ai app)

Read `apps/web` first and copy its conventions. The new app sits beside it in the same pnpm
workspace (`pnpm-workspace.yaml` already includes `apps/*`).

- **Framework:** Next.js 16.4 App Router, React 19.3, TypeScript 5.9 (strict), Node 22. Same
  exact versions as `apps/web/package.json`. Pin every new dependency to an exact version.
- **Styling:** plain CSS with design tokens, exactly as `apps/web/app/globals.css` does. No
  Tailwind, no CSS-in-JS. Extract the Voice Core tokens (colours, `--ion`, `--flare`, `--ice`,
  panels, lines, glass, glows, both dark "control room" and light "clean room" themes, and the
  theme control in `lib/theme.ts`) into a shared workspace package `packages/ui-tokens` that
  both apps import, so the brand stays identical. Update `pnpm-workspace.yaml` to include
  `packages/*`. Do not change how `apps/web` looks while doing this; verify its pages are
  visually unchanged.
- **Motion:** CSS transitions and keyframes, the Web Animations API, the View Transitions API
  for route and list changes, and canvas for the ambient visuals. Reuse the Spectrum particle
  field (`apps/web/components/home/field-engine.ts`, `ParticleField.tsx`) for the sign-in and
  onboarding backdrops. Do not add an animation library unless you hit something these cannot
  do; if so, stop and ask.
- **Charts:** hand-written SVG components (sparkline, area, bar, rank-position line, donut)
  styled with the tokens, so they theme correctly. No charting library.
- **Database:** PostgreSQL 16 using `pg` with plain SQL migrations in `apps/seo/migrations`
  (numbered files, applied in order on container start, as KitchenSpot does on VPS3). No ORM.
  Write a small typed query layer.
- **Tenant isolation:** Postgres row-level security on every tenant table, keyed by
  `workspace_id`, with the app connecting as a non-superuser role and setting the workspace per
  transaction. A query that forgets the workspace must return nothing, never another client's
  rows. Migrations run as a separate owner role.
- **Auth:** Better Auth (self-hosted, Postgres adapter) with its organization plugin for
  workspaces, members, roles and invitations. Email magic link plus Google sign-in. Session
  cookies, httpOnly, secure, SameSite=Lax.
- **Background jobs and scheduling:** `pg-boss` on the same Postgres (no Redis). A separate
  worker process (`apps/seo/worker`) runs from the same codebase and image as the web app with
  a different command.
- **LLM:** the Anthropic API through `@anthropic-ai/sdk`, behind an `LlmProvider` interface.
  Model ids come from env (`LLM_MODEL_DRAFT`, `LLM_MODEL_REVIEW`), defaulting to
  `claude-sonnet-5-5` for drafting and `claude-opus-5-5` for topic selection and fact-checking.
  Use tool use for the research steps so the model calls our provider wrappers, never raw
  credentials.
- **Email:** Resend, as `apps/web/lib/email.ts` already does.
- **Tests:** `node --test` with `tsx` for unit tests (as sonorch.ai does), Playwright for
  end-to-end tests.
- **Hosting:** a Docker image like the repo's root `Dockerfile`, running on VPS3 behind the
  shared Caddy, on the `lumoras_internal` network, port **3007** (3000, 3002, 3005 and 3006 are
  taken). Two containers from one image: `lumoras-seo` (web) and `lumoras-seo-worker`. A new
  `seo` role and database in the shared `lumoras-postgres`, created the same way as the others
  in `phonon-orchestration-hub/docker/vps3/postgres/init/01-databases.sh`. Write the compose
  file and Caddy route as files only. **Do not deploy, SSH to any server, or touch any server
  env file.** The owner deploys.

## 4. The SEO data provider: OpenSEO behind an interface

Today's research uses OpenSEO (open source, MIT, `github.com/every-app/open-seo`, docs at
`openseo.so/docs`), which sits on top of DataForSEO and exposes its features as MCP tools:
keyword research, keyword metrics, SERP results, domain overview, ranked keywords, SERP
competitors, backlinks, rank tracking, site audits, Search Console and GA4 reads, local SEO,
and AI-visibility checks.

The current account is a personal $10/month hosted plan wired to one Claude account. That
cannot serve many clients, so the product needs its own server-side access.

- Define a `SeoDataProvider` interface covering what the pipeline needs: `keywordIdeas(seed)`,
  `keywordMetrics(keywords[])`, `serp(keyword, location)`, `domainOverview(domain)`,
  `rankedKeywords(domain)`, `serpCompetitors(domain)`, `backlinksOverview(domain)`,
  `backlinksProfile(domain)`, `rankTracker.create/add/run/get`, `siteAudit.run/status/issues`,
  plus `estimateCost(operation)` and `balance()`.
- **First implementation:** a self-hosted OpenSEO instance on VPS3, called from our worker as
  an MCP client over HTTP, with our own DataForSEO API key. Before coding it, read OpenSEO's
  current MCP and API docs and its source, and list the actual tool names and parameters in
  `apps/seo/docs/openseo-tools.md`. Do not assume tool names from this prompt.
- **Second implementation, if OpenSEO's API cannot do something we need:** DataForSEO directly.
- Every provider call goes through one function that prices it, checks the workspace budget
  and reserve, records it in the research log and the usage ledger, and caches the result
  (keyed by operation and parameters, with an expiry), so a repeat request within the expiry
  costs nothing.
- **Stop and ask** before relying on reselling a hosted OpenSEO or DataForSEO account to
  clients; check both terms of service and report what they say.

Google Search Console and GA4 are connected **per site with the client's own Google account**
(OAuth, read-only scopes). They are free and are the best signal we have: striking-distance
queries (positions 4–20), which pages get impressions, and whether new URLs are indexed. Do
not use Google's Indexing API; it is only for job postings and livestreams.

## 5. Tenancy and roles

- **Workspace** = one client business. Has members, sites, a monthly budget, a usage ledger,
  billing details (later), and a plan.
- **Site** = one website or brand inside a workspace (a workspace may have several: sonorch.ai
  and seasonx.ai could be two sites of one workspace).
- **Roles:**
  - *Platform admin* (Lumoras staff): sees every workspace, can impersonate with an audit
    trail.
  - *Workspace owner*: everything inside the workspace, including billing and members.
  - *Editor*: runs research, edits and approves content, manages connections.
  - *Viewer / client reviewer*: sees dashboards, comments, approves or rejects content when
    approval is required.
- Every write is recorded in an audit log (who, what, when, before and after).

## 6. Data model (starting point; refine, but keep RLS on every tenant table)

- `workspaces`, `members` (from Better Auth), `invitations`
- `sites`: domain, name, industry, locale, country and SERP location, timezone, status
- `brand_profiles` (one per site): business overview, current goal, positioning, audience,
  what we sell, what we do not sell, competitors (domains), key pages, product facts that may
  be stated, forbidden claims, voice rules, SEO rules (title and description length, body
  length range, internal link count), banned words, example articles
- `authors` (per site): name, role, bio, avatar; real people only
- `site_routes`: the route inventory crawled from the site's sitemap, refreshed daily
- `connections`: per site, one row per external connection (Git repo, WordPress, Webflow,
  Ghost, webhook, Google Search Console, GA4, social accounts), credentials encrypted
- `seed_backlog`, `research_log`, `keywords` (saved, with metrics, intent, cluster, status)
- `content_calendar` / `content_items`: slot date, status, primary keyword, secondary keywords,
  cluster, author, title, description, slug, body (Markdown), cover art spec, sources, internal
  links, lint results, fact-check results, version history
- `pipeline_runs` and `pipeline_steps`: every generation run and each step's input, output,
  model, tokens, cost, duration, error
- `publications`: where and when an item was published, remote id or commit SHA or PR URL,
  live URL, indexing status
- `rank_trackers`, `rank_snapshots`
- `audits`, `audit_issues`
- `backlink_snapshots`, `link_prospects`, `outreach_drafts`
- `social_posts`: derived from content items or written standalone, per channel, scheduled time,
  status, remote id
- `usage_ledger`: every billable unit (SEO credits, LLM tokens, social posts), by workspace and
  site
- `budgets`: monthly ceiling and reserve per workspace, per category
- `notifications`, `audit_log`

Encrypt every stored secret (API keys, OAuth refresh tokens, app passwords) with AES-256-GCM
using a key from env (`ENCRYPTION_KEY`), with a key version column so the key can be rotated.
Never send a secret to the browser or to the LLM.

## 7. The content pipeline

A per-site schedule (for example "Tuesday and Friday, 09:00 site time") creates empty calendar
slots. A pg-boss cron job wakes up each slot `lead_days` before its date and runs the pipeline
for it. Each step is a persisted `pipeline_step`, so a run can be resumed, retried from any
step, and watched live in the UI.

1. **Context:** load the brand profile, authors, route inventory, published and scheduled
   items, the research log, Search Console striking-distance queries, and the latest rank
   snapshot.
2. **Opportunity scan (free first):** striking-distance queries and pages with impressions but
   no clicks; existing pages that should be refreshed instead of writing something new. The
   step may decide "refresh page X" rather than "write a new article".
3. **Topic selection (paid, budgeted):** take the next seeds from the backlog, get keyword
   ideas and metrics, fetch SERPs where intent is unclear, cluster by intent, drop anything that
   breaks rules 5, 6 or 7, and pick one target with a written rationale (volume, difficulty,
   CPC, intent, fit, why now).
4. **Brief:** outline, search intent, primary and secondary keywords, the questions to answer,
   3–6 internal links chosen from the route inventory as of the publish date, and a list of the
   claims that will need sources.
5. **Draft:** written to the brand profile's voice and SEO rules, by a configured author.
6. **Fact-check:** a separate model call with web fetching. Each claim gets a primary source
   URL and a quote, or is rewritten or removed. Store the evidence on the item.
7. **Lint (deterministic code, not a model):** title and description length, keyword in the
   title, heading structure, word count, banned words, internal links resolve on the publish
   date, external links return 200, no duplicate head term, author exists, cover spec present.
8. **Review gate:** per-site setting. *Approval required* (the default) holds the item as
   "awaiting review" and notifies reviewers. *Autopilot* publishes when lint and fact-check
   pass. Autopilot is off by default, and turning it on shows what it means: unreviewed claims
   go live under the client's name.
9. **Publish** through the site's publishing connector (section 8).
10. **After publishing:** add the keyword to rank tracking, check the live URL returns 200,
    inspect the URL through Search Console, create the social derivatives (section 10), and
    update the runway.

Content fetched from client sites, competitor pages and SERPs is untrusted data. Pass it to the
model clearly marked as data, never as instructions, and never let it trigger a tool call that
publishes or spends.

## 8. Publishing connectors (this is what makes it generic)

Behind one `Publisher` interface: `validate()`, `publish(item)`, `update(item)`,
`unpublish(item)`, `status(item)`. Ship these, in this order:

1. **Git: file per post.** GitHub and Gitea. Per site, configure the repository, branch, the
   content directory, a filename pattern, a frontmatter template, and a mode: *open a pull
   request* (default) or *commit to branch*. This covers lumoras.ai
   (`apps/web/content/insights/<slug>.md` with the frontmatter in `docs/content-spec.md`) and
   most static sites (Next.js MDX, Astro, Hugo, Jekyll). Acceptance: a generated lumoras.ai
   article lands as a PR that passes that repo's typecheck and build.
2. **WordPress** REST API with an application password: posts, categories, tags, featured
   image, Yoast or Rank Math meta when present, scheduled status for future dates.
3. **Webhook / headless feed:** we POST signed JSON to the client's endpoint, and we also serve
   a per-site JSON and RSS feed of published items, so any custom site can pull.
4. Later: Webflow CMS, Ghost Admin API, Shopify blog.

sonorch.ai and seasonx.ai do not use frontmatter files. They keep metadata as a typed array in
`src/content/posts.ts` with the body in `src/content/posts/<slug>.mdx`. **Stop and ask** which of
these the owner wants: (a) migrate those two sites to file-per-post frontmatter, or (b) build a
"typed array" Git adapter that inserts an object into an exported array using the TypeScript
compiler API. Do not edit those repos without an answer.

## 9. Measurement

- **Rank tracking:** every published target keyword, plus saved keywords, on a per-site
  cadence (default weekly), priced first.
- **Search Console:** clicks, impressions, CTR and position by page and query, daily.
- **GA4:** organic landing pages and key events, plus GA4's measurement health, because a
  broken tag reads exactly like zero traffic.
- **Site audit:** monthly, with issues grouped and assignable, and a "fix" action that creates
  a task (for example "17 titles over 60 characters").
- **Backlinks:** a baseline for the site and its competitors on onboarding, then quarterly.

## 10. Social posting

Every published article can produce social posts: a LinkedIn post, a Facebook page post, an X
post, an Instagram caption and a Google Business Profile update, each written to that channel's
length and tone, scheduled after the article goes live, with the article URL and UTM tags. A
social calendar shows them alongside articles. Standalone posts are allowed too.

Build this behind a `SocialPublisher` interface. **Stop and ask** before integrating any network
or aggregator: native APIs need app review per network, and an aggregator has its own cost and
terms. Until then, posts can be drafted, approved, scheduled and exported, and marked as posted
by hand.

## 11. Backlinks

- Monitor the backlink profile and new and lost links over time.
- **Link prospecting:** find pages that link to competitors but not to us, resource pages,
  unlinked brand mentions, and relevant directories. Score each prospect. See
  `phonon-orchestration-hub/plans/backlink-submission-kit.md` for the directory list we use
  today.
- **Outreach:** draft a personalised email per prospect for a human to review and send. Never
  send outreach automatically.
- Never offer link schemes: no paid links, private blog networks, link exchanges at scale or
  automated comment links. They break Google's spam policies and put the client's site at risk.

## 12. Screens

Everything must work at 375 px wide with no horizontal scroll, and at 1440 px and above.

- **Sign-in and onboarding:** the particle field behind a glass panel. Onboarding is a guided
  sequence: workspace → first site (domain) → we crawl the sitemap and fetch a domain overview
  while an animated "scan" visual runs → brand profile, pre-filled from the crawl for the client
  to correct → authors → connect Search Console and GA4 → choose a publishing connector and test
  it → choose a schedule and budget → done, with the first calendar visible.
- **Agency home (platform admin):** every workspace as a card with health at a glance: runway,
  articles published this month, organic clicks trend, budget used, items awaiting review,
  failing connections.
- **Workspace overview:** sites as cards, plus combined KPIs.
- **Site dashboard:** KPI tiles that count up on load (organic clicks, impressions, average
  position, indexed pages, articles live, runway days, credits used this month); a 90-day
  clicks and impressions chart; "next up" (the next three slots and their state); striking-
  distance opportunities; recent rank movements with up and down indicators; open audit issues.
- **Content calendar:** month and list views. Drag to reschedule; the runway shows as a band
  across the calendar that turns amber below the threshold and red when empty.
- **Pipeline run view:** the ten steps as connected nodes, with a live pulse travelling along
  the path as each step completes (server-sent events), each node expandable to its inputs,
  outputs, cost and evidence. This is the product's signature screen; make it beautiful.
- **Article editor:** Markdown with a live preview in the site's own style (approximated), a
  right-hand panel with the SEO checklist (live lint), the fact-check evidence per claim, the
  internal links and their status on the publish date, version history and diff, comments, and
  approve, reject or request changes.
- **Keywords:** saved keywords table with metrics, clusters, intent, status (idea, targeted,
  published, ranking), and the research log with costs.
- **Rankings:** position over time per keyword, filterable by cluster.
- **Audit**, **Backlinks**, **Social calendar**.
- **Site settings:** brand profile, authors, voice and SEO rules, connections (each with a
  live "test" button and status light), schedule, lead days, review mode, back-dating setting,
  runway threshold.
- **Workspace settings:** members and roles, budget and reserve, usage ledger, notifications.
- **⌘K command palette** for jumping between sites and actions.

## 13. Design direction

The look is the lumoras.ai Voice Core direction: a dark "control room" by default and a light
"clean room" alternative, with Auto following the system. Open the live site and
`apps/web/app/globals.css` and stay inside that system.

- **Surfaces:** deep near-black (`--void`), layered panels, hairline borders (`--line`), glass
  panels with backdrop blur for overlays, a faint grid behind dashboards.
- **Accents:** `--ion` (teal) for primary actions, live states and positive movement; `--flare`
  (orange) for warnings and the runway alert; `--ice` (blue) for information. Glows are used
  sparingly, on live and focused elements only.
- **Type:** the fonts `apps/web` uses; tabular numerals for every metric.
- **Motion has a job.** It shows state changes, progress and causality, not decoration:
  - interface feedback 120–200 ms, panels and route changes 250–400 ms, ambient hero visuals
    slow and continuous;
  - ease-out for entering, ease-in for leaving, no bounce on data;
  - staggered reveal of cards on first load (30–50 ms apart), count-up on KPI numbers, charts
    drawing in along their path, shimmer skeletons while loading (never a blank panel or a
    spinner alone), status lights that pulse only while something is live;
  - View Transitions between list and detail so a card morphs into its page;
  - everything respects `prefers-reduced-motion` with an instant or cross-fade equivalent, and
    canvas effects pause when the tab is hidden or the element is off screen;
  - hold 60 fps on a mid-range laptop; no layout shift from animation (animate transform and
    opacity only).
- **Empty states** are designed, with the next action as the primary button.
- **Accessibility:** WCAG 2.2 AA contrast in both themes, full keyboard use, visible focus
  rings in `--ion`, ARIA for charts (a hidden data table behind each chart).
- Use `apps/web/components/EmptyState.tsx`, `PageShell.tsx` and `Icons.tsx` as references.

Before building screens, make a design pass: build a `/design` route (dev only) showing every
token, component and motion pattern in both themes, and get it approved before building the
feature screens on top of it.

## 14. Security

- RLS as described, with a test that proves isolation (see section 16).
- Encrypted secrets, rotation-ready.
- **SSRF protection** for every URL we fetch on a client's behalf (sitemaps, pages, webhooks):
  resolve DNS and refuse private, loopback, link-local and metadata addresses, follow redirects
  with the same check, cap response size and time.
- Webhook payloads signed with HMAC-SHA256 and a timestamp.
- Rate limits on auth and on expensive actions.
- CSRF protection on mutations; strict Content Security Policy.
- Audit log on every write and every impersonation.

## 15. Delivery plan

Work in phases. Each phase ends with its acceptance checks passing, a short written summary of
what was built and what was not, and the work left uncommitted or on a branch for the owner to
test. Do not start the next phase until the owner says so.

- **Phase 0, foundations:** `packages/ui-tokens`, `apps/seo` scaffold, the `/design` route,
  Dockerfile and compose files (not deployed), migrations runner, CI scripts (typecheck, lint,
  unit, e2e). Acceptance: both apps build; `apps/web` looks unchanged; `/design` approved.
- **Phase 1, tenancy:** Better Auth, workspaces, roles, invitations, RLS, audit log, sites,
  brand profiles, authors, encrypted connections, sitemap crawler with SSRF guard, onboarding
  flow. Acceptance: two workspaces cannot see each other's data (proven red and green).
- **Phase 2, research:** `SeoDataProvider` with OpenSEO, budget and reserve, usage ledger,
  research log, cache, seed backlog, keywords screen, Search Console and GA4 connections.
  Acceptance: a repeated query is free; a workspace below its reserve cannot spend.
- **Phase 3, content pipeline:** calendar, schedule, rolling generation, the ten steps, lint,
  fact-check, review gate, editor, pipeline run view, runway monitor and alerts, Git
  file-per-post and webhook publishers. Acceptance: lumoras.ai is onboarded and one generated
  article lands as a PR that passes its build; the runway alert fires when the queue is short.
- **Phase 4, measurement:** rank tracking, Search Console and GA4 dashboards, site audit,
  backlinks baseline, the site dashboard and agency home. Acceptance: sonorch.ai's real Search
  Console data appears on its dashboard.
- **Phase 5:** WordPress publisher, social drafting and calendar (provider after the owner
  decides), link prospecting and outreach drafts.
- **Phase 6:** billing (Stripe), plans and limits, white-label (client logo and colours on
  their reviewer view), more publishers.

## 16. Testing rules

- **Prove a guard red before you trust it green.** For RLS, the budget reserve, the link
  validator, the duplicate head-term check and the SSRF guard: write the test, break the guard
  on purpose, watch the test fail and name the path and value, then restore it.
- Unit tests for every lint rule, the runway calculation, the scheduler's slot math across
  timezones and DST, cost accounting, and each publisher's output format.
- Playwright end to end: onboarding, approving an article, rescheduling by drag, a viewer who
  cannot approve, and a reduced-motion run of the main screens.
- Provider and LLM calls are faked in tests with recorded fixtures. Never spend real credits in
  the test suite.
- Assert on data and structure, never on generated wording.

## 17. Working rules

- **Fix causes, not symptoms.** If a library or API does not behave as its documentation says,
  find out why before adding a retry, timer, fallback or workaround. If a workaround is truly
  unavoidable, say so, name what it stands in for, and record it as open work in
  `apps/seo/docs/open-work.md`.
- Read the documentation of every external API before integrating it, and record the version
  and the date you read it.
- Do not deploy, do not SSH to any server, do not edit server env files, do not run anything
  against production databases, and do not push to `main`.
- Do not modify `apps/web` behaviour or appearance, or the sonorch.ai and seasonx.ai repos,
  without asking.
- Keep secrets out of git. Add every new variable to `apps/seo/.env.example` with a comment.
- Write an `apps/seo/README.md` covering local setup (Postgres in Docker, seed data with two
  demo workspaces), the architecture, and how to add a new publisher or provider.

## 18. Decisions to ask the owner about, not to make

1. The public host name for the app (for example `app.lumoras.ai` or `growth.lumoras.ai`) and
   the product name. "Lumoras Growth" is a working name.
2. sonorch.ai and seasonx.ai: migrate to file-per-post, or build the typed-array adapter.
3. Self-hosted OpenSEO with our own DataForSEO key, or DataForSEO directly, after you report
   what OpenSEO's API supports and what both terms of service allow.
4. Which social networks first, and native APIs or an aggregator.
5. Pricing and plans, before Phase 6.
