/**
 * Phase 3 seed: schedules, publishing connections, slots, and demo pipeline
 * runs on the FakeLlm (recorded fixtures; no network, no real money).
 *
 *   lumoras.ai   onboarded end to end (acceptance): brand profile and SEO
 *                rules from docs/content-spec.md, route inventory from its
 *                sitemap (fixture), its existing articles' keywords, a demo
 *                author placeholder, a Git connection (file per post,
 *                apps/web/content/insights/<slug>.md, pull request mode) to a
 *                FAKE GitHub, schedule Tuesday and Friday 09:00 New York.
 *                One article runs all ten steps and lands as a pull request
 *                when the fake GitHub is reachable (e2e, dev fakes, tests).
 *   sonorch.ai   scheduled but no publishing connection yet: two articles
 *                wait for review (one with an unverifiable claim), so the
 *                runway is short and its alert fires.
 *   seasonx.ai   scheduled, nothing written, no connection: the queue is empty.
 *   northwind    the demo webhook is its publishing connection; schedule off.
 */
import type pg from "pg";
import { withWorkspace, type Actor, type TenantContext } from "./db/tenant.ts";
import { createConnection } from "./data/connections.ts";
import { createPlanned, getItem } from "./data/content.ts";
import type { Keyring } from "./crypto/secrets.ts";
import { checkRunway } from "./content/planner.ts";
import { decideReview } from "./content/review.ts";
import { slotsBetween } from "./content/schedule.ts";
import { FakeLlm } from "./llm/fake.ts";
import { RECORDED_PAGES } from "./llm/fixtures.ts";
import { DEFAULT_PRICES } from "./llm/prices.ts";
import { DEFAULT_MODELS } from "./llm/types.ts";
import { createLogger } from "./log.ts";
import { RecordedFetcher } from "./net/fetcher.ts";
import type { SafeFetchPolicy } from "./net/safe-fetch.ts";
import { executeRun, startRun } from "./pipeline/runner.ts";
import type { Mailer, PipelineDeps } from "./pipeline/deps.ts";
import { FakeProvider } from "./providers/fake.ts";
import { LUMORAS_INSIGHTS_TEMPLATE } from "./publishers/frontmatter.ts";
import type { SeedResult } from "./seed.ts";

export type SeedContentOptions = {
  keyring?: Keyring | null;
  /** The (fake) GitHub API lumoras.ai's Git connection points at. Default: the dev fakes (scripts/fakes.ts). */
  github?: { apiBase: string; token: string; reachable?: boolean };
  /** The (fake) webhook receiver for Northwind. */
  webhook?: { endpoint: string; secret: string };
  policy?: SafeFetchPolicy;
  /** Run the demo pipelines (default true). */
  runs?: boolean;
  now?: () => Date;
  mail?: Mailer;
};

const SEED: Actor = { actorId: "system:seed" };
export const DEV_FAKE_GITHUB = { apiBase: "http://github.test:4571", token: "fake-token-0123456789" };
/** The dev webhook receiver (scripts/fakes.ts). Not a secret: it only signs deliveries to a local fake. */
export const DEV_FAKE_WEBHOOK = { endpoint: "http://webhook.test:4572/hook", secret: "dev-webhook-signing-secret-0123456789" };
export const LUMORAS_REPO = "https://github.com/lumoras/lumoras.ai";

/** lumoras.ai's existing articles (docs/content-spec.md): their keywords are taken (rule 5). */
export const LUMORAS_EXISTING_KEYWORDS = [
  "ai phone answering service", "ai receptionist cost", "appointment reminder texts", "no show policy", "order cancellation", "returns and exchanges",
  "ai receptionist", "voice ai for business", "ai call center", "call forwarding for business", "missed calls small business", "where is my order",
];

export async function seedContent(db: pg.Pool, out: SeedResult, opts: SeedContentOptions = {}): Promise<void> {
  const now = opts.now ?? (() => new Date());
  const lumoras = out.workspaces.lumoras;
  const northwind = out.workspaces["northwind-dental"];
  const lctx: TenantContext = { ...SEED, workspaceId: lumoras.id };
  const already = await withWorkspace(db, lctx, (tx) => tx.maybe("SELECT 1 FROM content_items LIMIT 1"), { readOnly: true });
  if (already) return;
  const gh = opts.github ?? DEV_FAKE_GITHUB;

  await withWorkspace(db, lctx, async (tx) => {
    await tx.action("seed.content");
    const l = lumoras.sites["lumoras.ai"], so = lumoras.sites["sonorch.ai"], sx = lumoras.sites["seasonx.ai"];
    for (const kw of LUMORAS_EXISTING_KEYWORDS) {
      await tx.exec(
        `INSERT INTO keywords (workspace_id, site_id, keyword, market, status, cluster, fit, variant_key) VALUES ($1, $2, $3, 'United States', 'published', 'Existing pages', 'offered', '')
         ON CONFLICT (site_id, keyword, market) DO UPDATE SET status = 'published'`,
        [lumoras.id, l, kw],
      );
    }
    // sonorch.ai: two ideas saved from earlier research (Phase 2 fixtures), so its next articles have topics
    for (const [kw, vol, kd, cpc] of [["ai receptionist for salons", 140, 18, 23_100_000], ["salon booking app", 880, 42, 9_600_000]] as const) {
      await tx.exec(
        `INSERT INTO keywords (workspace_id, site_id, keyword, market, search_volume, keyword_difficulty, cpc_micros, intent, status, cluster, fit, variant_key)
         VALUES ($1, $2, $3, 'United States', $4, $5, $6, 'commercial', 'idea', 'Front desk', 'offered', '') ON CONFLICT (site_id, keyword, market) DO NOTHING`,
        [lumoras.id, so, kw, vol, kd, cpc],
      );
    }
    await tx.exec("UPDATE sites SET schedule_days = '{2,5}', schedule_time = '09:00', schedule_active = true, lead_days = 3, runway_threshold_days = 10 WHERE id = ANY($1)", [[l, so, sx]]);
    if (opts.keyring) {
      const git = await createConnection(tx, opts.keyring, lumoras.id, l, { kind: "git", label: "lumoras.ai repository (fake GitHub)", repository: LUMORAS_REPO, branch: "main", secret: gh.token });
      await tx.exec("UPDATE connections SET config = config || $2::jsonb, status_detail = $3 WHERE id = $1", [
        git.id,
        JSON.stringify({ provider: "github", apiBaseUrl: gh.apiBase, contentDir: "apps/web/content/insights", filenamePattern: "{{slug}}.md", frontmatterTemplate: LUMORAS_INSIGHTS_TEMPLATE, mode: "pr", livePath: "/insights/{{slug}}" }),
        "Demo: points at a local FAKE GitHub, never the real repository. Test it to see the status light.",
      ]);
      await tx.exec("UPDATE sites SET publish_connection_id = $2 WHERE id = $1", [l, git.id]);
    }
    // lay out the first slots (the worker keeps doing this every few minutes)
    for (const id of [l, so, sx]) {
      const s = await tx.one<{ timezone: string; schedule_days: number[]; schedule_time: string; horizon_days: number }>("SELECT timezone, schedule_days, to_char(schedule_time, 'HH24:MI') AS schedule_time, horizon_days FROM sites WHERE id = $1", [id]);
      for (const at of slotsBetween({ days: s.schedule_days, time: s.schedule_time, timezone: s.timezone }, now(), new Date(now().getTime() + s.horizon_days * 86_400_000))) {
        await createPlanned(tx, lumoras.id, id, at, at, SEED.actorId);
      }
    }
  });

  const nctx: TenantContext = { ...SEED, workspaceId: northwind.id };
  await withWorkspace(db, nctx, async (tx) => {
    await tx.action("seed.content");
    const site = northwind.sites["northwind-dental.example"];
    if (opts.webhook && opts.keyring) {
      const hook = await createConnection(tx, opts.keyring, northwind.id, site, { kind: "webhook", label: "Demo webhook receiver (local)", endpoint: "https://placeholder.example/hook", secret: opts.webhook.secret });
      await tx.exec("UPDATE connections SET config = jsonb_build_object('endpoint', $2::text, 'livePath', '/blog/{{slug}}') WHERE id = $1", [hook.id, opts.webhook.endpoint]);
      await tx.exec("UPDATE sites SET publish_connection_id = $2 WHERE id = $1", [site, hook.id]);
    } else {
      const c = await tx.maybe<{ id: string }>("SELECT id FROM connections WHERE site_id = $1 AND kind = 'webhook' LIMIT 1", [site]);
      if (c) await tx.exec("UPDATE sites SET publish_connection_id = $2 WHERE id = $1", [site, c.id]);
    }
  });

  if (opts.runs === false) return;
  const log = createLogger("seed", { level: "warn" });
  const deps = (scenarios: ConstructorParameters<typeof FakeLlm>[0] = {}): PipelineDeps => ({
    db,
    llm: new FakeLlm(scenarios),
    prices: DEFAULT_PRICES,
    models: DEFAULT_MODELS,
    seo: new FakeProvider(),
    keyring: opts.keyring ?? null,
    fetcher: new RecordedFetcher(RECORDED_PAGES),
    outbound: opts.policy ?? {},
    google: null,
    enqueue: async () => {},
    mail: opts.mail ?? (async () => {}),
    now,
    log,
    baseUrl: "http://localhost:3007",
  });

  const reviewer = out.users["reviewer@lumoras.example"];
  // lumoras.ai: one article through all ten steps ("run now, publish now": today's date, no back-dating)
  const lumorasItem = await withWorkspace(db, lctx, async (tx) => {
    await tx.action("seed.content");
    return createPlanned(tx, lumoras.id, lumoras.sites["lumoras.ai"], new Date(now().getTime() - 60_000), null, SEED.actorId);
  });
  if (lumorasItem) {
    const d = deps();
    const runId = await startRun(d, lctx, lumorasItem, "manual");
    await executeRun(d, lctx, runId);
    const item = await withWorkspace(db, lctx, (tx) => getItem(tx, lumorasItem), { readOnly: true });
    if (item.status === "awaiting_review" && opts.keyring) {
      await decideReview(d, { workspaceId: lumoras.id, actorId: reviewer }, "reviewer", lumorasItem, "approved", "Reads well; sources check out.");
      if (opts.github?.reachable) await executeRun(d, lctx, runId);
    }
  }
  // lumoras.ai: its next slot written and waiting for a reviewer
  const next = await withWorkspace(db, lctx, (tx) => tx.maybe<{ id: string }>("SELECT id FROM content_items WHERE site_id = $1 AND status = 'planned' ORDER BY slot_at LIMIT 1", [lumoras.sites["lumoras.ai"]]), { readOnly: true });
  if (next) {
    const d = deps();
    await executeRun(d, lctx, await startRun(d, lctx, next.id, "schedule"));
  }
  // sonorch.ai: the next two slots written and waiting for review; the second has an unverifiable claim
  const slots = await withWorkspace(db, lctx, (tx) => tx.many<{ id: string }>("SELECT id FROM content_items WHERE site_id = $1 AND status = 'planned' ORDER BY slot_at LIMIT 2", [lumoras.sites["sonorch.ai"]]), { readOnly: true });
  for (const [i, s] of slots.entries()) {
    const d = deps(i === 1 ? { scenarios: { factcheck: "unverifiable" } } : {});
    const runId = await startRun(d, lctx, s.id, "schedule");
    await executeRun(d, lctx, runId);
  }
  for (const site of Object.values(lumoras.sites)) await checkRunway(deps(), lctx, site);
  await checkRunway(deps(), nctx, northwind.sites["northwind-dental.example"]);
}
