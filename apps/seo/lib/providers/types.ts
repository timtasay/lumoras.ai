/**
 * The SEO data provider interface (build prompt section 4). The pipeline only
 * ever talks to a SeoDataProvider, and only through the metered call path
 * (lib/metering/metered.ts), never directly: that is where every call is
 * priced, budgeted, cached, logged and charged.
 *
 * Implementations (lib/providers/registry.ts, SEO_PROVIDER):
 *   fake        recorded/synthetic fixtures; tests and local development
 *   openseo     a self-hosted OpenSEO over MCP (docs/openseo-tools.md)
 *   dataforseo  DataForSEO's REST API directly (docs/provider-decision.md)
 *
 * Everything a provider returns is untrusted data: it is validated into these
 * shapes, stored as data, and never treated as instructions.
 */
import type { Intent } from "../research/keywords.ts";

export type ProviderName = "fake" | "openseo" | "dataforseo";

/** Where a search happens: a DataForSEO location code (2840 = United States) and language. */
export type Market = { locationCode: number; languageCode: string; label: string };

export type OperationParams = {
  keywordIdeas: { seed: string; market: Market; limit: number };
  keywordMetrics: { keywords: string[]; market: Market };
  serp: { keyword: string; market: Market; depth: number };
  domainOverview: { domain: string; market: Market };
  rankedKeywords: { domain: string; market: Market; limit: number };
  serpCompetitors: { domain: string; market: Market; keywords: string[]; limit: number };
  backlinksOverview: { domain: string };
  backlinksProfile: { domain: string; limit: number };
  "rankTracker.create": { domain: string; market: Market; depth: number };
  "rankTracker.add": { trackerId: string; keywords: string[] };
  "rankTracker.run": { trackerId: string; domain: string; market: Market; keywords: string[]; depth: number };
  "rankTracker.get": { trackerId: string };
  "siteAudit.run": { domain: string; maxPages: number };
  "siteAudit.status": { auditId: string };
  "siteAudit.issues": { auditId: string };
};
export type OperationName = keyof OperationParams;
export type Operation = { [K in OperationName]: { op: K; params: OperationParams[K] } }[OperationName];
export type OperationOf<K extends OperationName> = { op: K; params: OperationParams[K] };

export type KeywordRow = {
  keyword: string;
  volume: number | null;
  /** Keyword difficulty 0–100. */
  kd: number | null;
  /** Cost per click in micro-USD. */
  cpcMicros: number | null;
  /** Paid competition 0–1. */
  competition: number | null;
  intent: Intent | null;
};
export type SerpItem = { rank: number; type: string; url: string; domain: string; title: string };
export type DomainOverview = { organicTraffic: number | null; organicKeywords: number | null; top3: number | null; top10: number | null; trafficValueMicros: number | null };
export type RankedKeyword = { keyword: string; position: number; url: string; volume: number | null; trafficEstimate: number | null };
export type Competitor = { domain: string; avgPosition: number | null; intersections: number | null; trafficEstimate: number | null };
export type BacklinksOverview = { backlinks: number | null; referringDomains: number | null; rank: number | null; brokenBacklinks: number | null };
export type Backlink = { urlFrom: string; domainFrom: string; urlTo: string; anchor: string; dofollow: boolean; domainRank: number | null; firstSeen: string | null; lost: boolean };
export type RankPosition = { keyword: string; position: number | null; url: string | null };
export type AuditIssue = { type: string; severity: "critical" | "warning" | "info"; count: number; title: string };

export type OperationResults = {
  keywordIdeas: KeywordRow[];
  keywordMetrics: KeywordRow[];
  serp: SerpItem[];
  domainOverview: DomainOverview;
  rankedKeywords: RankedKeyword[];
  serpCompetitors: Competitor[];
  backlinksOverview: BacklinksOverview;
  backlinksProfile: Backlink[];
  "rankTracker.create": { trackerId: string };
  "rankTracker.add": { added: number };
  /** OpenSEO runs asynchronously (positions null, read them with get); the others answer at once. */
  "rankTracker.run": { runId: string | null; positions: RankPosition[] | null };
  "rankTracker.get": { positions: RankPosition[]; lastCheckedAt: string | null };
  "siteAudit.run": { auditId: string };
  "siteAudit.status": { state: "running" | "done" | "failed"; pagesCrawled: number; pagesTotal: number | null };
  "siteAudit.issues": AuditIssue[];
};

/** What a provider answers: the data, what it says it charged (null = it does not say), and billable units. */
export type ProviderResponse<T> = { data: T; costMicros: number | null; units: number };

export type CostEstimate = {
  /** Upper bound, micro-USD. */
  micros: number;
  /** How the number was obtained. */
  basis: "price-table" | "provider-quote" | "free";
  /** The arithmetic, for people ("1 task × $0.012 + 150 rows × $0.00012"). */
  explain: string;
};

export type Balance = { micros: number | null; checkedAt: Date; note?: string };

type Call<K extends OperationName> = (p: OperationParams[K]) => Promise<ProviderResponse<OperationResults[K]>>;

export interface SeoDataProvider {
  readonly name: ProviderName;
  /** For people: "DataForSEO (direct)". */
  readonly label: string;
  keywordIdeas: Call<"keywordIdeas">;
  keywordMetrics: Call<"keywordMetrics">;
  serp: Call<"serp">;
  domainOverview: Call<"domainOverview">;
  rankedKeywords: Call<"rankedKeywords">;
  serpCompetitors: Call<"serpCompetitors">;
  backlinksOverview: Call<"backlinksOverview">;
  backlinksProfile: Call<"backlinksProfile">;
  rankTracker: {
    create: Call<"rankTracker.create">;
    add: Call<"rankTracker.add">;
    run: Call<"rankTracker.run">;
    get: Call<"rankTracker.get">;
  };
  siteAudit: {
    run: Call<"siteAudit.run">;
    status: Call<"siteAudit.status">;
    issues: Call<"siteAudit.issues">;
  };
  /** Price before the call (rule 11). Never calls anything paid. */
  estimateCost(operation: Operation): Promise<CostEstimate>;
  /** The provider account's remaining balance, when the provider can tell (null when it cannot). */
  balance(): Promise<Balance>;
}

/** The provider failed. `billedMicros` is set when it says it charged anyway. Messages never contain credentials. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly opts: { billedMicros?: number | null; status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The provider cannot do this operation at all (see docs/provider-decision.md, gap table). */
export class ProviderUnsupportedError extends ProviderError {
  constructor(provider: ProviderName, op: OperationName, why: string) {
    super(`${provider} cannot ${op}: ${why}`);
    this.name = "ProviderUnsupportedError";
  }
}

/** Calls the provider method an operation names. The only place that maps names to methods. */
export function invoke<K extends OperationName>(p: SeoDataProvider, operation: OperationOf<K>): Promise<ProviderResponse<OperationResults[K]>> {
  const o = operation as Operation;
  const r = (() => {
    switch (o.op) {
      case "keywordIdeas": return p.keywordIdeas(o.params);
      case "keywordMetrics": return p.keywordMetrics(o.params);
      case "serp": return p.serp(o.params);
      case "domainOverview": return p.domainOverview(o.params);
      case "rankedKeywords": return p.rankedKeywords(o.params);
      case "serpCompetitors": return p.serpCompetitors(o.params);
      case "backlinksOverview": return p.backlinksOverview(o.params);
      case "backlinksProfile": return p.backlinksProfile(o.params);
      case "rankTracker.create": return p.rankTracker.create(o.params);
      case "rankTracker.add": return p.rankTracker.add(o.params);
      case "rankTracker.run": return p.rankTracker.run(o.params);
      case "rankTracker.get": return p.rankTracker.get(o.params);
      case "siteAudit.run": return p.siteAudit.run(o.params);
      case "siteAudit.status": return p.siteAudit.status(o.params);
      case "siteAudit.issues": return p.siteAudit.issues(o.params);
    }
  })();
  return r as Promise<ProviderResponse<OperationResults[K]>>;
}
