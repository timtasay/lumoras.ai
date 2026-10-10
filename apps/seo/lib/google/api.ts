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
import { assertGoogleUrl } from "./allowlist.ts";
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

async function call(e: GoogleEndpoints, url: string, token: string, f: typeof fetch, body?: unknown): Promise<J> {
  // the allowlist (never the Indexing API): a refused URL never reaches fetch
  const safe = assertGoogleUrl(url, e.test ?? null).toString();
  let res: Response;
  try {
    res = await f(safe, {
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
  const j = await call(e, `${e.gsc}/sites`, token, f);
  return arr(j.siteEntry).map((s) => ({ siteUrl: String(obj(s).siteUrl ?? ""), permissionLevel: String(obj(s).permissionLevel ?? "") })).filter((s) => s.siteUrl);
}

export type GscQuery = { startDate: string; endDate: string; dimensions: ("query" | "page" | "date" | "country" | "device")[]; rowLimit?: number; dataState?: "final" | "all" };

export async function gscSearchAnalytics(e: GoogleEndpoints, token: string, siteUrl: string, q: GscQuery, f: typeof fetch = fetch): Promise<GscRow[]> {
  const j = await call(e, `${e.gsc}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, token, f, { type: "web", rowLimit: 1000, ...q });
  return arr(j.rows).map((r) => {
    const o = obj(r);
    return { keys: arr(o.keys).map(String), clicks: num(o.clicks), impressions: num(o.impressions), ctr: num(o.ctr), position: num(o.position) };
  });
}

export async function listGa4Properties(e: GoogleEndpoints, token: string, f: typeof fetch = fetch): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const j = await call(e, `${e.admin}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token, f);
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
  const j = await call(e, `${e.data}/${property}:runReport`, token, f, body);
  return arr(j.rows).map((row) => {
    const o = obj(row);
    const out: Record<string, string | number> = {};
    arr(o.dimensionValues).forEach((v, i) => (out[r.dimensions[i]] = String(obj(v).value ?? "")));
    arr(o.metricValues).forEach((v, i) => (out[r.metrics[i]] = num(obj(v).value)));
    return out;
  });
}

export type UrlInspection = {
  verdict: string;
  coverageState: string;
  indexingState: string;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  robotsTxtState: string;
  pageFetchState: string;
  userCanonical: string | null;
  inspectionResultLink: string | null;
};

/** Search Console URL inspection of one URL in a property (read-only scope). */
export async function gscInspectUrl(e: GoogleEndpoints, token: string, siteUrl: string, inspectionUrl: string, f: typeof fetch = fetch): Promise<UrlInspection> {
  const j = await call(e, e.inspect, token, f, { inspectionUrl, siteUrl, languageCode: "en-US" });
  const ir = obj(obj(j).inspectionResult);
  const r = obj(ir.indexStatusResult);
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : "");
  const link = typeof ir.inspectionResultLink === "string" && /^https:\/\/search\.google\.com\//.test(ir.inspectionResultLink) ? ir.inspectionResultLink.slice(0, 2048) : null;
  return {
    pageFetchState: s(r.pageFetchState),
    userCanonical: s(r.userCanonical) || null,
    inspectionResultLink: link,
    verdict: s(r.verdict) || "VERDICT_UNSPECIFIED",
    coverageState: s(r.coverageState),
    indexingState: s(r.indexingState),
    lastCrawlTime: s(r.lastCrawlTime) || null,
    googleCanonical: s(r.googleCanonical) || null,
    robotsTxtState: s(r.robotsTxtState),
  };
}

// ---------------------------------------------------------------------------
// Phase 4: the daily syncs (docs read 10 October 2026, see docs/external-apis.md)
// ---------------------------------------------------------------------------

export type GscPage = { rows: GscRow[]; firstIncompleteDate: string | null; aggregation: string };

/**
 * One searchAnalytics.query request, with Search Console's freshness
 * metadata: with dataState "all" and the date dimension, metadata.first_incomplete_date
 * names the first day that may still change (Google documents the snake_case name).
 */
export async function gscQueryPage(
  e: GoogleEndpoints,
  token: string,
  siteUrl: string,
  q: { startDate: string; endDate: string; dimensions: ("query" | "page" | "date")[]; rowLimit: number; startRow: number; dataState: "final" | "all" },
  f: typeof fetch = fetch,
): Promise<GscPage> {
  const j = await call(e, `${e.gsc}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, token, f, { type: "web", aggregationType: "auto", ...q });
  const meta = obj(j.metadata);
  const fid = meta.first_incomplete_date ?? meta.firstIncompleteDate;
  return {
    rows: arr(j.rows).map((r) => {
      const o = obj(r);
      return { keys: arr(o.keys).map(String), clicks: num(o.clicks), impressions: num(o.impressions), ctr: num(o.ctr), position: num(o.position) };
    }),
    firstIncompleteDate: typeof fid === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fid) ? fid : null,
    aggregation: String(j.responseAggregationType ?? ""),
  };
}

/**
 * Every row of one query, page by page (rowLimit up to 25,000, startRow
 * advanced by the page size) until a short page, or Google's documented cap of
 * 50,000 rows per day per search type. `pause` runs before every request
 * (the per-property rate limit).
 */
export async function gscQueryAll(
  e: GoogleEndpoints,
  token: string,
  siteUrl: string,
  q: { startDate: string; endDate: string; dimensions: ("query" | "page" | "date")[]; dataState: "final" | "all" },
  opts: { pageRows?: number; maxRows?: number; pause?: () => Promise<void>; fetch?: typeof fetch } = {},
): Promise<{ rows: GscRow[]; firstIncompleteDate: string | null; requests: number; truncated: boolean }> {
  const pageRows = opts.pageRows ?? 25_000, maxRows = opts.maxRows ?? 50_000;
  const rows: GscRow[] = [];
  let first: string | null = null, requests = 0;
  for (let startRow = 0; startRow < maxRows; startRow += pageRows) {
    if (opts.pause) await opts.pause();
    const p = await gscQueryPage(e, token, siteUrl, { ...q, rowLimit: Math.min(pageRows, maxRows - startRow), startRow }, opts.fetch);
    requests++;
    first ??= p.firstIncompleteDate;
    rows.push(...p.rows);
    if (p.rows.length < Math.min(pageRows, maxRows - startRow)) return { rows, firstIncompleteDate: first, requests, truncated: false };
  }
  return { rows, firstIncompleteDate: first, requests, truncated: true };
}

export type Ga4Filter =
  | { field: string; value: string; not?: boolean }
  | { field: string; values: string[] };

export type Ga4FullReport = {
  rows: Record<string, string | number>[];
  rowCount: number;
  timeZone: string | null;
  dataLossFromOtherRow: boolean;
  subjectToThresholding: boolean;
  emptyReason: string | null;
  requests: number;
};

/**
 * properties.runReport with offset paging (limit up to 250,000 rows; rowCount
 * says how many rows the whole result has) and the response metadata
 * (timeZone, dataLossFromOtherRow, emptyReason, subjectToThresholding).
 */
export async function ga4ReportAll(
  e: GoogleEndpoints,
  token: string,
  property: string,
  r: { dimensions: string[]; metrics: string[]; startDate: string; endDate: string; filter?: Ga4Filter; positiveMetric?: string; pageRows?: number; maxRows?: number },
  opts: { pause?: () => Promise<void>; fetch?: typeof fetch } = {},
): Promise<Ga4FullReport> {
  if (!/^properties\/\d+$/.test(property)) throw new GoogleApiError("not a GA4 property id", 400);
  const pageRows = r.pageRows ?? 10_000, maxRows = r.maxRows ?? 100_000;
  const out: Ga4FullReport = { rows: [], rowCount: 0, timeZone: null, dataLossFromOtherRow: false, subjectToThresholding: false, emptyReason: null, requests: 0 };
  for (let offset = 0; offset < maxRows; offset += pageRows) {
    const body: J = {
      dateRanges: [{ startDate: r.startDate, endDate: r.endDate }],
      dimensions: r.dimensions.map((name) => ({ name })),
      metrics: r.metrics.map((name) => ({ name })),
      offset: String(offset),
      limit: String(pageRows),
      keepEmptyRows: false,
    };
    if (r.filter) {
      const flt = "values" in r.filter
        ? { filter: { fieldName: r.filter.field, inListFilter: { values: r.filter.values, caseSensitive: true } } }
        : { filter: { fieldName: r.filter.field, stringFilter: { matchType: "EXACT", value: r.filter.value } } };
      body.dimensionFilter = "values" in r.filter || !r.filter.not ? flt : { notExpression: flt };
    }
    if (r.positiveMetric) body.metricFilter = { filter: { fieldName: r.positiveMetric, numericFilter: { operation: "GREATER_THAN", value: { doubleValue: 0 } } } };
    if (opts.pause) await opts.pause();
    const j = await call(e, `${e.data}/${property}:runReport`, token, opts.fetch ?? fetch, body);
    out.requests++;
    const meta = obj(j.metadata);
    out.rowCount = num(j.rowCount);
    out.timeZone ??= typeof meta.timeZone === "string" ? meta.timeZone.slice(0, 64) : null;
    out.dataLossFromOtherRow ||= meta.dataLossFromOtherRow === true;
    out.subjectToThresholding ||= meta.subjectToThresholding === true;
    out.emptyReason ??= typeof meta.emptyReason === "string" ? meta.emptyReason.slice(0, 200) : null;
    const rows = arr(j.rows).map((row) => {
      const o = obj(row);
      const x: Record<string, string | number> = {};
      arr(o.dimensionValues).forEach((v, i) => (x[r.dimensions[i]] = String(obj(v).value ?? "")));
      arr(o.metricValues).forEach((v, i) => (x[r.metrics[i]] = num(obj(v).value)));
      return x;
    });
    out.rows.push(...rows);
    if (rows.length < pageRows || out.rows.length >= out.rowCount) break;
  }
  return out;
}

export type Ga4Stream = { type: string; displayName: string; measurementId: string | null; defaultUri: string | null };

/** GA4 Admin properties.dataStreams.list (read-only scope). */
export async function listDataStreams(e: GoogleEndpoints, token: string, property: string, f: typeof fetch = fetch): Promise<Ga4Stream[]> {
  if (!/^properties\/\d+$/.test(property)) throw new GoogleApiError("not a GA4 property id", 400);
  const out: Ga4Stream[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const j = await call(e, `${e.admin}/${property}/dataStreams?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token, f);
    for (const s of arr(j.dataStreams)) {
      const o = obj(s), w = obj(o.webStreamData);
      out.push({ type: String(o.type ?? "").slice(0, 60), displayName: String(o.displayName ?? "").slice(0, 200), measurementId: typeof w.measurementId === "string" ? w.measurementId.slice(0, 40) : null, defaultUri: typeof w.defaultUri === "string" ? w.defaultUri.slice(0, 300) : null });
    }
    pageToken = typeof j.nextPageToken === "string" ? j.nextPageToken : "";
    if (!pageToken) break;
  }
  return out;
}

/** GA4 Admin properties.keyEvents.list: the event names counted as key events. */
export async function listKeyEvents(e: GoogleEndpoints, token: string, property: string, f: typeof fetch = fetch): Promise<string[]> {
  if (!/^properties\/\d+$/.test(property)) throw new GoogleApiError("not a GA4 property id", 400);
  const out: string[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const j = await call(e, `${e.admin}/${property}/keyEvents?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token, f);
    for (const k of arr(j.keyEvents)) {
      const n = obj(k).eventName;
      if (typeof n === "string") out.push(n.slice(0, 200));
    }
    pageToken = typeof j.nextPageToken === "string" ? j.nextPageToken : "";
    if (!pageToken) break;
  }
  return out;
}
