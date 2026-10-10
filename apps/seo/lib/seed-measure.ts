/**
 * Demo measurement for the seeded workspaces (Phase 4), produced by the real
 * code paths: rank checks, audits and backlinks bought through the metered
 * path from the FakeProvider (synthetic, no network, no real money) with the
 * provider's clock replayed over past weeks; Search Console and GA4 synced
 * from a local fake Google when one is given (the e2e server and the dev
 * fakes), never from Google itself.
 *
 *   sonorch.ai   Search Console + GA4 connected and synced (16 months), 12 weekly
 *                rank checks of saved keywords marked targeted (nothing is published
 *                through the app yet, so none is labelled Published), two monthly
 *                audits (one issue already a task), three quarterly backlink
 *                snapshots with two competitors
 *   lumoras.ai   six weekly rank checks (its published article's keyword and its
 *                existing pages' keywords), an audit, a backlinks baseline; Search
 *                Console not connected
 *
 * Every screen agrees: a keyword is labelled Published in Rankings only when a
 * published article (content_items) exists for it, as "Articles live" counts.
 *   seasonx.ai   an audit and a backlinks baseline; nothing to rank yet; Google not connected
 *   Northwind    fictional domain: paid measurement off; Search Console connected and
 *                a GA4 property whose tag is broken (the warning state)
 *
 * Idempotent: skipped when the demo runs already exist.
 */
import type pg from "pg";
import type { Keyring } from "./crypto/secrets.ts";
import { withWorkspace, type TenantContext } from "./db/tenant.ts";
import type { GoogleEndpoints } from "./google/oauth.ts";
import { saveGrantWithProperty } from "./google/service.ts";
import { createLogger } from "./log.ts";
import { createFixTask, pollSiteAudit, startSiteAudit } from "./measure/audit.ts";
import { runBacklinks } from "./measure/backlinks.ts";
import { windowKey } from "./measure/cadence.ts";
import { syncGa4 } from "./measure/ga4-sync.ts";
import { syncSearchConsole } from "./measure/gsc-sync.ts";
import { inspectSite } from "./measure/inspect.ts";
import { runRankTracking } from "./measure/rank.ts";
import { claimRun, type MeasureDeps } from "./measure/runs.ts";
import { FakeProvider } from "./providers/fake.ts";

export type SeedGoogle = { endpoints: GoogleEndpoints; client: { clientId: string; clientSecret: string }; issue: (kind: "search_console" | "ga4") => Promise<string> };
export type SeedMeasureOptions = { google?: SeedGoogle | null; keyring?: Keyring | null; now?: Date };

const SEED = { actorId: "system:seed" };
const WEEK = 7 * 86_400_000;

type Sites = Record<string, string>;

export async function seedMeasurement(db: pg.Pool, ws: Record<string, { id: string; sites: Sites }>, opts: SeedMeasureOptions = {}): Promise<void> {
  const lumoras = ws.lumoras;
  if (!lumoras) return;
  const sonorch = lumoras.sites["sonorch.ai"];
  const ctxL: TenantContext = { ...SEED, workspaceId: lumoras.id };
  const done = await withWorkspace(db, ctxL, (tx) => tx.maybe("SELECT 1 FROM measurement_runs WHERE site_id = $1 AND trigger = 'seed' LIMIT 1", [sonorch]), { readOnly: true });
  if (done) return;
  const now = opts.now ?? new Date();
  let clock = now;
  const provider = new FakeProvider({ now: () => clock });
  const google = opts.google && opts.keyring ? { db, ring: opts.keyring, endpoints: opts.google.endpoints, client: opts.google.client } : null;
  const deps: MeasureDeps = { db, seo: provider, google, now: () => clock, log: createLogger("seed", { level: "warn" }), googlePauseMs: 0 };

  // sonorch.ai: competitors for the backlinks comparison (reserved .example names: no real company gets invented numbers),
  // three topics it wants to rank for and more saved keywords marked targeted. Nothing is published through the app for
  // sonorch.ai (owner decision #2 is open: no publishing connection), so none of them is a published target.
  await withWorkspace(db, ctxL, async (tx) => {
    await tx.action("seed.measurement");
    await tx.exec("UPDATE brand_profiles SET competitors = '{salon-suite.example,bookly-salon.example}' WHERE site_id = $1 AND cardinality(competitors) = 0", [sonorch]);
    await tx.exec(
      `INSERT INTO keywords (workspace_id, site_id, keyword, market, status, cluster, fit, variant_key)
       VALUES ($1, $2, 'salon no show policy', 'United States', 'targeted', 'Policies', 'offered', ''), ($1, $2, 'esthetician salary', 'United States', 'targeted', 'Hiring', 'offered', ''),
              ($1, $2, 'how to reduce no shows at a salon', 'United States', 'targeted', 'Policies', 'offered', '')
       ON CONFLICT (site_id, keyword, market) DO UPDATE SET status = 'targeted' WHERE keywords.status = 'idea'`,
      [lumoras.id, sonorch],
    );
    await tx.exec("UPDATE keywords SET status = 'targeted' WHERE site_id = $1 AND status = 'idea' AND keyword IN (SELECT keyword FROM keywords WHERE site_id = $1 AND status = 'idea' ORDER BY search_volume DESC NULLS LAST LIMIT 4)", [sonorch]);
    await tx.exec("UPDATE keywords SET cluster = 'Policies' WHERE site_id = $1 AND cluster = '' AND keyword LIKE '%policy%'", [sonorch]);
  });

  const at = (weeksAgo: number) => new Date(now.getTime() - weeksAgo * WEEK);
  const rank = async (ctx: TenantContext, siteId: string, tz: string, weeks: number) => {
    for (let w = weeks - 1; w >= 0; w--) {
      clock = at(w);
      await runRankTracking(deps, ctx, siteId, { windowKey: windowKey("weekly", clock, tz), trigger: "seed" });
    }
    clock = now;
  };
  const audits = async (ctx: TenantContext, siteId: string, tz: string, monthsAgo: number[]) => {
    for (const m of monthsAgo) {
      clock = new Date(now.getTime() - m * 30 * 86_400_000);
      const s = await startSiteAudit(deps, ctx, siteId, { windowKey: windowKey("monthly", clock, tz), trigger: "seed" });
      if (s.status === "waiting") await pollSiteAudit(deps, ctx, { siteId, runId: s.runId });
    }
    clock = now;
  };
  const backlinks = async (ctx: TenantContext, siteId: string, tz: string, quartersAgo: number[]) => {
    for (const q of quartersAgo) {
      clock = new Date(now.getTime() - q * 91 * 86_400_000);
      await runBacklinks(deps, ctx, siteId, { windowKey: windowKey("quarterly", clock, tz), trigger: "seed" });
    }
    clock = now;
  };

  const NY = "America/New_York";
  await rank(ctxL, sonorch, NY, 12);
  await audits(ctxL, sonorch, NY, [31, 0]);
  await backlinks(ctxL, sonorch, NY, [2, 1, 0]);
  // one audit issue is already somebody's task
  await withWorkspace(db, ctxL, async (tx) => {
    await tx.action("task.fix");
    const issue = await tx.maybe<{ id: string }>("SELECT i.id FROM audit_issues i JOIN audits a ON a.id = i.audit_id WHERE i.site_id = $1 AND i.issue_type = 'broken_internal_link' ORDER BY a.started_at DESC LIMIT 1", [sonorch]);
    const editor = await tx.maybe<{ id: string }>("SELECT u.id FROM auth_user u JOIN auth_member m ON m.user_id = u.id WHERE m.organization_id = $1 AND m.role = 'editor' ORDER BY u.email LIMIT 1", [lumoras.id]);
    if (issue && editor) {
      await createFixTask(tx, lumoras.id, issue.id, SEED.actorId);
      await tx.exec("UPDATE audit_issues SET assignee_id = $2 WHERE id = $1", [issue.id, editor.id]);
      await tx.exec("UPDATE tasks SET assignee_id = $2, status = 'in_progress' WHERE id = (SELECT task_id FROM audit_issues WHERE id = $1)", [issue.id, editor.id]);
    }
  });

  const lum = lumoras.sites["lumoras.ai"];
  if (lum) {
    await withWorkspace(db, ctxL, async (tx) => {
      await tx.action("seed.measurement");
      await tx.exec("UPDATE brand_profiles SET competitors = '{voice-desk.example}' WHERE site_id = $1 AND cardinality(competitors) = 0", [lum]);
      // the article the seed published through the app is a published target (the post-publish hook queues it too);
      // lumoras.ai's existing pages' keywords (keyword status "published" in the Phase 3 seed) are tracked as saved keywords
      await tx.exec(
        `INSERT INTO rank_tracking_queue (workspace_id, site_id, item_id, keyword, market)
         SELECT $1, $2, id, primary_keyword, 'United States' FROM content_items WHERE site_id = $2 AND status = 'published' AND primary_keyword IS NOT NULL
         ON CONFLICT (site_id, keyword, market) DO NOTHING`,
        [lumoras.id, lum],
      );
    });
    await rank(ctxL, lum, NY, 6);
    await audits(ctxL, lum, NY, [0]);
    await backlinks(ctxL, lum, NY, [0]);
  }
  const sx = lumoras.sites["seasonx.ai"];
  if (sx) {
    await audits(ctxL, sx, NY, [0]);
    await backlinks(ctxL, sx, NY, [0]);
    // nothing to track yet: the rank check is recorded as skipped (the empty state says why)
    await runRankTracking(deps, ctxL, sx, { windowKey: windowKey("weekly", now, NY), trigger: "seed" });
  }

  // Search Console and GA4 from the local fake Google
  if (google && opts.google) {
    const issue = opts.google.issue;
    const connect = async (ctx: TenantContext, siteId: string, gsc: string, ga4: string) => {
      const t1 = await issue("search_console"), t2 = await issue("ga4");
      await withWorkspace(db, ctx, async (tx) => {
        await tx.action("connection.google_connect");
        await saveGrantWithProperty(tx, opts.keyring!, ctx.workspaceId, siteId, "search_console", t1, gsc, "seed (fake Google)", now);
        await saveGrantWithProperty(tx, opts.keyring!, ctx.workspaceId, siteId, "ga4", t2, ga4, "seed (fake Google)", now);
      });
      // the daily runs for today (so the hourly tick finds them done), then the 16-month backfill
      for (const kind of ["gsc", "ga4", "inspect"] as const) {
        const key = windowKey("daily", now, kind === "gsc" ? "America/Los_Angeles" : NY);
        const run = await withWorkspace(db, ctx, async (tx) => {
          await tx.action("search.claim");
          return claimRun(tx, ctx.workspaceId, siteId, kind, key, "seed", SEED.actorId, now);
        });
        if (!run) continue;
        if (kind === "gsc") {
          let r = await syncSearchConsole(deps, ctx, siteId, { trigger: "seed", runId: run.id });
          for (let i = 0; i < 40 && r.backfillRemaining; i++) r = await syncSearchConsole(deps, ctx, siteId, { trigger: "seed" });
        } else if (kind === "ga4") await syncGa4(deps, ctx, siteId, { trigger: "seed", runId: run.id });
        else await inspectSite(deps, ctx, siteId, { trigger: "seed", runId: run.id, pauseMs: 0 });
      }
    };
    await connect(ctxL, sonorch, "sc-domain:sonorch.ai", "properties/111111111");
    const nw = ws["northwind-dental"];
    if (nw) {
      const ctxN: TenantContext = { ...SEED, workspaceId: nw.id };
      await connect(ctxN, nw.sites["northwind-dental.example"], "sc-domain:northwind-dental.example", "properties/333333333");
    }
  }
}

/** Northwind's domain is fictional: no paid measurement there (set before anything runs). */
export async function pauseFictionalMeasurement(db: pg.Pool, workspaceId: string, siteId: string): Promise<void> {
  await withWorkspace(db, { ...SEED, workspaceId }, async (tx) => {
    await tx.action("site.measurement");
    await tx.exec("UPDATE sites SET rank_cadence = 'off', audit_cadence = 'off', backlinks_cadence = 'off' WHERE id = $1 AND (rank_cadence <> 'off' OR audit_cadence <> 'off' OR backlinks_cadence <> 'off')", [siteId]);
  });
}
