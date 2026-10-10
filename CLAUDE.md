# lumoras.ai monorepo: notes for Claude Code

Read `apps/seo/docs/handoff.md` first. It says where the work stands, how to run and test it, what the
owner must do to go live (including the Caddy route for growth.lumoras.ai), and what comes next.

- **Branch:** `dev` (GitHub `timtasay/lumoras.ai`). `git pull` before starting.
- **apps:** `apps/web` is lumoras.ai. `apps/seo` is Lumoras Growth (growth.lumoras.ai), built phase by
  phase from `docs/seo-platform-build-prompt.md`. Phases 0–4 are done. Phase 5 starts only when the owner
  says go.
- **Decisions:** `apps/seo/docs/owner-decisions.md`. Do not re-ask what is decided there.
- **Before saying something is done:**
  - run `pnpm --filter seo typecheck`, `lint` and `test` (with `TEST_DATABASE_URL`), then `build`;
  - run e2e for UI changes;
  - break each new guard once to show its test fails.
- **Dependencies and writing:** pin exact versions at least two weeks old. Plain language in UI copy and
  docs: no hype, emoji or em-dash asides.
- **Never:**
  - deploy, SSH to VPS3, or edit server env files;
  - merge pull requests, or push to `main`;
  - put secrets in git or chat.
- **Gitea repos** (sonorch.ai, seasonx.ai, phonon-orchestration-hub): a branch and a pull request into `dev`.
  The owner merges.
