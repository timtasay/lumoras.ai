# Handoff: continuing Lumoras Growth in a new session

Written 10 October 2026 at the end of the cloud session that built Phases 0–4 and the follow-ups.
A new Claude Code session (for example in VS Code, on the owner's Max plan) starts here.

## 1. Start the new session

1. **Get the code.** `git clone https://github.com/timtasay/lumoras.ai.git`, then `git checkout dev` and
   `git pull`. All work happens on **`dev`**. Never commit to `main`.
2. **Open it in VS Code.** Install the Claude Code extension and sign in with the Max plan account. The
   Max plan is fine here, because a person is driving the session. It cannot pay for the app's own AI
   calls; those go through OpenRouter (§4).
3. **Local tools:**
   - Node 22 or 24, and pnpm 10.28 (`corepack enable`);
   - Docker, for a local Postgres;
   - Playwright's Chromium, for end-to-end tests (`pnpm --filter seo exec playwright install chromium`).
4. **Gitea access**, for sonorch.ai, seasonx.ai and the hub repo on `gitea.timdatinh.com`:
   - From a laptop, plain `git clone` over HTTPS or SSH with your Gitea account works. The cloud session
     could only use the Gitea MCP tools.
   - Optional: add the Gitea MCP server to Claude Code (`claude mcp add …`) so the session can open and
     read pull requests itself.
5. **First message to send:**
   > Read CLAUDE.md and apps/seo/docs/handoff.md. Then `git pull` on dev, run the checks in §3, and tell me
   > what you find before changing anything.

## 2. Where everything is

| What | Where |
| --- | --- |
| The build plan (phases, rules, decisions to ask) | `docs/seo-platform-build-prompt.md` |
| Owner decisions so far (newest first) and what is still open | `apps/seo/docs/owner-decisions.md` |
| What is waiting on the owner, known gaps | `apps/seo/docs/open-work.md` |
| What each phase built and verified | `apps/seo/docs/phase-0-summary.md` … `phase-4-summary.md` |
| External APIs as read (OpenRouter, DataForSEO, Google, Gitea, GitHub…) | `apps/seo/docs/external-apis.md` |
| The posts endpoint sonorch.ai and seasonx.ai read | `apps/seo/docs/content-api.md` |
| sonorch.ai / seasonx.ai post formats | `apps/seo/docs/site-formats/` |
| App readme (layout, commands, deploy files) | `apps/seo/README.md` |
| Deploy files (not deployed) | `apps/seo/deploy/` (compose, Caddy block, Postgres setup script) |

**Repos:**
- `timtasay/lumoras.ai` on GitHub: this repo (apps/web is lumoras.ai, apps/seo is Lumoras Growth).
- `lumoras/sonorch.ai` and `lumoras/seasonx.ai` on Gitea: the two marketing sites.
- `lumoras/phonon-orchestration-hub` on Gitea: VPS3 infrastructure on branch **`marketing-split`**
  (`docker/vps3/`, with caddy, postgres, scripts, and one folder per stack).

## 3. Checks before and after any change

```bash
pnpm install
docker run -d --name seo-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm --filter seo typecheck && pnpm --filter seo lint
pnpm --filter seo test          # 458 tests at handoff, none skipped when TEST_DATABASE_URL is set
pnpm --filter seo build         # the e2e server runs this production build: rebuild before e2e
pnpm --filter seo test:e2e      # Playwright; starts `next start` with test settings and a throwaway database
pnpm dev:seo                    # http://localhost:3007 (fake AI and fake SEO data, no money spent)
```

**Working rules the owner expects:**
- **Phases:** work one phase at a time and stop for the owner's go between phases.
- **Red/green:** break each new guard on purpose, show the test fail, restore it.
- **Dependencies:** pin exact versions at least two weeks old.
- **Writing:** plain language in UI copy and docs; no hype words, emoji or em-dash asides.
- **No deploys:** never deploy, SSH to VPS3, or edit server env files. The owner does that.
- **Gitea:**
  - work goes on a branch with a pull request into `dev`, never `main`;
  - never merge; the owner merges;
  - for the sites, `dev` is promoted to `main` and then deployed.
- **Secrets:** never in git or chat. The owner pastes tokens into the app (sealed) or into the server env file.

## 4. To go live: Lumoras Growth on VPS3 (owner, with the session preparing files)

Lumoras Growth has never been deployed. In order:

1. **Hub repo** (`phonon-orchestration-hub`, branch `marketing-split`), as a pull request:
   - **Caddy:** append the block in `apps/seo/deploy/Caddyfile.snippet` to `docker/vps3/caddy/Caddyfile`,
     after the `lumoras.ai` block.
     - It routes `growth.lumoras.ai` to `lumoras-seo:3007`.
     - It gets its certificate the same way `lumoras.ai` does.
     - It imports the existing `client_ip_only` snippet and shows a holding page during restarts.
     - DNS is already done: `growth.lumoras.ai` is a CNAME to `lumoras.ai` through Cloudflare.
   - **Stack:** copy `apps/seo/deploy/docker-compose.yml` to `docker/vps3/lumoras-seo/docker-compose.yml`.
     - Services: `lumoras-seo` (web, port 3007, runs migrations on start) and `lumoras-seo-worker`.
     - Network: `lumoras_internal`. Env file: `/opt/lumoras/env/lumoras-seo.env`.
     - Build context: `/opt/lumoras/src/lumoras.ai`, using `apps/seo/Dockerfile`.
   - **Ship script:** `docker/vps3/scripts/ship-lumoras.sh` unpacks the repo to `/opt/lumoras/src/lumoras.ai` but
     only rebuilds the `lumoras.ai` stack. Add a rebuild of `/opt/lumoras/stacks/lumoras-seo`
     (`docker compose build && docker compose up -d`), or add a separate `ship-lumoras-seo.sh`.
   - **Backups:** already done by the owner (`seo` added to `backup-postgres.sh`).
2. **Database, once:**
   - Add `SEO_DB_PASSWORD` and `SEO_APP_DB_PASSWORD` to `/opt/lumoras/env/postgres.env`.
   - Run `apps/seo/deploy/postgres/10-seo-database.sh` with `docker exec` (command in its header).
     It creates the database `seo`, the owner role `seo` and the app role `seo_app`.
3. **Env file** `/opt/lumoras/env/lumoras-seo.env`, from `apps/seo/.env.example`. At least:
   - **Database:** `DATABASE_URL=postgres://seo_app:…@lumoras-postgres:5432/seo` and
     `DATABASE_URL_OWNER=postgres://seo:…@lumoras-postgres:5432/seo`.
   - **App:** `BETTER_AUTH_URL=https://growth.lumoras.ai`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEYS`,
     `ENCRYPTION_KEY_CURRENT`.
   - **Email:** `RESEND_API_KEY`, and `EMAIL_FROM` on a Resend-verified domain.
   - **AI:** `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY` (openrouter.ai → Keys; set a credit limit).
   - **SEO data:** `SEO_PROVIDER=dataforseo`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (try the sandbox first).
   - **Google:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (sign-in), and `GOOGLE_OAUTH_CLIENT_ID` and
     `GOOGLE_OAUTH_CLIENT_SECRET` (Search Console and GA4). These can be the same values: the owner's Google
     client already has both return addresses.
4. **Ship, start, make the owner a platform admin:**
   `docker exec lumoras-seo node --import tsx scripts/grant-admin.ts timtasay@gmail.com`.
5. **First real checks:**
   - one DataForSEO balance read and one small research call;
   - one article run watched end to end. Its ledger rows should say "cost reported by the provider".
     Compare with OpenRouter's activity page.
   - connect sonorch.ai's Search Console as timtasay@gmail.com: this is Phase 4's acceptance check.

## 5. To go live: sonorch.ai and seasonx.ai publishing (owner)

Their code is merged into `dev` on Gitea: one file per post, plus reading new posts from Lumoras Growth. Then:

1. Promote `dev` to `main` in each repo and deploy each site once.
2. In Lumoras Growth, open each site → Connections. On the "Lumoras Growth (…)" connection click
   **Use for publishing**, then copy the address it shows.
3. Add `INSIGHTS_API_URL=http://lumoras-seo:3007/api/feeds/<token>/posts.json` to
   `/opt/lumoras/env/sonorch-marketing.env` and `/opt/lumoras/env/seasonx-marketing.env`, then restart each container.
4. On each site's Authors tab, replace the demo author with the real bylines (Tim, Tran, Alex, Jayden).
   The author keys map them.
5. lumoras.ai itself publishes by pull request into `dev` on GitHub. Paste a fine-grained token
   (Contents and Pull requests, that repo only) on lumoras.ai → Connections.

## 6. Next build work

- **Phase 5** (wait for the owner's go):
  - WordPress publisher.
  - Social drafting and calendar for Facebook, Instagram, Threads, Bluesky and TikTok. First research each
    network's own API and terms against an aggregator, and bring the owner a recommendation (decision #4).
    The pipeline's after-publish hook, `AFTER_PUBLISH_HOOKS` in `lib/pipeline/run-steps.ts`, is where
    drafts start.
  - Link prospecting and outreach drafts.
- **Phase 6:** Stripe billing, plans and limits (decision #5: pricing, and whether reviewer seats are paid),
  white-label reviewer view, more publishers.
- **Small follow-ups worth doing:**
  - The post-publish live check runs about 1 hour and 1 day after publishing. For "Lumoras Growth serves
    it" sites the post appears within an hour, so that is fine. For pull-request sites a slow merge can miss
    both checks: keep checking daily until live, up to two weeks.
  - On the sites, a never-visited Lumoras Growth post returns 500 while Lumoras Growth is down. Pages that
    have loaded before are unaffected.
  - After each site deploy, new posts can drop off the Insights list, sitemap and RSS for up to an hour.
    Passing `INSIGHTS_API_URL` as a build arg avoids it.
  - Gitea CI has no runner, so pull request checks never run.
  - Leftover branches can be deleted: `content/file-per-post` and `content/growth-api` in both Gitea repos,
    and `wip/phase-3` on GitHub.

## 7. Decisions already made (do not re-ask)

- **Name and host:** "Lumoras Growth" at `growth.lumoras.ai`.
- **SEO data:** DataForSEO direct.
- **AI:** OpenRouter, with the model per step chosen in the app (Agency → Models).
- **Bylines:** "Lumoras team" is fine for lumoras.ai.
- **lumoras.ai publishing:** pull requests into `dev`.
- **sonorch.ai and seasonx.ai publishing:** served by Lumoras Growth, with no deploy per post.
- **Clients:** autopilot is allowed for any client; Reviewer is a client role.
- **Social networks:** Facebook, Instagram, Threads, Bluesky and TikTok.
- **Phase 1–4 defaults:** all kept.
- **Google account:** timtasay@gmail.com.

**Still open:** #4, native APIs or an aggregator for social; #5, pricing.
