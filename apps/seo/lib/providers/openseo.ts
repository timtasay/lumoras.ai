/**
 * OpenSeoProvider: OpenSEO called as an MCP server over HTTP (build prompt
 * section 4). Tool names and parameters are the real ones read from
 * OpenSEO's source and tools/list (docs/openseo-tools.md); nothing here is
 * guessed from the build prompt.
 *
 * Two modes (owner decision #3, 10 October 2026: OpenSEO on the owner's
 * existing hosted account):
 *   hosted      https://app.openseo.so/mcp with the owner's API key, sent as
 *               `Authorization: Bearer oseo_…` (openseo.so/docs/mcp). Credits
 *               are metered by OpenSEO (1 credit = US$0.001, list price ×
 *               1.28): `whoami` reports the balance, and a call's credits are
 *               recorded when OpenSEO reports them (`creditsCharged` in the
 *               result's meta), else our estimate is charged and the ledger
 *               says so.
 *   selfhosted  our own instance on the private network: no cost and no
 *               balance are reported, so the estimate is charged.
 *
 * Other limits (docs/provider-decision.md):
 *   - every tool needs an OpenSEO projectId: the site's own project (a site
 *     setting, passed in by the metered path), else the default project
 *     (OPENSEO_PROJECT_ID), else one per site domain found with
 *     list_projects or made with create_project (both free);
 *   - find_serp_competitors needs a keyword set, not a domain;
 *   - tracker and audit ids are scoped to a project: ours are
 *     "<projectId>:<openseoId>".
 */
import { normalizeIntent, normalizeKeyword } from "../research/keywords.ts";
import { usdToMicros } from "../research/money.ts";
import { McpClient, McpError } from "./mcp-client.ts";
import { dataForSeoPrice } from "./operations.ts";
import {
  ProviderError,
  ProviderUnsupportedError,
  type Balance,
  type CallContext,
  type CostEstimate,
  type KeywordRow,
  type Market,
  type Operation,
  type OperationParams,
  type OperationResults,
  type ProviderResponse,
  type SeoDataProvider,
} from "./types.ts";

export type OpenSeoConfig = {
  url: string;
  /** hosted: the owner's openseo.so account; selfhosted (default): our own instance. */
  mode?: "hosted" | "selfhosted";
  /** Bearer token: the hosted API key (oseo_…, required in hosted mode), or a proxy's token in front of a self-hosted instance. */
  token?: string | null;
  /** The project for research when the site has none of its own (OPENSEO_PROJECT_ID). */
  defaultProjectId?: string | null;
  /** Cloudflare Access service token, for an instance behind Access. */
  cfAccess?: { clientId: string; clientSecret: string } | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 2048) : "");
const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => obj(o)[k], v);
/** OpenSEO credits → micros (1 credit = US$0.001, src/shared/billing.ts). */
export const creditsToMicros = (c: number) => Math.round(c * 1000);
/** Hosted OpenSEO charges DataForSEO's cost × 1.28 (SEO_DATA_COST_MARKUP), rounded up to whole credits. */
export const HOSTED_MARKUP = 1.28;
export const hostedCredits = (rawMicros: number) => (rawMicros > 0 ? Math.ceil((rawMicros / 1_000_000) * HOSTED_MARKUP * 1000 - 1e-9) : 0);
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(3)}`;
/** The OpenSEO project that holds keyword research not tied to one site. */
export const RESEARCH_PROJECT = "Lumoras Growth research";

function row(r: unknown): KeywordRow | null {
  const keyword = normalizeKeyword(str(at(r, "keyword")));
  if (!keyword) return null;
  const cpc = num(at(r, "cpc"));
  const kd = num(at(r, "keywordDifficulty"));
  const comp = num(at(r, "competition"));
  return {
    keyword,
    volume: num(at(r, "searchVolume")),
    kd: kd === null ? null : Math.max(0, Math.min(100, Math.round(kd))),
    cpcMicros: cpc === null ? null : usdToMicros(Math.max(0, cpc)),
    competition: comp === null ? null : Math.max(0, Math.min(1, comp)),
    intent: normalizeIntent(at(r, "intent")),
  };
}

const split = (id: string): [string, string] => {
  const i = id.indexOf(":");
  if (i < 1) throw new ProviderError(`not an OpenSEO id: ${id.slice(0, 80)}`);
  return [id.slice(0, i), id.slice(i + 1)];
};

export class OpenSeoProvider implements SeoDataProvider {
  readonly name = "openseo" as const;
  readonly label: string;
  readonly mode: "hosted" | "selfhosted";
  private readonly mcp: McpClient;
  private readonly projects = new Map<string, Promise<string>>();
  private readonly defaultProjectId: string | null;

  constructor(cfg: OpenSeoConfig) {
    this.mode = cfg.mode ?? "selfhosted";
    this.label = this.mode === "hosted" ? "OpenSEO (hosted, MCP)" : "OpenSEO (self-hosted, MCP)";
    this.defaultProjectId = cfg.defaultProjectId?.trim() || null;
    const headers: Record<string, string> = {};
    if (this.mode === "hosted") {
      // the owner's API key, from server env only: refused before anything is sent without it
      if (!cfg.token || !cfg.token.startsWith("oseo_")) throw new ProviderError("OpenSEO hosted mode needs the account's API key (OPENSEO_API_KEY, starting oseo_); nothing was sent.");
      headers.Authorization = `Bearer ${cfg.token}`;
    } else {
      if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
      if (cfg.cfAccess) {
        headers["CF-Access-Client-Id"] = cfg.cfAccess.clientId;
        headers["CF-Access-Client-Secret"] = cfg.cfAccess.clientSecret;
      }
    }
    this.mcp = new McpClient({ url: cfg.url, headers, fetch: cfg.fetch, timeoutMs: cfg.timeoutMs });
  }

  /** Every MCP failure becomes a ProviderError (never billed: OpenSEO does not tell us). */
  private async tool<T = J>(name: string, args: J): Promise<T> {
    return (await this.paid<T>(name, args)).data;
  }

  /** A tool call with the credits OpenSEO reports for it (null when it does not say). */
  private async paid<T = J>(name: string, args: J): Promise<{ data: T; credits: number | null }> {
    try {
      const r = await this.mcp.callToolMeta<T>(name, args);
      return { data: r.data, credits: r.meta.creditsCharged };
    } catch (e) {
      if (e instanceof McpError) throw new ProviderError(`OpenSEO ${e.message}`, { status: e.status, billedMicros: null });
      throw e;
    }
  }

  /**
   * The cost of a paid call as the ledger records it: the credits OpenSEO
   * reported, else null (the meter charges the estimate), labelled either way.
   */
  private cost(credits: number | null): Pick<ProviderResponse<unknown>, "costMicros" | "costDetail"> {
    if (credits !== null) return { costMicros: creditsToMicros(credits), costDetail: `provider-reported: OpenSEO charged ${credits} credits (${usd(creditsToMicros(credits))})` };
    return {
      costMicros: null,
      costDetail:
        this.mode === "hosted"
          ? "estimate: OpenSEO did not report this call's credits; charged at our estimate (DataForSEO list price × 1.28)"
          : "estimate: self-hosted OpenSEO reports no cost; charged at our estimate (DataForSEO list price)",
    };
  }

  /**
   * The OpenSEO project for a site domain (list_projects, else create_project;
   * both free). Keyword-level research has no domain: it runs in one project
   * named RESEARCH_PROJECT, without a domain, per market.
   */
  private project(domain: string | null, market: Market | null, cx?: CallContext): Promise<string> {
    if (cx?.projectId) return Promise.resolve(cx.projectId);
    if (this.defaultProjectId) return Promise.resolve(this.defaultProjectId);
    const d = domain?.toLowerCase() ?? null;
    const name = d ?? `${RESEARCH_PROJECT} (${market?.locationCode ?? "default"})`;
    let p = this.projects.get(name);
    if (!p) {
      p = (async () => {
        const list = await this.tool<{ projects?: unknown[] } | unknown[]>("list_projects", {});
        const items = Array.isArray(list) ? list : arr(obj(list).projects);
        const hit = items.find((x) => (d ? str(at(x, "domain")).toLowerCase() === d : str(at(x, "name")) === name));
        if (hit) return str(at(hit, "id"));
        const made = await this.tool("create_project", { name, ...(d ? { domain: d } : {}), ...(market ? { locationCode: market.locationCode, languageCode: market.languageCode } : {}) });
        const id = str(at(made, "project", "id")) || str(at(made, "id"));
        if (!id) throw new ProviderError(`OpenSEO create_project for ${name} returned no id`);
        return id;
      })();
      p.catch(() => this.projects.delete(name));
      this.projects.set(name, p);
    }
    return p;
  }

  private mkt = (m: Market) => ({ locationCode: m.locationCode, languageCode: m.languageCode });

  async estimateCost(operation: Operation): Promise<CostEstimate> {
    if (operation.op === "siteAudit.run") return { micros: 0, basis: "free", explain: "OpenSEO crawls with its own crawler (no DataForSEO charge)" };
    if (operation.op === "rankTracker.run") {
      const [projectId, trackerId] = split(operation.params.trackerId);
      const e = await this.tool("estimate_rank_tracker_cost", { projectId, trackerId });
      const credits = num(at(e, "costCredits")) ?? num(at(e, "live", "costCredits")) ?? num(at(e, "estimate", "costCredits"));
      if (credits !== null) return { micros: creditsToMicros(credits), basis: "provider-quote", explain: `estimate_rank_tracker_cost: ${credits} credits` };
    }
    const p = dataForSeoPrice(operation);
    if (this.mode === "hosted") {
      const credits = hostedCredits(p.micros);
      return { micros: creditsToMicros(credits), basis: credits ? "price-table" : "free", explain: `${p.explain} × ${HOSTED_MARKUP} hosted markup = ${credits} credits (1 credit = $0.001)` };
    }
    return { micros: p.micros, basis: p.micros ? "price-table" : "free", explain: `${p.explain} (DataForSEO list price; self-hosted OpenSEO adds nothing)` };
  }

  /** whoami (free): the hosted account's creditsRemaining; null when self-hosted (OpenSEO does not meter self-hosted calls). */
  async balance(): Promise<Balance> {
    const w = await this.tool("whoami", {});
    const credits = num(at(w, "creditsRemaining"));
    if (credits !== null) return { micros: creditsToMicros(credits), checkedAt: new Date(), note: `${credits.toLocaleString("en-US")} credits on the hosted account (whoami)` };
    return { micros: null, checkedAt: new Date(), note: str(at(w, "mode")) === "self-hosted" ? "Self-hosted OpenSEO does not report a balance." : "OpenSEO did not report a balance (whoami)." };
  }

  keywordIdeas = async (p: OperationParams["keywordIdeas"], cx?: CallContext): Promise<ProviderResponse<OperationResults["keywordIdeas"]>> => {
    const projectId = await this.project(null, p.market, cx);
    const limit = p.limit <= 150 ? 150 : p.limit <= 300 ? 300 : 500;
    const { data: r, credits } = await this.paid("research_keywords", { projectId, seeds: [{ seed: normalizeKeyword(p.seed), ...this.mkt(p.market) }], resultLimit: limit });
    const first = obj(arr(at(r, "results"))[0]);
    if (first.ok !== true) throw new ProviderError(`OpenSEO research_keywords: ${str(first.error) || "failed"}`);
    const data = arr(first.rows).map(row).filter((x): x is KeywordRow => !!x).slice(0, p.limit);
    return { data, ...this.cost(credits), units: data.length };
  };

  keywordMetrics = async (p: OperationParams["keywordMetrics"], cx?: CallContext): Promise<ProviderResponse<OperationResults["keywordMetrics"]>> => {
    const projectId = await this.project(null, p.market, cx);
    const { data: r, credits } = await this.paid("get_keyword_metrics", { projectId, keywords: [...new Set(p.keywords.map(normalizeKeyword))].slice(0, 700), ...this.mkt(p.market), includeMonthlyTrends: false });
    const data = arr(at(r, "keywords")).map(row).filter((x): x is KeywordRow => !!x);
    return { data, ...this.cost(credits), units: data.length };
  };

  serp = async (p: OperationParams["serp"], cx?: CallContext): Promise<ProviderResponse<OperationResults["serp"]>> => {
    const projectId = await this.project(null, p.market, cx);
    const { data: r, credits } = await this.paid("get_serp_results", { projectId, queries: [{ keyword: normalizeKeyword(p.keyword), ...this.mkt(p.market) }], depth: p.depth });
    const first = obj(arr(at(r, "results"))[0]);
    if (first.ok !== true) throw new ProviderError(`OpenSEO get_serp_results: ${str(first.error) || "failed"}`);
    const data = arr(first.items)
      .map((i) => ({ rank: num(at(i, "rank")) ?? 0, type: str(at(i, "type")) || "organic", url: str(at(i, "url")), domain: str(at(i, "domain")), title: str(at(i, "title")).slice(0, 300) }))
      .filter((i) => i.rank > 0);
    return { data, ...this.cost(credits), units: Math.ceil(p.depth / 10) };
  };

  domainOverview = async (p: OperationParams["domainOverview"], cx?: CallContext): Promise<ProviderResponse<OperationResults["domainOverview"]>> => {
    const projectId = await this.project(p.domain, p.market, cx);
    const { data: r, credits } = await this.paid("get_domain_overview", { projectId, domain: p.domain, ...this.mkt(p.market) });
    return {
      data: { organicTraffic: num(at(r, "organicTraffic")), organicKeywords: num(at(r, "organicKeywords")), top3: null, top10: null, trafficValueMicros: null },
      ...this.cost(credits),
      units: 1,
    };
  };

  rankedKeywords = async (p: OperationParams["rankedKeywords"], cx?: CallContext): Promise<ProviderResponse<OperationResults["rankedKeywords"]>> => {
    const projectId = await this.project(p.domain, p.market, cx);
    const { data: r, credits } = await this.paid("get_ranked_keywords", { projectId, target: p.domain, ...this.mkt(p.market), limit: Math.min(100, p.limit) });
    const data = arr(at(r, "keywords"))
      .map((i) => ({
        keyword: normalizeKeyword(str(at(i, "keyword_data", "keyword")) || str(at(i, "keyword"))),
        position: num(at(i, "ranked_serp_element", "serp_item", "rank_absolute")) ?? num(at(i, "rank_absolute")) ?? 0,
        url: str(at(i, "ranked_serp_element", "serp_item", "url")),
        volume: num(at(i, "keyword_data", "keyword_info", "search_volume")),
        trafficEstimate: num(at(i, "ranked_serp_element", "serp_item", "etv")),
      }))
      .filter((x) => x.keyword && x.position > 0);
    return { data, ...this.cost(credits), units: data.length };
  };

  serpCompetitors = async (p: OperationParams["serpCompetitors"], cx?: CallContext): Promise<ProviderResponse<OperationResults["serpCompetitors"]>> => {
    if (!p.keywords.length) throw new ProviderUnsupportedError("openseo", "serpCompetitors", "find_serp_competitors needs a keyword set; save some keywords for the site first");
    const projectId = await this.project(p.domain, p.market, cx);
    const { data: r, credits } = await this.paid("find_serp_competitors", { projectId, keywords: p.keywords.slice(0, 100), excludeDomains: [p.domain], ...this.mkt(p.market), limit: Math.min(100, p.limit) });
    const data = arr(at(r, "competitors"))
      .map((c) => ({ domain: str(at(c, "domain")), avgPosition: num(at(c, "avg_position")), intersections: num(at(c, "intersections")) ?? num(at(c, "keywords_count")), trafficEstimate: num(at(c, "etv")) }))
      .filter((c) => c.domain);
    return { data, ...this.cost(credits), units: data.length };
  };

  backlinksOverview = async (p: OperationParams["backlinksOverview"], cx?: CallContext): Promise<ProviderResponse<OperationResults["backlinksOverview"]>> => {
    const projectId = await this.project(p.domain, null, cx);
    const { data: r, credits } = await this.paid("get_backlinks_overview", { projectId, target: p.domain });
    const o = at(r, "overview");
    return {
      data: { backlinks: num(at(o, "backlinks")), referringDomains: num(at(o, "referringDomains")) ?? num(at(o, "referring_domains")), rank: num(at(o, "rank")), brokenBacklinks: num(at(o, "brokenBacklinks")) ?? num(at(o, "broken_backlinks")) },
      ...this.cost(credits),
      units: 1,
    };
  };

  backlinksProfile = async (p: OperationParams["backlinksProfile"], cx?: CallContext): Promise<ProviderResponse<OperationResults["backlinksProfile"]>> => {
    const projectId = await this.project(p.domain, null, cx);
    const pageSize = p.limit <= 50 ? 50 : p.limit <= 100 ? 100 : 200;
    const { data: r, credits } = await this.paid("get_backlinks_profile", { projectId, target: p.domain, mode: "one_per_domain", pageSize });
    const data = arr(at(r, "backlinks"))
      .slice(0, p.limit)
      .map((b) => ({
        urlFrom: str(at(b, "urlFrom")) || str(at(b, "url_from")),
        domainFrom: str(at(b, "domainFrom")) || str(at(b, "domain_from")),
        urlTo: str(at(b, "urlTo")) || str(at(b, "url_to")),
        anchor: (str(at(b, "anchor")) || "").slice(0, 300),
        dofollow: at(b, "dofollow") === true || at(b, "isDofollow") === true,
        domainRank: num(at(b, "domainFromRank")) ?? num(at(b, "domain_from_rank")),
        firstSeen: str(at(b, "firstSeen")) || str(at(b, "first_seen")) || null,
        lost: at(b, "isLost") === true || at(b, "is_lost") === true,
      }));
    return { data, ...this.cost(credits), units: data.length };
  };

  rankTracker = {
    create: async (p: OperationParams["rankTracker.create"], cx?: CallContext): Promise<ProviderResponse<OperationResults["rankTracker.create"]>> => {
      const projectId = await this.project(p.domain, p.market, cx);
      const r = await this.tool("create_rank_tracker", { projectId, domain: p.domain, ...this.mkt(p.market), devices: "desktop", serpDepth: p.depth, scheduleInterval: "manual" });
      const id = str(at(r, "trackerId"));
      if (!id) throw new ProviderError("OpenSEO create_rank_tracker returned no trackerId");
      return { data: { trackerId: `${projectId}:${id}` }, costMicros: 0, units: 0 };
    },
    add: async (p: OperationParams["rankTracker.add"]): Promise<ProviderResponse<OperationResults["rankTracker.add"]>> => {
      const [projectId, trackerId] = split(p.trackerId);
      const r = await this.tool("add_rank_tracking_keywords", { projectId, trackerId, keywords: p.keywords.map(normalizeKeyword).slice(0, 2000) });
      return { data: { added: num(at(r, "added")) ?? 0 }, costMicros: 0, units: 0 };
    },
    run: async (p: OperationParams["rankTracker.run"]): Promise<ProviderResponse<OperationResults["rankTracker.run"]>> => {
      const [projectId, trackerId] = split(p.trackerId);
      const est = await this.estimateCost({ op: "rankTracker.run", params: p });
      const maxCostCredits = Math.max(1, Math.ceil(est.micros / 1000));
      const { data: r, credits } = await this.paid("run_rank_tracker", { projectId, trackerId, maxCostCredits });
      return { data: { runId: str(at(r, "runId")) || str(at(r, "blockingRunId")) || null, positions: null }, ...this.cost(credits), units: p.keywords.length };
    },
    get: async (p: OperationParams["rankTracker.get"]): Promise<ProviderResponse<OperationResults["rankTracker.get"]>> => {
      const [projectId, trackerId] = split(p.trackerId);
      const r = await this.tool("get_rank_tracker", { projectId, trackerId, limit: 1000 });
      const rows = arr(at(r, "results", "rows"));
      return {
        data: {
          positions: rows.map((x) => ({ keyword: normalizeKeyword(str(at(x, "keyword"))), position: num(at(x, "desktop", "position")) ?? num(at(x, "mobile", "position")), url: str(at(x, "desktop", "url")) || null })),
          lastCheckedAt: str(at(rows[0], "lastCheckedAt")) || null,
        },
        costMicros: 0,
        units: 0,
      };
    },
  };

  siteAudit = {
    run: async (p: OperationParams["siteAudit.run"], cx?: CallContext): Promise<ProviderResponse<OperationResults["siteAudit.run"]>> => {
      const projectId = await this.project(p.domain, null, cx);
      const { data: r, credits } = await this.paid("run_site_audit", { projectId, url: `https://${p.domain}/`, maxPages: Math.max(10, Math.min(10_000, p.maxPages)) });
      const id = str(at(r, "auditId"));
      if (!id) throw new ProviderError("OpenSEO run_site_audit returned no auditId");
      return { data: { auditId: `${projectId}:${id}` }, ...(credits !== null ? this.cost(credits) : { costMicros: 0 }), units: p.maxPages };
    },
    status: async (p: OperationParams["siteAudit.status"]): Promise<ProviderResponse<OperationResults["siteAudit.status"]>> => {
      const [projectId, auditId] = split(p.auditId);
      const s = at(await this.tool("get_audit_status", { projectId, auditId }), "status");
      const st = str(at(s, "status"));
      return { data: { state: st === "completed" ? "done" : st === "failed" ? "failed" : "running", pagesCrawled: num(at(s, "pagesCrawled")) ?? 0, pagesTotal: num(at(s, "pagesTotal")) }, costMicros: 0, units: 0 };
    },
    issues: async (p: OperationParams["siteAudit.issues"]): Promise<ProviderResponse<OperationResults["siteAudit.issues"]>> => {
      const [projectId, auditId] = split(p.auditId);
      const r = await this.tool("get_audit_issues", { projectId, auditId, limit: 1000 });
      const sev = (v: string) => (v === "critical" || v === "info" ? v : "warning") as "critical" | "warning" | "info";
      const data = arr(at(r, "issues")).map((i) => ({ type: str(at(i, "issueType")), severity: sev(str(at(i, "severity"))), count: num(at(i, "count")) ?? 1, title: str(at(i, "title")).slice(0, 200) }));
      return { data, costMicros: 0, units: 0 };
    },
  };
}
