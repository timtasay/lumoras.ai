/**
 * The three SeoDataProvider implementations against local fakes (no real
 * provider is ever called, no credits spent):
 *   DataForSeoProvider  → a fake api.dataforseo.com (v3 envelope)
 *   OpenSeoProvider     → a fake OpenSEO MCP endpoint (real tool names)
 *   FakeProvider        → fixtures; charges what DataForSEO would
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DataForSeoProvider } from "../../lib/providers/dataforseo.ts";
import { FakeProvider } from "../../lib/providers/fake.ts";
import { McpClient, McpError, parseSse } from "../../lib/providers/mcp-client.ts";
import { OpenSeoProvider, RESEARCH_PROJECT } from "../../lib/providers/openseo.ts";
import { dataForSeoPrice } from "../../lib/providers/operations.ts";
import { ProviderError, ProviderUnsupportedError, invoke, type Market } from "../../lib/providers/types.ts";
import { readSeoProviderEnv } from "../../lib/env.ts";
import { startFakeDataForSeo } from "../helpers/fake-dataforseo.ts";
import { startFakeOpenSeo } from "../helpers/fake-openseo.ts";

const US: Market = { locationCode: 2840, languageCode: "en", label: "United States" };

describe("DataForSeoProvider (against a fake DataForSEO)", () => {
  let dfs: Awaited<ReturnType<typeof startFakeDataForSeo>>;
  let p: DataForSeoProvider;
  before(async () => {
    dfs = await startFakeDataForSeo();
    p = new DataForSeoProvider({ login: "login@example.test", password: "pw-test", baseUrl: dfs.origin });
  });
  after(() => dfs.close());

  it("sends Basic auth and the documented request body; reads rows and the billed cost", async () => {
    const r = await p.keywordIdeas({ seed: "Salon POS", market: US, limit: 150 });
    const req = dfs.requests.at(-1)!;
    assert.equal(req.path, "/v3/dataforseo_labs/google/keyword_ideas/live");
    assert.equal(req.method, "POST");
    assert.deepEqual(req.body, [{ keywords: ["salon pos"], location_code: 2840, language_code: "en", limit: 150, include_serp_info: false }]);
    assert.equal(r.costMicros, 12_360, "cost 0.01236 USD → 12,360 micros");
    assert.equal(r.units, 3);
    assert.deepEqual(r.data[0], { keyword: "salon pos", volume: 1900, kd: 38, cpcMicros: 12_400_000, competition: 0.41, intent: "commercial" });
    assert.equal(r.data[1].keyword, "salon pos system", "keywords are normalised");
    assert.equal(r.data[2].intent, null, "an unknown intent label is dropped, not trusted");
  });

  it("maps SERP, domain overview, ranked keywords, competitors, backlinks and audits", async () => {
    const serp = await p.serp({ keyword: "salon pos", market: US, depth: 20 });
    assert.deepEqual(serp.data.map((i) => [i.rank, i.type, i.domain]), [[1, "paid", "ads.example"], [2, "organic", "sonorch.ai"], [3, "organic", "other.example"]]);
    const ov = await p.domainOverview({ domain: "sonorch.ai", market: US });
    assert.deepEqual(ov.data, { organicTraffic: 1841, organicKeywords: 612, top3: 8, top10: 28, trafficValueMicros: 3_120_500_000 });
    const rk = await p.rankedKeywords({ domain: "sonorch.ai", market: US, limit: 10 });
    assert.deepEqual(rk.data, [{ keyword: "salon pos", position: 5, url: "https://sonorch.ai/pos", volume: 1900, trafficEstimate: 41.2 }]);
    const comp = await p.serpCompetitors({ domain: "sonorch.ai", market: US, keywords: [], limit: 10 });
    assert.deepEqual(comp.data.map((c) => c.domain), ["rival.example"], "the site itself is not its own competitor");
    const bo = await p.backlinksOverview({ domain: "sonorch.ai" });
    assert.deepEqual(bo.data, { backlinks: 1450, referringDomains: 132, rank: 211, brokenBacklinks: 4 });
    const bp = await p.backlinksProfile({ domain: "sonorch.ai", limit: 1 });
    assert.equal(bp.data[0].domainFrom, "dir.example");
    const audit = await p.siteAudit.run({ domain: "sonorch.ai", maxPages: 10 });
    assert.equal(audit.data.auditId, "09201234-1111-0216-0000-onpage000001");
    const st = await p.siteAudit.status({ auditId: audit.data.auditId });
    assert.deepEqual(st.data, { state: "done", pagesCrawled: 10, pagesTotal: 10 });
    const issues = await p.siteAudit.issues({ auditId: audit.data.auditId });
    assert.deepEqual(issues.data.map((i) => [i.type, i.count, i.severity]), [["title_too_long", 7, "warning"], ["no_title", 1, "critical"]]);
  });

  it("rank checks find the domain's organic position in live SERPs", async () => {
    const r = await p.rankTracker.run({ trackerId: "t", domain: "sonorch.ai", market: US, keywords: ["salon pos"], depth: 20 });
    // SERP features come from the non-organic items on the same page (here, an ad block)
    assert.deepEqual(r.data.positions, [{ keyword: "salon pos", position: 2, url: "https://sonorch.ai/pos", serpFeatures: ["paid"] }]);
    await assert.rejects(p.rankTracker.get({ trackerId: "t" }), ProviderUnsupportedError);
  });

  it("reads the balance from appendix/user_data (free)", async () => {
    assert.equal((await p.balance()).micros, 12_345_678);
  });

  it("a failed task becomes a ProviderError that carries what DataForSEO billed, never the credentials", async () => {
    dfs.failNextWith({ status_code: 40501, message: "Invalid Field: 'limit'.", cost: 0.012 });
    await assert.rejects(p.keywordIdeas({ seed: "x", market: US, limit: 150 }), (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.opts.billedMicros, 12_000);
      assert.match(e.message, /40501 Invalid Field/);
      assert.ok(!e.message.includes("pw-test") && !e.message.includes(Buffer.from("login@example.test:pw-test").toString("base64")));
      return true;
    });
    const bad = new DataForSeoProvider({ login: "login@example.test", password: "wrong", baseUrl: dfs.origin });
    await assert.rejects(bad.keywordIdeas({ seed: "x", market: US, limit: 150 }), /DataForSEO .*40100/);
  });

  it("estimates with the price table", async () => {
    const o = { op: "keywordIdeas" as const, params: { seed: "x", market: US, limit: 150 } };
    assert.deepEqual(await p.estimateCost(o), { micros: 30_000, basis: "price-table", explain: dataForSeoPrice(o).explain });
  });
});

describe("OpenSeoProvider (against a fake OpenSEO MCP server)", () => {
  let mcp: Awaited<ReturnType<typeof startFakeOpenSeo>>;
  let p: OpenSeoProvider;
  before(async () => {
    mcp = await startFakeOpenSeo({ token: "oseo_test_token" });
    p = new OpenSeoProvider({ url: mcp.url, token: "oseo_test_token" });
  });
  after(() => mcp.close());

  it("calls research_keywords with the real parameter names, in a research project it creates once", async () => {
    const r = await p.keywordIdeas({ seed: "Salon POS", market: US, limit: 150 });
    const names = mcp.calls.map((c) => c.name);
    assert.deepEqual(names, ["list_projects", "create_project", "research_keywords"]);
    const create = mcp.calls[1];
    assert.deepEqual(create.args, { name: `${RESEARCH_PROJECT} (2840)`, locationCode: 2840, languageCode: "en" });
    const call = mcp.calls[2];
    assert.equal(call.method, "tools/call");
    assert.equal(call.headers["mcp-method"], "tools/call");
    assert.equal(call.headers["mcp-name"], "research_keywords");
    assert.equal(call.headers.authorization, "Bearer oseo_test_token");
    assert.deepEqual(call.meta, { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} });
    assert.deepEqual(call.args, { projectId: "p-1", seeds: [{ seed: "salon pos", locationCode: 2840, languageCode: "en" }], resultLimit: 150 });
    assert.equal(r.costMicros, null, "self-hosted OpenSEO does not report what a call cost");
    assert.deepEqual(r.data[0], { keyword: "salon pos", volume: 1900, kd: 38, cpcMicros: 12_400_000, competition: 0.62, intent: "commercial" });
    assert.equal(r.data[1].intent, null);
    await p.keywordIdeas({ seed: "no show policy", market: US, limit: 150 });
    assert.equal(mcp.calls.filter((c) => c.name === "create_project").length, 1, "the project is reused");
  });

  it("uses the site's existing project for domain tools", async () => {
    const before = mcp.calls.length;
    const r = await p.domainOverview({ domain: "sonorch.ai", market: US });
    const call = mcp.calls.slice(before).find((c) => c.name === "get_domain_overview")!;
    assert.deepEqual(call.args, { projectId: "p-existing", domain: "sonorch.ai", locationCode: 2840, languageCode: "en" });
    assert.equal(r.data.organicKeywords, 612);
  });

  it("maps every operation onto its OpenSEO tool", async () => {
    await p.serp({ keyword: "salon pos", market: US, depth: 20 });
    await p.keywordMetrics({ keywords: ["a", "b"], market: US });
    await p.rankedKeywords({ domain: "sonorch.ai", market: US, limit: 10 });
    await p.serpCompetitors({ domain: "sonorch.ai", market: US, keywords: ["salon pos"], limit: 10 });
    await p.backlinksOverview({ domain: "sonorch.ai" });
    await p.backlinksProfile({ domain: "sonorch.ai", limit: 50 });
    const t = await p.rankTracker.create({ domain: "sonorch.ai", market: US, depth: 20 });
    assert.equal(t.data.trackerId, "p-existing:11111111-2222-4333-8444-555555555555");
    await p.rankTracker.add({ trackerId: t.data.trackerId, keywords: ["salon pos"] });
    const run = await p.rankTracker.run({ trackerId: t.data.trackerId, domain: "sonorch.ai", market: US, keywords: ["salon pos"], depth: 20 });
    assert.deepEqual(run.data, { runId: "run-1", positions: null });
    const runArgs = mcp.calls.find((c) => c.name === "run_rank_tracker")!.args!;
    assert.equal(runArgs.maxCostCredits, 5, "run is capped at OpenSEO's own fresh estimate");
    const got = await p.rankTracker.get({ trackerId: t.data.trackerId });
    assert.deepEqual(got.data.positions, [{ keyword: "salon pos", position: 7, url: "https://sonorch.ai/pos" }]);
    const a = await p.siteAudit.run({ domain: "sonorch.ai", maxPages: 50 });
    assert.equal(a.data.auditId, "p-existing:audit-9");
    assert.equal((await p.siteAudit.status({ auditId: a.data.auditId })).data.state, "done");
    assert.equal((await p.siteAudit.issues({ auditId: a.data.auditId })).data[0].count, 17);
    const used = new Set(mcp.calls.map((c) => c.name));
    for (const tool of ["get_serp_results", "get_keyword_metrics", "get_ranked_keywords", "find_serp_competitors", "get_backlinks_overview", "get_backlinks_profile", "create_rank_tracker", "add_rank_tracking_keywords", "estimate_rank_tracker_cost", "run_rank_tracker", "get_rank_tracker", "run_site_audit", "get_audit_status", "get_audit_issues"]) {
      assert.ok(used.has(tool), `${tool} was never called`);
    }
  });

  it("refuses domain-only competitors (find_serp_competitors needs keywords) and reports a null balance when self-hosted", async () => {
    await assert.rejects(p.serpCompetitors({ domain: "sonorch.ai", market: US, keywords: [], limit: 10 }), ProviderUnsupportedError);
    assert.equal((await p.balance()).micros, null);
  });

  it("turns tool errors, per-seed failures and auth failures into ProviderErrors", async () => {
    await assert.rejects(p.keywordIdeas({ seed: "broken seed", market: US, limit: 150 }), /No keyword data/);
    const wrong = new OpenSeoProvider({ url: mcp.url, token: "nope" });
    await assert.rejects(wrong.balance(), (e: unknown) => e instanceof ProviderError && /HTTP 401/.test(e.message));
    await assert.rejects(new McpClient({ url: mcp.url, headers: { Authorization: "Bearer oseo_test_token" } }).callTool("no_such_tool", {}), McpError);
  });

  it("reads Server-Sent Events responses too", async () => {
    const sse = await startFakeOpenSeo({ sse: true });
    try {
      const r = await new OpenSeoProvider({ url: sse.url }).domainOverview({ domain: "sonorch.ai", market: US });
      assert.equal(r.data.organicTraffic, 1840);
    } finally {
      await sse.close();
    }
    assert.deepEqual(parseSse('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n\n', 2), { jsonrpc: "2.0", id: 2, result: {} });
    assert.equal(parseSse("data: nope\n\n", 1), null);
    assert.throws(() => new McpClient({ url: "http://u:p@127.0.0.1/mcp" }), /credentials/);
  });
});

describe("FakeProvider", () => {
  it("answers from fixtures, charges what DataForSEO would for the rows returned, and counts calls", async () => {
    const f = new FakeProvider({ balanceMicros: 1_000_000 });
    const r = await invoke(f, { op: "keywordIdeas", params: { seed: "salon pos", market: US, limit: 150 } });
    assert.equal(r.units, 14);
    assert.equal(r.costMicros, 12_000 + 14 * 120);
    assert.ok(r.costMicros! <= (await f.estimateCost({ op: "keywordIdeas", params: { seed: "salon pos", market: US, limit: 150 } })).micros);
    assert.equal(f.calls.get("keywordIdeas"), 1);
    assert.equal((await f.balance()).micros, 1_000_000 - r.costMicros!);
    const gen = await f.keywordIdeas({ seed: "lash extensions", market: US, limit: 150 });
    assert.ok(gen.data.length > 5 && gen.data.every((k) => k.keyword.includes("lash extensions")));
    const again = await f.keywordIdeas({ seed: "lash extensions", market: US, limit: 150 });
    assert.deepEqual(again.data, gen.data, "generated data is deterministic");
  });
});

describe("SEO_PROVIDER configuration", () => {
  const read = (env: Record<string, string>, o = { production: false, secure: false }) => {
    const problems: string[] = [];
    return { cfg: readSeoProviderEnv(env, problems, o), problems };
  };
  it("defaults to fake in development and none in production; fake is refused next to https", () => {
    assert.equal(read({}).cfg.kind, "fake");
    assert.equal(read({}, { production: true, secure: true }).cfg.kind, "none");
    assert.match(read({ SEO_PROVIDER: "fake" }, { production: true, secure: true }).problems[0], /demo data/);
  });
  it("needs credentials for real providers and pins DataForSEO to its own hosts", () => {
    assert.match(read({ SEO_PROVIDER: "dataforseo" }).problems.join(), /DATAFORSEO_LOGIN/);
    assert.match(read({ SEO_PROVIDER: "dataforseo", DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b", DATAFORSEO_BASE_URL: "https://evil.example" }).problems.join(), /DATAFORSEO_BASE_URL/);
    assert.deepEqual(read({ SEO_PROVIDER: "dataforseo", DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b", DATAFORSEO_BASE_URL: "https://sandbox.dataforseo.com" }).problems, []);
    assert.match(read({ SEO_PROVIDER: "dataforseo", DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b", DATAFORSEO_BASE_URL: "http://127.0.0.1:9" }, { production: true, secure: true }).problems.join(), /DATAFORSEO_BASE_URL/);
    assert.match(read({ SEO_PROVIDER: "openseo" }).problems.join(), /OPENSEO_MCP_URL is required/);
    assert.match(read({ SEO_PROVIDER: "openseo", OPENSEO_MCP_URL: "http://u:p@open-seo:3001/mcp" }).problems.join(), /must not contain credentials/);
    assert.match(read({ SEO_PROVIDER: "bogus" }).problems.join(), /must be one of/);
  });
});
