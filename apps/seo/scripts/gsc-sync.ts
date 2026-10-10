/**
 * Runs the Search Console sync for one site now, outside the worker's
 * schedule: the same code, the same idempotency, the same audit trail.
 *
 *   pnpm --filter seo gsc:sync -- --site <site uuid> [--ga4] [--inspect] [--no-backfill]
 *
 * It reads the worker's environment (export apps/seo/.env.local or the server
 * env file first): DATABASE_URL (the app role), ENCRYPTION_KEY(S) (to open the
 * stored refresh token), GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.
 * The site must already be connected to Search Console with a property chosen
 * (Site → Connections → Connect Search Console). On first run it backfills 16
 * months (in chunks; progress is printed) and then prints the last 28 days and
 * the dashboard link. Read-only scopes; never the Indexing API.
 *
 * In production this runs inside the container:
 *   docker exec lumoras-seo-worker node --import tsx scripts/gsc-sync.ts --site <id>
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readKeyring } from "../lib/crypto/secrets.ts";
import { isUuid, withActor, withWorkspace } from "../lib/db/tenant.ts";
import { EnvError, readWorkerEnv } from "../lib/env.ts";
import { googleEndpoints } from "../lib/google/oauth.ts";
import { createLogger, redactUrl } from "../lib/log.ts";
import { gscKpis } from "../lib/measure/dashboard.ts";
import { syncGa4 } from "../lib/measure/ga4-sync.ts";
import { syncSearchConsole } from "../lib/measure/gsc-sync.ts";
import { inspectSite } from "../lib/measure/inspect.ts";
import { claimRun, type MeasureDeps } from "../lib/measure/runs.ts";

const log = createLogger("gsc-sync");

function args(argv: string[]) {
  const a = argv.filter((x) => x !== "--");
  const site = a[a.indexOf("--site") + 1];
  return { site: a.includes("--site") ? site : "", ga4: a.includes("--ga4"), inspect: a.includes("--inspect"), backfill: !a.includes("--no-backfill") };
}

async function main(): Promise<number> {
  const o = args(process.argv.slice(2));
  if (!isUuid(o.site)) {
    log.error("usage: pnpm --filter seo gsc:sync -- --site <site uuid> [--ga4] [--inspect] [--no-backfill]");
    return 2;
  }
  let env;
  try {
    env = readWorkerEnv();
  } catch (e) {
    log.error("invalid environment", { problems: e instanceof EnvError ? e.problems : String(e) });
    return 1;
  }
  if (!env.googleOAuth) {
    log.error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not set: create the OAuth client first (docs/phase-4-summary.md, runbook step 1)");
    return 1;
  }
  const ring = readKeyring();
  const db = new pg.Pool({ connectionString: env.databaseUrl, application_name: "lumoras-seo-gsc-sync", max: 3 });
  db.on("error", () => {});
  try {
    // the one cross-workspace lookup: which workspace owns this site (ids only, worker-only function)
    const sites = await withActor(db, { actorId: "system:worker-cli" }, (tx) => tx.many<{ workspace_id: string; site_id: string; domain: string }>("SELECT workspace_id, site_id, domain FROM job_sites()"), { readOnly: true });
    const s = sites.find((x) => x.site_id === o.site);
    if (!s) {
      log.error("no such site", { site: o.site });
      return 1;
    }
    const ctx = { workspaceId: s.workspace_id, actorId: "system:cli", requestId: randomUUID() };
    const deps: MeasureDeps = {
      db,
      seo: null,
      google: { db, ring, endpoints: googleEndpoints(env.googleApiTestOrigin), client: env.googleOAuth },
      now: () => new Date(),
      log,
      googlePauseMs: env.googlePauseMs,
    };
    log.info("syncing Search Console", { site: s.domain, db: redactUrl(env.databaseUrl) });
    const run = await withWorkspace(db, ctx, async (tx) => {
      await tx.action("search.claim");
      return claimRun(tx, ctx.workspaceId, s.site_id, "gsc", `cli:${randomUUID().slice(0, 13)}`, "cli", ctx.actorId, new Date());
    });
    let r = await syncSearchConsole(deps, ctx, s.site_id, { trigger: "cli", runId: run?.id ?? null });
    if (r.status !== "ok") {
      log.error("not synced", { detail: r.detail });
      return 1;
    }
    log.info("synced", { totalsDays: r.totalDays, detailRows: r.detailRows, requests: r.requests, provisionalFrom: r.firstIncomplete, detail: r.detail });
    while (o.backfill && r.backfillRemaining) {
      r = await syncSearchConsole(deps, ctx, s.site_id, { trigger: "cli" });
      log.info("backfill step", { detail: r.detail, requests: r.requests });
    }
    if (o.ga4) {
      const g = await syncGa4(deps, ctx, s.site_id, { trigger: "cli" });
      log.info("GA4", { status: g.status, detail: g.detail, health: g.health?.state });
    }
    if (o.inspect) {
      const i = await inspectSite(deps, ctx, s.site_id, { trigger: "cli" });
      log.info("URL inspection", { detail: i.detail });
    }
    const k = await withWorkspace(db, ctx, (tx) => gscKpis(tx, s.site_id, new Date()), { readOnly: true });
    const slug = await withWorkspace(db, ctx, (tx) => tx.one<{ slug: string }>("SELECT slug FROM auth_organization WHERE id = $1", [ctx.workspaceId]), { readOnly: true });
    log.info("last 28 days", { clicks: k.clicks, impressions: k.impressions, position: k.position, newestDay: k.newest, dashboard: `${env.baseUrl}/w/${slug.slug}/sites/${s.site_id}` });
    return 0;
  } catch (e) {
    log.error("sync failed", { err: e instanceof Error ? e.message : String(e) });
    return 1;
  } finally {
    await db.end();
  }
}

main().then((c) => {
  process.exitCode = c;
});
