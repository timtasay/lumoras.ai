/**
 * The one metered call path, on a real PostgreSQL with the app role:
 *   - a repeated query within expiry is free (zero-cost cached ledger entry, no provider call);
 *   - a workspace below its reserve cannot spend, and a call that would cross
 *     the reserve is refused BEFORE the provider is called;
 *   - concurrent calls cannot overspend;
 *   - the cache never leaks across workspaces;
 *   - rule 4: a seed in the log is not bought again inside its maximum age;
 *   - failures, price changes, provider balance, stale holds, ledger immutability.
 * Failure messages name the operation and the money involved, so a broken
 * guard says exactly what it let through. CACHE_TEST_SABOTAGE=shared breaks
 * the cache's workspace isolation on purpose (red run).
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { setBudget, listLedger } from "../../lib/data/research.ts";
import { BudgetRefusedError, forgetBalances, meteredCall, quoteCall, type MeterContext } from "../../lib/metering/metered.ts";
import { FakeProvider } from "../../lib/providers/fake.ts";
import { ProviderError, type Market } from "../../lib/providers/types.ts";
import { formatMicros } from "../../lib/research/money.ts";
import { runResearch, quoteResearch } from "../../lib/research/service.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

const US: Market = { locationCode: 2840, languageCode: "en", label: "United States" };
const ideas = (seed: string) => ({ op: "keywordIdeas" as const, params: { seed, market: US, limit: 150 } });
const IDEAS_EST = 12_000 + 150 * 120; // 30,000 micros = $0.03

/** Awaits a call that must be refused; if it went through, fails naming the operation and what it cost. */
async function expectRefused(call: Promise<{ costMicros: number; status: string }>, what: string, estimate: number, reason: string, room: string) {
  let r: { costMicros: number; status: string } | undefined;
  try {
    r = await call;
  } catch (e) {
    assert.ok(e instanceof BudgetRefusedError, `${what}: expected a budget refusal, got ${e}`);
    assert.equal(e.reason, reason, `${what}: refused for the wrong reason`);
    return;
  }
  assert.fail(`${what} (estimate ${formatMicros(estimate)}) was allowed and charged ${formatMicros(r.costMicros)} (status ${r.status}) with ${room}; expected a "${reason}" refusal`);
}

describe("the metered call path", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let A: TestWorkspace, B: TestWorkspace;
  let fake: FakeProvider;
  let clock: Date;
  const deps = () => ({ db: pool, provider: fake, now: () => clock });
  const ctx = (w: TestWorkspace): MeterContext => ({ workspaceId: w.ws, actorId: w.user, siteId: w.site });
  const ledger = (w: TestWorkspace) => withWorkspace(pool, ctx(w), (tx) => listLedger(tx, { limit: 1000 }), { readOnly: true });
  const budget = (w: TestWorkspace, ceiling: number, reserve: number) => withWorkspace(pool, ctx(w), (tx) => setBudget(tx, w.ws, "seo_credits", ceiling, reserve));
  const reset = async () => {
    await adminQuery("SELECT set_config('app.actor_id', 'system:test', false); DELETE FROM provider_cache; DELETE FROM usage_ledger; DELETE FROM keywords; DELETE FROM research_log; DELETE FROM seed_backlog", [], db.name);
  };

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 12 });
    // dropping the test database terminates idle connections: that is expected, not a crash
    pool.on("error", () => {});
    A = await makeWorkspace(pool, "meter-a");
    B = await makeWorkspace(pool, "meter-b");
    // red/green: CACHE_TEST_SABOTAGE=shared makes the cache visible across workspaces (policy USING (true))
    if (process.env.CACHE_TEST_SABOTAGE === "shared") {
      await adminQuery("DROP POLICY provider_cache_tenant_isolation ON provider_cache; CREATE POLICY sabotage ON provider_cache USING (true) WITH CHECK (true)", [], db.name);
      console.log("# CACHE_TEST_SABOTAGE=shared applied: this run is expected to FAIL");
    }
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });
  beforeEach(async () => {
    fake = new FakeProvider();
    clock = new Date();
    await reset();
    await budget(A, 10_000_000, 1_000_000); // $10 a month, $1 reserve
    await budget(B, 10_000_000, 1_000_000);
  });

  it("a repeated query within expiry is free: zero-cost cached ledger entry, no provider call", async () => {
    const first = await meteredCall(deps(), ctx(A), ideas("salon pos"));
    assert.equal(first.status, "ok");
    assert.ok(first.costMicros > 0);
    clock = new Date(clock.getTime() + 29 * 86_400_000); // inside the 30-day expiry
    const again = await meteredCall(deps(), ctx(A), ideas("  Salon POS ")); // same request, other spelling
    const calls = fake.calls.get("keywordIdeas") ?? 0;
    assert.ok(
      again.status === "cached" && again.costMicros === 0 && calls === 1,
      `keywordIdeas("salon pos"): a repeat within expiry was charged ${formatMicros(again.costMicros)} (${again.costMicros} micros, status ${again.status}) and the provider was called ${calls} time(s); expected free from the cache and 1 call`,
    );
    assert.deepEqual(again.data, first.data);
    const rows = await ledger(A);
    assert.equal(rows.length, 2);
    const hit = rows.find((r) => r.cached)!;
    assert.ok(hit, "no cached ledger entry");
    assert.equal(hit.cost_micros, 0);
    assert.equal(hit.status, "settled");
    const log = await adminQuery<{ status: string; cost_micros: string }>("SELECT status, cost_micros::text FROM research_log WHERE workspace_id = $1 ORDER BY created_at", [A.ws], db.name);
    assert.deepEqual(log.map((l) => [l.status, l.cost_micros]), [["ok", String(first.costMicros)], ["cached", "0"]]);
  });

  it("after expiry the same query is bought again", async () => {
    await meteredCall(deps(), ctx(A), ideas("salon pos"));
    clock = new Date(clock.getTime() + 31 * 86_400_000);
    const r = await meteredCall(deps(), ctx(A), ideas("salon pos"));
    assert.equal(r.status, "ok");
    assert.equal(fake.calls.get("keywordIdeas"), 2);
  });

  it("charges the provider's actual cost, holds the estimate first, and records units", async () => {
    const r = await meteredCall(deps(), ctx(A), ideas("salon pos"));
    assert.equal(r.estimateMicros, IDEAS_EST);
    assert.equal(r.costMicros, 12_000 + 14 * 120, "14 rows returned: settled below the estimate");
    const [row] = await ledger(A);
    assert.deepEqual([row.status, row.estimate_micros, row.cost_micros, row.units, row.cached], ["settled", IDEAS_EST, r.costMicros, 14, false]);
  });

  it("a call that would cross the reserve is refused before the provider is called", async () => {
    await budget(A, 60_000, 20_000); // spendable 40,000
    await meteredCall(deps(), ctx(A), ideas("salon pos")); // 13,680
    const before = fake.totalCalls();
    await expectRefused(meteredCall(deps(), ctx(A), ideas("no show policy")), 'keywordIdeas("no show policy")', IDEAS_EST, "would_cross_reserve", `only ${formatMicros(60_000 - 20_000 - 13_680)} spendable above a ${formatMicros(20_000)} reserve`);
    assert.equal(fake.totalCalls(), before, `keywordIdeas("no show policy") (estimate ${formatMicros(IDEAS_EST)}) reached the provider although only ${formatMicros(60_000 - 20_000 - 13_680)} was spendable above the reserve`);
    const used = (await ledger(A)).filter((r) => r.status !== "released").reduce((s, r) => s + r.cost_micros, 0);
    assert.ok(used <= 60_000 - 20_000, `spent ${formatMicros(used)}, past the reserve`);
    const log = await adminQuery<{ status: string; detail: string }>("SELECT status, detail FROM research_log WHERE workspace_id = $1 AND status = 'refused'", [A.ws], db.name);
    assert.equal(log.length, 1, "the refusal is in the research log");
    const audit = await adminQuery("SELECT 1 FROM audit_log WHERE workspace_id = $1 AND action = 'research.refused'", [A.ws], db.name);
    assert.equal(audit.length, 1, "and in the audit log");
  });

  it("a workspace below its reserve cannot spend at all, but can still re-read what it bought", async () => {
    await meteredCall(deps(), ctx(A), ideas("salon pos")); // 13,680
    await budget(A, 20_000, 10_000); // available 6,320 < reserve 10,000
    const before = fake.totalCalls();
    await expectRefused(meteredCall(deps(), ctx(A), { op: "serp", params: { keyword: "salon pos", market: US, depth: 10 } }), 'serp("salon pos")', 2_000, "below_reserve", `${formatMicros(20_000 - 13_680)} left against a ${formatMicros(10_000)} reserve`);
    assert.equal(fake.totalCalls(), before, `serp("salon pos") (estimate $0.0020) reached the provider while the workspace was below its reserve`);
    const cached = await meteredCall(deps(), ctx(A), ideas("salon pos"));
    assert.equal(cached.status, "cached", "a cache hit spends nothing, so it is allowed");
    const q = await quoteCall(deps(), ctx(A), ideas("lash extensions"));
    assert.equal(q.refusal, "below_reserve");
  });

  it("no budget means no paid calls", async () => {
    await withWorkspace(pool, ctx(A), (tx) => tx.exec("DELETE FROM budgets"));
    await assert.rejects(meteredCall(deps(), ctx(A), ideas("salon pos")), (e: unknown) => e instanceof BudgetRefusedError && e.reason === "no_budget");
    assert.equal(fake.totalCalls(), 0);
  });

  it("concurrent calls cannot overspend: ten at once against room for one", async () => {
    await budget(A, IDEAS_EST + 5_000, 5_000); // room for exactly one estimate above the reserve
    fake.delayMs = 150; // every call is in flight at the same time
    // widen the race: inside the reservation, after reading the budget, wait for the other
    // calls to read it too (up to 150 ms). Without the lock all ten read "nothing spent yet".
    let arrived = 0;
    const barrier = async () => {
      arrived++;
      const t0 = Date.now();
      while (arrived < 10 && Date.now() - t0 < 150) await new Promise((r) => setTimeout(r, 5));
    };
    const seeds = Array.from({ length: 10 }, (_, i) => `concurrent seed ${i}`);
    const results = await Promise.allSettled(seeds.map((s) => meteredCall({ ...deps(), afterBudgetRead: barrier }, ctx(A), ideas(s))));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && r.reason instanceof BudgetRefusedError).length;
    const spent = (await ledger(A)).filter((r) => r.status !== "released").reduce((s, r) => s + r.cost_micros, 0);
    assert.equal(ok, 1, `${ok} of 10 concurrent keywordIdeas calls (estimate ${formatMicros(IDEAS_EST)} each) passed a budget with room for one; spent ${formatMicros(spent)} against ${formatMicros(IDEAS_EST)} spendable`);
    assert.equal(refused, 9);
    assert.equal(fake.calls.get("keywordIdeas"), 1, "only one reached the provider");
    assert.ok(spent <= IDEAS_EST, `spent ${formatMicros(spent)}`);
  });

  it("refuses when the price went up after the person confirmed it", async () => {
    await assert.rejects(meteredCall(deps(), ctx(A), ideas("salon pos"), { confirmMaxMicros: IDEAS_EST - 1 }), (e: unknown) => e instanceof BudgetRefusedError && e.reason === "price_changed");
    assert.equal(fake.totalCalls(), 0);
    const ok = await meteredCall(deps(), ctx(A), ideas("salon pos"), { confirmMaxMicros: IDEAS_EST });
    assert.equal(ok.status, "ok");
    const hit = await meteredCall(deps(), ctx(A), ideas("salon pos"), { confirmMaxMicros: 0 });
    assert.equal(hit.status, "cached", "a free cache hit confirmed at $0 is served, not refused as a price change");
  });

  it("checks the provider's own balance before spending", async () => {
    fake.balanceMicros = 1_000;
    forgetBalances(fake);
    await assert.rejects(meteredCall(deps(), ctx(A), ideas("salon pos")), (e: unknown) => e instanceof BudgetRefusedError && e.reason === "provider_balance");
    assert.equal(fake.totalCalls(), 0);
  });

  it("a failed call is released, or charged what the provider says it billed", async () => {
    fake.failWith = new ProviderError("upstream timeout");
    await assert.rejects(meteredCall(deps(), ctx(A), ideas("salon pos")), /upstream timeout/);
    fake.failWith = new ProviderError("Invalid Field", { billedMicros: 5_000 });
    await assert.rejects(meteredCall(deps(), ctx(A), ideas("no show policy")), /Invalid Field/);
    const rows = await ledger(A);
    assert.deepEqual(rows.map((r) => [r.status, r.cost_micros]).sort(), [["released", 0], ["settled", 5_000]]);
    const logs = await adminQuery<{ status: string }>("SELECT status FROM research_log WHERE workspace_id = $1", [A.ws], db.name);
    assert.deepEqual(logs.map((l) => l.status), ["error", "error"]);
  });

  it("a hold that was never settled (crash mid-call) is counted as spent at its estimate", async () => {
    await withWorkspace(pool, ctx(A), (tx) =>
      tx.exec(
        `INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, estimate_micros, cost_micros, actor_id, created_at)
         VALUES ($1, $2, 'seo_credits', 'keywordIdeas', 'fake', date_trunc('month', now() AT TIME ZONE 'UTC')::date, 'held', 30000, 30000, $3, now() - interval '2 hours')`,
        [A.ws, A.site, A.user],
      ),
    );
    await meteredCall(deps(), ctx(A), ideas("salon pos"));
    const stale = (await ledger(A)).find((r) => r.estimate_micros === 30_000 && r.detail?.startsWith("stale"));
    assert.ok(stale && stale.status === "settled" && stale.cost_micros === 30_000, "the stale hold was not settled at its estimate");
  });

  it("settled ledger entries are final and the app cannot delete them", async () => {
    const r = await meteredCall(deps(), ctx(A), ideas("salon pos"));
    await assert.rejects(withWorkspace(pool, ctx(A), (tx) => tx.exec("UPDATE usage_ledger SET cost_micros = 0 WHERE id = $1", [r.ledgerId])), /cannot change/);
    await assert.rejects(withWorkspace(pool, ctx(A), (tx) => tx.exec("DELETE FROM usage_ledger")), /permission denied/);
    await assert.rejects(withWorkspace(pool, ctx(A), (tx) => tx.exec("DELETE FROM research_log")), /permission denied/);
    await assert.rejects(withWorkspace(pool, ctx(A), (tx) => tx.exec("UPDATE research_log SET cost_micros = 0")), /permission denied/);
  });

  it("the cache never leaks across workspaces: B pays for its own data and cannot see A's entries", async () => {
    await meteredCall(deps(), ctx(A), ideas("salon pos"));
    const qb = await quoteCall(deps(), ctx(B), ideas("salon pos"));
    assert.equal(qb.cached, null, "B's quote says the result is cached because A bought it: the cache tells B what A researched");
    const rb = await meteredCall(deps(), ctx(B), ideas("salon pos"));
    assert.equal(rb.status, "ok", `B's identical keywordIdeas("salon pos") came from A's cache (charged ${formatMicros(rb.costMicros)})`);
    assert.equal(fake.calls.get("keywordIdeas"), 2, "B's call went to the provider");
    await withWorkspace(pool, ctx(B), async (tx) => {
      const rows = await tx.many<{ workspace_id: string }>("SELECT workspace_id FROM provider_cache");
      assert.ok(rows.every((r) => r.workspace_id === B.ws), "B can read A's cache rows");
      const logs = await tx.many("SELECT 1 FROM research_log WHERE workspace_id = $1", [A.ws]);
      assert.equal(logs.length, 0, "B can read A's research log");
    });
    const keys = await adminQuery<{ workspace_id: string }>("SELECT workspace_id FROM provider_cache", [], db.name);
    assert.equal(keys.length, 2, "one entry per workspace");
    // and B's ledger shows a paid call, not a cache hit that would reveal A's research
    const lb = await ledger(B);
    assert.deepEqual(lb.map((r) => r.cached), [false]);
  });

  it("rule 4: a seed already in the log is not bought again inside the site's maximum age", async () => {
    const site = { id: A.site, domain: A.domain, research_max_age_days: 90 };
    const brand = { sells: ["Salon point of sale"], does_not_sell: ["Restaurant software"] };
    await withWorkspace(pool, ctx(A), (tx) => tx.exec("INSERT INTO seed_backlog (workspace_id, site_id, seed, added_by) VALUES ($1, $2, 'salon pos', 'test')", [A.ws, A.site]));
    const first = await runResearch(deps(), ctx(A), site, brand, US, { kind: "ideas", seed: "Salon POS" });
    assert.equal(first.status, "ok");
    assert.ok(first.kind === "ideas" && first.rows.find((r) => r.keyword === "restaurant pos system")?.fit === "not_offered", "rule 7 applied to the results");
    clock = new Date(clock.getTime() + 60 * 86_400_000); // cache expired, still inside 90 days
    const q = await quoteResearch(deps(), ctx(A), site, US, { kind: "ideas", seed: "salon pos" });
    assert.equal(q.kind, "logged");
    const second = await runResearch(deps(), ctx(A), site, brand, US, { kind: "ideas", seed: "salon pos" });
    assert.equal(second.status, "logged", `seed "salon pos" researched 60 days ago was bought again (status ${second.status}, ${formatMicros(second.costMicros)})`);
    assert.equal(fake.calls.get("keywordIdeas"), 1);
    assert.equal((await ledger(A)).length, 1, "no ledger entry for reading the log");
    const [bk] = await adminQuery<{ status: string; research_count: number }>("SELECT status, research_count FROM seed_backlog WHERE site_id = $1", [A.site], db.name);
    assert.deepEqual([bk.status, bk.research_count], ["researched", 1]);
    clock = new Date(clock.getTime() + 31 * 86_400_000); // 91 days: stale
    const third = await runResearch(deps(), ctx(A), site, brand, US, { kind: "ideas", seed: "salon pos" });
    assert.equal(third.status, "ok");
    assert.equal(fake.calls.get("keywordIdeas"), 2);
  });

  it("free operations go through the same path and cost nothing", async () => {
    await budget(A, 0, 0);
    const t = await meteredCall(deps(), ctx(A), { op: "rankTracker.create", params: { domain: A.domain, market: US, depth: 20 } });
    assert.equal(t.costMicros, 0);
    const [row] = await ledger(A);
    assert.deepEqual([row.operation, row.status, row.cost_micros], ["rankTracker.create", "settled", 0]);
  });
});
