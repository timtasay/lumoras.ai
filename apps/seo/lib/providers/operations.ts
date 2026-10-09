/**
 * Per-operation policy (cache lifetime, paid or free), canonical parameters,
 * cache keys, and the DataForSEO price table used to price a call before it
 * is made (rule 11). Pure functions.
 */
import { createHash } from "node:crypto";
import { normalizeKeyword } from "../research/keywords.ts";
import type { Market, Operation, OperationName } from "./types.ts";

export type Category = "seo_credits" | "llm_tokens" | "social_posts";
export const CATEGORIES: Category[] = ["seo_credits", "llm_tokens", "social_posts"];

type Policy = {
  label: string;
  /** How long a result stays reusable for free. null: never cached (stateful or must be live). */
  ttlHours: number | null;
  /** Free operations skip the budget (they still go through the metered path and are logged). */
  free: boolean;
};

const DAY = 24;
export const OPERATION_POLICY: Record<OperationName, Policy> = {
  keywordIdeas: { label: "Keyword ideas", ttlHours: 30 * DAY, free: false },
  keywordMetrics: { label: "Keyword metrics", ttlHours: 30 * DAY, free: false },
  serp: { label: "SERP", ttlHours: 7 * DAY, free: false },
  domainOverview: { label: "Domain overview", ttlHours: 7 * DAY, free: false },
  rankedKeywords: { label: "Ranked keywords", ttlHours: 7 * DAY, free: false },
  serpCompetitors: { label: "SERP competitors", ttlHours: 30 * DAY, free: false },
  backlinksOverview: { label: "Backlinks overview", ttlHours: 30 * DAY, free: false },
  backlinksProfile: { label: "Backlinks profile", ttlHours: 30 * DAY, free: false },
  "rankTracker.create": { label: "Create rank tracker", ttlHours: null, free: true },
  "rankTracker.add": { label: "Add tracked keywords", ttlHours: null, free: true },
  "rankTracker.run": { label: "Rank check", ttlHours: null, free: false },
  "rankTracker.get": { label: "Read rank tracker", ttlHours: null, free: true },
  "siteAudit.run": { label: "Site audit", ttlHours: null, free: false },
  "siteAudit.status": { label: "Audit status", ttlHours: null, free: true },
  "siteAudit.issues": { label: "Audit issues", ttlHours: null, free: true },
};

const marketKey = (m: Market) => ({ locationCode: m.locationCode, languageCode: m.languageCode.toLowerCase() });
const domainKey = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const kwList = (k: string[]) => [...new Set(k.map(normalizeKeyword).filter(Boolean))].sort();

/**
 * The parameters that decide the answer, in one canonical form: keywords
 * normalised (case, spacing, punctuation) and sorted, domains bare, markets
 * reduced to location and language (the label is for people). Two requests
 * with the same canonical params get the same cache entry.
 */
export function canonicalParams(o: Operation): Record<string, unknown> {
  switch (o.op) {
    case "keywordIdeas": return { seed: normalizeKeyword(o.params.seed), market: marketKey(o.params.market), limit: o.params.limit };
    case "keywordMetrics": return { keywords: kwList(o.params.keywords), market: marketKey(o.params.market) };
    case "serp": return { keyword: normalizeKeyword(o.params.keyword), market: marketKey(o.params.market), depth: o.params.depth };
    case "domainOverview": return { domain: domainKey(o.params.domain), market: marketKey(o.params.market) };
    case "rankedKeywords": return { domain: domainKey(o.params.domain), market: marketKey(o.params.market), limit: o.params.limit };
    case "serpCompetitors": return { domain: domainKey(o.params.domain), market: marketKey(o.params.market), keywords: kwList(o.params.keywords), limit: o.params.limit };
    case "backlinksOverview": return { domain: domainKey(o.params.domain) };
    case "backlinksProfile": return { domain: domainKey(o.params.domain), limit: o.params.limit };
    case "rankTracker.create": return { domain: domainKey(o.params.domain), market: marketKey(o.params.market), depth: o.params.depth };
    case "rankTracker.add": return { trackerId: o.params.trackerId, keywords: kwList(o.params.keywords) };
    case "rankTracker.run": return { trackerId: o.params.trackerId, domain: domainKey(o.params.domain), market: marketKey(o.params.market), keywords: kwList(o.params.keywords), depth: o.params.depth };
    case "rankTracker.get": return { trackerId: o.params.trackerId };
    case "siteAudit.run": return { domain: domainKey(o.params.domain), maxPages: o.params.maxPages };
    case "siteAudit.status": return { auditId: o.params.auditId };
    case "siteAudit.issues": return { auditId: o.params.auditId };
  }
}

/** JSON with object keys sorted at every level, so equal values serialise identically. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * sha256 over provider + operation + canonical parameters. The provider is
 * part of the key so demo data can never answer for a real provider after a
 * switch. The workspace scope comes from the table (RLS), not the key.
 */
export function cacheKey(provider: string, o: Operation): string {
  return createHash("sha256").update(canonicalJson({ provider, op: o.op, params: canonicalParams(o) })).digest("hex");
}

/** What a log line says the call was about. */
export function subjectOf(o: Operation): string {
  const s = (() => {
    switch (o.op) {
      case "keywordIdeas": return normalizeKeyword(o.params.seed);
      case "keywordMetrics": {
        const k = kwList(o.params.keywords);
        return k.length > 3 ? `${k.slice(0, 3).join(", ")} +${k.length - 3}` : k.join(", ");
      }
      case "serp": return normalizeKeyword(o.params.keyword);
      case "rankTracker.add": case "rankTracker.get": return o.params.trackerId;
      case "rankTracker.run": return `${domainKey(o.params.domain)} · ${o.params.keywords.length} keywords`;
      case "siteAudit.status": case "siteAudit.issues": return o.params.auditId;
      default: return domainKey((o.params as { domain: string }).domain);
    }
  })();
  return (s || o.op).slice(0, 300);
}

export const marketOf = (o: Operation): string => ("market" in o.params ? (o.params as { market: Market }).market.label : "");

// ---------------------------------------------------------------------------
// DataForSEO list prices, in micro-USD. Read 9 October 2026 from
// dataforseo.com/pricing: Labs (all Google endpoints) $0.012 per task +
// $0.00012 per returned item (×2 with clickstream, which we never request);
// Google Organic SERP live $0.002 per 10 results (standard queue $0.0006);
// Backlinks $0.024 per request + $0.000036 per row; On-Page basic crawl
// $0.00015 per page. These are upper bounds: a call is charged at what the
// provider reports, never more than estimated without the difference showing
// in the ledger.
// ---------------------------------------------------------------------------
export const DFS_PRICES = {
  labsTask: 12_000,
  labsItem: 120,
  serpLivePer10: 2_000,
  serpQueuedPer10: 600,
  backlinksTask: 24_000,
  backlinksRow: 36,
  onPagePage: 150,
} as const;

const usd = (m: number) => `$${(m / 1e6).toFixed(m < 1000 ? 6 : 4).replace(/0+$/, "").replace(/\.$/, "")}`;

/** DataForSEO price of an operation (the same arithmetic DataForSEO bills). */
export function dataForSeoPrice(o: Operation): { micros: number; explain: string } {
  const P = DFS_PRICES;
  const labs = (items: number, what: string) => ({ micros: P.labsTask + items * P.labsItem, explain: `1 task × ${usd(P.labsTask)} + ${items} ${what} × ${usd(P.labsItem)}` });
  const pages = (depth: number) => Math.ceil(depth / 10);
  switch (o.op) {
    case "keywordIdeas": return labs(o.params.limit, "ideas");
    case "keywordMetrics": return labs(kwList(o.params.keywords).length, "keywords");
    case "serp": return { micros: pages(o.params.depth) * P.serpLivePer10, explain: `${pages(o.params.depth)} page(s) of 10 × ${usd(P.serpLivePer10)}` };
    case "domainOverview": return labs(1, "row");
    case "rankedKeywords": return labs(o.params.limit, "rows");
    case "serpCompetitors": return labs(o.params.limit, "competitors");
    case "backlinksOverview": return { micros: P.backlinksTask + P.backlinksRow, explain: `1 request × ${usd(P.backlinksTask)} + 1 row × ${usd(P.backlinksRow)}` };
    case "backlinksProfile": return { micros: P.backlinksTask + o.params.limit * P.backlinksRow, explain: `1 request × ${usd(P.backlinksTask)} + ${o.params.limit} rows × ${usd(P.backlinksRow)}` };
    case "rankTracker.run": {
      const n = kwList(o.params.keywords).length * pages(o.params.depth);
      return { micros: n * P.serpLivePer10, explain: `${kwList(o.params.keywords).length} keywords × ${pages(o.params.depth)} page(s) × ${usd(P.serpLivePer10)}` };
    }
    case "siteAudit.run": return { micros: o.params.maxPages * P.onPagePage, explain: `up to ${o.params.maxPages} pages × ${usd(P.onPagePage)}` };
    default: return { micros: 0, explain: "free" };
  }
}

/** Calendar month (UTC) a call counts against: the first day, YYYY-MM-01. */
export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
