/**
 * Phase 4 measurement on a real PostgreSQL with the app role, against a local
 * fake Google (realistic Search Analytics / URL Inspection / GA4 shapes) and
 * the fake SEO data provider. Never a real service, never real money.
 *
 *   - Search Console sync: 16-month totals on first connect, provisional days
 *     (data lag), backfill in chunks to the retention limit, and idempotency:
 *     re-running the same day stores the same rows and never double counts;
 *     a rate limit is retried, a revoked grant turns the connection red.
 *   - GA4 sync and measurement health: a broken tag reads as an error, not
 *     as zero traffic, and turns the connection red with a notification.
 *   - Rank tracking is priced first and refused below the reserve without
 *     calling the provider; with room it is charged once per window and moves.
 *   - Site audit: start, poll, issues grouped; "fix" creates one task;
 *     assignees must be members; carry-over to the next audit.
 *   - Backlinks baseline with competitors, new and lost referring domains.
 *   - URL inspection (read-only), capped per day.
 *   - The hourly tick enqueues due work once per window.
 *   - The agency home's cross-workspace health read is admin-only and audited.
 *
 * MEASURE_TEST_SABOTAGE is not used: the red runs break the source on purpose
 * (see docs/phase-4-summary.md for the commands and outputs).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readKeyring } from "../../lib/crypto/secrets.ts";
import { withActor, withWorkspace } from "../../lib/db/tenant.ts";
import { setBudget } from "../../lib/data/research.ts";
import { platformHealth } from "../../lib/data/workspaces.ts";
import { googleEndpoints } from "../../lib/google/oauth.ts";
import { forgetGoogleCaches, saveGrantWithProperty, type GoogleDeps } from "../../lib/google/service.ts";
import { createLogger } from "../../lib/log.ts";
import { assignIssue, createFixTask, pollSiteAudit, startSiteAudit } from "../../lib/measure/audit.ts";
import { runBacklinks } from "../../lib/measure/backlinks.ts";
import { windowKey } from "../../lib/measure/cadence.ts";
import { gscKpis, gscSeries, latestAudit, rankTrends, strikingFromStore } from "../../lib/measure/dashboard.ts";
import { syncGa4 } from "../../lib/measure/ga4-sync.ts";
import { syncSearchConsole } from "../../lib/measure/gsc-sync.ts";
import { inspectSite } from "../../lib/measure/inspect.ts";
import { runRankTracking } from "../../lib/measure/rank.ts";
import type { MeasureDeps } from "../../lib/measure/runs.ts";
import { measureTick } from "../../lib/measure/scheduler.ts";
import { FakeProvider } from "../../lib/providers/fake.ts";
import { QUEUES } from "../../lib/pipeline/deps.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { FAKE_GOOGLE_CLIENT, startFakeGoogle } from "../helpers/fake-google.ts";
import { dayTotal, firstIncomplete, pacificToday, totalsBetween } from "../helpers/fake-google-data.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

const ring = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64") });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("measurement", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let g: Awaited<ReturnType<typeof startFakeGoogle>>;
  let A: TestWorkspace, B: TestWorkspace;
  let clock = new Date("2026-10-10T18:00:00Z");
  let fake: FakeProvider;
  const jobs: { queue: string; data: Record<string, unknown>; singletonKey?: string; startAfter?: Date }[] = [];
  let google: GoogleDeps;
  const deps = (o: Partial<MeasureDeps> = {}): MeasureDeps => ({
    db: pool,
    seo: fake,
    google,
    now: () => clock,
    log: createLogger("test", { level: "error" }),
    enqueue: async (queue, data, opts) => void jobs.push({ queue, data, ...opts }),
    googlePauseMs: 0,
    ...o,
  });
  const ctx = (w: TestWorkspace) => ({ workspaceId: w.ws, actorId: w.user });
  const asA = <T>(fn: Parameters<typeof withWorkspace<T>>[2]) => withWorkspace(pool, ctx(A), fn);
  const count = async (sql: string, params: unknown[] = []) => Number((await adminQuery<{ n: string }>(sql, params, db.name))[0].n);

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    pool.on("error", () => {});
    g = await startFakeGoogle({ now: () => clock });
    google = { db: pool, ring, endpoints: googleEndpoints(g.origin), client: FAKE_GOOGLE_CLIENT };
    fake = new FakeProvider({ now: () => clock });
    A = await makeWorkspace(pool, "meas-a", "sonorch.ai");
    B = await makeWorkspace(pool, "meas-b", "northwind-dental.example");
    await asA(async (tx) => {
      await saveGrantWithProperty(tx, ring, A.ws, A.site, "search_console", g.issueRefreshToken("search_console"), "sc-domain:sonorch.ai", "test");
      await saveGrantWithProperty(tx, ring, A.ws, A.site, "ga4", g.issueRefreshToken("ga4"), "properties/111111111", "test");
      await tx.exec("UPDATE brand_profiles SET competitors = '{rival-salon.example,https://www.other-pos.example/}', key_pages = '[{\"url\":\"https://sonorch.ai/\"},{\"url\":\"https://sonorch.ai/pricing\"}]' WHERE site_id = $1", [A.site]);
    });
    await withWorkspace(pool, ctx(B), async (tx) => {
      await saveGrantWithProperty(tx, ring, B.ws, B.site, "search_console", g.issueRefreshToken("search_console"), "sc-domain:northwind-dental.example", "test");
      await saveGrantWithProperty(tx, ring, B.ws, B.site, "ga4", g.issueRefreshToken("ga4"), "properties/333333333", "test");
    });
  });
  after(async () => {
    await pool?.end();
    await g?.close();
    await dropAll();
  });

  // -------------------------------------------------------------------------
  // Search Console
  // -------------------------------------------------------------------------
  it("first Search Console sync: 16 months of daily totals, provisional days flagged, the newest 30 days of details", async () => {
    jobs.length = 0;
    const r = await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "connect" });
    assert.equal(r.status, "ok", r.detail);
    const today = pacificToday(clock);
    assert.equal(r.firstIncomplete, firstIncomplete(today));
    assert.ok(r.plan!.firstSync && r.plan!.detailDays.length === 30);
    const [span] = await adminQuery<{ min: string; max: string; n: string }>("SELECT to_char(min(day), 'YYYY-MM-DD') AS min, to_char(max(day), 'YYYY-MM-DD') AS max, count(*) AS n FROM gsc_daily WHERE site_id = $1", [A.site], db.name);
    assert.equal(span.max, addDays(today, -1), "the newest day is yesterday (Pacific)");
    assert.ok(Number(span.n) > 470, `only ${span.n} days of totals: expected about 16 months`);
    // the lag: the days from first_incomplete_date on are provisional; earlier ones final
    const prov = await adminQuery<{ day: string }>("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM gsc_daily WHERE site_id = $1 AND NOT final ORDER BY day", [A.site], db.name);
    assert.deepEqual(prov.map((p) => p.day), [firstIncomplete(today), addDays(today, -1)]);
    // stored totals equal what Google reports for those days
    const d = addDays(today, -10);
    const [row] = await adminQuery<{ clicks: number; impressions: number }>("SELECT clicks, impressions FROM gsc_daily WHERE site_id = $1 AND day = $2", [A.site, d], db.name);
    const want = dayTotal("sc-domain:sonorch.ai", d, today)!;
    assert.deepEqual([row.clicks, row.impressions], [want.clicks, want.impressions]);
    assert.equal(await count("SELECT count(DISTINCT day) AS n FROM gsc_query_daily WHERE site_id = $1", [A.site]), 30);
    // the backfill continues in another job
    assert.ok(r.backfillRemaining);
    assert.equal(jobs.filter((j) => j.queue === QUEUES.gscSync && j.data.backfill).length, 1);
  });

  it("idempotent: re-running the same day stores the same rows and never double counts", async () => {
    const snap = async () => ({
      totals: (await adminQuery<{ c: string; i: string; n: string }>("SELECT sum(clicks)::text c, sum(impressions)::text i, count(*)::text n FROM gsc_daily WHERE site_id = $1", [A.site], db.name))[0],
      q: (await adminQuery<{ c: string; n: string }>("SELECT sum(clicks)::text c, count(*)::text n FROM gsc_query_daily WHERE site_id = $1", [A.site], db.name))[0],
      p: (await adminQuery<{ c: string; n: string }>("SELECT sum(clicks)::text c, count(*)::text n FROM gsc_page_daily WHERE site_id = $1", [A.site], db.name))[0],
    });
    // the second step reads the recent days again plus the next backfill chunk; the third, the same recent days again
    await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" });
    const once = await snap();
    const recentBefore = await adminQuery<{ day: string; clicks: number }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, clicks FROM gsc_daily WHERE site_id = $1 AND day > $2::date - 6 ORDER BY day", [A.site, pacificToday(clock)], db.name);
    // force the same window again: rewind the cursor so the step re-reads exactly the same days
    const [st] = await adminQuery<{ c: string }>("SELECT to_char(backfill_cursor, 'YYYY-MM-DD') c FROM search_sync_state WHERE site_id = $1 AND kind = 'search_console'", [A.site], db.name);
    await adminQuery("SELECT set_config('app.actor_id', 'system:test', false); UPDATE search_sync_state SET backfill_cursor = $2::date + 30 WHERE site_id = $1 AND kind = 'search_console'".replace("$2", `'${st.c}'`).replace("$1", `'${A.site}'`), [], db.name);
    await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" });
    const twice = await snap();
    assert.deepEqual(twice, once, `re-running the same days changed the stored totals: ${JSON.stringify(once)} → ${JSON.stringify(twice)}`);
    const recentAfter = await adminQuery<{ day: string; clicks: number }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, clicks FROM gsc_daily WHERE site_id = $1 AND day > $2::date - 6 ORDER BY day", [A.site, pacificToday(clock)], db.name);
    assert.deepEqual(recentAfter, recentBefore);
    // and the 28-day KPI equals what Search Console reports for the same days (dataState all)
    const k = await asA((tx) => gscKpis(tx, A.site, clock));
    const end = addDays(pacificToday(clock), -1);
    const want = totalsBetween("sc-domain:sonorch.ai", addDays(end, -27), end, pacificToday(clock), "all");
    assert.equal(k.clicks, want.clicks, `KPI clicks ${k.clicks} ≠ Search Console's ${want.clicks}: counted twice or missed days`);
    assert.equal(k.impressions, want.impressions);
  });

  it("backfill walks back to the 16-month limit in chunks, then stops; a provisional day becomes final a day later", async () => {
    for (let i = 0; i < 30; i++) {
      const r = await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" });
      if (!r.backfillRemaining) break;
    }
    const [st] = await adminQuery<{ backfilled_at: Date | null; from: string; cursor: string }>("SELECT backfilled_at, to_char(backfill_from, 'YYYY-MM-DD') \"from\", to_char(backfill_cursor, 'YYYY-MM-DD') cursor FROM search_sync_state WHERE site_id = $1 AND kind = 'search_console'", [A.site], db.name);
    assert.ok(st.backfilled_at, "the backfill never finished");
    assert.equal(st.cursor, st.from);
    const [days] = await adminQuery<{ n: string; min: string }>("SELECT count(DISTINCT day) n, to_char(min(day), 'YYYY-MM-DD') min FROM gsc_query_daily WHERE site_id = $1", [A.site], db.name);
    assert.ok(Number(days.n) > 470, `details for ${days.n} days`);
    assert.ok(days.min >= st.from);
    const provisional = firstIncomplete(pacificToday(clock));
    clock = new Date(clock.getTime() + 86_400_000);
    await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" });
    const [was] = await adminQuery<{ final: boolean }>("SELECT final FROM gsc_daily WHERE site_id = $1 AND day = $2", [A.site, provisional], db.name);
    assert.equal(was.final, true, "yesterday's provisional day is final once Google says so");
    // the dashboard reads striking-distance queries from the stored rows
    const s = await asA((tx) => strikingFromStore(tx, A.site, clock));
    assert.ok(s.length >= 3 && s.every((x) => x.position >= 4 && x.position <= 20));
    assert.ok(s.some((x) => x.query === "salon no show policy"));
    assert.ok(!s.some((x) => x.query === "salon software"), "position 34 is not striking distance");
    const series = await asA((tx) => gscSeries(tx, A.site, clock, 90));
    assert.equal(series.days.length, 90);
  });

  it("a rate limit is retried (the error propagates for the queue's backoff); a revoked grant turns the connection red", async () => {
    g.state.gscFailNext = 429;
    await assert.rejects(syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" }), /429/);
    const [st] = await adminQuery<{ status: string; failures: number }>("SELECT status, failures FROM search_sync_state WHERE site_id = $1 AND kind = 'search_console'", [A.site], db.name);
    assert.notEqual(st.status, "error", "a rate limit is not a failing connection");
    assert.equal(st.failures, 1);
    const ok = await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" });
    assert.equal(ok.status, "ok");
  });

  // -------------------------------------------------------------------------
  // GA4
  // -------------------------------------------------------------------------
  it("GA4: sessions, organic landing pages and key events; health ok next to Search Console's clicks", async () => {
    const r = await syncGa4(deps(), ctx(A), A.site, { trigger: "connect" });
    assert.equal(r.status, "ok", r.detail);
    assert.equal(r.days, 90);
    assert.equal(r.health?.state, "ok", JSON.stringify(r.health?.signals));
    const top = await adminQuery<{ landing_page: string }>("SELECT landing_page FROM ga4_landing_daily WHERE site_id = $1 GROUP BY landing_page ORDER BY sum(sessions) DESC LIMIT 1", [A.site], db.name);
    assert.equal(top[0].landing_page, "/insights/no-show-policy");
    assert.ok((await count("SELECT count(*) n FROM ga4_event_daily WHERE site_id = $1 AND event_name = 'generate_lead'", [A.site])) > 0);
    const again = await syncGa4(deps(), ctx(A), A.site, { trigger: "schedule" });
    assert.equal(again.days, 7, "later syncs re-read the last 7 days");
    assert.equal(await count("SELECT count(*) n FROM ga4_daily WHERE site_id = $1", [A.site]), 90, "re-reading days replaced them, never duplicated");
  });

  it("GA4: a broken tag is an error (\"zero here does not mean zero traffic\"), the connection turns red, people are told", async () => {
    await syncSearchConsole(deps(), ctx(B), B.site, { trigger: "connect" });
    const runId = (await withWorkspace(pool, ctx(B), (tx) => tx.one<{ id: string }>("INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, created_by) VALUES ($1, $2, 'ga4', 'd:test', 'system:test') RETURNING id", [B.ws, B.site]))).id;
    const r = await syncGa4(deps(), ctx(B), B.site, { trigger: "schedule", runId });
    assert.equal(r.health?.state, "error");
    assert.match(r.health!.headline, /zero here does not mean zero traffic/);
    const codes = r.health!.signals.map((s) => s.code);
    assert.ok(codes.includes("no_data"), codes.join());
    assert.ok(codes.includes("no_key_events"), codes.join());
    const [c] = await adminQuery<{ status: string; status_detail: string }>("SELECT status, status_detail FROM connections WHERE site_id = $1 AND kind = 'ga4'", [B.site], db.name);
    assert.equal(c.status, "error");
    assert.equal(await count("SELECT count(*) n FROM notifications WHERE workspace_id = $1 AND kind = 'measure-ga4'", [B.ws]), 1);
  });

  // -------------------------------------------------------------------------
  // Rank tracking: priced first, refused below the reserve
  // -------------------------------------------------------------------------
  it("rank tracking is priced first and refused below the reserve: the provider is never called and nothing is charged", async () => {
    await asA(async (tx) => {
      await tx.exec("INSERT INTO keywords (workspace_id, site_id, keyword, status, cluster, search_volume) VALUES ($1, $2, 'salon pos', 'targeted', 'Point of sale', 900), ($1, $2, 'salon software', 'ranking', 'Point of sale', 2400), ($1, $2, 'esthetician salary', 'idea', 'Careers', 3000)", [A.ws, A.site]);
      await tx.exec("INSERT INTO rank_tracking_queue (workspace_id, site_id, keyword, market) VALUES ($1, $2, 'salon no show policy', 'United States')", [A.ws, A.site]);
      // a budget whose reserve is already reached: $1.00 a month, $0.90 reserve, $0.95 spent
      await setBudget(tx, A.ws, "seo_credits", 1_000_000, 900_000);
      await tx.exec("INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, cost_micros, estimate_micros, actor_id, settled_at) VALUES ($1, $2, 'seo_credits', 'serp', 'fake', date_trunc('month', $3::timestamptz AT TIME ZONE 'UTC')::date, 'settled', 950000, 950000, 'system:test', now())", [A.ws, A.site, clock]);
    });
    fake.calls.clear();
    const est = fake.estimateCost.bind(fake);
    const order: string[] = [];
    fake.estimateCost = async (o) => (order.push(`estimate:${o.op}`), est(o));
    const runBefore = fake.rankTracker.run;
    fake.rankTracker.run = async (p) => (order.push("run"), runBefore(p));
    const key = windowKey("weekly", clock, "UTC");
    const r = await runRankTracking(deps(), ctx(A), A.site, { windowKey: key, trigger: "schedule" });
    fake.estimateCost = est;
    fake.rankTracker.run = runBefore;
    assert.equal(r.status, "refused", `a rank check below the reserve was not refused: ${JSON.stringify(r)}; provider calls: ${JSON.stringify([...fake.calls])}`);
    assert.equal(fake.calls.get("rankTracker.run") ?? 0, 0, "the provider was called for a refused rank check");
    assert.ok(order.includes("estimate:rankTracker.run") && !order.includes("run"), `priced first, never run: ${order.join(" → ")}`);
    const [run] = await adminQuery<{ status: string; detail: string; estimate_micros: string }>("SELECT status, detail, estimate_micros::text FROM measurement_runs WHERE id = $1", [r.runId], db.name);
    assert.equal(run.status, "refused");
    assert.match(run.detail, /reserve/);
    assert.equal(Number(run.estimate_micros), 3 * 3 * 2000, "3 keywords × 3 pages of 10 × $0.002");
    assert.equal(await count("SELECT count(*) n FROM usage_ledger WHERE workspace_id = $1 AND operation = 'rankTracker.run'", [A.ws]), 0, "a refused rank check was charged");
    assert.equal(await count("SELECT count(*) n FROM rank_snapshots WHERE site_id = $1", [A.site]), 0);
    assert.equal(await count("SELECT count(*) n FROM research_log WHERE site_id = $1 AND operation = 'rankTracker.run' AND status = 'refused'", [A.site]), 0, "quote refusals are not logged as calls");
    assert.equal(await count("SELECT count(*) n FROM notifications WHERE workspace_id = $1 AND kind = 'measure-rank'", [A.ws]), 1, "owners and editors are told");
    // the same window again before retry_after: nothing happens
    const again = await runRankTracking(deps(), ctx(A), A.site, { windowKey: key, trigger: "schedule" });
    assert.equal(again.status, "skipped");
  });

  it("with room above the reserve: one charged check per window, snapshots with the charge, positions move week to week", async () => {
    await asA((tx) => setBudget(tx, A.ws, "seo_credits", 25_000_000, 1_000_000));
    clock = new Date(clock.getTime() + 25 * 3_600_000); // past the refused run's retry_after
    const key = windowKey("weekly", clock, "UTC");
    const r = await runRankTracking(deps(), ctx(A), A.site, { windowKey: key, trigger: "schedule" });
    assert.equal(r.status, "succeeded", JSON.stringify(r));
    if (r.status !== "succeeded") return;
    assert.equal(r.tracked, 3, "published keyword + 2 targeted/ranking saved keywords (ideas are not tracked)");
    const led = await adminQuery<{ status: string; cost_micros: string }>("SELECT status, cost_micros::text FROM usage_ledger WHERE workspace_id = $1 AND operation = 'rankTracker.run' AND status <> 'released'", [A.ws], db.name);
    assert.deepEqual(led.map((l) => [l.status, Number(l.cost_micros)]), [["settled", r.costMicros]]);
    const snaps = await adminQuery<{ keyword: string; source: string; device: string; location: string }>("SELECT keyword, source, device, location FROM rank_snapshots WHERE run_id = $1 ORDER BY keyword", [r.runId], db.name);
    assert.deepEqual(snaps.map((s) => [s.keyword, s.source]), [["salon no show policy", "published"], ["salon pos", "saved"], ["salon software", "saved"]]);
    assert.ok(snaps.every((s) => s.device === "desktop" && s.location === "United States"));
    // a second delivery of the same job does nothing (and charges nothing)
    const dup = await runRankTracking(deps(), ctx(A), A.site, { windowKey: key, trigger: "schedule" });
    assert.equal(dup.status, "skipped");
    assert.equal(await count("SELECT count(*) n FROM usage_ledger WHERE workspace_id = $1 AND operation = 'rankTracker.run' AND status = 'settled'", [A.ws]), 1);
    // weeks later: movement against the previous check
    for (let w = 1; w <= 3; w++) {
      clock = new Date(clock.getTime() + 7 * 86_400_000);
      const n = await runRankTracking(deps(), ctx(A), A.site, { windowKey: windowKey("weekly", clock, "UTC"), trigger: "schedule" });
      assert.equal(n.status, "succeeded");
    }
    const trends = await asA((tx) => rankTrends(tx, A.site));
    assert.equal(trends.length, 3);
    assert.ok(trends.every((t) => t.history.length === 4));
    assert.ok(trends.some((t) => t.movement.kind !== "new"), "no keyword has a previous check to move against");
  });

  it("a tracker the provider no longer knows (deleted, or another provider instance) is replaced; the history stays", async () => {
    fake = new FakeProvider({ now: () => clock });
    clock = new Date(clock.getTime() + 7 * 86_400_000);
    const r = await runRankTracking(deps(), ctx(A), A.site, { windowKey: windowKey("weekly", clock, "UTC"), trigger: "schedule" });
    assert.equal(r.status, "succeeded", JSON.stringify(r));
    assert.equal(await count("SELECT count(*) n FROM rank_trackers WHERE site_id = $1", [A.site]), 1, "a second tracker row instead of replacing the provider id");
    const trends = await asA((tx) => rankTrends(tx, A.site));
    assert.ok(trends.every((t) => t.history.length === 5));
  });

  // -------------------------------------------------------------------------
  // Site audit, tasks
  // -------------------------------------------------------------------------
  it("site audit: priced, started, polled; issues grouped; fix creates one task; only members can be assigned", async () => {
    jobs.length = 0;
    const s = await startSiteAudit(deps(), ctx(A), A.site, { windowKey: windowKey("monthly", clock, "UTC"), trigger: "schedule" });
    assert.equal(s.status, "waiting");
    assert.equal(jobs.filter((j) => j.queue === QUEUES.auditPoll).length, 1, "a poll is queued");
    if (s.status !== "waiting") return;
    const p = await pollSiteAudit(deps(), ctx(A), { siteId: A.site, runId: s.runId });
    assert.equal(p.status, "succeeded");
    const v = await asA((tx) => latestAudit(tx, A.site));
    assert.deepEqual(v.issues.map((i) => [i.issue_type, i.category, i.severity, i.count, i.title]), [
      ["broken_internal_link", "links", "critical", 2, "2 broken internal links"],
      ["title_too_long", "metadata", "warning", 17, "17 titles over 60 characters"],
      ["missing_meta_description", "metadata", "warning", 4, "4 pages without a meta description"],
    ]);
    const titles = v.issues.find((i) => i.issue_type === "title_too_long")!;
    const t1 = await asA(async (tx) => { await tx.action("task.fix"); return createFixTask(tx, A.ws, titles.id, A.user); });
    const t2 = await asA(async (tx) => { await tx.action("task.fix"); return createFixTask(tx, A.ws, titles.id, A.user); });
    assert.ok(t1.created && !t2.created && t1.taskId === t2.taskId, "a second fix made a second task");
    const [task] = await adminQuery<{ title: string; source: string }>("SELECT title, source FROM tasks WHERE id = $1", [t1.taskId], db.name);
    assert.deepEqual(task, { title: "Shorten 17 titles over 60 characters", source: "audit" });
    await assert.rejects(asA((tx) => assignIssue(tx, A.ws, titles.id, B.user)), /Only members/);
    await asA((tx) => assignIssue(tx, A.ws, titles.id, A.user));
    const [assigned] = await adminQuery<{ a: string; t: string }>("SELECT i.assignee_id a, t.assignee_id t FROM audit_issues i JOIN tasks t ON t.id = i.task_id WHERE i.id = $1", [titles.id], db.name);
    assert.deepEqual(assigned, { a: A.user, t: A.user });
    // next month's audit keeps the assignee and the open task
    clock = new Date(clock.getTime() + 32 * 86_400_000);
    const s2 = await startSiteAudit(deps(), ctx(A), A.site, { windowKey: windowKey("monthly", clock, "UTC"), trigger: "schedule" });
    if (s2.status === "waiting") await pollSiteAudit(deps(), ctx(A), { siteId: A.site, runId: s2.runId });
    const v2 = await asA((tx) => latestAudit(tx, A.site));
    const again = v2.issues.find((i) => i.issue_type === "title_too_long")!;
    assert.equal(again.assignee_id, A.user);
    assert.equal(again.task_id, t1.taskId);
    assert.equal(v2.previousTotal, 23);
  });

  // -------------------------------------------------------------------------
  // Backlinks
  // -------------------------------------------------------------------------
  it("backlinks baseline: the site and its competitors, priced as a whole; a later quarter counts new and lost referring domains", async () => {
    const q1 = await runBacklinks(deps(), ctx(A), A.site, { windowKey: windowKey("quarterly", clock, "UTC"), trigger: "schedule" });
    assert.equal(q1.status, "succeeded", JSON.stringify(q1));
    const rows = await adminQuery<{ domain: string; is_competitor: boolean; new_referring_domains: number | null }>("SELECT domain, is_competitor, new_referring_domains FROM backlink_snapshots WHERE site_id = $1 ORDER BY is_competitor, domain", [A.site], db.name);
    assert.deepEqual(rows.map((r) => [r.domain, r.is_competitor, r.new_referring_domains]), [["sonorch.ai", false, null], ["other-pos.example", true, null], ["rival-salon.example", true, null]]);
    clock = new Date(clock.getTime() + 95 * 86_400_000);
    const q2 = await runBacklinks(deps(), ctx(A), A.site, { windowKey: windowKey("quarterly", clock, "UTC"), trigger: "schedule" });
    assert.equal(q2.status, "succeeded");
    const [latest] = await adminQuery<{ n: number | null; l: number | null }>("SELECT new_referring_domains n, lost_referring_domains l FROM backlink_snapshots WHERE site_id = $1 AND domain = 'sonorch.ai' ORDER BY captured_at DESC LIMIT 1", [A.site], db.name);
    assert.ok(latest.n !== null && latest.l !== null && latest.n + latest.l > 0, `new/lost not computed: ${JSON.stringify(latest)}`);
    // no budget: refused before any call
    fake.calls.clear();
    const r = await runBacklinks(deps(), ctx(B), B.site, { windowKey: "q:test", trigger: "manual" });
    assert.equal(r.status, "refused");
    assert.equal(fake.calls.get("backlinksOverview") ?? 0, 0);
  });

  // -------------------------------------------------------------------------
  // URL inspection (read-only), the tick, the agency read
  // -------------------------------------------------------------------------
  it("URL inspection: read-only index status of key pages and top search pages, capped per day", async () => {
    await asA((tx) => tx.exec("UPDATE sites SET inspect_daily_cap = 3 WHERE id = $1", [A.site]));
    await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule" }); // the current top pages (the clock moved months on)
    const r = await inspectSite(deps(), ctx(A), A.site, { trigger: "schedule", pauseMs: 0 });
    assert.equal(r.inspected, 3, r.detail);
    const rows = await adminQuery<{ url: string; verdict: string; source: string }>("SELECT url, verdict, source FROM url_inspections WHERE site_id = $1 ORDER BY url", [A.site], db.name);
    assert.ok(rows.some((x) => x.url === "https://sonorch.ai/" && x.verdict === "PASS"));
    assert.ok(rows.some((x) => x.url === "https://sonorch.ai/pricing" && x.verdict === "NEUTRAL"));
    const more = await inspectSite(deps(), ctx(A), A.site, { trigger: "schedule", pauseMs: 0 });
    assert.equal(more.inspected, 0, "the daily cap was exceeded");
    // every inspection hit the read-only endpoint, never anything else
    assert.ok(g.requests.filter((x) => x.path.includes("urlInspection")).length >= 3);
    assert.ok(!g.requests.some((x) => /indexing|urlNotifications/i.test(x.path)));
  });

  it("the hourly tick enqueues due work once per window", async () => {
    jobs.length = 0;
    const out = await measureTick({ ...deps(), enqueue: async (queue, data, opts) => void jobs.push({ queue, data, ...opts }) });
    const forA = out.find((o) => o.siteId === A.site)?.due.map((d) => d.kind).sort() ?? [];
    assert.ok(forA.includes("gsc") && forA.includes("ga4") && forA.includes("inspect") && forA.includes("rank"), forA.join());
    const keys = jobs.map((j) => j.singletonKey);
    assert.equal(new Set(keys).size, keys.length, "two jobs share an idempotency key");
    assert.ok(keys.every((k) => /^(rank|audit|backlinks|gsc|ga4|inspect):[0-9a-f-]{36}:[a-z]:/.test(k ?? "")), keys.join());
  });

  it("the agency home's health read is admin-only, audited, and reports real numbers", async () => {
    await assert.rejects(withActor(pool, { actorId: A.user }, (tx) => platformHealth(tx)), /not a platform admin/);
    const [admin] = (await pool.query<{ id: string }>("INSERT INTO auth_user (name, email, role) VALUES ('Staff', 'staff-measure@lumoras.test', 'admin') RETURNING id")).rows;
    await assert.rejects(withActor(pool, { actorId: A.user, impersonatorId: admin.id }, (tx) => platformHealth(tx)), /not a platform admin/);
    const rows = await withActor(pool, { actorId: admin.id }, (tx) => platformHealth(tx));
    const a = rows.find((r) => r.workspace_id === A.ws)!;
    assert.ok(Number(a.clicks_28d) > 0);
    assert.equal(a.clicks_weekly?.length, 12);
    assert.equal(a.gsc_sites, 1);
    const b = rows.find((r) => r.workspace_id === B.ws)!;
    assert.ok(b.failing >= 1, "Northwind's broken GA4 counts as a failing connection");
    const [audit] = await adminQuery<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit_log WHERE action = 'platform.health.read' ORDER BY id DESC LIMIT 1", [], db.name);
    assert.deepEqual(audit, { action: "platform.health.read", actor_id: admin.id });
  });

  it("a grant revoked at Google: the sync fails without retrying, the sync and the connection turn red, people are told once", async () => {
    forgetGoogleCaches();
    g.revokeAll();
    const runId = (await asA((tx) => tx.one<{ id: string }>("INSERT INTO measurement_runs (workspace_id, site_id, kind, window_key, created_by) VALUES ($1, $2, 'gsc', 'd:revoked', 'system:test') RETURNING id", [A.ws, A.site]))).id;
    const err = await syncSearchConsole(deps(), ctx(A), A.site, { trigger: "schedule", runId }).then(() => null, (e: unknown) => e);
    assert.ok(err, "a revoked grant synced");
    const { isRetryable } = await import("../../lib/jobs/measure.ts");
    assert.equal(isRetryable(err), false, "a revoked grant would be retried");
    const [st] = await adminQuery<{ status: string }>("SELECT status FROM search_sync_state WHERE site_id = $1 AND kind = 'search_console'", [A.site], db.name);
    const [c] = await adminQuery<{ status: string }>("SELECT status FROM connections WHERE site_id = $1 AND kind = 'search_console'", [A.site], db.name);
    assert.deepEqual([st.status, c.status], ["error", "error"]);
    assert.equal(await count("SELECT count(*) n FROM notifications WHERE workspace_id = $1 AND kind = 'measure-gsc'", [A.ws]), 1);
  });
});
