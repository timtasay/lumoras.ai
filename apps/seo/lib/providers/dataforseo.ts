/**
 * DataForSeoProvider: DataForSEO API v3 directly (docs.dataforseo.com, read
 * 9 October 2026; see docs/external-apis.md). HTTP Basic auth with our own
 * API login and password from the environment; credentials never leave the
 * server and never appear in errors or logs.
 *
 * Every response is the v3 envelope:
 *   { status_code: 20000, cost: 0.0132, tasks: [{ status_code, status_message, cost, result: [...] }] }
 * `cost` (USD) is what DataForSEO billed; it settles the ledger. Responses are
 * untrusted: every field is read defensively into our own shapes.
 *
 * Rank tracking: DataForSEO has no tracker object. `rankTracker.run` checks
 * live SERPs and reports positions; tracker configuration and history belong
 * in our database (rank_trackers / rank_snapshots, Phase 4), so create/add/get
 * here are local no-ops or unsupported. Site audits use the On-Page API.
 */
import { randomUUID } from "node:crypto";
import { normalizeIntent, normalizeKeyword } from "../research/keywords.ts";
import { usdToMicros } from "../research/money.ts";
import { dataForSeoPrice } from "./operations.ts";
import {
  ProviderError,
  ProviderUnsupportedError,
  type Balance,
  type CostEstimate,
  type KeywordRow,
  type Operation,
  type OperationParams,
  type OperationResults,
  type ProviderResponse,
  type SeoDataProvider,
} from "./types.ts";

export const DATAFORSEO_ORIGINS = ["https://api.dataforseo.com", "https://sandbox.dataforseo.com"] as const;

export type DataForSeoConfig = { login: string; password: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 2048) : "");
const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => obj(o)[k], v);

function keywordRow(item: unknown, keywordPath: string[] = ["keyword"], infoPrefix: string[] = []): KeywordRow | null {
  const keyword = normalizeKeyword(str(at(item, ...keywordPath)));
  if (!keyword) return null;
  const info = at(item, ...infoPrefix, "keyword_info");
  const cpc = num(at(info, "cpc"));
  const kd = num(at(item, ...infoPrefix, "keyword_properties", "keyword_difficulty"));
  const comp = num(at(info, "competition"));
  return {
    keyword,
    volume: num(at(info, "search_volume")),
    kd: kd === null ? null : Math.max(0, Math.min(100, Math.round(kd))),
    cpcMicros: cpc === null ? null : usdToMicros(Math.max(0, cpc)),
    competition: comp === null ? null : Math.max(0, Math.min(1, comp)),
    intent: normalizeIntent(at(item, ...infoPrefix, "search_intent_info", "main_intent")),
  };
}

export class DataForSeoProvider implements SeoDataProvider {
  readonly name = "dataforseo" as const;
  readonly label = "DataForSEO (direct)";
  private readonly base: string;
  private readonly auth: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(cfg: DataForSeoConfig) {
    if (!cfg.login || !cfg.password) throw new Error("DataForSEO login and password are required");
    this.base = (cfg.baseUrl ?? DATAFORSEO_ORIGINS[0]).replace(/\/+$/, "");
    this.auth = `Basic ${Buffer.from(`${cfg.login}:${cfg.password}`).toString("base64")}`;
    this.timeoutMs = cfg.timeoutMs ?? 60_000;
    this.doFetch = cfg.fetch ?? fetch;
  }

  /** One request; returns the first task's result list and the billed cost. */
  private async call(path: string, body?: unknown[]): Promise<{ result: unknown[]; costMicros: number; taskId: string }> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: this.auth, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch (e) {
      throw new ProviderError(`DataForSEO request to ${path} failed: ${e instanceof Error ? e.name : "network error"}`, { retryable: true });
    }
    const text = await res.text();
    if (text.length > 20_000_000) throw new ProviderError(`DataForSEO response to ${path} is too large`);
    let env: Json;
    try {
      env = obj(JSON.parse(text));
    } catch {
      throw new ProviderError(`DataForSEO answered ${path} with HTTP ${res.status} and no JSON`, { status: res.status, retryable: res.status >= 500 });
    }
    const costUsd = num(env.cost) ?? 0;
    const costMicros = usdToMicros(Math.max(0, costUsd));
    if (!res.ok || num(env.status_code) !== 20000) {
      throw new ProviderError(`DataForSEO ${path}: ${num(env.status_code) ?? res.status} ${str(env.status_message).slice(0, 200)}`, { status: res.status, billedMicros: costMicros, retryable: res.status >= 500 });
    }
    const task = obj(arr(env.tasks)[0]);
    if (body && num(task.status_code) !== 20000) {
      throw new ProviderError(`DataForSEO ${path} task: ${num(task.status_code)} ${str(task.status_message).slice(0, 200)}`, { billedMicros: usdToMicros(Math.max(0, num(task.cost) ?? 0)) });
    }
    return { result: arr(task.result), costMicros, taskId: str(task.id) };
  }

  async estimateCost(operation: Operation): Promise<CostEstimate> {
    const p = dataForSeoPrice(operation);
    return { micros: p.micros, basis: p.micros ? "price-table" : "free", explain: p.explain };
  }

  /** GET /v3/appendix/user_data (free): money.balance in USD. */
  async balance(): Promise<Balance> {
    const { result } = await this.call("/v3/appendix/user_data");
    const b = num(at(result[0], "money", "balance"));
    return { micros: b === null ? null : usdToMicros(Math.max(0, b)), checkedAt: new Date() };
  }

  private items(result: unknown[]): unknown[] {
    return arr(at(result[0], "items"));
  }

  keywordIdeas = async (p: OperationParams["keywordIdeas"]): Promise<ProviderResponse<OperationResults["keywordIdeas"]>> => {
    const { result, costMicros } = await this.call("/v3/dataforseo_labs/google/keyword_ideas/live", [
      { keywords: [normalizeKeyword(p.seed)], location_code: p.market.locationCode, language_code: p.market.languageCode, limit: p.limit, include_serp_info: false },
    ]);
    const data = this.items(result).map((i) => keywordRow(i)).filter((x): x is KeywordRow => !!x).slice(0, p.limit);
    return { data, costMicros, units: data.length };
  };

  keywordMetrics = async (p: OperationParams["keywordMetrics"]): Promise<ProviderResponse<OperationResults["keywordMetrics"]>> => {
    const { result, costMicros } = await this.call("/v3/dataforseo_labs/google/keyword_overview/live", [
      { keywords: [...new Set(p.keywords.map(normalizeKeyword))].slice(0, 700), location_code: p.market.locationCode, language_code: p.market.languageCode },
    ]);
    const data = this.items(result).map((i) => keywordRow(i)).filter((x): x is KeywordRow => !!x);
    return { data, costMicros, units: data.length };
  };

  serp = async (p: OperationParams["serp"]): Promise<ProviderResponse<OperationResults["serp"]>> => {
    const { result, costMicros } = await this.call("/v3/serp/google/organic/live/advanced", [
      { keyword: normalizeKeyword(p.keyword), location_code: p.market.locationCode, language_code: p.market.languageCode, depth: p.depth },
    ]);
    const data = this.items(result)
      .map((i) => ({ rank: num(at(i, "rank_absolute")) ?? num(at(i, "rank_group")) ?? 0, type: str(at(i, "type")), url: str(at(i, "url")), domain: str(at(i, "domain")), title: str(at(i, "title")).slice(0, 300) }))
      .filter((i) => i.rank > 0);
    return { data, costMicros, units: Math.ceil(p.depth / 10) };
  };

  domainOverview = async (p: OperationParams["domainOverview"]): Promise<ProviderResponse<OperationResults["domainOverview"]>> => {
    const { result, costMicros } = await this.call("/v3/dataforseo_labs/google/domain_rank_overview/live", [
      { target: p.domain, location_code: p.market.locationCode, language_code: p.market.languageCode },
    ]);
    const o = at(this.items(result)[0], "metrics", "organic");
    const etvCost = num(at(o, "estimated_paid_traffic_cost"));
    const pos = (k: string) => num(at(o, k)) ?? 0;
    return {
      data: {
        organicTraffic: num(at(o, "etv")) === null ? null : Math.round(num(at(o, "etv"))!),
        organicKeywords: num(at(o, "count")),
        top3: pos("pos_1") + pos("pos_2_3"),
        top10: pos("pos_1") + pos("pos_2_3") + pos("pos_4_10"),
        trafficValueMicros: etvCost === null ? null : usdToMicros(Math.max(0, etvCost)),
      },
      costMicros,
      units: 1,
    };
  };

  rankedKeywords = async (p: OperationParams["rankedKeywords"]): Promise<ProviderResponse<OperationResults["rankedKeywords"]>> => {
    const { result, costMicros } = await this.call("/v3/dataforseo_labs/google/ranked_keywords/live", [
      { target: p.domain, location_code: p.market.locationCode, language_code: p.market.languageCode, limit: p.limit },
    ]);
    const data = this.items(result)
      .map((i) => ({
        keyword: normalizeKeyword(str(at(i, "keyword_data", "keyword"))),
        position: num(at(i, "ranked_serp_element", "serp_item", "rank_absolute")) ?? num(at(i, "ranked_serp_element", "serp_item", "rank_group")) ?? 0,
        url: str(at(i, "ranked_serp_element", "serp_item", "url")),
        volume: num(at(i, "keyword_data", "keyword_info", "search_volume")),
        trafficEstimate: num(at(i, "ranked_serp_element", "serp_item", "etv")),
      }))
      .filter((r) => r.keyword && r.position > 0);
    return { data, costMicros, units: data.length };
  };

  serpCompetitors = async (p: OperationParams["serpCompetitors"]): Promise<ProviderResponse<OperationResults["serpCompetitors"]>> => {
    // a domain's organic competitors (Labs competitors_domain); OpenSEO only offers the keyword-set variant
    const { result, costMicros } = await this.call("/v3/dataforseo_labs/google/competitors_domain/live", [
      { target: p.domain, location_code: p.market.locationCode, language_code: p.market.languageCode, limit: p.limit, exclude_top_domains: true },
    ]);
    const data = this.items(result)
      .map((i) => ({
        domain: str(at(i, "domain")),
        avgPosition: num(at(i, "avg_position")),
        intersections: num(at(i, "intersections")),
        trafficEstimate: num(at(i, "full_domain_metrics", "organic", "etv")),
      }))
      .filter((c) => c.domain && c.domain !== p.domain);
    return { data, costMicros, units: data.length };
  };

  backlinksOverview = async (p: OperationParams["backlinksOverview"]): Promise<ProviderResponse<OperationResults["backlinksOverview"]>> => {
    const { result, costMicros } = await this.call("/v3/backlinks/summary/live", [{ target: p.domain, include_subdomains: true }]);
    const r = result[0];
    return {
      data: { backlinks: num(at(r, "backlinks")), referringDomains: num(at(r, "referring_domains")), rank: num(at(r, "rank")), brokenBacklinks: num(at(r, "broken_backlinks")) },
      costMicros,
      units: 1,
    };
  };

  backlinksProfile = async (p: OperationParams["backlinksProfile"]): Promise<ProviderResponse<OperationResults["backlinksProfile"]>> => {
    const { result, costMicros } = await this.call("/v3/backlinks/backlinks/live", [{ target: p.domain, mode: "one_per_domain", limit: p.limit }]);
    const data = this.items(result).map((i) => ({
      urlFrom: str(at(i, "url_from")),
      domainFrom: str(at(i, "domain_from")),
      urlTo: str(at(i, "url_to")),
      anchor: str(at(i, "anchor")).slice(0, 300),
      dofollow: at(i, "dofollow") === true,
      domainRank: num(at(i, "domain_from_rank")),
      firstSeen: str(at(i, "first_seen")) || null,
      lost: at(i, "is_lost") === true,
    }));
    return { data, costMicros, units: data.length };
  };

  rankTracker = {
    create: async (_p: OperationParams["rankTracker.create"]): Promise<ProviderResponse<OperationResults["rankTracker.create"]>> => ({ data: { trackerId: randomUUID() }, costMicros: 0, units: 0 }),
    add: async (p: OperationParams["rankTracker.add"]): Promise<ProviderResponse<OperationResults["rankTracker.add"]>> => ({ data: { added: new Set(p.keywords.map(normalizeKeyword)).size }, costMicros: 0, units: 0 }),
    run: async (p: OperationParams["rankTracker.run"]): Promise<ProviderResponse<OperationResults["rankTracker.run"]>> => {
      let cost = 0;
      const positions = [];
      for (const keyword of p.keywords) {
        const r = await this.serp({ keyword, market: p.market, depth: p.depth });
        cost += r.costMicros ?? 0;
        const hit = r.data.find((i) => i.type === "organic" && (i.domain === p.domain || i.domain.endsWith(`.${p.domain}`)));
        const serpFeatures = [...new Set(r.data.filter((i) => i.type && i.type !== "organic").map((i) => i.type))].slice(0, 12);
        positions.push({ keyword: normalizeKeyword(keyword), position: hit?.rank ?? null, url: hit?.url ?? null, serpFeatures });
      }
      return { data: { runId: null, positions }, costMicros: cost, units: p.keywords.length * Math.ceil(p.depth / 10) };
    },
    get: async (_p: OperationParams["rankTracker.get"]): Promise<ProviderResponse<OperationResults["rankTracker.get"]>> => {
      void _p;
      throw new ProviderUnsupportedError("dataforseo", "rankTracker.get", "tracker history is stored in our database (Phase 4), not at DataForSEO");
    },
  };

  siteAudit = {
    run: async (p: OperationParams["siteAudit.run"]): Promise<ProviderResponse<OperationResults["siteAudit.run"]>> => {
      const { costMicros, taskId } = await this.call("/v3/on_page/task_post", [{ target: p.domain, max_crawl_pages: p.maxPages }]);
      if (!taskId) throw new ProviderError(`DataForSEO on_page/task_post for ${p.domain} returned no task id`, { billedMicros: costMicros });
      return { data: { auditId: taskId }, costMicros, units: p.maxPages };
    },
    status: async (p: OperationParams["siteAudit.status"]): Promise<ProviderResponse<OperationResults["siteAudit.status"]>> => {
      const { result } = await this.call(`/v3/on_page/summary/${encodeURIComponent(p.auditId)}`);
      const r = result[0];
      const progress = str(at(r, "crawl_progress"));
      return {
        data: { state: progress === "finished" ? "done" : progress === "in_progress" ? "running" : "failed", pagesCrawled: num(at(r, "crawl_status", "pages_crawled")) ?? 0, pagesTotal: num(at(r, "crawl_status", "max_crawl_pages")) },
        costMicros: 0,
        units: 0,
      };
    },
    issues: async (p: OperationParams["siteAudit.issues"]): Promise<ProviderResponse<OperationResults["siteAudit.issues"]>> => {
      const { result } = await this.call(`/v3/on_page/summary/${encodeURIComponent(p.auditId)}`);
      const checks = obj(at(result[0], "page_metrics", "checks"));
      const CRITICAL = new Set(["is_broken", "is_4xx_code", "is_5xx_code", "broken_links", "no_title", "duplicate_title"]);
      const data = Object.entries(checks)
        .map(([type, n]) => ({ type, count: num(n) ?? 0 }))
        .filter((c) => c.count > 0)
        .map((c) => ({ type: c.type, count: c.count, severity: (CRITICAL.has(c.type) ? "critical" : "warning") as "critical" | "warning", title: c.type.replace(/_/g, " ") }))
        .sort((a, b) => b.count - a.count);
      return { data, costMicros: 0, units: 0 };
    },
  };
}
