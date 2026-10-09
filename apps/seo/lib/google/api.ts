/**
 * Minimal Search Console and GA4 reads (docs read 9 October 2026, see
 * docs/external-apis.md):
 *   GET  {gsc}/sites                                   sites.list
 *   POST {gsc}/sites/{siteUrl}/searchAnalytics/query    Search Console API v3 (updated 2026-08-11)
 *   GET  {admin}/accountSummaries                      GA4 Admin API v1beta (updated 2026-06-18)
 *   POST {data}/properties/{id}:runReport              GA4 Data API v1beta (updated 2026-04-23)
 *   POST {inspect}                                      URL Inspection API v1 (page updated 2024-07-23, read 9 October 2026;
 *                                                       webmasters.readonly is enough)
 * Read-only scopes. Responses are untrusted data and read defensively. No
 * Indexing API.
 */
import type { GoogleEndpoints } from "./oauth.ts";
import type { Ga4Property, GscRow, GscSite } from "./analysis.ts";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

type J = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

async function call(url: string, token: string, f: typeof fetch, body?: unknown): Promise<J> {
  let res: Response;
  try {
    res = await f(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch (e) {
    throw new GoogleApiError(`Google API unreachable (${e instanceof Error ? e.name : "network"})`, 0);
  }
  const j = obj(await res.json().catch(() => ({})));
  if (!res.ok) throw new GoogleApiError(`Google answered ${res.status}: ${String(obj(j.error).message ?? obj(j.error).status ?? "error").slice(0, 200)}`, res.status);
  return j;
}

export async function listGscSites(e: GoogleEndpoints, token: string, f: typeof fetch = fetch): Promise<GscSite[]> {
  const j = await call(`${e.gsc}/sites`, token, f);
  return arr(j.siteEntry).map((s) => ({ siteUrl: String(obj(s).siteUrl ?? ""), permissionLevel: String(obj(s).permissionLevel ?? "") })).filter((s) => s.siteUrl);
}

export type GscQuery = { startDate: string; endDate: string; dimensions: ("query" | "page" | "date" | "country" | "device")[]; rowLimit?: number; dataState?: "final" | "all" };

export async function gscSearchAnalytics(e: GoogleEndpoints, token: string, siteUrl: string, q: GscQuery, f: typeof fetch = fetch): Promise<GscRow[]> {
  const j = await call(`${e.gsc}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, token, f, { type: "web", rowLimit: 1000, ...q });
  return arr(j.rows).map((r) => {
    const o = obj(r);
    return { keys: arr(o.keys).map(String), clicks: num(o.clicks), impressions: num(o.impressions), ctr: num(o.ctr), position: num(o.position) };
  });
}

export async function listGa4Properties(e: GoogleEndpoints, token: string, f: typeof fetch = fetch): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const j = await call(`${e.admin}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token, f);
    for (const a of arr(j.accountSummaries)) {
      for (const p of arr(obj(a).propertySummaries)) {
        const prop = String(obj(p).property ?? "");
        if (/^properties\/\d+$/.test(prop)) out.push({ property: prop, displayName: String(obj(p).displayName ?? prop).slice(0, 200), account: String(obj(a).displayName ?? "").slice(0, 200) });
      }
    }
    pageToken = typeof j.nextPageToken === "string" ? j.nextPageToken : "";
    if (!pageToken) break;
  }
  return out;
}

export type Ga4Report = { dimensions: string[]; metrics: string[]; startDate: string; endDate: string; filter?: { field: string; value: string }; limit?: number; orderByMetric?: string };

/** runReport → rows of { dimension values..., metric values... } keyed by name. */
export async function ga4RunReport(e: GoogleEndpoints, token: string, property: string, r: Ga4Report, f: typeof fetch = fetch): Promise<Record<string, string | number>[]> {
  if (!/^properties\/\d+$/.test(property)) throw new GoogleApiError("not a GA4 property id", 400);
  const body: J = {
    dateRanges: [{ startDate: r.startDate, endDate: r.endDate }],
    dimensions: r.dimensions.map((name) => ({ name })),
    metrics: r.metrics.map((name) => ({ name })),
    limit: r.limit ?? 1000,
  };
  if (r.filter) body.dimensionFilter = { filter: { fieldName: r.filter.field, stringFilter: { matchType: "EXACT", value: r.filter.value } } };
  if (r.orderByMetric) body.orderBys = [{ metric: { metricName: r.orderByMetric }, desc: true }];
  const j = await call(`${e.data}/${property}:runReport`, token, f, body);
  return arr(j.rows).map((row) => {
    const o = obj(row);
    const out: Record<string, string | number> = {};
    arr(o.dimensionValues).forEach((v, i) => (out[r.dimensions[i]] = String(obj(v).value ?? "")));
    arr(o.metricValues).forEach((v, i) => (out[r.metrics[i]] = num(obj(v).value)));
    return out;
  });
}

export type UrlInspection = { verdict: string; coverageState: string; indexingState: string; lastCrawlTime: string | null; googleCanonical: string | null; robotsTxtState: string };

/** Search Console URL inspection of one URL in a property (read-only scope). */
export async function gscInspectUrl(e: GoogleEndpoints, token: string, siteUrl: string, inspectionUrl: string, f: typeof fetch = fetch): Promise<UrlInspection> {
  const j = await call(e.inspect, token, f, { inspectionUrl, siteUrl, languageCode: "en-US" });
  const r = obj(obj(obj(j).inspectionResult).indexStatusResult);
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : "");
  return {
    verdict: s(r.verdict) || "VERDICT_UNSPECIFIED",
    coverageState: s(r.coverageState),
    indexingState: s(r.indexingState),
    lastCrawlTime: s(r.lastCrawlTime) || null,
    googleCanonical: s(r.googleCanonical) || null,
    robotsTxtState: s(r.robotsTxtState),
  };
}
