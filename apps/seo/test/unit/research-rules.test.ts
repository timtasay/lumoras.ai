/**
 * Research rules as pure functions: keyword normalisation, near-duplicate and
 * geographic variant collapse (rule 6), sells / does-not-sell (rule 7), the
 * seed re-run rule and backlog rotation (rule 4), money and budget arithmetic
 * (rule 11), cache keys and the price table.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collapseVariants, geoTerms, normalizeKeyword, stem, variantKey } from "../../lib/research/keywords.ts";
import { classifyFit, filterByOffering, offerTerms } from "../../lib/research/offering.ts";
import { nextSeeds, seedDecision, type BacklogSeed } from "../../lib/research/seeds.ts";
import { formatMicros, microsToDecimal, parseUsd, usdToMicros } from "../../lib/research/money.ts";
import { budgetState, decide } from "../../lib/metering/budget.ts";
import { cacheKey, canonicalJson, dataForSeoPrice, periodOf } from "../../lib/providers/operations.ts";
import { annotate } from "../../lib/research/service.ts";
import { marketFor } from "../../lib/research/market.ts";
import { SEED_WORKSPACES } from "../../lib/seed.ts";
import type { Market } from "../../lib/providers/types.ts";

const US: Market = { locationCode: 2840, languageCode: "en", label: "United States" };
const sonorch = SEED_WORKSPACES[0].sites[0].brand;

describe("keyword normalisation", () => {
  it("folds case, quotes, apostrophes, punctuation and spacing", () => {
    assert.equal(normalizeKeyword("  Salon   POS!  "), "salon pos");
    assert.equal(normalizeKeyword("Women’s Haircut “Prices”"), "womens haircut prices");
    assert.equal(normalizeKeyword("24/7 AI receptionist."), "24/7 ai receptionist");
    assert.equal(normalizeKeyword("c++ & salon-pos"), "c++ & salon-pos");
    assert.equal(normalizeKeyword("ＳＡＬＯＮ"), "salon", "full-width letters (NFKC)");
    assert.equal(normalizeKeyword("?!"), "");
  });

  it("stems plurals only", () => {
    assert.deepEqual(["salons", "policies", "boxes", "business", "status", "analysis", "pos"].map(stem), ["salon", "policy", "box", "business", "status", "analysis", "pos"]);
  });
});

describe("rule 6: near-duplicate and geographic variants collapse into one target", () => {
  it("finds places and local modifiers, longest names first", () => {
    assert.deepEqual(geoTerms("esthetician salary in New York City"), ["new york city"]);
    assert.deepEqual(geoTerms("dental implants near me seattle"), ["near me", "seattle"]);
    assert.deepEqual(geoTerms("ai receptionist for dental office"), []);
    assert.deepEqual(geoTerms("salon pos texas tx"), ["texas", "tx"]);
  });

  it("gives the same key to place, order, plural and filler variants", () => {
    const k = variantKey("esthetician salary");
    for (const v of ["esthetician salary california", "Esthetician Salary in Texas", "salary esthetician ohio", "esthetician salaries", "esthetician salary near me"]) {
      assert.equal(variantKey(v), k, `"${v}" should collapse into "esthetician salary"`);
    }
    assert.notEqual(variantKey("medical esthetician salary"), k, "a different job is a different article");
    assert.notEqual(variantKey("esthetician salary per hour"), k, "a different question is a different article");
    assert.equal(variantKey("texas"), "texas", "a place alone keeps itself as the key");
  });

  it("esthetician salary california / texas / ohio is one article that handles the states inside it", () => {
    const rows = [
      { keyword: "esthetician salary california", volume: 1300 },
      { keyword: "esthetician salary texas", volume: 1000 },
      { keyword: "esthetician salary", volume: 14800 },
      { keyword: "esthetician salary ohio", volume: 390 },
      { keyword: "how much do estheticians make", volume: 6600 },
    ];
    const groups = collapseVariants(rows);
    assert.equal(groups.length, 2);
    const g = groups[0];
    assert.equal(g.target.keyword, "esthetician salary");
    assert.equal(g.members.length, 4);
    assert.deepEqual(g.places.sort(), ["california", "ohio", "texas"]);
  });

  it("prefers a member without a place as the target even when a place variant has more volume", () => {
    const [g] = collapseVariants([
      { keyword: "salon pos texas", volume: 900 },
      { keyword: "salon pos", volume: 400 },
    ]);
    assert.equal(g.target.keyword, "salon pos");
  });

  it("with only place variants, picks the highest volume, then the shortest", () => {
    const [g] = collapseVariants([
      { keyword: "dental implants seattle", volume: 880 },
      { keyword: "dental implants near me", volume: 33100 },
    ]);
    assert.equal(g.target.keyword, "dental implants near me");
  });
});

describe("rule 7: only what the business sells", () => {
  const no = offerTerms(sonorch.doesNotSell!);
  const yes = offerTerms(sonorch.sells!);

  it("splits free-text brand lists into terms", () => {
    const words = no.map((t) => t.words.join(" "));
    for (const w of ["home service", "hvac", "plumbing", "electrical", "dental", "medical clinic", "restaurant", "seasonx"]) {
      assert.ok(words.includes(w), `"${w}" missing from ${JSON.stringify(words)}`);
    }
  });

  it("excludes what sonorch.ai does not sell, however good the CPC", () => {
    for (const k of ["restaurant pos system", "dental practice pos", "hvac scheduling app", "plumbing invoices", "medical clinic booking", "dental no show policy"]) {
      assert.equal(classifyFit(k, yes, no).fit, "not_offered", k);
    }
  });

  it("keeps what it sells, and does not over-match single shared words", () => {
    assert.equal(classifyFit("salon pos", yes, no).fit, "offered");
    assert.equal(classifyFit("salon booking app", yes, no).fit, "offered");
    assert.equal(classifyFit("home salon business ideas", yes, no).fit, "offered", "'home services' needs both words");
    assert.equal(classifyFit("med spa marketing", yes, no).fit !== "not_offered", true, "'medical clinics' needs both words");
    assert.equal(classifyFit("tax deadlines", yes, no).fit, "unknown");
  });

  it("does-not-sell wins over sells", () => {
    assert.equal(classifyFit("restaurant salon pos", yes, no).fit, "not_offered");
  });

  it("filterByOffering removes excluded rows and says why", () => {
    const r = filterByOffering([{ keyword: "salon pos" }, { keyword: "restaurant pos system" }, { keyword: "barbershop pos" }], { sells: sonorch.sells!, doesNotSell: sonorch.doesNotSell! });
    assert.deepEqual(r.kept.map((k) => [k.keyword, k.fit]), [["salon pos", "offered"], ["barbershop pos", "unknown"]]);
    assert.equal(r.excluded.length, 1);
    assert.match(r.excluded[0].reason, /Restaurant software/);
  });

  it("annotate marks fit, variant groups and their targets on research rows", () => {
    const rows = annotate(
      [
        { keyword: "esthetician salary", volume: 100, kd: 1, cpcMicros: 0, competition: 0, intent: null },
        { keyword: "esthetician salary texas", volume: 50, kd: 1, cpcMicros: 0, competition: 0, intent: null },
        { keyword: "dental implants", volume: 5000, kd: 1, cpcMicros: 0, competition: 0, intent: null },
      ],
      { sells: sonorch.sells!, does_not_sell: sonorch.doesNotSell! },
    );
    assert.deepEqual(rows.map((r) => [r.keyword, r.fit, r.target, r.variants]), [
      ["esthetician salary", "unknown", true, 2],
      ["esthetician salary texas", "unknown", false, 2],
      ["dental implants", "not_offered", true, 1],
    ]);
    assert.deepEqual(rows[0].places, ["texas"]);
  });
});

describe("rule 4: seeds are not re-run inside their maximum age", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("never researched → run; researched 89 days ago → no; 90 days ago → run", () => {
    assert.deepEqual(seedDecision(null, 90, now), { run: true, reason: "never", lastAt: null, ageDays: null });
    const fresh = seedDecision(daysAgo(89), 90, now);
    assert.equal(fresh.run, false);
    assert.equal(fresh.reason, "fresh");
    assert.equal(fresh.ageDays, 89);
    assert.equal(seedDecision(daysAgo(90), 90, now).run, true);
    assert.equal(seedDecision(daysAgo(10), 7, now).reason, "stale", "the per-site max age is honoured");
    assert.throws(() => seedDecision(null, 0, now), RangeError);
  });

  it("rotates the backlog: never-researched by priority, then the stalest; skipped and fresh seeds never", () => {
    const s = (seed: string, priority: number, last: number | null, status: BacklogSeed["status"] = "queued", added = 0): BacklogSeed => ({
      id: seed, seed, priority, status, lastResearchedAt: last === null ? null : daysAgo(last), createdAt: daysAgo(200 - added),
    });
    const backlog = [s("a", 0, null, "queued", 1), s("b", 2, null), s("c", 0, 120, "researched"), s("d", 3, 30, "researched"), s("e", 3, null, "skipped"), s("f", 0, 300, "researched"), s("g", 0, null, "queued", 2)];
    assert.deepEqual(nextSeeds(backlog, 90, now, 10).map((x) => x.seed), ["b", "a", "g", "f", "c"]);
    assert.deepEqual(nextSeeds(backlog, 90, now, 2).map((x) => x.seed), ["b", "a"]);
  });
});

describe("money in micro-dollars", () => {
  it("converts and formats without losing a micro", () => {
    assert.equal(usdToMicros(0.000036), 36);
    assert.equal(usdToMicros(0.0132), 13_200);
    assert.equal(parseUsd("25"), 25_000_000);
    assert.equal(parseUsd("$0.0121"), 12_100);
    assert.equal(parseUsd("1.1234567"), null);
    assert.equal(parseUsd("-1"), null);
    assert.equal(formatMicros(12_100), "$0.0121");
    assert.equal(formatMicros(25_000_000), "$25.00");
    assert.equal(formatMicros(0), "$0.00");
    assert.equal(microsToDecimal(12_100), "0.0121");
    assert.equal(microsToDecimal(25_000_000), "25");
  });
});

describe("budget and reserve (rule 11)", () => {
  const st = (ceiling: number, reserve: number, settled: number, held = 0) => budgetState("seo_credits", { category: "seo_credits", monthly_ceiling: ceiling, reserve }, settled, held);

  it("refuses with no budget, below the reserve, and when a call would cross it", () => {
    assert.deepEqual(decide(budgetState("seo_credits", null, 0, 0), 10), { ok: false, reason: "no_budget" });
    assert.deepEqual(decide(st(100, 20, 80), 1), { ok: false, reason: "below_reserve" }, "available == reserve: nothing more may be spent");
    assert.deepEqual(decide(st(100, 20, 90), 1), { ok: false, reason: "below_reserve" });
    assert.deepEqual(decide(st(100, 20, 50), 31), { ok: false, reason: "would_cross_reserve" });
    assert.deepEqual(decide(st(100, 20, 50), 30), { ok: true }, "a call that lands exactly on the reserve is allowed");
    assert.deepEqual(decide(st(100, 20, 40, 10), 31), { ok: false, reason: "would_cross_reserve" }, "open holds count as used");
    assert.deepEqual(decide(st(100, 0, 90), 11), { ok: false, reason: "over_ceiling" });
  });

  it("free calls always pass, even below the reserve", () => {
    assert.deepEqual(decide(st(100, 20, 100), 0), { ok: true });
    assert.deepEqual(decide(budgetState("seo_credits", null, 0, 0), 0), { ok: true });
  });
});

describe("cache keys and prices", () => {
  it("equal requests share a key whatever their spelling; anything that changes the answer changes it", () => {
    const base = cacheKey("fake", { op: "keywordIdeas", params: { seed: "salon pos", market: US, limit: 150 } });
    assert.equal(cacheKey("fake", { op: "keywordIdeas", params: { seed: "  Salon POS ", market: { ...US, label: "anything" }, limit: 150 } }), base);
    assert.notEqual(cacheKey("dataforseo", { op: "keywordIdeas", params: { seed: "salon pos", market: US, limit: 150 } }), base, "provider");
    assert.notEqual(cacheKey("fake", { op: "keywordIdeas", params: { seed: "salon pos", market: { ...US, locationCode: 2826 }, limit: 150 } }), base, "market");
    assert.notEqual(cacheKey("fake", { op: "keywordIdeas", params: { seed: "salon pos", market: US, limit: 300 } }), base, "limit");
    assert.notEqual(cacheKey("fake", { op: "serp", params: { keyword: "salon pos", market: US, depth: 20 } }), base, "operation");
    assert.equal(
      cacheKey("fake", { op: "keywordMetrics", params: { keywords: ["B", "a", "a "], market: US } }),
      cacheKey("fake", { op: "keywordMetrics", params: { keywords: ["a", "b"], market: US } }),
      "keyword lists are deduplicated and sorted",
    );
    assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
  });

  it("prices calls with DataForSEO's arithmetic", () => {
    assert.equal(dataForSeoPrice({ op: "keywordIdeas", params: { seed: "x", market: US, limit: 150 } }).micros, 12_000 + 150 * 120);
    assert.equal(dataForSeoPrice({ op: "serp", params: { keyword: "x", market: US, depth: 20 } }).micros, 4_000);
    assert.equal(dataForSeoPrice({ op: "serp", params: { keyword: "x", market: US, depth: 25 } }).micros, 6_000, "a partial page is a page");
    assert.equal(dataForSeoPrice({ op: "backlinksOverview", params: { domain: "x.com" } }).micros, 24_036);
    assert.equal(dataForSeoPrice({ op: "rankTracker.get", params: { trackerId: "t" } }).micros, 0);
    assert.equal(periodOf(new Date("2026-10-31T23:59:59Z")), "2026-10-01");
    assert.equal(periodOf(new Date("2026-11-01T00:00:00Z")), "2026-11-01");
  });

  it("maps a site to its market", () => {
    assert.deepEqual(marketFor({ country: "US", locale: "en-US", serp_location: "United States" }), US);
    assert.equal(marketFor({ country: "GB", locale: "en-GB", serp_location: "London" }).locationCode, 2826);
    assert.match(marketFor({ country: "ZZ", locale: "en-US", serp_location: "" }).label, /not supported/);
  });
});

describe("usage CSV export", () => {
  it("quotes what needs quoting and defuses spreadsheet formulas", async () => {
    const { csvField } = await import("../../lib/research/csv.ts");
    assert.equal(csvField("plain"), "plain");
    assert.equal(csvField('a,"b"'), '"a,""b"""');
    assert.equal(csvField("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvField("+1"), "'+1");
    assert.equal(csvField(null), "");
    assert.equal(csvField(new Date("2026-10-09T00:00:00Z")), "2026-10-09T00:00:00.000Z");
  });
});
