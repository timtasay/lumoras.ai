/**
 * The demo seed and the data layer on a real database: the seed is idempotent
 * and writes through the audited tenant path; each demo workspace sees only its
 * own sites; a crawl result is stored (routes upserted, one audit summary row,
 * brand pre-filled only where empty); connection secrets rotate to a new key.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { readKeyring } from "../../lib/crypto/secrets.ts";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { listSites, getBrand } from "../../lib/data/sites.ts";
import { finishCrawlRun, startCrawlRun, CrawlBusyError } from "../../lib/data/crawl.ts";
import { listConnections, readConnectionSecret, rotateConnectionKeys } from "../../lib/data/connections.ts";
import { seed, SEED_USERS } from "../../lib/seed.ts";
import { createTestDatabase, dropAll, skipReason, adminQuery, type TestDb } from "../helpers/db.ts";
import { assertScreensAgree } from "../helpers/consistency.ts";
import { LUMORAS_GIT } from "../../lib/publishers/lumoras.ts";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");

describe("seed and data layer (PostgreSQL)", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let ids: Awaited<ReturnType<typeof seed>>;

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 3 });
    ids = await seed(pool, { keyring: readKeyring({ ENCRYPTION_KEY: K1 }) });
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  it("is idempotent: a second run adds nothing and changes nothing", async () => {
    const count = async () =>
      (await adminQuery<{ t: string; n: string }>(
        "SELECT 'users' t, count(*) n FROM auth_user UNION ALL SELECT 'sites', count(*) FROM sites UNION ALL SELECT 'authors', count(*) FROM authors UNION ALL SELECT 'audit', count(*) FROM audit_log UNION ALL SELECT 'members', count(*) FROM auth_member",
        [],
        db.name,
      )).map((r) => `${r.t}=${r.n}`);
    const before = await count();
    await seed(pool, { keyring: readKeyring({ ENCRYPTION_KEY: K1 }) });
    assert.deepEqual(await count(), before);
    assert.ok(before.includes(`users=${SEED_USERS.length}`));
  });

  it("each demo workspace sees only its own sites; every seeded member role exists", async () => {
    const lumoras = await withWorkspace(pool, { workspaceId: ids.workspaces.lumoras.id, actorId: "system:test" }, (tx) => listSites(tx));
    const northwind = await withWorkspace(pool, { workspaceId: ids.workspaces["northwind-dental"].id, actorId: "system:test" }, (tx) => listSites(tx));
    assert.deepEqual(lumoras.map((s) => s.domain).sort(), ["lumoras.ai", "seasonx.ai", "sonorch.ai"]);
    assert.deepEqual(northwind.map((s) => s.domain), ["northwind-dental.example"]);
    const roles = await adminQuery<{ slug: string; roles: string[] }>(
      "SELECT o.slug, array_agg(m.role ORDER BY m.role) AS roles FROM auth_member m JOIN auth_organization o ON o.id = m.organization_id GROUP BY o.slug ORDER BY o.slug",
      [],
      db.name,
    );
    assert.deepEqual(roles, [
      { slug: "lumoras", roles: ["editor", "owner", "reviewer", "viewer"] },
      { slug: "northwind-dental", roles: ["editor", "owner", "reviewer", "viewer"] },
    ]);
    // lumoras.ai is signed by its organization (owner decision, 10 October 2026); every other seeded author is a flagged demo person
    const real = await adminQuery<{ domain: string; kind: string; name: string; role: string }>("SELECT s.domain, a.kind, a.name, a.role FROM authors a JOIN sites s ON s.id = a.site_id WHERE NOT a.is_demo", [], db.name);
    assert.deepEqual(real, [{ domain: "lumoras.ai", kind: "organization", name: "Lumoras team", role: "" }]);
    const demo = await adminQuery<{ domain: string; kind: string }>("SELECT s.domain, a.kind FROM authors a JOIN sites s ON s.id = a.site_id WHERE a.is_demo ORDER BY s.domain", [], db.name);
    assert.deepEqual([...new Set(demo.map((d) => d.domain))], ["northwind-dental.example", "seasonx.ai", "sonorch.ai"]);
    assert.ok(demo.every((d) => d.kind === "person"), "demo placeholders are people");
    const admins = await adminQuery<{ email: string }>("SELECT email FROM auth_user WHERE role = 'admin'", [], db.name);
    assert.deepEqual(admins, [{ email: "staff@lumoras.example" }]);
  });

  it("demo data agrees across screens: a keyword is labelled Published only when its article is live (sonorch.ai: none)", async () => {
    const sites = await assertScreensAgree(db.name);
    assert.deepEqual(sites.find((s) => s.domain === "sonorch.ai"), { domain: "sonorch.ai", live: 0, publishedLabels: 0 });
    // sonorch.ai still has a full ranking history, on saved keywords marked targeted
    const [r] = await adminQuery<{ n: number; kws: number }>(
      "SELECT count(*)::int n, count(DISTINCT keyword)::int kws FROM rank_snapshots r JOIN sites s ON s.id = r.site_id WHERE s.domain = 'sonorch.ai' AND r.source = 'saved'",
      [],
      db.name,
    );
    assert.ok(r.kws >= 5 && r.n >= r.kws * 10, `sonorch.ai ranking history: ${JSON.stringify(r)}`);
  });

  it("without the dev fakes, lumoras.ai's Git connection points at timtasay/lumoras.ai (base dev, pull requests) with no token: token needed", async () => {
    const site = ids.workspaces.lumoras.sites["lumoras.ai"];
    const conns = await withWorkspace(pool, { workspaceId: ids.workspaces.lumoras.id, actorId: "system:test" }, (tx) => listConnections(tx, site), { readOnly: true });
    const git = conns.find((c) => c.kind === "git")!;
    assert.equal(git.label, "lumoras.ai repository");
    assert.equal(git.has_secret, false, "no token is seeded: the owner adds it in the app");
    assert.equal(git.status, "warn");
    assert.match(git.status_detail ?? "", /^Token needed/);
    assert.deepEqual(
      { repository: git.config.repository, branch: git.config.branch, contentDir: git.config.contentDir, filenamePattern: git.config.filenamePattern, mode: git.config.mode, apiBaseUrl: git.config.apiBaseUrl, livePath: git.config.livePath },
      { repository: "https://github.com/timtasay/lumoras.ai", branch: "dev", contentDir: "apps/web/content/insights", filenamePattern: "{{slug}}.md", mode: "pr", apiBaseUrl: "", livePath: "/insights/{{slug}}" },
    );
    assert.equal(git.config.frontmatterTemplate, LUMORAS_GIT.frontmatterTemplate);
    const [s] = await adminQuery<{ publish_connection_id: string; runway_reason: string | null }>("SELECT publish_connection_id, runway_reason FROM sites WHERE id = $1", [site], db.name);
    assert.equal(s.publish_connection_id, git.id);
  });

  it("stores a crawl: routes upserted, one audit summary, brand pre-filled only where empty, one crawl at a time", async () => {
    const ws = ids.workspaces["northwind-dental"].id;
    const site = ids.workspaces["northwind-dental"].sites["northwind-dental.example"];
    const ctx = { workspaceId: ws, actorId: "system:test", requestId: "crawl-test" };
    const run = await withWorkspace(pool, ctx, async (tx) => {
      await tx.action("crawl.start");
      return startCrawlRun(tx, ws, site);
    });
    await assert.rejects(withWorkspace(pool, ctx, (tx) => startCrawlRun(tx, ws, site)), CrawlBusyError);
    const routes = Array.from({ length: 1200 }, (_, i) => ({ url: `https://northwind-dental.example/p/${i}`, path: `/p/${i}`, lastmod: null, source: "test" }));
    const r = await withWorkspace(pool, ctx, async (tx) => {
      await tx.action("crawl.finish");
      return finishCrawlRun(tx, ws, site, run.id, {
        status: "ok",
        sitemaps: ["https://northwind-dental.example/sitemap.xml"],
        routes,
        pages: [{ url: "https://northwind-dental.example/", path: "/", title: "T", description: "Crawled description", siteName: null, h1: "Crawled heading" }],
        problems: [],
        truncated: false,
      });
    });
    assert.deepEqual(r, { added: 1200, seen: 1200 });
    const audit = await adminQuery<{ details: { rows: number } }>("SELECT details FROM audit_log WHERE entity_type = 'site_routes' AND request_id = 'crawl-test'", [], db.name);
    assert.equal(audit.length, 1, "one summary row per statement, not one per route");
    assert.equal(audit[0].details.rows, 1200);
    const brand = await withWorkspace(pool, ctx, (tx) => getBrand(tx, site));
    assert.equal(brand.overview, "A fictional family and cosmetic dental practice used as demo data.", "a human-written overview is never overwritten");
    assert.ok(brand.prefilled_at);
    // a second crawl only refreshes
    const run2 = await withWorkspace(pool, ctx, (tx) => startCrawlRun(tx, ws, site));
    const r2 = await withWorkspace(pool, ctx, (tx) =>
      finishCrawlRun(tx, ws, site, run2.id, { status: "ok", sitemaps: [], routes: routes.slice(0, 10), pages: [], problems: [], truncated: false }),
    );
    assert.deepEqual(r2, { added: 0, seen: 10 });
  });

  it("rotates connection secrets to a new key version; the old key can then be dropped", async () => {
    const ws = ids.workspaces["northwind-dental"].id;
    const ctx = { workspaceId: ws, actorId: "system:test" };
    const ring12 = readKeyring({ ENCRYPTION_KEYS: `1:${K1},2:${K2}`, ENCRYPTION_KEY_CURRENT: "2" });
    const [conn] = await withWorkspace(pool, ctx, (tx) => listConnections(tx, ids.workspaces["northwind-dental"].sites["northwind-dental.example"]));
    assert.equal(conn.key_version, 1);
    assert.equal(await withWorkspace(pool, ctx, (tx) => rotateConnectionKeys(tx, ring12, ws)), 1);
    const [after] = await withWorkspace(pool, ctx, (tx) => listConnections(tx, conn.site_id));
    assert.equal(after.key_version, 2);
    const secret = await withWorkspace(pool, ctx, (tx) => readConnectionSecret(tx, readKeyring({ ENCRYPTION_KEYS: `2:${K2}` }), ws, conn.id));
    assert.equal(secret, "demo-signing-secret-not-real");
    const audit = await adminQuery<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
      "SELECT before, after FROM audit_log WHERE entity_type = 'connections' AND before IS NOT NULL ORDER BY id DESC LIMIT 1",
      [],
      db.name,
    );
    assert.notEqual(audit[0].before.credentials_ciphertext, audit[0].after.credentials_ciphertext, "the trail shows the secret changed");
    assert.match(String(audit[0].after.credentials_ciphertext), /^\[redacted [0-9a-f]{8}\]$/, "without holding it");
    assert.deepEqual([audit[0].before.key_version, audit[0].after.key_version], [1, 2]);
  });
});
