/**
 * The content pipeline on a real PostgreSQL with the app role, FakeLlm,
 * FakeProvider, recorded pages, a local fake GitHub and a local webhook
 * receiver (nothing leaves the machine, nothing real is spent):
 *
 *   - ACCEPTANCE: lumoras.ai, onboarded by the seed, gets one generated
 *     article through all ten steps, landing as a pull request on the fake
 *     GitHub at apps/web/content/insights/<slug>.md with lumoras.ai's
 *     frontmatter (ACCEPTANCE_OUT=<dir> writes the file for the build check);
 *   - the rolling model with a clock: slots from the schedule, generation
 *     lead_days before the slot, publishing at the slot (signed webhook), DST;
 *   - rule 5: the duplicate head-term check (code and database);
 *   - rule 8: unverifiable claims block approval and publishing;
 *   - autopilot is off by default and needs an acknowledgement;
 *   - the model budget's reserve refuses writing before any model call;
 *   - retry from a failed step keeps the earlier steps;
 *   - rule 1: the runway alert fires (email + in-app) when the queue is short.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import matter from "gray-matter";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { createConnection } from "../../lib/data/connections.ts";
import { createPlanned, getItem, listSteps, type ContentItem } from "../../lib/data/content.ts";
import { createAuthor } from "../../lib/data/sites.ts";
import { addSeeds, setBudget } from "../../lib/data/research.ts";
import { checkRunway, planSite } from "../../lib/content/planner.ts";
import { decideReview, ReviewBlockedError } from "../../lib/content/review.ts";
import { localParts } from "../../lib/content/schedule.ts";
import { FakeLlm } from "../../lib/llm/fake.ts";
import { LlmError } from "../../lib/llm/types.ts";
import { executeRun, retryFrom, startRun } from "../../lib/pipeline/runner.ts";
import { STEP_KEYS } from "../../lib/pipeline/steps.ts";
import { seed, type SeedResult } from "../../lib/seed.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { startFakeGit, type FakeGit } from "../helpers/fake-git.ts";
import { startFakeWebhook, type FakeWebhook } from "../helpers/fake-webhook.ts";
import { testDeps, TEST_RING } from "../helpers/pipeline.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";
import { assertScreensAgree } from "../helpers/consistency.ts";

const POLICY = { testResolve: new Map([["github.test", "127.0.0.1"], ["hooks.test", "127.0.0.1"]]) };
const HOOK_SECRET = "hook-signing-secret-for-tests-only";

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

describe("the content pipeline", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let gh: FakeGit;
  let hook: FakeWebhook;
  let seeded: SeedResult;

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    pool.on("error", () => {});
    gh = await startFakeGit({ provider: "github", hostName: "github.test", repos: [{ owner: "timtasay", repo: "lumoras.ai", defaultBranch: "dev", files: { "apps/web/content/insights/no-show-policy.md": "existing" } }] });
    hook = await startFakeWebhook(HOOK_SECRET, { hostName: "hooks.test" });
    seeded = await seed(pool, { keyring: TEST_RING, content: { github: { apiBase: gh.apiBase, token: gh.token, reachable: true }, policy: POLICY } });
  });
  after(async () => {
    await pool?.end();
    await gh?.close();
    await hook?.close();
    await dropAll();
  });

  const lumoras = () => ({ ws: seeded.workspaces.lumoras.id, site: seeded.workspaces.lumoras.sites["lumoras.ai"] });
  const sys = (ws: string) => ({ workspaceId: ws, actorId: "system:test" });

  it("ACCEPTANCE: lumoras.ai's generated article goes through all ten steps and lands as a pull request with its frontmatter", async () => {
    const { ws, site } = lumoras();
    const items = await withWorkspace(pool, sys(ws), (tx) => tx.many<ContentItem & { run_status: string }>(
      "SELECT c.id, c.status, c.current_run_id, c.slug, c.title, c.primary_keyword, r.status AS run_status FROM content_items c JOIN pipeline_runs r ON r.id = c.current_run_id WHERE c.site_id = $1 AND c.status = 'published'", [site]), { readOnly: true });
    assert.equal(items.length, 1, "one lumoras.ai article published by the seed");
    const item = items[0];
    assert.equal(item.run_status, "succeeded");
    const steps = await withWorkspace(pool, sys(ws), (tx) => listSteps(tx, item.current_run_id!), { readOnly: true });
    assert.deepEqual(steps.map((s) => s.step), [...STEP_KEYS]);
    for (const s of steps) {
      assert.equal(s.status, "succeeded", `step ${s.step} is ${s.status} (${s.error})`);
      assert.ok(s.output, `step ${s.step} stored no output`);
      assert.ok(s.duration_ms !== null && s.duration_ms >= 0, `step ${s.step} has no duration`);
    }
    for (const k of ["topic", "brief", "draft", "factcheck"]) {
      const s = steps.find((x) => x.step === k)!;
      assert.match(s.model ?? "", /^claude-/, `${k}: model recorded`);
      assert.ok(s.input_tokens + s.cache_read_tokens + s.cache_write_tokens > 0 && s.output_tokens > 0, `${k}: tokens recorded`);
      assert.ok(Number(s.cost_micros) > 0, `${k}: cost recorded`);
    }
    assert.equal(steps.find((x) => x.step === "topic")!.model, "claude-opus-5-5", "topic selection uses the review model");
    assert.equal(steps.find((x) => x.step === "factcheck")!.model, "claude-opus-5-5", "fact-checking uses the review model");
    assert.equal(steps.find((x) => x.step === "draft")!.model, "claude-sonnet-5-5", "drafting uses the draft model");
    for (const k of ["context", "lint", "review", "publish"]) assert.equal(Number(steps.find((x) => x.step === k)!.cost_micros), 0, `${k} is free`);

    // the pull request, the file, the frontmatter lumoras.ai reads (docs/content-spec.md)
    const repo = gh.repo("timtasay", "lumoras.ai");
    assert.equal(repo.pulls.length, 1);
    const pr = repo.pulls[0];
    assert.equal(pr.state, "open");
    assert.equal(pr.base, "dev", "lumoras.ai's pull requests target dev (owner decision, 10 October 2026)");
    assert.match(pr.body, /Byline:\*\* Lumoras team \(organization, schema\.org Organization\)/, "the organization byline");
    const filePath = `apps/web/content/insights/${item.slug}.md`;
    const content = gh.fileOn("timtasay", "lumoras.ai", pr.head, filePath);
    assert.ok(content, `${filePath} is on the PR branch`);
    assert.equal(gh.fileOn("timtasay", "lumoras.ai", "dev", filePath), null, "nothing was committed to dev (PR mode)");
    const fm = matter(content!);
    assert.equal(fm.data.title, item.title);
    assert.ok(fm.data.title.length <= 60);
    assert.ok(fm.data.description.length >= 140 && fm.data.description.length <= 155, `description ${fm.data.description.length}`);
    assert.match(fm.data.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof fm.data.readingMinutes, "number");
    assert.equal(fm.data.keyword, item.primary_keyword);
    assert.ok(Array.isArray(fm.data.tags));
    assert.ok(["call", "people", "checklist", "ticket", "calendar", "chart"].includes(fm.data.art.kind));
    assert.equal(fm.data.art.chips.length, 2);
    for (const c of fm.data.art.chips) assert.ok(c.length <= 22);
    assert.ok(!/^# /m.test(fm.content), "no H1 in the body");
    assert.ok(gh.requests.every((r) => r.apiVersion === "2026-03-10"), "every GitHub call names API version 2026-03-10");
    const pub = await withWorkspace(pool, sys(ws), (tx) => tx.one<{ status: string; pr_number: number; path: string; mode: string }>("SELECT status, pr_number, path, mode FROM publications WHERE item_id = $1", [item.id]), { readOnly: true });
    assert.deepEqual(pub, { status: "open", pr_number: 1, path: filePath, mode: "pr" });
    // model usage was charged to llm_tokens through the ledger, matching the steps
    const [{ steps_cost, ledger_cost }] = await adminQuery<{ steps_cost: string; ledger_cost: string }>(
      `SELECT (SELECT sum(cost_micros) FROM pipeline_steps WHERE run_id = $1)::text AS steps_cost,
              (SELECT sum(cost_micros) FROM usage_ledger WHERE category = 'llm_tokens' AND status = 'settled' AND created_at >= (SELECT created_at FROM pipeline_runs WHERE id = $1)
                 AND created_at <= (SELECT coalesce(finished_at, now()) FROM pipeline_runs WHERE id = $1) AND site_id = $2)::text AS ledger_cost`,
      [item.current_run_id, site],
      db.name,
    );
    assert.ok(Number(steps_cost) > 0);
    assert.equal(ledger_cost, steps_cost, "the ledger charged exactly what the steps recorded");
    // rule 12: the keyword is queued for rank tracking
    const q = await adminQuery("SELECT keyword FROM rank_tracking_queue WHERE item_id = $1", [item.id], db.name);
    assert.deepEqual(q.map((r) => r.keyword), [item.primary_keyword]);
    if (process.env.ACCEPTANCE_OUT) {
      await mkdir(path.join(process.env.ACCEPTANCE_OUT, path.dirname(filePath)), { recursive: true });
      await writeFile(path.join(process.env.ACCEPTANCE_OUT, filePath), content!);
      await writeFile(path.join(process.env.ACCEPTANCE_OUT, "pr.json"), JSON.stringify({ pr, file: filePath, requests: gh.requests }, null, 2));
    }
  });

  it("demo data agrees across screens with the fakes running: lumoras.ai's live article is the one keyword labelled Published; sonorch.ai has none", async () => {
    const sites = await assertScreensAgree(db.name);
    assert.deepEqual(sites.find((s) => s.domain === "lumoras.ai"), { domain: "lumoras.ai", live: 1, publishedLabels: 1 });
    assert.deepEqual(sites.find((s) => s.domain === "sonorch.ai"), { domain: "sonorch.ai", live: 0, publishedLabels: 0 });
  });

  // ------------------------------------------------------------------ a workspace of our own for the rest
  let W: TestWorkspace;
  let hookId: string;
  const ctx = () => ({ workspaceId: W.ws, actorId: W.user });
  before(async () => {
    W = await makeWorkspace(pool, "rolling", "rolling.example");
    await withWorkspace(pool, ctx(), async (tx) => {
      await createAuthor(tx, W.ws, W.site, { name: "Riley Example", role: "Editor", bio: "", avatarUrl: null });
      await setBudget(tx, W.ws, "seo_credits", 20_000_000, 1_000_000);
      await setBudget(tx, W.ws, "llm_tokens", 20_000_000, 1_000_000);
      await addSeeds(tx, W.ws, W.site, ["phone answering", "appointment booking", "call handling"], 1, W.user);
      await tx.exec("UPDATE brand_profiles SET sells = $2, product_facts = $3 WHERE site_id = $1", [W.site, ["phone answering", "appointment booking"], ["Rolling answers calls around the clock"]]);
      await tx.exec(
        `INSERT INTO site_routes (workspace_id, site_id, url, path) SELECT $1, $2, 'https://rolling.example' || p, p FROM unnest($3::text[]) p`,
        [W.ws, W.site, ["/", "/about", "/pricing", "/demo", "/guides/phone-answering-basics", "/guides/booking-calls"]],
      );
      const c = await createConnection(tx, TEST_RING, W.ws, W.site, { kind: "webhook", label: "Hook", endpoint: `${hook.origin}/lumoras`, secret: HOOK_SECRET });
      hookId = c.id;
      await tx.exec("UPDATE sites SET timezone = 'America/New_York', schedule_active = true, schedule_days = '{2,5}', schedule_time = '09:00', lead_days = 3, publish_connection_id = $2 WHERE id = $1", [W.site, c.id]);
    });
  });

  it("rolling model: slots from the schedule (09:00 local across DST), generation 3 days ahead, publishing at the slot through a signed webhook", async () => {
    const clock = { now: new Date("2026-10-07T14:00:00Z") }; // Wednesday
    const deps = testDeps(pool, { clock, policy: POLICY });
    const r1 = await planSite(deps, ctx(), W.site);
    const slots = await withWorkspace(pool, ctx(), (tx) => tx.many<{ id: string; slot_at: Date; status: string }>("SELECT id, slot_at, status FROM content_items WHERE site_id = $1 ORDER BY slot_at", [W.site]), { readOnly: true });
    assert.equal(r1.created, slots.length);
    assert.ok(slots.length >= 11 && slots.length <= 13, `about 12 slots in 42 days, got ${slots.length}`);
    for (const s of slots) {
      const l = localParts(s.slot_at, "America/New_York");
      assert.equal(l.time, "09:00", `slot ${s.slot_at.toISOString()} is ${l.time} local`);
      assert.ok([2, 5].includes(l.weekday));
    }
    assert.ok(slots.some((s) => s.slot_at.getUTCHours() === 13) && slots.some((s) => s.slot_at.getUTCHours() === 14), "the UTC hour moves at the DST change; the local hour does not");
    assert.ok(slots.every((s) => s.slot_at > clock.now), "no slot in the past (no back-dating)");
    // Fri 9 Oct 09:00 EDT is 2 days away: inside the 3-day lead window; Tue 13 Oct is not
    assert.equal(r1.started, 1, "only the slot inside its lead window starts");
    const first = slots[0];
    assert.equal(first.slot_at.toISOString(), "2026-10-09T13:00:00.000Z");
    const run = deps.rec.jobs.find((j) => j.queue === "pipeline-run")!;
    await executeRun(deps, ctx(), String(run.data.runId));
    let item = await withWorkspace(pool, ctx(), (tx) => getItem(tx, first.id), { readOnly: true });
    assert.equal(item.status, "awaiting_review", item.status_detail ?? "");
    assert.equal(item.lint_passed, true, JSON.stringify(item.lint.filter((l) => l.status !== "pass")));
    assert.equal(item.publish_date, "2026-10-09");
    // approval schedules publishing at the slot, not now
    await decideReview(deps, ctx(), "owner", first.id, "approved", "");
    const pubJob = deps.rec.jobs.at(-1)!;
    assert.equal(pubJob.queue, "pipeline-run");
    assert.equal(pubJob.startAfter?.toISOString(), "2026-10-09T13:00:00.000Z");
    const early = await executeRun(deps, ctx(), String(run.data.runId));
    assert.equal(early.status, "waiting");
    assert.equal(early.step, "publish");
    assert.equal(hook.deliveries.length, 0, "nothing is delivered before the slot");
    clock.now = new Date("2026-10-09T13:00:30Z");
    const done = await executeRun(deps, ctx(), String(run.data.runId));
    assert.equal(done.status, "succeeded", done.error);
    item = await withWorkspace(pool, ctx(), (tx) => getItem(tx, first.id), { readOnly: true });
    assert.equal(item.status, "published");
    assert.equal(hook.deliveries.length, 1);
    const d = hook.deliveries[0];
    assert.deepEqual(d.verdict, { ok: true }, "the receiver verified our signature");
    assert.equal(d.headers["x-lumoras-event"], "article.published");
    const body = d.json as { article: { slug: string; date: string; html: string; url: string } };
    assert.equal(body.article.slug, item.slug);
    assert.equal(body.article.date, "2026-10-09");
    assert.match(body.article.html, /<h2/);
    assert.ok(deps.rec.jobs.some((j) => j.queue === "post-publish-check"), "post-publish checks are scheduled");
    // three days before Tuesday's slot, the next run wakes
    clock.now = new Date("2026-10-10T13:01:00Z");
    const r2 = await planSite(deps, ctx(), W.site);
    assert.equal(r2.started, 1);
  });

  it("rule 5: a topic that duplicates a published or scheduled head term is never chosen, and the database refuses a second one", async () => {
    const deps = testDeps(pool, { policy: POLICY });
    const taken = await withWorkspace(pool, ctx(), (tx) => tx.many<{ primary_keyword: string; head_term: string }>("SELECT primary_keyword, head_term FROM content_items WHERE site_id = $1 AND head_term IS NOT NULL AND status IN ('published', 'generating', 'awaiting_review', 'approved')", [W.site]), { readOnly: true });
    assert.ok(taken.length >= 1);
    // a saved idea that is the same head term in other words (plural, other order): must be refused
    const twin = `${taken[0].primary_keyword.split(" ").reverse().join(" ")}s`;
    await withWorkspace(pool, ctx(), (tx) => tx.exec("INSERT INTO keywords (workspace_id, site_id, keyword, search_volume, keyword_difficulty, intent, status, fit) VALUES ($1, $2, $3, 99000, 1, 'commercial', 'idea', 'offered')", [W.ws, W.site, twin]));
    // run another article: its topic step must skip every taken head term (variants included)
    const id = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() + 20 * 86_400_000), null, W.user));
    await executeRun(deps, ctx(), await startRun(deps, ctx(), id!, "manual"));
    const item = await withWorkspace(pool, ctx(), (tx) => getItem(tx, id!), { readOnly: true });
    assert.ok(item.head_term, item.status_detail ?? "");
    for (const t of taken) assert.notEqual(item.head_term, t.head_term, `chose "${item.primary_keyword}", whose head term "${item.head_term}" is already targeted by "${t.primary_keyword}"`);
    const topic = item.topic as { rejected: { keyword: string; reason: string }[] };
    const refused = topic.rejected.find((r) => r.keyword === twin);
    assert.ok(refused, `"${twin}" (huge volume, easiest difficulty) was not refused: ${JSON.stringify(topic.rejected)}`);
    assert.match(refused.reason, /^rule 5/);
    // the database backstop
    await assert.rejects(
      withWorkspace(pool, ctx(), (tx) => tx.exec("INSERT INTO content_items (workspace_id, site_id, slot_at, status, primary_keyword, head_term, created_by) VALUES ($1, $2, now() + interval '30 days', 'generating', $3, $4, 'system:test')", [W.ws, W.site, `${taken[0].primary_keyword}s`, taken[0].head_term])),
      /content_items_head_term_once/,
    );
  });

  it("rule 8: unverifiable claims block approval and publishing", async () => {
    const deps = testDeps(pool, { llm: new FakeLlm({ scenarios: { factcheck: "unverifiable" } }), policy: POLICY });
    const id = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() - 60_000 + 25 * 86_400_000), null, W.user));
    const runId = await startRun(deps, ctx(), id!, "manual");
    await executeRun(deps, ctx(), runId);
    const item = await withWorkspace(pool, ctx(), (tx) => getItem(tx, id!), { readOnly: true });
    assert.equal(item.status, "awaiting_review");
    // the people who may approve are told (in-app, and by email when email is configured)
    const asked = deps.rec.mail.filter((m) => m.kind === "review-request");
    assert.deepEqual(asked.map((m) => m.to), ["rolling@example.test"]);
    assert.match(asked[0].text, new RegExp(`/content/${id}`));
    assert.equal(item.fact_check_passed, false);
    assert.equal(item.unverifiable_claims, 1);
    const bad = item.fact_check.find((c) => c.status === "unverifiable")!;
    assert.match(bad.note, /quote does not appear/);
    await assert.rejects(decideReview(deps, ctx(), "reviewer", id!, "approved", ""), (e: unknown) => e instanceof ReviewBlockedError && /unverifiable/.test(e.message));
    // even if something forced it to approved, the publish step refuses at the last moment
    await asSystem("UPDATE content_items SET status = 'approved', slot_at = now() - interval '1 minute' WHERE id = $1", [id], db.name);
    await asSystem("UPDATE pipeline_steps SET status = 'succeeded' WHERE run_id = $1 AND step = 'review'", [runId], db.name);
    const before = hook.deliveries.length;
    const r = await executeRun(deps, ctx(), runId);
    assert.equal(r.status, "failed");
    assert.equal(r.step, "publish");
    assert.match(r.error ?? "", /unverifiable/);
    assert.equal(hook.deliveries.length, before, "nothing was delivered");
  });

  it("autopilot is off by default, cannot be switched on without an acknowledgement, and still holds articles that fail checks", async () => {
    const [s] = await adminQuery<{ review_mode: string; allow_backdating: boolean; runway_threshold_days: number; lead_days: number }>("SELECT review_mode, allow_backdating, runway_threshold_days, lead_days FROM sites WHERE id = $1", [W.site], db.name);
    assert.deepEqual(s, { review_mode: "approval", allow_backdating: false, runway_threshold_days: 10, lead_days: 3 });
    await assert.rejects(withWorkspace(pool, ctx(), (tx) => tx.exec("UPDATE sites SET review_mode = 'autopilot' WHERE id = $1", [W.site])), /sites_autopilot_acknowledged/);
    await withWorkspace(pool, ctx(), (tx) => tx.exec("UPDATE sites SET review_mode = 'autopilot', autopilot_acknowledged_at = now(), autopilot_acknowledged_by = $2 WHERE id = $1", [W.site, W.user]));
    try {
      const deps = testDeps(pool, { policy: POLICY });
      const ok = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() + 30 * 86_400_000), null, W.user));
      await executeRun(deps, ctx(), await startRun(deps, ctx(), ok!, "manual"));
      const a = await withWorkspace(pool, ctx(), (tx) => getItem(tx, ok!), { readOnly: true });
      assert.equal(a.status, "approved", "a clean article is approved by autopilot");
      const [rv] = await adminQuery<{ decision: string }>("SELECT decision FROM content_reviews WHERE item_id = $1", [ok], db.name);
      assert.equal(rv.decision, "autopilot");
      const held = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() + 31 * 86_400_000), null, W.user));
      const d2 = testDeps(pool, { llm: new FakeLlm({ scenarios: { factcheck: "unverifiable" } }), policy: POLICY });
      await executeRun(d2, ctx(), await startRun(d2, ctx(), held!, "manual"));
      const b = await withWorkspace(pool, ctx(), (tx) => getItem(tx, held!), { readOnly: true });
      assert.equal(b.status, "awaiting_review", "autopilot never publishes an article with an unverifiable claim");
    } finally {
      await withWorkspace(pool, ctx(), (tx) => tx.exec("UPDATE sites SET review_mode = 'approval' WHERE id = $1", [W.site]));
    }
  });

  it("retry from a failed step keeps the earlier steps' work", async () => {
    let fail = true;
    const base = new FakeLlm();
    const flaky = { name: "fake" as const, label: "flaky", turn: async (req: Parameters<FakeLlm["turn"]>[0]) => {
      if (req.purpose === "draft" && fail) throw new LlmError("The model refused the request: test failure");
      return base.turn(req);
    } };
    const deps = testDeps(pool, { llm: flaky, policy: POLICY });
    const id = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() + 35 * 86_400_000), null, W.user));
    const runId = await startRun(deps, ctx(), id!, "manual");
    const r = await executeRun(deps, ctx(), runId);
    assert.deepEqual([r.status, r.step], ["failed", "draft"]);
    assert.equal((await withWorkspace(pool, ctx(), (tx) => getItem(tx, id!), { readOnly: true })).status, "failed");
    fail = false;
    await retryFrom(deps, ctx(), runId, "draft");
    const r2 = await executeRun(deps, ctx(), runId);
    assert.equal(r2.status, "waiting");
    const steps = await withWorkspace(pool, ctx(), (tx) => listSteps(tx, runId), { readOnly: true });
    const attempts = Object.fromEntries(steps.map((s) => [s.step, s.attempt]));
    assert.equal(attempts.topic, 1, "topic selection was not bought again");
    assert.equal(attempts.brief, 1);
    assert.equal(attempts.draft, 2);
  });

  it("untrusted content never triggers a purchase or picks the topic: paid tools close after a SERP; an off-list pick is overruled by code", async () => {
    const llm = new FakeLlm({ scenarios: { topic: "greedy_tools" } });
    const deps = testDeps(pool, { llm, policy: POLICY });
    const id = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() + 40 * 86_400_000), null, W.user));
    const runId = await startRun(deps, ctx(), id!, "manual");
    const before = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM usage_ledger WHERE workspace_id = $1 AND category = 'seo_credits' AND operation IN ('keywordMetrics', 'serp')", [W.ws], db.name);
    const r = await executeRun(deps, ctx(), runId);
    assert.equal(r.status, "waiting", `${r.step}: ${r.error}`);
    const topic = (await withWorkspace(pool, ctx(), (tx) => listSteps(tx, runId), { readOnly: true })).find((x) => x.step === "topic")!;
    const tools = (topic.output as { tools: { name: string; ok: boolean; summary: string; untrusted: boolean }[] }).tools;
    assert.deepEqual(tools.map((t) => [t.name, t.ok]), [["keyword_metrics", true], ["serp", true], ["keyword_metrics", false]]);
    assert.match(tools[2].summary, /paid tools closed after untrusted content/);
    const after = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM usage_ledger WHERE workspace_id = $1 AND category = 'seo_credits' AND operation IN ('keywordMetrics', 'serp')", [W.ws], db.name);
    assert.equal(after[0].n - before[0].n, 2, "only the two calls made before the SERP was read were charged");
    // the SERP reached the model wrapped as data
    const topicCall = llm.calls.filter((c) => c.purpose === "topic").at(-1)!;
    const serpResult = topicCall.messages.flatMap((m) => (m.role === "user" && typeof m.content !== "string" ? m.content : [])).find((b) => b.type === "tool_result" && b.content.includes("serp:"));
    assert.ok(serpResult && serpResult.type === "tool_result" && serpResult.content.startsWith('<untrusted_data source="serp:'), "the SERP was not wrapped as untrusted data");

    const off = new FakeLlm({ scenarios: { topic: "off_list_topic" } });
    const d2 = testDeps(pool, { llm: off, policy: POLICY });
    const id2 = await withWorkspace(pool, ctx(), (tx) => createPlanned(tx, W.ws, W.site, new Date(Date.now() + 43 * 86_400_000), null, W.user));
    const run2 = await startRun(d2, ctx(), id2!, "manual");
    const r2 = await executeRun(d2, ctx(), run2);
    assert.equal(r2.status, "waiting", `${r2.step}: ${r2.error}`);
    const t2 = (await withWorkspace(pool, ctx(), (tx) => listSteps(tx, run2), { readOnly: true })).find((x) => x.step === "topic")!.output as { chosenBy: string; note: string; keyword: string };
    assert.equal(t2.chosenBy, "code");
    assert.match(t2.note, /not one of the allowed candidates/);
  });

  it("the model budget's reserve refuses writing before any model call", async () => {
    const V = await makeWorkspace(pool, "broke", "broke.example");
    const vctx = { workspaceId: V.ws, actorId: V.user };
    await withWorkspace(pool, vctx, async (tx) => {
      await createAuthor(tx, V.ws, V.site, { name: "Sam Example", role: "", bio: "", avatarUrl: null });
      await setBudget(tx, V.ws, "seo_credits", 5_000_000, 0);
      await setBudget(tx, V.ws, "llm_tokens", 50_000, 40_000); // $0.01 spendable: less than one turn's estimate
      await addSeeds(tx, V.ws, V.site, ["phone answering"], 1, V.user);
    });
    const llm = new FakeLlm();
    const deps = testDeps(pool, { llm });
    const id = await withWorkspace(pool, vctx, (tx) => createPlanned(tx, V.ws, V.site, new Date(Date.now() + 86_400_000), null, V.user));
    const r = await executeRun(deps, vctx, await startRun(deps, vctx, id!, "manual"));
    assert.deepEqual([r.status, r.step], ["failed", "topic"]);
    assert.match(r.error ?? "", /reserve/);
    assert.equal(llm.calls.length, 0, "the model was never called");
    const [{ n }] = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM usage_ledger WHERE workspace_id = $1 AND category = 'llm_tokens' AND cost_micros > 0", [V.ws], db.name);
    assert.equal(n, 0, "nothing was charged");
  });

  it("rule 1: the runway alert fires (in-app and email) when the queue is short, once, and again when it gets worse", async () => {
    const R = await makeWorkspace(pool, "short", "short.example");
    const rctx = { workspaceId: R.ws, actorId: R.user };
    const clock = { now: new Date("2026-10-07T14:00:00Z") };
    const deps = testDeps(pool, { clock });
    await withWorkspace(pool, rctx, async (tx) => {
      await createAuthor(tx, R.ws, R.site, { name: "Jo Example", role: "", bio: "", avatarUrl: null });
      await tx.exec("UPDATE sites SET schedule_active = true, schedule_days = '{2,5}', timezone = 'America/New_York' WHERE id = $1", [R.site]);
      // one article written and approved for Friday; nothing can write the rest (no publishing connection)
      const id = await createPlanned(tx, R.ws, R.site, new Date("2026-10-09T13:00:00Z"), new Date("2026-10-09T13:00:00Z"), R.user);
      await tx.exec("UPDATE content_items SET status = 'approved' WHERE id = $1", [id]);
    });
    const plan = await planSite(deps, rctx, R.site);
    assert.equal(plan.runway.level, "low");
    assert.equal(plan.runway.days, 2, plan.runway.reason);
    assert.match(plan.runway.reason, /No publishing connection/);
    assert.ok(plan.alerted, "the alert fired");
    assert.equal(deps.rec.mail.length, 1);
    assert.equal(deps.rec.mail[0].kind, "runway-alert");
    assert.equal(deps.rec.mail[0].to, "short@example.test");
    const notes = await adminQuery<{ kind: string; title: string }>("SELECT kind, title FROM notifications WHERE workspace_id = $1", [R.ws], db.name);
    assert.deepEqual(notes.map((n) => n.kind), ["runway"]);
    assert.match(notes[0].title, /2 days of content left/);
    // same level, same day: no second alert
    assert.equal((await checkRunway(deps, rctx, R.site)).alerted, false);
    // Friday's article is gone: the queue is empty, a worse level alerts again
    await asSystem("UPDATE content_items SET status = 'skipped' WHERE site_id = $1", [R.site], db.name);
    const r = await checkRunway(deps, rctx, R.site);
    assert.equal(r.runway.level, "empty");
    assert.equal(r.alerted, true);
    assert.equal(deps.rec.mail.length, 2);
  });
});
