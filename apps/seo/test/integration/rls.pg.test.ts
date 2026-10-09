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
};

const RING = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });

type Seeded = { ws: string; user: string; site: string };

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
      return s;
    });
    return { ws, user: u.id, site: site.id };
  }

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
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
      if (table !== "audit_log") {
        const updated = await asA((tx) => tx.exec(`UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1`, [B.ws]));
        assert.equal(updated, 0, `${table}: workspace A updated ${updated} row(s) of workspace B (${col} = ${B.ws})`);
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
