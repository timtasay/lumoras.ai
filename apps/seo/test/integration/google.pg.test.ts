/**
 * Search Console and GA4 connections on a real PostgreSQL, against a local
 * fake Google: the refresh token is encrypted at rest and never selected
 * back, the audit log holds only a fingerprint, other workspaces cannot see
 * the connection, property selection and the live test drive the status
 * light, the reads return striking-distance queries and measurement health,
 * a revoked grant turns the light red, and disconnect revokes at Google.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readKeyring } from "../../lib/crypto/secrets.ts";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { createAuthRequest, exchangeCode, googleEndpoints } from "../../lib/google/oauth.ts";
import { chooseProperty, disconnect, forgetGoogleCaches, ga4Insights, gscInsights, listGoogleConnections, listProperties, saveGoogleGrant, testConnection, type GoogleDeps } from "../../lib/google/service.ts";
import { createTestDatabase, dropAll, skipReason, adminQuery, type TestDb } from "../helpers/db.ts";
import { FAKE_GOOGLE_CLIENT, startFakeGoogle } from "../helpers/fake-google.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

const ring = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") });
const REDIRECT = "http://127.0.0.1:3107/api/google/callback";

describe("Search Console and GA4 connections", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let g: Awaited<ReturnType<typeof startFakeGoogle>>;
  let A: TestWorkspace, B: TestWorkspace;
  let deps: GoogleDeps;
  const ctx = (w: TestWorkspace) => ({ workspaceId: w.ws, actorId: w.user });
  const site = () => ({ id: A.site, domain: A.domain, name: "Sonorch" });

  async function connect(w: TestWorkspace, kind: "search_console" | "ga4") {
    const a = createAuthRequest({ clientId: FAKE_GOOGLE_CLIENT.clientId, redirectUri: REDIRECT, endpoints: deps.endpoints, ring, workspaceId: w.ws, slug: "x", siteId: w.site, kind, userId: w.user });
    const back = new URL((await fetch(a.url, { redirect: "manual" })).headers.get("location")!);
    const t = await exchangeCode({ code: back.searchParams.get("code")!, verifier: a.state.verifier, redirectUri: REDIRECT, client: FAKE_GOOGLE_CLIENT, endpoints: deps.endpoints, kind });
    await withWorkspace(pool, ctx(w), async (tx) => {
      await tx.action("connection.google_connect");
      await saveGoogleGrant(tx, ring, w.ws, w.site, kind, t, `${w.user}@example.test`);
    });
    return t;
  }

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    // dropping the test database terminates idle connections: that is expected, not a crash
    pool.on("error", () => {});
    g = await startFakeGoogle();
    deps = { db: pool, ring, endpoints: googleEndpoints(g.origin), client: FAKE_GOOGLE_CLIENT };
    A = await makeWorkspace(pool, "goog-a", "sonorch.ai");
    B = await makeWorkspace(pool, "goog-b", "lumoras.ai");
  });
  after(async () => {
    await pool?.end();
    await g?.close();
    await dropAll();
  });

  it("stores the refresh token encrypted; it is never selected back, logged or visible to another workspace", async () => {
    const t = await connect(A, "search_console");
    const [row] = await adminQuery<{ c: string; key_version: number; config: Record<string, string>; status: string }>("SELECT credentials_ciphertext AS c, key_version, config, status FROM connections WHERE kind = 'search_console'", [], db.name);
    assert.match(row.c, /^v1\./);
    assert.ok(!row.c.includes(t.refreshToken!), "refresh token stored in clear");
    assert.ok(!JSON.stringify(row.config).includes(t.refreshToken!));
    assert.equal(row.status, "warn", "connected, property not chosen yet");
    const audit = await adminQuery<{ after: Record<string, unknown> }>("SELECT after FROM audit_log WHERE entity_type = 'connections' AND after->>'kind' = 'search_console'", [], db.name);
    assert.ok(audit.length >= 1);
    for (const a of audit) {
      assert.match(String(a.after.credentials_ciphertext), /^\[redacted [0-9a-f]{8}\]$/);
      assert.ok(!JSON.stringify(a).includes(t.refreshToken!) && !JSON.stringify(a).includes(row.c));
    }
    const viewA = await withWorkspace(pool, ctx(A), (tx) => listGoogleConnections(tx, A.site), { readOnly: true });
    assert.ok(viewA.search_console);
    assert.ok(!JSON.stringify(viewA).includes("v1.") && !JSON.stringify(viewA).includes(t.refreshToken!), "the view carries no secret");
    const viewB = await withWorkspace(pool, ctx(B), (tx) => tx.many("SELECT id FROM connections WHERE kind IN ('search_console', 'ga4')"), { readOnly: true });
    assert.deepEqual(viewB, [], "workspace B sees A's Google connection");
  });

  it("lists properties, suggests the site's own, and the test turns the light green", async () => {
    const props = await listProperties(deps, ctx(A), site(), "search_console");
    assert.equal(props.suggested, "sc-domain:sonorch.ai");
    assert.ok(!props.options.some((o) => o.value.includes("unverified")), "unverified properties are offered");
    let r = await testConnection(deps, ctx(A), A.site, "search_console");
    assert.equal(r.status, "warn", "no property chosen yet");
    await assert.rejects(chooseProperty(deps, ctx(A), site(), "search_console", "sc-domain:not-mine.example"), /not available/);
    await chooseProperty(deps, ctx(A), site(), "search_console", "sc-domain:sonorch.ai");
    r = await testConnection(deps, ctx(A), A.site, "search_console");
    assert.equal(r.status, "ok", r.detail);
    assert.match(r.detail, /84 clicks and 3,360 impressions/);
    const [row] = await adminQuery<{ status: string; last_tested_at: Date | null }>("SELECT status, last_tested_at FROM connections WHERE kind = 'search_console'", [], db.name);
    assert.equal(row.status, "ok");
    assert.ok(row.last_tested_at);
  });

  it("reads striking-distance queries (positions 4–20) and pages with impressions but no clicks", async () => {
    const i = await gscInsights(deps, ctx(A), A.site);
    assert.ok(i);
    assert.deepEqual(i.striking.map((s) => [s.query, s.position]), [["salon no show policy", 7.4], ["salon deposit policy", 11.8], ["walk in salon app", 18.6]]);
    assert.deepEqual(i.zeroClick.map((z) => z.page), ["https://sonorch.ai/insights/ai-receptionist-cost"]);
  });

  it("GA4: organic landing pages and measurement health; a broken tag shows as an error", async () => {
    await connect(A, "ga4");
    const props = await listProperties(deps, ctx(A), site(), "ga4");
    assert.equal(props.suggested, "properties/111111111");
    await chooseProperty(deps, ctx(A), site(), "ga4", "properties/111111111");
    assert.equal((await testConnection(deps, ctx(A), A.site, "ga4")).status, "ok");
    const i = await ga4Insights(deps, ctx(A), A.site);
    assert.equal(i?.landingPages[0].page, "/insights/no-show-policy");
    assert.equal(i?.health.state, "ok");
    await chooseProperty(deps, ctx(A), site(), "ga4", "properties/333333333");
    const broken = await testConnection(deps, ctx(A), A.site, "ga4");
    assert.equal(broken.status, "error");
    assert.match(broken.detail, /tag may be missing or broken/);
  });

  it("a grant revoked at Google turns the light red on the next use", async () => {
    forgetGoogleCaches();
    g.revokeAll();
    const r = await testConnection(deps, ctx(A), A.site, "search_console");
    assert.equal(r.status, "error");
    const [row] = await adminQuery<{ status: string; status_detail: string }>("SELECT status, status_detail FROM connections WHERE kind = 'search_console'", [], db.name);
    assert.equal(row.status, "error");
    assert.equal(await gscInsights(deps, ctx(A), A.site), null, "no reads from a failing connection");
  });

  it("disconnect revokes the token at Google and deletes the connection", async () => {
    const t = await connect(B, "search_console");
    const res = await disconnect(deps, ctx(B), B.site, "search_console");
    assert.equal(res.revoked, true);
    assert.equal(g.refreshTokens().find((x) => x.token === t.refreshToken)?.revoked, true);
    const rows = await adminQuery("SELECT 1 FROM connections WHERE site_id = $1", [B.site], db.name);
    assert.equal(rows.length, 0);
    const audit = await adminQuery("SELECT 1 FROM audit_log WHERE workspace_id = $1 AND action = 'connection.google_disconnect'", [B.ws], db.name);
    assert.equal(audit.length, 1);
  });
});
