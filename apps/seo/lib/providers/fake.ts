/**
 * FakeProvider: answers every SeoDataProvider operation from fixtures
 * (lib/providers/fixtures.ts) or deterministic generated data, never touches
 * the network, and charges what DataForSEO would for the rows it returns
 * (the price table in operations.ts), so budgets, the ledger and the
 * estimate-then-settle path behave as they will in production.
 *
 * Tests use the knobs: `calls` counts provider calls per operation, `delayMs`
 * holds each call open (concurrency tests), `failWith` makes the next calls
 * fail (optionally "billed anyway"), `balanceMicros` is the account balance.
 */
import { createHash } from "node:crypto";
import { geoTerms, normalizeKeyword } from "../research/keywords.ts";
import { DOMAIN_OVERVIEW, KEYWORD_IDEAS, SERP_DOMAINS } from "./fixtures.ts";
import { DFS_PRICES, dataForSeoPrice } from "./operations.ts";
import {
  ProviderError,
  type Balance,
  type CostEstimate,
  type KeywordRow,
  type Operation,
  type OperationName,
  type OperationParams,
  type OperationResults,
  type ProviderResponse,
  type RankPosition,
  type SeoDataProvider,
} from "./types.ts";

/** Deterministic pseudo-random numbers from a string (mulberry32 seeded by sha256). */
function rng(seed: string): () => number {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODIFIERS = ["", "best", "software", "app", "cost", "for small business", "free", "how to choose", "vs", "pricing", "examples", "template", "checklist", "near me", "texas", "california"];
const ROUND = [10, 20, 30, 40, 50, 70, 90, 110, 140, 170, 210, 260, 320, 390, 480, 590, 720, 880, 1000, 1300, 1600, 1900, 2400, 2900, 3600];

function generatedIdeas(seed: string, limit: number): KeywordRow[] {
  const r = rng(`ideas:${seed}`);
  const out: KeywordRow[] = [];
  for (const m of MODIFIERS) {
    if (out.length >= limit) break;
    const keyword = !m ? seed : m === "best" || m === "free" || m === "how to choose" ? `${m} ${seed}` : `${seed} ${m}`;
    const head = !m;
    out.push({
      keyword,
      volume: head ? ROUND[18 + Math.floor(r() * 6)] : ROUND[Math.floor(r() * 16)],
      kd: Math.round(10 + r() * 50),
      cpcMicros: Math.round(r() * 2500) * 10_000,
      competition: Math.round(r() * 1000) / 1000,
      intent: m === "how to choose" || m === "examples" || m === "template" || m === "checklist" ? "informational" : m === "free" || m === "near me" ? "transactional" : "commercial",
    });
  }
  return out;
}

export type FakeOptions = {
  /** Provider account balance (null: the provider cannot tell, like self-hosted OpenSEO). Default $50. */
  balanceMicros?: number | null;
  /** Hold every call open this long (concurrency tests). */
  delayMs?: number;
  /** The provider's clock: rank positions and backlink counts drift with it (seeds replay past weeks). */
  now?: () => Date;
};

const FEATURES = ["featured_snippet", "people_also_ask", "local_pack", "video", "images", "top_stories"];
const WEEK_MS = 7 * 86_400_000;
const EPOCH = Date.UTC(2026, 0, 5);

export class FakeProvider implements SeoDataProvider {
  readonly name = "fake" as const;
  readonly label = "Demo data (fake provider)";
  /** Provider calls per operation, for tests ("was the provider called?"). */
  readonly calls = new Map<OperationName, number>();
  balanceMicros: number | null;
  delayMs: number;
  now: () => Date;
  /** The next calls fail with this (cleared by setting undefined). */
  failWith: ProviderError | undefined;
  private trackers = new Map<string, { domain: string; keywords: Set<string>; last: RankPosition[]; lastCheckedAt: string | null }>();
  private audits = new Map<string, { domain: string; maxPages: number; startedAt: number }>();
  private seq = 0;

  constructor(opts: FakeOptions = {}) {
    this.balanceMicros = opts.balanceMicros === undefined ? 50_000_000 : opts.balanceMicros;
    this.delayMs = opts.delayMs ?? 0;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * A keyword's position for a domain at the provider's clock: a stable base,
   * a slow weekly drift (some keywords climb, some slip) and a little weekly
   * noise; about one in seven never ranks in the tracked depth.
   */
  position(domain: string, keyword: string, depth: number): { position: number | null; serpFeatures: string[] } {
    const r = rng(`rank:${domain}:${normalizeKeyword(keyword)}`);
    const base = r(), slope = r(), noiseSeed = r();
    const weeks = Math.max(0, Math.floor((this.now().getTime() - EPOCH) / WEEK_MS));
    const features = FEATURES.filter(() => r() < 0.28);
    if (base < 0.14) return { position: null, serpFeatures: features };
    const noise = (rng(`rank:${domain}:${keyword}:${weeks}:${noiseSeed}`)() - 0.5) * 3;
    const p = Math.round(3 + base * 38 - weeks * (slope - 0.3) * 0.9 + noise);
    const position = Math.max(1, Math.min(90, p));
    return { position: position > depth ? null : position, serpFeatures: features };
  }

  totalCalls(): number {
    return [...this.calls.values()].reduce((a, b) => a + b, 0);
  }

  private async begin(op: OperationName) {
    this.calls.set(op, (this.calls.get(op) ?? 0) + 1);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failWith) throw this.failWith;
  }

  /** What DataForSEO would bill for this many returned items. */
  private charged<T>(op: Operation, data: T, units: number, micros: number): ProviderResponse<T> {
    if (this.balanceMicros !== null) this.balanceMicros = Math.max(0, this.balanceMicros - micros);
    void op;
    return { data, costMicros: micros, units };
  }

  async estimateCost(operation: Operation): Promise<CostEstimate> {
    const p = dataForSeoPrice(operation);
    return { micros: p.micros, basis: p.micros ? "price-table" : "free", explain: p.explain };
  }

  async balance(): Promise<Balance> {
    return { micros: this.balanceMicros, checkedAt: new Date(), note: "Fake provider: a simulated balance." };
  }

  keywordIdeas = async (p: OperationParams["keywordIdeas"]): Promise<ProviderResponse<OperationResults["keywordIdeas"]>> => {
    await this.begin("keywordIdeas");
    const seed = normalizeKeyword(p.seed);
    const data = (KEYWORD_IDEAS[seed] ?? generatedIdeas(seed, Math.min(p.limit, 24))).slice(0, p.limit);
    return this.charged({ op: "keywordIdeas", params: p }, data, data.length, DFS_PRICES.labsTask + data.length * DFS_PRICES.labsItem);
  };

  keywordMetrics = async (p: OperationParams["keywordMetrics"]): Promise<ProviderResponse<OperationResults["keywordMetrics"]>> => {
    await this.begin("keywordMetrics");
    const all = Object.values(KEYWORD_IDEAS).flat();
    const data = [...new Set(p.keywords.map(normalizeKeyword))].map((k) => all.find((r) => r.keyword === k) ?? { ...generatedIdeas(k, 1)[0], keyword: k });
    return this.charged({ op: "keywordMetrics", params: p }, data, data.length, DFS_PRICES.labsTask + data.length * DFS_PRICES.labsItem);
  };

  serp = async (p: OperationParams["serp"]): Promise<ProviderResponse<OperationResults["serp"]>> => {
    await this.begin("serp");
    const kw = normalizeKeyword(p.keyword);
    const r = rng(`serp:${kw}`);
    const domains = [...SERP_DOMAINS].sort(() => r() - 0.5);
    const data = Array.from({ length: Math.min(p.depth, 10) }, (_, i) => {
      const domain = domains[i % domains.length];
      const slug = kw.replace(/[^a-z0-9]+/g, "-");
      return { rank: i + 1, type: i === 0 && geoTerms(kw).length ? "local_pack" : "organic", url: `https://${domain}/${slug}`, domain, title: `${kw.replace(/\b\w/g, (c) => c.toUpperCase())}: guide ${i + 1}` };
    });
    const pages = Math.ceil(p.depth / 10);
    return this.charged({ op: "serp", params: p }, data, pages, pages * DFS_PRICES.serpLivePer10);
  };

  domainOverview = async (p: OperationParams["domainOverview"]): Promise<ProviderResponse<OperationResults["domainOverview"]>> => {
    await this.begin("domainOverview");
    const d = p.domain.toLowerCase();
    const r = rng(`domain:${d}`);
    const data = DOMAIN_OVERVIEW[d] ?? { organicTraffic: Math.round(r() * 4000), organicKeywords: Math.round(r() * 900), top3: Math.round(r() * 30), top10: Math.round(r() * 120), trafficValueMicros: Math.round(r() * 5000) * 1_000_000 };
    return this.charged({ op: "domainOverview", params: p }, data, 1, DFS_PRICES.labsTask + DFS_PRICES.labsItem);
  };

  rankedKeywords = async (p: OperationParams["rankedKeywords"]): Promise<ProviderResponse<OperationResults["rankedKeywords"]>> => {
    await this.begin("rankedKeywords");
    const r = rng(`ranked:${p.domain}`);
    const pool = Object.values(KEYWORD_IDEAS).flat();
    const data = pool.slice(0, Math.min(p.limit, 12)).map((k, i) => ({ keyword: k.keyword, position: 3 + Math.floor(r() * 40), url: `https://${p.domain}/insights/${i}`, volume: k.volume, trafficEstimate: Math.round((k.volume ?? 0) * 0.02) }));
    return this.charged({ op: "rankedKeywords", params: p }, data, data.length, DFS_PRICES.labsTask + data.length * DFS_PRICES.labsItem);
  };

  serpCompetitors = async (p: OperationParams["serpCompetitors"]): Promise<ProviderResponse<OperationResults["serpCompetitors"]>> => {
    await this.begin("serpCompetitors");
    const r = rng(`competitors:${p.domain}`);
    const data = SERP_DOMAINS.slice(0, Math.min(p.limit, 6)).map((domain) => ({ domain, avgPosition: Math.round((3 + r() * 20) * 10) / 10, intersections: Math.round(5 + r() * 80), trafficEstimate: Math.round(r() * 20000) }));
    return this.charged({ op: "serpCompetitors", params: p }, data, data.length, DFS_PRICES.labsTask + data.length * DFS_PRICES.labsItem);
  };

  backlinksOverview = async (p: OperationParams["backlinksOverview"]): Promise<ProviderResponse<OperationResults["backlinksOverview"]>> => {
    await this.begin("backlinksOverview");
    const r = rng(`backlinks:${p.domain}`);
    // slow growth with the provider's clock (about 3% a month), so quarterly snapshots move
    const months = Math.max(0, (this.now().getTime() - EPOCH) / (30 * 86_400_000));
    const g = 1 + months * 0.03;
    const data = { backlinks: Math.round(r() * 3000 * g), referringDomains: Math.round(r() * 300 * g), rank: Math.round(r() * 400), brokenBacklinks: Math.round(r() * 20) };
    return this.charged({ op: "backlinksOverview", params: p }, data, 1, DFS_PRICES.backlinksTask + DFS_PRICES.backlinksRow);
  };

  backlinksProfile = async (p: OperationParams["backlinksProfile"]): Promise<ProviderResponse<OperationResults["backlinksProfile"]>> => {
    await this.begin("backlinksProfile");
    const r = rng(`profile:${p.domain}`);
    // the referring domains change a little each quarter: a few appear, one is lost
    const quarter = Math.floor(Math.max(0, this.now().getTime() - EPOCH) / (91 * 86_400_000));
    const pool = [...SERP_DOMAINS, ...Array.from({ length: 12 }, (_, i) => `ref-${i + 1}.example`)];
    const from = pool.filter((d, i) => i < 8 + quarter * 3 && rng(`keep:${p.domain}:${d}:${quarter}`)() > 0.12);
    const data = from.slice(0, Math.min(p.limit, 40)).map((domainFrom, i) => ({
      urlFrom: `https://${domainFrom}/resources`, domainFrom, urlTo: `https://${p.domain}/`, anchor: i % 2 ? p.domain : "salon software", dofollow: r() > 0.3, domainRank: Math.round(r() * 500), firstSeen: "2026-0" + (1 + (i % 9)) + "-15", lost: false,
    }));
    return this.charged({ op: "backlinksProfile", params: p }, data, data.length, DFS_PRICES.backlinksTask + data.length * DFS_PRICES.backlinksRow);
  };

  rankTracker = {
    create: async (p: OperationParams["rankTracker.create"]): Promise<ProviderResponse<OperationResults["rankTracker.create"]>> => {
      await this.begin("rankTracker.create");
      const trackerId = `fake-tracker-${++this.seq}`;
      this.trackers.set(trackerId, { domain: p.domain, keywords: new Set(), last: [], lastCheckedAt: null });
      return { data: { trackerId }, costMicros: 0, units: 0 };
    },
    add: async (p: OperationParams["rankTracker.add"]): Promise<ProviderResponse<OperationResults["rankTracker.add"]>> => {
      await this.begin("rankTracker.add");
      const t = this.trackers.get(p.trackerId);
      if (!t) throw new ProviderError(`no tracker ${p.trackerId}`, { status: 404 });
      const before = t.keywords.size;
      for (const k of p.keywords) t.keywords.add(normalizeKeyword(k));
      return { data: { added: t.keywords.size - before }, costMicros: 0, units: 0 };
    },
    run: async (p: OperationParams["rankTracker.run"]): Promise<ProviderResponse<OperationResults["rankTracker.run"]>> => {
      await this.begin("rankTracker.run");
      const t = this.trackers.get(p.trackerId);
      const keywords = p.keywords.length ? p.keywords : [...(t?.keywords ?? [])];
      const positions = keywords.map((keyword) => {
        const x = this.position(p.domain, keyword, p.depth);
        const slug = normalizeKeyword(keyword).replace(/[^a-z0-9]+/g, "-");
        return { keyword: normalizeKeyword(keyword), position: x.position, url: x.position === null ? null : `https://${p.domain}/${x.position <= 12 ? `insights/${slug}` : ""}`, serpFeatures: x.serpFeatures };
      });
      if (t) Object.assign(t, { last: positions, lastCheckedAt: this.now().toISOString() });
      const pages = keywords.length * Math.ceil(p.depth / 10);
      return this.charged({ op: "rankTracker.run", params: p }, { runId: null, positions }, pages, pages * DFS_PRICES.serpLivePer10);
    },
    get: async (p: OperationParams["rankTracker.get"]): Promise<ProviderResponse<OperationResults["rankTracker.get"]>> => {
      await this.begin("rankTracker.get");
      const t = this.trackers.get(p.trackerId);
      return { data: { positions: t?.last ?? [], lastCheckedAt: t?.lastCheckedAt ?? null }, costMicros: 0, units: 0 };
    },
  };

  siteAudit = {
    run: async (p: OperationParams["siteAudit.run"]): Promise<ProviderResponse<OperationResults["siteAudit.run"]>> => {
      await this.begin("siteAudit.run");
      const auditId = `fake-audit-${++this.seq}`;
      this.audits.set(auditId, { domain: p.domain, maxPages: p.maxPages, startedAt: Date.now() });
      const pages = Math.min(p.maxPages, 40);
      return this.charged({ op: "siteAudit.run", params: p }, { auditId }, pages, pages * DFS_PRICES.onPagePage);
    },
    status: async (p: OperationParams["siteAudit.status"]): Promise<ProviderResponse<OperationResults["siteAudit.status"]>> => {
      await this.begin("siteAudit.status");
      const a = this.audits.get(p.auditId);
      if (!a) throw new ProviderError(`no audit ${p.auditId}`, { status: 404 });
      const pages = Math.min(a.maxPages, 40);
      return { data: { state: "done", pagesCrawled: pages, pagesTotal: pages }, costMicros: 0, units: 0 };
    },
    issues: async (p: OperationParams["siteAudit.issues"]): Promise<ProviderResponse<OperationResults["siteAudit.issues"]>> => {
      await this.begin("siteAudit.issues");
      if (!this.audits.has(p.auditId)) throw new ProviderError(`no audit ${p.auditId}`, { status: 404 });
      return {
        data: [
          { type: "title-too-long", severity: "warning", count: 17, title: "Titles over 60 characters" },
          { type: "missing-meta-description", severity: "warning", count: 4, title: "Pages without a meta description" },
          { type: "broken-internal-link", severity: "critical", count: 2, title: "Broken internal links" },
        ],
        costMicros: 0,
        units: 0,
      };
    },
  };
}
