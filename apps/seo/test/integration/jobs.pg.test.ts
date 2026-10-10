/**
 * The worker process and pg-boss end to end, on a real PostgreSQL with the
 * app role (the job schema installed by the owner role, as in production):
 *
 *   - the worker starts ("worker ready") with no DDL rights;
 *   - a schedule tick lays out a site's slots and wakes rolling generation
 *     for the slot inside its lead window; the run goes through the steps in
 *     the worker (FakeLlm, recorded pages) and stops at the review gate;
 *   - an autopilot site (acknowledged) with a slot a few seconds away:
 *     approved by the gate, published AT the slot through the signed webhook
 *     to a local receiver that verifies the signature;
 *   - SIGTERM stops it cleanly (exit 0).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import pg from "pg";
import type { PgBoss } from "pg-boss";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { createAuthor } from "../../lib/data/sites.ts";
import { createConnection } from "../../lib/data/connections.ts";
import { createPlanned } from "../../lib/data/content.ts";
import { addSeeds, setBudget } from "../../lib/data/research.ts";
import { bossFor, enqueueWith } from "../../lib/jobs/wire.ts";
import { QUEUES } from "../../lib/pipeline/deps.ts";
import { startRun } from "../../lib/pipeline/runner.ts";
import { createTestDatabase, dropAll, skipReason, adminQuery, type TestDb } from "../helpers/db.ts";
import { startFakeWebhook, type FakeWebhook } from "../helpers/fake-webhook.ts";
import { testDeps, TEST_RING } from "../helpers/pipeline.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HOOK_SECRET = "jobs-test-hook-secret-0123456789";

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("worker and job queue (PostgreSQL)", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let hook: FakeWebhook;
  let worker: ChildProcess;
  let producer: PgBoss;
  const lines: Record<string, unknown>[] = [];
  let exited: Promise<number | null>;

  async function setUpSite(slug: string, opts: { autopilot: boolean }): Promise<TestWorkspace> {
    const W = await makeWorkspace(pool, slug, `${slug}.example`);
    await withWorkspace(pool, { workspaceId: W.ws, actorId: W.user }, async (tx) => {
      await createAuthor(tx, W.ws, W.site, { name: "Riley Example", role: "Editor", bio: "", avatarUrl: null });
      await setBudget(tx, W.ws, "seo_credits", 20_000_000, 1_000_000);
      await setBudget(tx, W.ws, "llm_tokens", 20_000_000, 1_000_000);
      await addSeeds(tx, W.ws, W.site, ["phone answering", "appointment booking", "call handling"], 1, W.user);
      await tx.exec("UPDATE brand_profiles SET sells = $2, product_facts = $3 WHERE site_id = $1", [W.site, ["phone answering", "appointment booking"], [`${slug} answers calls around the clock`]]);
      await tx.exec(`INSERT INTO site_routes (workspace_id, site_id, url, path) SELECT $1, $2, $3 || p, p FROM unnest($4::text[]) p`, [
        W.ws,
        W.site,
        `https://${slug}.example`,
        ["/", "/about", "/pricing", "/demo", "/guides/phone-answering-basics", "/guides/booking-calls"],
      ]);
      const c = await createConnection(tx, TEST_RING, W.ws, W.site, { kind: "webhook", label: "Hook", endpoint: `${hook.origin}/${slug}`, secret: HOOK_SECRET });
      await tx.exec("UPDATE sites SET publish_connection_id = $2 WHERE id = $1", [W.site, c.id]);
      if (opts.autopilot) await tx.exec("UPDATE sites SET review_mode = 'autopilot', autopilot_acknowledged_by = $2, autopilot_acknowledged_at = now() WHERE id = $1", [W.site, W.user]);
    });
    return W;
  }

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    pool.on("error", () => {});
    hook = await startFakeWebhook(HOOK_SECRET, { hostName: "hooks.test" });
    worker = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        DATABASE_URL: db.appUrl,
        ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        LLM_PROVIDER: "fake",
        SEO_PROVIDER: "fake",
        OUTBOUND_FETCH: "recorded",
        OUTBOUND_TEST_HOSTS: "hooks.test",
        WORKER_CONCURRENCY: "2",
        LOG_LEVEL: "info",
      } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    worker.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          lines.push(JSON.parse(line));
        } catch {
          lines.push({ raw: line });
        }
      }
    });
    worker.stderr!.on("data", (d: Buffer) => lines.push({ stderr: d.toString() }));
    exited = new Promise((r) => worker.on("exit", (c) => r(c)));
    producer = bossFor(db.appUrl, { worker: false, max: 2 });
    producer.on("error", () => {});
    await producer.start();
  });
  after(async () => {
    if (worker && worker.exitCode === null) worker.kill("SIGKILL");
    await producer?.stop({ graceful: false, close: true }).catch(() => {});
    await pool?.end();
    await hook?.close();
    await dropAll();
  });

  it("starts as the app role and registers its queues and schedules", async () => {
    await until("worker ready", async () => lines.find((l) => l.msg === "worker ready"), 30_000);
    const [r] = (await pool.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows;
    assert.equal(r.rolsuper, false);
    const scheduled = await adminQuery<{ name: string; cron: string }>("SELECT name, cron FROM pgboss.schedule ORDER BY name", [], db.name);
    assert.deepEqual(scheduled.map((s) => s.name).sort(), [QUEUES.links, QUEUES.runway, QUEUES.sitemaps, QUEUES.tick, QUEUES.measureTick].sort());
  });

  it("a schedule tick lays out slots and wakes generation for the slot in its lead window; the worker writes it and stops at review", async () => {
    const W = await setUpSite("rolling-jobs", { autopilot: false });
    const inAnHour = new Date(Date.now() + 3_600_000);
    const time = `${String(inAnHour.getUTCHours()).padStart(2, "0")}:${String(inAnHour.getUTCMinutes()).padStart(2, "0")}`;
    await withWorkspace(pool, { workspaceId: W.ws, actorId: W.user }, (tx) =>
      tx.exec("UPDATE sites SET schedule_active = true, schedule_days = '{1,2,3,4,5,6,7}', schedule_time = $2, lead_days = 1, horizon_days = 14 WHERE id = $1", [W.site, time]),
    );
    await enqueueWith(producer)(QUEUES.tick, {});
    const slots = await until("slots", async () => {
      const r = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM content_items WHERE site_id = $1", [W.site], db.name);
      return r[0].n >= 14 ? r[0].n : null;
    });
    assert.ok(slots >= 14 && slots <= 15, `${slots} slots for 14 days`);
    const item = await until("the woken slot to reach review", async () => {
      const r = await adminQuery<{ id: string; status: string; slot_at: Date }>("SELECT id, status, slot_at FROM content_items WHERE site_id = $1 AND status NOT IN ('planned') ORDER BY slot_at", [W.site], db.name);
      return r.length && r.every((x) => x.status === "awaiting_review") ? r : null;
    });
    assert.equal(item.length, 1, "only the slot inside the one-day lead window was written");
    assert.ok(Math.abs(item[0].slot_at.getTime() - inAnHour.getTime()) < 120_000);
    const [run] = await adminQuery<{ status: string; current_step: string }>("SELECT r.status, r.current_step FROM pipeline_runs r JOIN content_items c ON c.current_run_id = r.id WHERE c.id = $1", [item[0].id], db.name);
    assert.deepEqual(run, { status: "waiting", current_step: "review" });
  });

  it("autopilot (acknowledged): the gate approves and the article is published AT its slot through the signed webhook", async () => {
    const W = await setUpSite("autopilot-jobs", { autopilot: true });
    const ctx = { workspaceId: W.ws, actorId: W.user };
    const deps = { ...testDeps(pool), enqueue: enqueueWith(producer) };
    const slot = new Date(Date.now() + 12_000);
    const id = await withWorkspace(pool, ctx, (tx) => createPlanned(tx, W.ws, W.site, slot, null, W.user));
    await startRun(deps, ctx, id!, "manual");
    const approved = await until("autopilot approval", async () => {
      const r = await adminQuery<{ status: string }>("SELECT status FROM content_items WHERE id = $1", [id], db.name);
      return ["approved", "publishing", "published"].includes(r[0].status) ? r[0].status : r[0].status === "failed" || r[0].status === "awaiting_review" ? `held:${r[0].status}` : null;
    });
    assert.ok(!approved.startsWith("held"), `the article was held: ${approved}`);
    const delivered = await until("the webhook delivery", async () => hook.deliveries.find((d) => d.path === "/autopilot-jobs"), 60_000);
    assert.ok(Date.now() >= slot.getTime() - 1000, "published before its slot");
    assert.deepEqual(delivered.verdict, { ok: true });
    assert.equal(delivered.headers["x-lumoras-event"], "article.published");
    const pub = await until("published", async () => {
      const r = await adminQuery<{ status: string; publication: string }>("SELECT c.status, p.status AS publication FROM content_items c JOIN publications p ON p.item_id = c.id WHERE c.id = $1", [id], db.name);
      return r[0]?.status === "published" ? r[0] : null;
    });
    assert.deepEqual(pub, { status: "published", publication: "published" });
    const [review] = await adminQuery<{ decision: string; reviewer_role: string }>("SELECT decision, reviewer_role FROM content_reviews WHERE item_id = $1", [id], db.name);
    assert.deepEqual(review, { decision: "autopilot", reviewer_role: "system" });
  });

  it("SIGTERM stops the worker cleanly", async () => {
    worker.kill("SIGTERM");
    assert.equal(await exited, 0);
    const msgs = lines.map((l) => l.msg);
    assert.ok(msgs.includes("worker stopped"), JSON.stringify(lines.slice(-5)));
    assert.ok(!JSON.stringify(lines).includes(new URL(db.appUrl).password), "the database password was logged");
  });
});
