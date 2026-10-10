/**
 * Tenant isolation, proven on a real PostgreSQL with the app role.
 *
 * Two workspaces, A and B, each with a row in EVERY tenant table. As A:
 * B's rows cannot be read, updated, deleted, or written; with no workspace set
 * nothing is visible or writable; settings never leak to the next user of a
 * pooled connection. The tenant-table list is discovered from the catalog
 * (every public table with a workspace_id column, plus workspaces), so a new
 * table without RLS fails this suite.
 *
 * Red/green: run with RLS_TEST_SABOTAGE to break a guard on purpose and watch
 * the suite fail, naming the table and the leaked value:
 *   RLS_TEST_SABOTAGE=bypassrls          the app role gets BYPASSRLS
 *   RLS_TEST_SABOTAGE=policy:<table>     <table>'s policy is replaced by USING (true)
 *   RLS_TEST_SABOTAGE=noforce:<table>    <table> loses RLS entirely (DISABLE)
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withActor, withWorkspace, type Tx } from "../../lib/db/tenant.ts";
import { encryptSecret, readKeyring } from "../../lib/crypto/secrets.ts";
import { createSite, createAuthor } from "../../lib/data/sites.ts";
import { createConnection } from "../../lib/data/connections.ts";
import { finishCrawlRun, startCrawlRun } from "../../lib/data/crawl.ts";
import { notify, platformWorkspaces, platformAudit } from "../../lib/data/workspaces.ts";
import { addSeeds, saveKeywords, setBudget } from "../../lib/data/research.ts";
import { meteredCall } from "../../lib/metering/metered.ts";
import { FakeProvider } from "../../lib/providers/fake.ts";
import { addComment, addReview, createPlanned, createRun, saveVersion } from "../../lib/data/content.ts";
import { createTestDatabase, dropAll, skipReason, adminQuery, type TestDb } from "../helpers/db.ts";

/** Every tenant table and the column that holds its workspace. */
const EXPECTED_TENANT_TABLES: Record<string, string> = {
  workspaces: "id",
  sites: "workspace_id",
  brand_profiles: "workspace_id",
  authors: "workspace_id",
  site_routes: "workspace_id",
  crawl_runs: "workspace_id",
  connections: "workspace_id",
  notifications: "workspace_id",
  audit_log: "workspace_id",
  // Phase 2
  budgets: "workspace_id",
  usage_ledger: "workspace_id",
  research_log: "workspace_id",
  provider_cache: "workspace_id",
  seed_backlog: "workspace_id",
  keywords: "workspace_id",
  // Phase 3
  content_items: "workspace_id",
  content_versions: "workspace_id",
  content_comments: "workspace_id",
  content_reviews: "workspace_id",
  pipeline_runs: "workspace_id",
  pipeline_steps: "workspace_id",
  publications: "workspace_id",
  rank_tracking_queue: "workspace_id",
  link_checks: "workspace_id",
  // Phase 4
  measurement_runs: "workspace_id",
  rank_trackers: "workspace_id",
  rank_snapshots: "workspace_id",
  search_sync_state: "workspace_id",
  gsc_daily: "workspace_id",
  gsc_page_daily: "workspace_id",
  gsc_query_daily: "workspace_id",
  ga4_daily: "workspace_id",
  ga4_landing_daily: "workspace_id",
  ga4_event_daily: "workspace_id",
  url_inspections: "workspace_id",
  audits: "workspace_id",
  audit_issues: "workspace_id",
  tasks: "workspace_id",
  backlink_snapshots: "workspace_id",
};

/** Tables the app role may not UPDATE or DELETE at all (append-only): a write attempt must be refused outright. */
const NO_UPDATE = new Set(["audit_log", "research_log", "content_versions", "content_reviews"]);
const NO_DELETE = new Set(["audit_log", "research_log", "usage_ledger", "content_versions", "content_reviews"]);

const RING = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });

type Seeded = { ws: string; user: string; site: string; item: string; run: string };

describe("row-level security isolates workspaces", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let A: Seeded, B: Seeded;

  async function seedWorkspace(slug: string): Promise<Seeded> {
    // Better Auth's tables are not tenant tables: the app role writes them directly
    const [u] = (await pool.query<{ id: string }>("INSERT INTO auth_user (name, email) VALUES ($1, $2) RETURNING id", [slug, `${slug}@example.test`])).rows;
    const c = await pool.connect();
    let ws: string;
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.actor_id', $1, true)", [u.id]);
      ws = (await c.query<{ id: string }>("INSERT INTO auth_organization (name, slug) VALUES ($1, $2) RETURNING id", [slug, slug])).rows[0].id;
      await c.query("INSERT INTO auth_member (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [ws, u.id]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    const site = await withWorkspace(pool, { workspaceId: ws, actorId: u.id }, async (tx) => {
      const s = await createSite(tx, ws, { domain: `${slug}.example`, name: slug, industry: "", locale: "en-US", country: "US", serpLocation: "United States", timezone: "UTC" });
      await createAuthor(tx, ws, s.id, { name: `${slug} author`, role: "Editor", bio: "", avatarUrl: null });
      await createConnection(tx, RING, ws, s.id, { kind: "webhook", label: "Hook", endpoint: `https://${slug}.example/hook`, secret: "s".repeat(24) });
      const run = await startCrawlRun(tx, ws, s.id);
      await finishCrawlRun(tx, ws, s.id, run.id, {
        status: "ok",
        sitemaps: [`https://${slug}.example/sitemap.xml`],
        routes: [{ url: `https://${slug}.example/secret-${slug}`, path: `/secret-${slug}`, lastmod: null, source: "test" }],
        pages: [{ url: `https://${slug}.example/`, path: "/", title: `${slug} home`, description: `${slug} private description`, siteName: null, h1: null }],
        problems: [],
        truncated: false,
      });
      await notify(tx, ws, [u.id], { kind: "test", title: `${slug} note` });
      await setBudget(tx, ws, "seo_credits", 5_000_000, 500_000);
      await addSeeds(tx, ws, s.id, [`${slug} private seed`], 1, u.id);
      return s;
    });
    // research through the one metered path: research_log, usage_ledger and provider_cache rows
    const r = await meteredCall(
      { db: pool, provider: new FakeProvider() },
      { workspaceId: ws, actorId: u.id, siteId: site.id },
      { op: "keywordIdeas", params: { seed: `${slug} secret research`, market: { locationCode: 2840, languageCode: "en", label: "United States" }, limit: 150 } },
    );
    await withWorkspace(pool, { workspaceId: ws, actorId: u.id }, (tx) =>
      saveKeywords(tx, ws, site.id, [{ ...r.data[0], keyword: `${slug} private keyword`, market: "United States", fit: "unknown", variantKey: "", cluster: "", sourceLogId: r.logId, metricsAt: new Date() }]),
    );
    // Phase 3: an article with a version, a comment and a review, a run with its steps, a publication, a rank-tracking entry, a link check
    const content = await withWorkspace(pool, { workspaceId: ws, actorId: u.id }, async (tx) => {
      const item = (await createPlanned(tx, ws, site.id, new Date("2030-01-01T09:00:00Z"), null, u.id))!;
      await tx.exec("UPDATE content_items SET primary_keyword = $2, title = $3, slug = $4, status = 'awaiting_review' WHERE id = $1", [item, `${slug} secret keyword`, `${slug} secret title`, `${slug}-secret`]);
      await saveVersion(tx, ws, item, { title: `${slug} secret title`, description: "", bodyMd: `${slug} private body text`, cover: {} }, "draft", u.id);
      await addComment(tx, ws, item, u.id, `${slug} private comment`, 1);
      await addReview(tx, ws, item, 1, "changes_requested", `${slug} private review note`, u.id, "owner");
      const run = await createRun(tx, ws, site.id, item, "manual", u.id);
      await tx.exec("INSERT INTO publications (workspace_id, site_id, item_id, publisher, mode, status, path) VALUES ($1, $2, $3, 'github', 'pr', 'open', $4)", [ws, site.id, item, `content/${slug}-secret.md`]);
      await tx.exec("INSERT INTO rank_tracking_queue (workspace_id, site_id, item_id, keyword) VALUES ($1, $2, $3, $4)", [ws, site.id, item, `${slug} secret keyword`]);
      await tx.exec("INSERT INTO link_checks (workspace_id, site_id, url, status_code, ok) VALUES ($1, $2, $3, 200, true)", [ws, site.id, `https://${slug}.example/private-source`]);
      // Phase 4: a measurement run with a tracker and a snapshot, Search Console and GA4 rows, an inspection, an audit with an issue and a task, a backlinks snapshot
      const mrun = (await tx.one<{ id: string }>("INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, created_by, status) VALUES ($1, $2, 'rank', 'w:2026-W41', $3, 'succeeded') RETURNING id", [ws, site.id, u.id])).id;
      const tracker = (await tx.one<{ id: string }>("INSERT INTO rank_trackers (workspace_id, site_id, provider, provider_tracker_id, market, location_code, language_code) VALUES ($1, $2, 'fake', $3, 'United States', 2840, 'en') RETURNING id", [ws, site.id, `${slug}-tracker`])).id;
      await tx.exec("INSERT INTO rank_snapshots (workspace_id, site_id, tracker_id, run_id, keyword, source, position, device, location, captured_at) VALUES ($1, $2, $3, $4, $5, 'saved', 4, 'desktop', 'United States', now())", [ws, site.id, tracker, mrun, `${slug} secret ranking`]);
      await tx.exec("INSERT INTO search_sync_state (workspace_id, site_id, kind, property) VALUES ($1, $2, 'search_console', $3)", [ws, site.id, `sc-domain:${slug}.example`]);
      await tx.exec("INSERT INTO gsc_daily (workspace_id, site_id, day, clicks, impressions, ctr, position, final) VALUES ($1, $2, '2026-10-01', 7, 100, 0.07, 5.5, true)", [ws, site.id]);
      await tx.exec("INSERT INTO gsc_page_daily (workspace_id, site_id, day, page, clicks, impressions, position) VALUES ($1, $2, '2026-10-01', $3, 7, 100, 5.5)", [ws, site.id, `https://${slug}.example/secret-page`]);
      await tx.exec("INSERT INTO gsc_query_daily (workspace_id, site_id, day, query, page, clicks, impressions, position) VALUES ($1, $2, '2026-10-01', $3, $4, 7, 100, 5.5)", [ws, site.id, `${slug} secret query`, `https://${slug}.example/secret-page`]);
      await tx.exec("INSERT INTO ga4_daily (workspace_id, site_id, day, sessions, key_events, organic_sessions, organic_key_events, final) VALUES ($1, $2, '2026-10-01', 50, 2, 30, 1, true)", [ws, site.id]);
      await tx.exec("INSERT INTO ga4_landing_daily (workspace_id, site_id, day, landing_page, sessions, key_events) VALUES ($1, $2, '2026-10-01', $3, 30, 1)", [ws, site.id, `/${slug}-secret-landing`]);
      await tx.exec("INSERT INTO ga4_event_daily (workspace_id, site_id, day, event_name, key_events) VALUES ($1, $2, '2026-10-01', $3, 1)", [ws, site.id, `${slug}_secret_event`]);
      await tx.exec("INSERT INTO url_inspections (workspace_id, site_id, url, verdict) VALUES ($1, $2, $3, 'PASS')", [ws, site.id, `https://${slug}.example/secret-page`]);
      const arun = (await tx.one<{ id: string }>("INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, created_by, status) VALUES ($1, $2, 'audit', 'm:2026-10', $3, 'succeeded') RETURNING id", [ws, site.id, u.id])).id;
      const audit = (await tx.one<{ id: string }>("INSERT INTO audits (workspace_id, site_id, run_id, provider, provider_audit_id, max_pages, status) VALUES ($1, $2, $3, 'fake', 'a1', 50, 'done') RETURNING id", [ws, site.id, arun])).id;
      const task = (await tx.one<{ id: string }>("INSERT INTO tasks (workspace_id, site_id, title, source, issue_type, created_by) VALUES ($1, $2, $3, 'audit', 'title_too_long', $4) RETURNING id", [ws, site.id, `${slug} secret task`, u.id])).id;
      await tx.exec("INSERT INTO audit_issues (workspace_id, site_id, audit_id, issue_type, severity, count, title, task_id) VALUES ($1, $2, $3, 'title_too_long', 'warning', 3, $4, $5)", [ws, site.id, audit, `${slug} secret issue`, task]);
      const brun = (await tx.one<{ id: string }>("INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, created_by, status) VALUES ($1, $2, 'backlinks', 'q:2026-Q4', $3, 'succeeded') RETURNING id", [ws, site.id, u.id])).id;
      await tx.exec("INSERT INTO backlink_snapshots (workspace_id, site_id, run_id, domain, is_competitor, backlinks, referring_domains, referring_sample, captured_at) VALUES ($1, $2, $3, $4, false, 10, 3, $5, now())", [ws, site.id, brun, `${slug}.example`, [`${slug}-secret-ref.example`]]);
      return { item, run };
    });
    return { ws, user: u.id, site: site.id, ...content };
  }

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    // dropping the test database terminates idle connections: that is expected, not a crash
    pool.on("error", () => {});
    A = await seedWorkspace("alpha");
    B = await seedWorkspace("bravo");

    const sabotage = process.env.RLS_TEST_SABOTAGE;
    if (sabotage === "bypassrls") await adminQuery(`ALTER ROLE ${db.app} BYPASSRLS`);
    else if (sabotage?.startsWith("policy:")) {
      const t = sabotage.slice(7);
      await adminQuery(`DROP POLICY ${t}_tenant_isolation ON ${t}; CREATE POLICY sabotage ON ${t} USING (true) WITH CHECK (true)`, [], db.name);
    } else if (sabotage?.startsWith("noforce:")) {
      await adminQuery(`ALTER TABLE ${sabotage.slice(8)} DISABLE ROW LEVEL SECURITY`, [], db.name);
    }
    if (sabotage) console.log(`# RLS_TEST_SABOTAGE=${sabotage} applied: this run is expected to FAIL`);
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  const asA = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(pool, { workspaceId: A.ws, actorId: A.user }, fn);

  it("the app role is not a superuser, cannot bypass RLS and owns no table", async () => {
    const [r] = (await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows;
    assert.equal(r.rolsuper, false, "app role is a superuser");
    assert.equal(r.rolbypassrls, false, "app role has BYPASSRLS");
    const owned = (await pool.query("SELECT relname FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)")).rows;
    assert.deepEqual(owned, [], "app role owns tables");
  });

  it("every tenant table has row-level security enabled AND forced, with a workspace policy", async () => {
    const rows = (
      await pool.query<{ table: string; rls: boolean; forced: boolean; policies: string[] }>(
        `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                coalesce(array_agg(p.qual) FILTER (WHERE p.policyname IS NOT NULL), '{}') AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND (c.relname = 'workspaces' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped))
         GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity ORDER BY c.relname`,
      )
    ).rows;
    assert.deepEqual(rows.map((r) => r.table).sort(), Object.keys(EXPECTED_TENANT_TABLES).sort(), "tenant tables changed: update EXPECTED_TENANT_TABLES and seed a row in each");
    for (const r of rows) {
      assert.ok(r.rls, `${r.table}: row-level security is not enabled`);
      assert.ok(r.forced, `${r.table}: row-level security is not forced`);
      assert.ok(r.policies.some((q) => q?.includes("app.workspace_id")), `${r.table}: no policy keyed by app.workspace_id`);
    }
  });

  for (const [table, col] of Object.entries(EXPECTED_TENANT_TABLES)) {
    it(`${table}: workspace A cannot read, update or delete workspace B's rows`, async () => {
      const owners = await adminQuery<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${col} = $1`, [B.ws], db.name);
      assert.ok(Number(owners[0].n) > 0, `seed: ${table} has no row for workspace B, so this check proves nothing`);

      await asA(async (tx) => {
        const leaked = await tx.many<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${col} = $1`, [B.ws]);
        assert.equal(leaked.length, 0, `${table}: workspace A read ${leaked.length} row(s) of workspace B (${col} = ${B.ws}): ${JSON.stringify(leaked[0])?.slice(0, 200)}`);
        const all = await tx.many<{ w: string }>(`SELECT ${col}::text AS w FROM ${table}`);
        const foreign = all.filter((r) => r.w !== A.ws);
        assert.equal(foreign.length, 0, `${table}: an unfiltered SELECT as A returned ${foreign.length} row(s) of other workspaces (${foreign[0]?.w})`);
      });
      if (NO_UPDATE.has(table)) {
        await assert.rejects(asA((tx) => tx.exec(`UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1`, [B.ws])), /permission denied/, `${table}: the app role may update rows`);
      } else {
        const updated = await asA((tx) => tx.exec(`UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1`, [B.ws]));
        assert.equal(updated, 0, `${table}: workspace A updated ${updated} row(s) of workspace B (${col} = ${B.ws})`);
      }
      if (NO_DELETE.has(table)) {
        await assert.rejects(asA((tx) => tx.exec(`DELETE FROM ${table} WHERE ${col} = $1`, [B.ws])), /permission denied/, `${table}: the app role may delete rows`);
      } else {
        const deleted = await asA((tx) => tx.exec(`DELETE FROM ${table} WHERE ${col} = $1`, [B.ws]));
        assert.equal(deleted, 0, `${table}: workspace A deleted ${deleted} row(s) of workspace B (${col} = ${B.ws})`);
      }
      const still = await adminQuery<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${col} = $1`, [B.ws], db.name);
      assert.equal(still[0].n, owners[0].n, `${table}: workspace B's row count changed after A's attempts`);
    });
  }

  it("workspace A cannot write a row into workspace B", async () => {
    const attempts: [string, string, unknown[]][] = [
      ["sites", "INSERT INTO sites (workspace_id, domain, name) VALUES ($1, 'planted.example', 'x')", [B.ws]],
      ["authors", "INSERT INTO authors (workspace_id, site_id, name) VALUES ($1, $2, 'planted')", [B.ws, B.site]],
      ["site_routes", "INSERT INTO site_routes (workspace_id, site_id, url, path) VALUES ($1, $2, 'https://bravo.example/x', '/x')", [B.ws, B.site]],
      ["connections", "INSERT INTO connections (workspace_id, site_id, kind, label) VALUES ($1, $2, 'git', 'planted')", [B.ws, B.site]],
      ["notifications", "INSERT INTO notifications (workspace_id, user_id, kind, title) VALUES ($1, $2, 'x', 'planted')", [B.ws, B.user]],
      ["crawl_runs", "INSERT INTO crawl_runs (workspace_id, site_id) VALUES ($1, $2)", [B.ws, B.site]],
      ["budgets", "INSERT INTO budgets (workspace_id, category, monthly_ceiling) VALUES ($1, 'llm_tokens', 1)", [B.ws]],
      ["usage_ledger", "INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, actor_id) VALUES ($1, $2, 'seo_credits', 'x', 'fake', '2026-10-01', 'settled', 'system:test')", [B.ws, B.site]],
      ["research_log", "INSERT INTO research_log (workspace_id, site_id, operation, provider, subject, params, params_hash, status, actor_id) VALUES ($1, $2, 'serp', 'fake', 'x', '{}', repeat('a', 64), 'ok', 'system:test')", [B.ws, B.site]],
      ["provider_cache", "INSERT INTO provider_cache (workspace_id, cache_key, operation, provider, params, result, expires_at) VALUES ($1, repeat('b', 64), 'serp', 'fake', '{}', '[]', now() + interval '1 day')", [B.ws]],
      ["seed_backlog", "INSERT INTO seed_backlog (workspace_id, site_id, seed, added_by) VALUES ($1, $2, 'planted', 'system:test')", [B.ws, B.site]],
      ["keywords", "INSERT INTO keywords (workspace_id, site_id, keyword) VALUES ($1, $2, 'planted')", [B.ws, B.site]],
      ["content_items", "INSERT INTO content_items (workspace_id, site_id, slot_at, created_by) VALUES ($1, $2, now() + interval '9 days', 'system:test')", [B.ws, B.site]],
      ["content_versions", "INSERT INTO content_versions (workspace_id, item_id, version, source, actor_id) VALUES ($1, $2, 99, 'editor', 'system:test')", [B.ws, B.item]],
      ["content_comments", "INSERT INTO content_comments (workspace_id, item_id, user_id, body) VALUES ($1, $2, $3, 'planted')", [B.ws, B.item, B.user]],
      ["content_reviews", "INSERT INTO content_reviews (workspace_id, item_id, version, decision, reviewer_id) VALUES ($1, $2, 1, 'approved', 'system:test')", [B.ws, B.item]],
      ["pipeline_runs", "INSERT INTO pipeline_runs (workspace_id, site_id, item_id, trigger, created_by) VALUES ($1, $2, $3, 'manual', 'system:test')", [B.ws, B.site, B.item]],
      ["pipeline_steps", "INSERT INTO pipeline_steps (workspace_id, run_id, step, position) VALUES ($1, gen_random_uuid(), 'context', 1)", [B.ws]],
      ["publications", "INSERT INTO publications (workspace_id, site_id, item_id, publisher, mode) VALUES ($1, $2, $3, 'webhook', 'webhook')", [B.ws, B.site, B.item]],
      ["rank_tracking_queue", "INSERT INTO rank_tracking_queue (workspace_id, site_id, keyword) VALUES ($1, $2, 'planted')", [B.ws, B.site]],
      ["link_checks", "INSERT INTO link_checks (workspace_id, site_id, url, ok) VALUES ($1, $2, 'https://planted.example/', true)", [B.ws, B.site]],
      ["measurement_runs", "INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, created_by) VALUES ($1, $2, 'rank', 'planted', 'system:test')", [B.ws, B.site]],
      ["rank_trackers", "INSERT INTO rank_trackers (workspace_id, site_id, provider, provider_tracker_id, market, location_code, language_code, device) VALUES ($1, $2, 'fake', 'planted', 'Planted', 2840, 'en', 'mobile')", [B.ws, B.site]],
      ["rank_snapshots", "INSERT INTO rank_snapshots (workspace_id, site_id, tracker_id, run_id, keyword, source, device, location, captured_at) VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), 'planted', 'saved', 'desktop', 'x', now())", [B.ws, B.site]],
      ["search_sync_state", "INSERT INTO search_sync_state (workspace_id, site_id, kind, property) VALUES ($1, $2, 'ga4', 'properties/1')", [B.ws, B.site]],
      ["gsc_daily", "INSERT INTO gsc_daily (workspace_id, site_id, day, clicks, impressions, ctr, position, final) VALUES ($1, $2, '2026-09-01', 1, 1, 1, 1, true)", [B.ws, B.site]],
      ["gsc_page_daily", "INSERT INTO gsc_page_daily (workspace_id, site_id, day, page, clicks, impressions, position) VALUES ($1, $2, '2026-09-01', 'planted', 1, 1, 1)", [B.ws, B.site]],
      ["gsc_query_daily", "INSERT INTO gsc_query_daily (workspace_id, site_id, day, query, page, clicks, impressions, position) VALUES ($1, $2, '2026-09-01', 'planted', 'planted', 1, 1, 1)", [B.ws, B.site]],
      ["ga4_daily", "INSERT INTO ga4_daily (workspace_id, site_id, day, sessions, key_events, organic_sessions, organic_key_events, final) VALUES ($1, $2, '2026-09-01', 1, 0, 1, 0, true)", [B.ws, B.site]],
      ["ga4_landing_daily", "INSERT INTO ga4_landing_daily (workspace_id, site_id, day, landing_page, sessions, key_events) VALUES ($1, $2, '2026-09-01', '/planted', 1, 0)", [B.ws, B.site]],
      ["ga4_event_daily", "INSERT INTO ga4_event_daily (workspace_id, site_id, day, event_name, key_events) VALUES ($1, $2, '2026-09-01', 'planted', 1)", [B.ws, B.site]],
      ["url_inspections", "INSERT INTO url_inspections (workspace_id, site_id, url, verdict) VALUES ($1, $2, 'https://planted.example/', 'PASS')", [B.ws, B.site]],
      ["audits", "INSERT INTO audits (workspace_id, site_id, run_id, provider, provider_audit_id, max_pages) VALUES ($1, $2, gen_random_uuid(), 'fake', 'planted', 10)", [B.ws, B.site]],
      ["audit_issues", "INSERT INTO audit_issues (workspace_id, site_id, audit_id, issue_type, severity, count, title) VALUES ($1, $2, gen_random_uuid(), 'planted', 'info', 1, 'planted')", [B.ws, B.site]],
      ["tasks", "INSERT INTO tasks (workspace_id, site_id, title, created_by) VALUES ($1, $2, 'planted', 'system:test')", [B.ws, B.site]],
      ["backlink_snapshots", "INSERT INTO backlink_snapshots (workspace_id, site_id, run_id, domain, is_competitor, captured_at) VALUES ($1, $2, gen_random_uuid(), 'planted.example', true, now())", [B.ws, B.site]],
    ];
    for (const [table, sql, params] of attempts) {
      await assert.rejects(asA((tx) => tx.exec(sql, params)), /row-level security|violates/, `${table}: workspace A inserted a row with workspace_id ${B.ws}`);
    }
    // moving one of A's rows into B is refused too
    await assert.rejects(asA((tx) => tx.exec("UPDATE sites SET workspace_id = $1 WHERE id = $2", [B.ws, A.site])), /row-level security|violates/, "sites: A moved its site into B");
  });

  it("workspace A cannot attach a row to workspace B's site (composite foreign key)", async () => {
    await assert.rejects(
      asA((tx) => tx.exec("INSERT INTO authors (workspace_id, site_id, name) VALUES ($1, $2, 'cross')", [A.ws, B.site])),
      /foreign key/,
      `authors: A attached an author to B's site ${B.site}`,
    );
  });

  it("with no workspace set, every tenant table is empty and unwritable", async () => {
    await withActor(pool, { actorId: A.user }, async (tx) => {
      for (const table of Object.keys(EXPECTED_TENANT_TABLES)) {
        const [{ n }] = await tx.many<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        assert.equal(n, 0, `${table}: ${n} row(s) visible with no workspace set`);
      }
    });
    await assert.rejects(
      withActor(pool, { actorId: A.user }, (tx) => tx.exec("INSERT INTO sites (workspace_id, domain, name) VALUES ($1, 'nows.example', 'x')", [A.ws])),
      /row-level security/,
    );
    // a bare query outside any transaction
    for (const table of Object.keys(EXPECTED_TENANT_TABLES)) {
      const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      assert.equal(rows[0].n, 0, `${table}: ${rows[0].n} row(s) visible to a bare query`);
    }
  });

  it("the workspace setting is transaction-local: it never leaks to the next user of a pooled connection", async () => {
    const one = new pg.Pool({ connectionString: db.appUrl, max: 1 });
    try {
      await withWorkspace(one, { workspaceId: A.ws, actorId: A.user }, (tx) => tx.many("SELECT 1 FROM sites"));
      const { rows } = await one.query<{ ws: string | null; n: number }>(
        "SELECT nullif(current_setting('app.workspace_id', true), '') AS ws, (SELECT count(*)::int FROM sites) AS n",
      );
      assert.deepEqual(rows[0], { ws: null, n: 0 });
      // and a failed transaction does not leave it behind either
      await assert.rejects(withWorkspace(one, { workspaceId: A.ws, actorId: A.user }, async (tx) => tx.exec("SELECT 1/0")));
      const again = await one.query<{ n: number }>("SELECT count(*)::int AS n FROM sites");
      assert.equal(again.rows[0].n, 0);
    } finally {
      await one.end();
    }
  });

  it("the audit log is append-only for the app and scoped to the workspace", async () => {
    await asA(async (tx) => {
      const rows = await tx.many<{ workspace_id: string; after: unknown }>("SELECT workspace_id, after FROM audit_log");
      assert.ok(rows.length > 0, "A sees its own audit trail");
      assert.ok(rows.every((r) => r.workspace_id === A.ws));
      assert.ok(!JSON.stringify(rows).includes("bravo private description"), "B's data appears in A's audit view");
    });
    for (const sql of ["INSERT INTO audit_log (action, entity_type) VALUES ('forged', 'x')", "UPDATE audit_log SET action = 'x'", "DELETE FROM audit_log"]) {
      await assert.rejects(asA((tx) => tx.exec(sql)), /permission denied/, `the app role could run: ${sql}`);
    }
  });

  it("article versions and review decisions are append-only for the app; article text is fingerprinted in the audit log", async () => {
    for (const sql of ["UPDATE content_versions SET note = 'rewritten history'", "DELETE FROM content_versions", "UPDATE content_reviews SET decision = 'approved'", "DELETE FROM content_reviews"]) {
      await assert.rejects(asA((tx) => tx.exec(sql)), /permission denied/, `the app role could run: ${sql}`);
    }
    const rows = await adminQuery<{ entity_type: string; after: Record<string, unknown> }>(
      "SELECT entity_type, after FROM audit_log WHERE entity_type IN ('content_items', 'content_versions') AND after IS NOT NULL AND after->>'body_md' IS NOT NULL",
      [],
      db.name,
    );
    assert.ok(rows.length >= 2);
    for (const r of rows) assert.ok(!JSON.stringify(r.after).includes("private body text"), `${r.entity_type}: article text copied into the audit log`);
  });

  it("the worker's cross-workspace site list is refused to everyone but the worker; a feed token reveals one enabled site only", async () => {
    await assert.rejects(withActor(pool, { actorId: A.user }, (tx) => tx.many("SELECT * FROM job_sites()")), /only the worker/);
    const all = await withActor(pool, { actorId: "system:worker" }, (tx) => tx.many<{ workspace_id: string }>("SELECT * FROM job_sites()"));
    assert.deepEqual(new Set(all.map((r) => r.workspace_id)), new Set([A.ws, B.ws]));
    const [tok] = await adminQuery<{ t: string }>("SELECT feed_token AS t FROM sites WHERE id = $1", [B.site], db.name);
    const off = await withActor(pool, { actorId: "system:feed" }, (tx) => tx.many("SELECT * FROM feed_site($1)", [tok.t]));
    assert.equal(off.length, 0, "a disabled feed answered");
    const asB = <T>(fn: (tx: Tx) => Promise<T>) => withWorkspace(pool, { workspaceId: B.ws, actorId: B.user }, fn);
    await asB((tx) => tx.exec("UPDATE sites SET feed_enabled = true WHERE id = $1", [B.site]));
    const on = await withActor(pool, { actorId: "system:feed" }, (tx) => tx.many<{ site_id: string }>("SELECT * FROM feed_site($1)", [tok.t]));
    assert.deepEqual(on.map((r) => r.site_id), [B.site]);
    assert.equal((await withActor(pool, { actorId: "system:feed" }, (tx) => tx.many("SELECT * FROM feed_site($1)", ["0".repeat(64)]))).length, 0);
    await asB((tx) => tx.exec("UPDATE sites SET feed_enabled = false WHERE id = $1", [B.site]));
  });

  it("research results are fingerprinted in the audit log, not copied (research_log and provider_cache)", async () => {
    const rows = await adminQuery<{ entity_type: string; after: Record<string, unknown> }>(
      "SELECT entity_type, after FROM audit_log WHERE entity_type IN ('research_log', 'provider_cache') AND after IS NOT NULL",
      [],
      db.name,
    );
    assert.ok(rows.length >= 4);
    for (const r of rows) assert.match(String(r.after.result), /^\[redacted [0-9a-f]{8}\]$/, `${r.entity_type}: result copied into the audit log`);
  });

  it("connection secrets are never in the audit log, not even as ciphertext", async () => {
    const rows = await adminQuery<{ after: Record<string, unknown> }>("SELECT after FROM audit_log WHERE entity_type = 'connections' AND after IS NOT NULL", [], db.name);
    assert.ok(rows.length >= 2);
    const [ct] = await adminQuery<{ c: string }>("SELECT credentials_ciphertext AS c FROM connections LIMIT 1", [], db.name);
    for (const r of rows) {
      assert.match(String(r.after.credentials_ciphertext), /^\[redacted [0-9a-f]{8}\]$/);
      assert.ok(!JSON.stringify(r).includes(ct.c));
    }
    assert.ok(encryptSecret("x", "y", RING).ciphertext.startsWith("v1."));
  });

  it("bulk sync tables are audited per statement (row count and day range), and a backlinks sample is fingerprinted", async () => {
    const rows = await adminQuery<{ entity_type: string; details: Record<string, unknown> }>(
      "SELECT entity_type, details FROM audit_log WHERE entity_type IN ('gsc_daily', 'gsc_query_daily', 'ga4_landing_daily', 'rank_snapshots') AND workspace_id = $1",
      [A.ws],
      db.name,
    );
    assert.deepEqual([...new Set(rows.map((r) => r.entity_type))].sort(), ["ga4_landing_daily", "gsc_daily", "gsc_query_daily", "rank_snapshots"]);
    for (const r of rows) assert.equal(r.details.rows, 1);
    assert.ok(!JSON.stringify(rows).includes("secret query"), "a search query was copied into the audit log");
    const [b] = await adminQuery<{ after: Record<string, unknown> }>("SELECT after FROM audit_log WHERE entity_type = 'backlink_snapshots' AND workspace_id = $1", [A.ws], db.name);
    assert.match(String(b.after.referring_sample), /^\[redacted [0-9a-f]{8}\]$/);
  });

  it("tenant writes without an actor are refused (every write says who)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.workspace_id', $1, true)", [A.ws]);
      await assert.rejects(c.query("UPDATE sites SET name = 'anonymous'"), /no actor/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("the platform path refuses non-admins and impersonators, and audits every admin read", async () => {
    await assert.rejects(withActor(pool, { actorId: A.user }, (tx) => platformWorkspaces(tx)), /not a platform admin/);
    const [admin] = (await pool.query<{ id: string }>("INSERT INTO auth_user (name, email, role) VALUES ('Staff', 'staff@lumoras.test', 'admin') RETURNING id")).rows;
    await assert.rejects(withActor(pool, { actorId: A.user, impersonatorId: admin.id }, (tx) => platformWorkspaces(tx)), /not a platform admin/);
    const list = await withActor(pool, { actorId: admin.id }, (tx) => platformWorkspaces(tx));
    assert.deepEqual(list.map((w) => w.slug).sort(), ["alpha", "bravo"]);
    assert.equal(list.find((w) => w.slug === "bravo")?.sites, 1);
    const trail = await withActor(pool, { actorId: admin.id }, (tx) => platformAudit(tx, { limit: 5 }));
    assert.equal(trail[0].action, "platform.audit.read");
    assert.equal(trail[1].action, "platform.workspaces.read");
    assert.equal(trail[1].actor_email, "staff@lumoras.test");
    // the functions return aggregates and the trail, never connection secrets
    assert.ok(!JSON.stringify(list).includes("credentials"));
  });
});
