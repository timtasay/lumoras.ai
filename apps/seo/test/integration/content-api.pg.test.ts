/**
 * "Lumoras Growth serves it" on a real PostgreSQL with the app role
 * (docs/content-api.md, owner decision of 10 October 2026):
 *   - an approved article publishes at its slot through a content_api
 *     connection: nothing is contacted, the post is stored as served;
 *   - the posts endpoint lists it once its date has arrived (UTC), never
 *     before, newest snapshot per slug, in the contract's shape;
 *   - the endpoint answers only for a site whose publishing connection is
 *     content_api, and only to its own token.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { createConnection } from "../../lib/data/connections.ts";
import { getItem } from "../../lib/data/content.ts";
import { createAuthor } from "../../lib/data/sites.ts";
import { addSeeds, setBudget } from "../../lib/data/research.ts";
import { loadPostsFeed } from "../../lib/data/feeds.ts";
import { planSite } from "../../lib/content/planner.ts";
import { decideReview } from "../../lib/content/review.ts";
import { executeRun } from "../../lib/pipeline/runner.ts";
import { POST_MOTIFS } from "../../lib/publishers/content-api.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { testDeps, TEST_RING } from "../helpers/pipeline.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

/** A superuser write with an actor set (tenant tables refuse writes without one), in one transaction. */
async function asSystem(sql: string, params: unknown[], database: string) {
  const u = new URL(process.env.TEST_DATABASE_URL!);
  u.pathname = `/${database}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id', 'system:test', true)");
    await c.query(sql, params);
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
}

describe("Lumoras Growth serves it: publishing and the posts endpoint", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let W: TestWorkspace;
  let token: string;
  const ctx = () => ({ workspaceId: W.ws, actorId: W.user });

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    pool.on("error", () => {});
    W = await makeWorkspace(pool, "served", "served.example");
    await withWorkspace(pool, ctx(), async (tx) => {
      await createAuthor(tx, W.ws, W.site, { name: "Tran", role: "Salon owner", bio: "", avatarUrl: null });
      await setBudget(tx, W.ws, "seo_credits", 20_000_000, 1_000_000);
      await setBudget(tx, W.ws, "llm_tokens", 20_000_000, 1_000_000);
      await addSeeds(tx, W.ws, W.site, ["salon deposits", "salon booking", "walk in policy"], 1, W.user);
      await tx.exec("UPDATE brand_profiles SET sells = $2, product_facts = $3, seo_rules = seo_rules || $4::jsonb WHERE site_id = $1", [
        W.site,
        ["salon booking"],
        ["Served answers calls around the clock"],
        JSON.stringify({ coverKinds: [...POST_MOTIFS], coverChips: 2, coverChipMax: 26 }),
      ]);
      await tx.exec(
        `INSERT INTO site_routes (workspace_id, site_id, url, path) SELECT $1, $2, 'https://served.example' || p, p FROM unnest($3::text[]) p`,
        [W.ws, W.site, ["/", "/about", "/pricing", "/demo", "/insights/booking-basics", "/insights/deposits-101"]],
      );
      const c = await createConnection(tx, TEST_RING, W.ws, W.site, { kind: "content_api", label: "Lumoras Growth", livePath: "/insights/{{slug}}", authorKeys: "Tran = tran" });
      await tx.exec("UPDATE sites SET timezone = 'America/New_York', schedule_active = true, schedule_days = '{2,5}', schedule_time = '09:00', lead_days = 3, publish_connection_id = $2 WHERE id = $1", [W.site, c.id]);
      token = (await tx.one<{ feed_token: string }>("SELECT feed_token FROM sites WHERE id = $1", [W.site])).feed_token;
    });
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  it("an approved article publishes at its slot without contacting anything, and the endpoint serves it from its date", async () => {
    const clock = { now: new Date("2026-10-07T14:00:00Z") };
    const deps = testDeps(pool, { clock });
    const plan = await planSite(deps, ctx(), W.site);
    assert.equal(plan.started, 1);
    const run = deps.rec.jobs.find((j) => j.queue === "pipeline-run")!;
    await executeRun(deps, ctx(), String(run.data.runId));
    const first = await withWorkspace(pool, ctx(), (tx) => tx.one<{ id: string }>("SELECT id FROM content_items WHERE site_id = $1 ORDER BY slot_at LIMIT 1", [W.site]), { readOnly: true });
    let item = await withWorkspace(pool, ctx(), (tx) => getItem(tx, first.id), { readOnly: true });
    assert.equal(item.status, "awaiting_review", item.status_detail ?? "");
    await decideReview(deps, ctx(), "owner", first.id, "approved", "");
    // before its date: not published, not served
    assert.deepEqual((await loadPostsFeed(pool, token, clock.now))!.posts, []);
    clock.now = new Date("2026-10-09T13:00:30Z");
    const done = await executeRun(deps, ctx(), String(run.data.runId));
    assert.equal(done.status, "succeeded", done.error);
    item = await withWorkspace(pool, ctx(), (tx) => getItem(tx, first.id), { readOnly: true });
    assert.equal(item.status, "published");
    assert.equal(item.live_url, `https://served.example/insights/${item.slug}`);

    const pub = (await adminQuery<{ publisher: string; mode: string; status: string; remote_id: string; payload: Record<string, unknown> }>("SELECT publisher, mode, status, remote_id, payload FROM publications WHERE item_id = $1", [item.id], db.name))[0];
    assert.equal(pub.publisher, "content_api");
    assert.equal(pub.mode, "api");
    assert.equal(pub.status, "published");
    assert.equal(pub.remote_id, item.slug);

    const feed = (await loadPostsFeed(pool, token, clock.now))!;
    assert.equal(feed.version, 1);
    assert.equal(feed.site, "served.example");
    assert.equal(feed.posts.length, 1);
    const post = feed.posts[0];
    assert.deepEqual(Object.keys(post), ["slug", "title", "description", "publishedAt", "author", "readingMinutes", "cover", "body"], "no updatedAt on a first publish");
    assert.equal(post.slug, item.slug);
    assert.equal(post.title, item.title);
    assert.equal(post.publishedAt, "2026-10-09");
    assert.equal(post.author, "tran", "the byline's site key, never the name");
    assert.ok((POST_MOTIFS as readonly string[]).includes(post.cover.motif));
    assert.ok(post.cover.chips.length >= 1 && post.cover.chips.length <= 3 && post.cover.chips.every((c) => c.length <= 26));
    assert.ok(post.body.length > 200 && !/^# /m.test(post.body));
    assert.deepEqual(post, pub.payload, "the endpoint serves exactly the snapshot taken at publishing");
    // the day before (UTC) it is not listed; the snapshot does not follow later edits to the draft
    assert.deepEqual((await loadPostsFeed(pool, token, new Date("2026-10-08T23:59:59Z")))!.posts, []);
    await withWorkspace(pool, ctx(), (tx) => tx.exec("UPDATE content_items SET title = 'Edited after publishing' WHERE id = $1", [item.id]));
    assert.equal((await loadPostsFeed(pool, token, clock.now))!.posts[0].title, item.title);
  });

  it("the newest snapshot per slug wins (a refresh replaces the article); a taken-down slug disappears", async () => {
    const [p] = await adminQuery<{ id: string; item_id: string; payload: Record<string, unknown> }>("SELECT id, item_id, payload FROM publications WHERE site_id = $1 AND publisher = 'content_api'", [W.site], db.name);
    const refreshed = { ...p.payload, title: "Refreshed title", updatedAt: "2026-10-12" };
    await asSystem(
      `INSERT INTO publications (workspace_id, site_id, item_id, publisher, mode, action, status, remote_id, payload, created_at)
       SELECT workspace_id, site_id, item_id, 'content_api', 'api', 'update', 'published', remote_id, $2::jsonb, created_at + interval '1 minute' FROM publications WHERE id = $1`,
      [p.id, JSON.stringify(refreshed)],
      db.name,
    );
    const now = new Date("2026-10-12T12:00:00Z");
    const feed = (await loadPostsFeed(pool, token, now))!;
    assert.equal(feed.posts.length, 1, "one post per slug");
    assert.equal(feed.posts[0].title, "Refreshed title");
    assert.equal(feed.posts[0].updatedAt, "2026-10-12");
  });

  it("answers only for content_api sites and their own token", async () => {
    assert.equal(await loadPostsFeed(pool, "0".repeat(64), new Date()), null, "unknown token");
    assert.equal(await loadPostsFeed(pool, "not-a-token", new Date()), null, "malformed token");
    const other = await makeWorkspace(pool, "githost", "githost.example");
    const otherToken = await withWorkspace(pool, { workspaceId: other.ws, actorId: other.user }, async (tx) => {
      const c = await createConnection(tx, TEST_RING, other.ws, other.site, { kind: "webhook", label: "Hook", endpoint: "https://hooks.example/x", secret: "a-signing-secret-of-enough-length" });
      await tx.exec("UPDATE sites SET publish_connection_id = $2, feed_enabled = true WHERE id = $1", [other.site, c.id]);
      return (await tx.one<{ feed_token: string }>("SELECT feed_token FROM sites WHERE id = $1", [other.site])).feed_token;
    });
    assert.equal(await loadPostsFeed(pool, otherToken, new Date()), null, "a site that publishes elsewhere has no posts endpoint");
    // switching the site off content_api turns its endpoint off
    await withWorkspace(pool, ctx(), (tx) => tx.exec("UPDATE sites SET publish_connection_id = NULL WHERE id = $1", [W.site]));
    assert.equal(await loadPostsFeed(pool, token, new Date("2026-10-12T12:00:00Z")), null);
  });
});
