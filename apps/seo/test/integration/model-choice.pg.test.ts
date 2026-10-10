/**
 * Choosing the model per pipeline step (Agency → Models, migration 0011) on a
 * real PostgreSQL with the app role:
 *   - only a platform admin, not while impersonating, can change it, and the
 *     change is in the audit log with before and after;
 *   - the app role cannot read or write the settings table directly;
 *   - a run uses the chosen model for the chosen steps and the env defaults
 *     for the rest, read fresh at each step.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withActor, withWorkspace } from "../../lib/db/tenant.ts";
import { createConnection } from "../../lib/data/connections.ts";
import { createAuthor } from "../../lib/data/sites.ts";
import { addSeeds, setBudget } from "../../lib/data/research.ts";
import { planSite } from "../../lib/content/planner.ts";
import { executeRun } from "../../lib/pipeline/runner.ts";
import { loadModelChoice } from "../../lib/llm/model-settings.ts";
import { DEFAULT_MODELS } from "../../lib/llm/types.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { testDeps, TEST_RING } from "../helpers/pipeline.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

const CHOICE = {
  models: { brief: "anthropic/claude-haiku-5.5", draft: "openai/gpt-6" },
  prices: { "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }, "openai/gpt-6": { input: 3, output: 12, cacheRead: 0.3, cacheWrite: 3 } },
};

describe("model choice per pipeline step", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let W: TestWorkspace;
  let adminId: string;

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    pool.on("error", () => {});
    W = await makeWorkspace(pool, "chooser", "chooser.example");
    adminId = (await pool.query<{ id: string }>("INSERT INTO auth_user (name, email) VALUES ('Staff', 'staff@lumoras.example') RETURNING id")).rows[0].id;
    await adminQuery("UPDATE auth_user SET role = 'admin' WHERE id = $1", [adminId], db.name);
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  const set = (actor: { actorId: string; impersonatorId?: string }) => withActor(pool, actor, (tx) => tx.exec("SELECT platform_set_llm_models($1::jsonb)", [JSON.stringify(CHOICE)]));

  it("only a platform admin can change it, never while impersonating; the change is audited", async () => {
    await assert.rejects(set({ actorId: W.user }), /not a platform admin/);
    await assert.rejects(set({ actorId: adminId, impersonatorId: adminId }), /not a platform admin/);
    assert.deepEqual((await loadModelChoice(pool)).models, {}, "nothing was saved");
    await set({ actorId: adminId });
    const c = await loadModelChoice(pool);
    assert.deepEqual(c.models, CHOICE.models);
    assert.equal(c.prices["openai/gpt-6"].output, 12);
    const [a] = await adminQuery<{ actor_id: string; details: { before: unknown; after: unknown } }>("SELECT actor_id::text, details FROM audit_log WHERE action = 'platform.llm_models.set'", [], db.name);
    assert.equal(a.actor_id, adminId);
    assert.deepEqual(a.details, { before: null, after: CHOICE.models });
  });

  it("the app role cannot read or write the settings table directly", async () => {
    assert.equal((await pool.query("SELECT * FROM platform_settings")).rowCount, 0, "row-level security hides the row");
    await assert.rejects(pool.query("INSERT INTO platform_settings (key, value) VALUES ('llm_models', '{}')"), /row-level security|permission denied/);
    assert.equal((await pool.query("UPDATE platform_settings SET value = '{}'")).rowCount, 0, "an update reaches no row");
    assert.deepEqual((await loadModelChoice(pool)).models, CHOICE.models, "the choice is unchanged");
  });

  it("a run uses the chosen model for brief and draft and the defaults for topic choice and fact-checking", async () => {
    const ctx = { workspaceId: W.ws, actorId: W.user };
    await withWorkspace(pool, ctx, async (tx) => {
      await createAuthor(tx, W.ws, W.site, { name: "Riley Example", role: "Editor", bio: "", avatarUrl: null });
      await setBudget(tx, W.ws, "seo_credits", 20_000_000, 1_000_000);
      await setBudget(tx, W.ws, "llm_tokens", 20_000_000, 1_000_000);
      await addSeeds(tx, W.ws, W.site, ["phone answering", "appointment booking"], 1, W.user);
      await tx.exec("UPDATE brand_profiles SET sells = $2, product_facts = $3 WHERE site_id = $1", [W.site, ["phone answering"], ["Chooser answers calls around the clock"]]);
      await tx.exec(
        `INSERT INTO site_routes (workspace_id, site_id, url, path) SELECT $1, $2, 'https://chooser.example' || p, p FROM unnest($3::text[]) p`,
        [W.ws, W.site, ["/", "/about", "/pricing", "/demo", "/guides/a", "/guides/b"]],
      );
      const c = await createConnection(tx, TEST_RING, W.ws, W.site, { kind: "content_api", label: "Lumoras Growth", authorKeys: "Riley Example = riley" });
      await tx.exec("UPDATE sites SET timezone = 'America/New_York', schedule_active = true, schedule_days = '{2,5}', schedule_time = '09:00', lead_days = 3, publish_connection_id = $2 WHERE id = $1", [W.site, c.id]);
    });
    const deps = testDeps(pool, { clock: { now: new Date("2026-10-07T14:00:00Z") } });
    assert.equal((await planSite(deps, ctx, W.site)).started, 1);
    const run = deps.rec.jobs.find((j) => j.queue === "pipeline-run")!;
    await executeRun(deps, ctx, String(run.data.runId));
    const steps = await adminQuery<{ step: string; model: string }>("SELECT step, model FROM pipeline_steps WHERE run_id = $1 AND model IS NOT NULL ORDER BY step", [run.data.runId], db.name);
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s.model]));
    assert.equal(byStep.topic, DEFAULT_MODELS.review);
    assert.equal(byStep.brief, "anthropic/claude-haiku-5.5");
    assert.equal(byStep.draft, "openai/gpt-6");
    assert.equal(byStep.factcheck, DEFAULT_MODELS.review);
  });
});
