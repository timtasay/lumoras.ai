# Phase 0 summary: foundations

Built 9 October 2026 on branch `dev`, left uncommitted for the owner to review. Phase 1 has not
been started and waits for the owner's go-ahead (and for `/design` to be approved).

## What was built

### Shared packages (`packages/*`, now in `pnpm-workspace.yaml`)

- **`@lumoras/ui-tokens`**
  - `tokens.css`. Part 1 is the Voice Core palette moved verbatim from `apps/web/app/globals.css`:
    the dark "control room" on bare `:root`, the light "clean room" under
    `prefers-color-scheme: light` (Auto) and `[data-theme="light"]`, `--ion`/`--flare`/`--ice`,
    the industry hues, panels, lines, glass, glows, radii, easings, font variables, Spectrum and
    `--cv-*` field tokens. Part 2 adds the product scales: motion durations and easings, radii,
    spacing, type scale, semantic states (`--info`, `--warn`, `--amber`, `--danger`), an
    accessible `--control-line`, elevation, focus ring, skeleton and four chart series
    (`--viz-1..4`, checked for colour-vision separation with a palette validator).
  - `theme-control.css` and `./theme-control`: the Light · Dark · Auto control moved from apps/web.
  - `./theme`: `THEME_KEY` (`lumoras-theme`), `THEME_COLORS`, the pre-paint `THEME_INIT_SCRIPT`,
    the circular View Transition reveal, and the `lumoras:themechange` event.
- **`@lumoras/ui-field`**: the Spectrum particle field engine, moved from apps/web. Its state
  (formation, daypart, highlight) now comes from a `source` option instead of the homepage bus,
  and it gained two opt-in options for other hosts: `pauseOffscreen` (IntersectionObserver) and
  `localPointer`.
- **apps/web** imports tokens, theme and field from the packages (`transpilePackages`); its own
  copies (`lib/theme.ts`, `components/home/field-engine.ts`, the token blocks in `globals.css`)
  are gone. Nothing else in apps/web changed except a Playwright smoke test and its script.

### apps/seo

- Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3 strict, plain CSS on the shared tokens,
  `eslint-config-next`, same fonts (Sora, Geist, Geist Mono), dev and start on port 3007.
- App shell: sidebar (a drawer on phones) with every future screen listed and tagged with its
  phase, workspace switcher placeholder, top bar with ⌘K search and the theme control.
  `/` is a Phase 0 overview. `/api/health` serves the container healthcheck.
- **`/design`** (development only; in production a 404 unless `ENABLE_DESIGN_ROUTE=1`, checked
  by unit test and by hand): every token with live WCAG contrast ratios in the current theme,
  type scale with tabular numerals, spacing, radii, elevation and glows, motion durations with a
  demo, and reusable components: buttons (4 variants, 3 sizes, loading that keeps its width),
  text field, select, textarea, checkbox, switch, segmented control, badges, filter chips,
  status lights (only "live" pulses), KPI tiles with count-up and sparklines, cards with
  staggered reveal, shimmer skeletons, a designed empty state, a sortable data table, tabs,
  toasts, a modal on `<dialog>`, a ⌘K command palette, five hand-written SVG charts (sparkline,
  area, bar, rank position, donut) that draw in and carry hidden data tables and keyboard
  readouts, the content-calendar month with the runway band (ion, amber below threshold, red
  hatched when empty), the **pipeline run view** (ten nodes, a pulse travelling the path as each
  step completes, a pause at the review gate with approve / request changes, expandable step
  details with cost and fact-check evidence), a View Transitions list → detail morph, and the
  sign-in mock with the particle field behind glass.
- **Migrations runner** (`lib/db/migrate.ts`, `scripts/migrate.ts`, `migrations/0001_bootstrap.sql`):
  numbered files in order, one transaction each, session advisory lock, `schema_migrations`
  with filename, version, sha256 checksum, applied_at, applying role and duration; refuses on a
  changed, missing or out-of-order file; runs only as the owner role and refuses if
  `DATABASE_URL_OWNER` and `DATABASE_URL` name the same role. Runs on web container start
  (`docker/start-web.sh`) before the server.
- **Worker** (`worker/index.ts`): same image, different command; validates env, logs JSON,
  heartbeat, clean exit 0 on SIGTERM/SIGINT. pg-boss deliberately not added yet (TODO for Phase 3).
- **Deploy files (not deployed)**: `apps/seo/Dockerfile`, `deploy/docker-compose.yml`
  (`lumoras-seo` web on 3007 + `lumoras-seo-worker`, external `lumoras_internal` network,
  healthcheck, worker waits for a healthy web container), `deploy/Caddyfile.snippet`
  (placeholder host), `deploy/postgres/10-seo-database.sh` (database `seo`, owner role, non-superuser
  app role without BYPASSRLS, default privileges). Root `Dockerfile` updated to copy
  `packages/` and build only the web app; `.dockerignore` updated.
- **CI**: root scripts `typecheck`, `lint`, `test`, `test:e2e`, `build` across the workspace;
  `.github/workflows/ci.yml` (install, typecheck, lint, unit + integration tests against a
  Postgres 16 service, build; then a Playwright job for apps/seo and apps/web).
- Docs: `README.md`, `.env.example`, `docs/open-work.md`, this file.

### Pinned versions added

`pg` 8.23.0, `@types/pg` 8.23.1, `tsx` 4.23.15, `@playwright/test` 1.56.1 (apps/seo and apps/web,
matched to the available Chromium build). Everything else reuses apps/web's exact versions
(next 16.4.0, react/react-dom 19.3.0, typescript 5.9.3, eslint 9.39.5, eslint-config-next 16.4.0,
@types/node 22.20.5, @types/react(-dom) 19.3.0). No animation or chart library.

## What was not built

Everything from Phase 1 on: auth, workspaces, RLS and tenant tables, seed data, providers,
publishers, jobs, real data on any screen. The pipeline view, calendar, charts and KPIs show
sample data. No Docker image was built (no daemon in the session) and nothing was deployed.

## Acceptance checks

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | pass |
| `pnpm typecheck` (ui-tokens, ui-field, web, seo) | pass |
| `pnpm lint` (all four) | pass, 0 warnings |
| `pnpm test` (apps/seo unit + integration, real PostgreSQL 16.15) | 30 / 30 pass |
| `pnpm build` (web and seo) | pass |
| apps/web unchanged | 32 / 32 full-page screenshots pixel-identical (0 differing pixels, zero tolerance) |
| apps/web behaviour | field animates, theme control switches, persists and fires `lumoras:themechange`; Playwright smoke passes |
| `/design` (Playwright, production build) | dark and light × 375 and 1440: renders, no console errors, no horizontal overflow, all text tokens ≥ 4.5:1 and graphics tokens ≥ 3:1 in both themes, every chart has a data table |
| Reduced-motion run | pass (final values at once, no travelling pulse, still frame, no errors) |
| Pipeline, palette, theme, drawer, health e2e | pass (apps/seo 11 / 11) |
| `/design` without the flag in production | 404 |
| Migration guard red before green | shown (below) |
| Docker image build | not run (daemon unavailable); steps reproduced without Docker, see open-work |

**apps/web pixel diff.** Before any change, apps/web was built and served with `next start`, and
Playwright took full-page screenshots of `/`, `/about`, `/insights`, `/insights/no-show-policy`,
`/knowledge-base`, `/help-center`, `/faq` and `/demo` at 1440 and 400 px, in dark and light,
with `prefers-reduced-motion: reduce` so the particle field draws one still frame. Two baseline
runs matched each other exactly, so the tolerance used is zero. After the move (and again at the
very end, after every later change), the same 32 screenshots were compared pixel by pixel: 0
differing pixels on all 32, identical page heights.

**Checksum guard, red then green.** With the comparison in `planMigrations` commented out:

```
not ok 6 - refuses to continue when an applied file's checksum changed, naming the file
  error: 'Missing expected rejection: /tmp/seo-mig-CFaKvK/0002_table.sql was edited after it was
  applied (recorded checksum b95200494525…, on disk e2e69c3000fb…): the runner must refuse to continue'
not ok 4 - refuses when an applied file's checksum changed, and names the file
  error: 'Missing expected exception: 0002_two.sql was edited after it was applied (recorded
  checksum 3087d5862751…, on disk 44cce64e0be1…): planMigrations must refuse'
# pass 17  # fail 2
```

Guard restored: 30 / 30 pass.

**End to end against a real database.** The init script ran twice on the local cluster
(idempotent); `migrate --dry-run` listed `0001_bootstrap.sql`; `docker/start-web.sh` applied it
as `seo_owner` and started the server; a second run reported up to date; the app role got
`permission denied for schema public` on `CREATE TABLE`; running migrations with the app role's
URL as the owner URL was refused.

## Screenshots

Taken from the production build; full page uses a viewport as tall as the page so sticky parts
render as a user sees them. Under the build session's scratchpad `shots/`:

- `seo-design-dark-1440.png`, `seo-design-light-1440.png`, `seo-design-dark-375.png`, `seo-design-light-375.png`
- `seo-design-pipeline-{dark,light}-{1440,375}.png` (the run waiting at the review gate)
- `seo-design-signin-{dark,light}-{1440,375}.png`

## Decisions still open (section 18, plus Phase 0 questions)

1. Public host name and product name (`growth.lumoras.ai` / "Lumoras Growth" are placeholders).
2. sonorch.ai and seasonx.ai: migrate to file-per-post frontmatter, or build the typed-array Git adapter.
3. Self-hosted OpenSEO with our own DataForSEO key, or DataForSEO directly (after the Phase 2 report on OpenSEO's API and both terms of service).
4. Which social networks first, and native APIs or an aggregator.
5. Pricing and plans, before Phase 6.
6. **New:** approve `/design` (the prompt's gate for building feature screens), or list changes.
7. **New:** confirm the database names (`seo`, `seo_owner`, `seo_app`) and env file path
   (`/opt/lumoras/env/lumoras-seo.env`) against how `01-databases.sh` does it on VPS3.
8. **New:** the review deploy of `/design`, if wanted, needs `ENABLE_DESIGN_ROUTE=1`; production should leave it unset.
