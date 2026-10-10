/**
 * A local stand-in for Google's OAuth 2.0 endpoints and the Search Console /
 * GA4 APIs, for tests and e2e (GOOGLE_API_TEST_ORIGIN). It behaves like the
 * real thing where it matters to us: the consent page redirects back with a
 * code and the state; the token endpoint checks the client, the redirect URI
 * and the PKCE verifier against the S256 challenge, and issues read-only
 * scopes; refresh tokens can be revoked; the APIs need a valid bearer token.
 * Search Console (searchAnalytics.query with dimensions, dataState, data lag,
 * first_incomplete_date, rowLimit/startRow paging), URL Inspection, GA4
 * Admin (account summaries, data streams, key events) and the GA4 Data API
 * (runReport with filters, offset/limit, rowCount, metadata) answer in the
 * documented shapes from synthetic, deterministic data
 * (test/helpers/fake-google-data.ts). Binds 127.0.0.1 only. Never calls Google.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ANON_SHARE, dayMs, dayRows, dayTotal, firstIncomplete, ga4DayRows, GA4_PROPERTIES, hostOf, iso, pacificToday, type FakeRow } from "./fake-google-data.ts";

export const FAKE_GOOGLE_CLIENT = { clientId: "fake-client-id.apps.googleusercontent.test", clientSecret: "fake-client-secret" };

type Grant = { scope: string; challenge: string; redirectUri: string; clientId: string };

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeGoogle(opts: { port?: number; now?: () => Date } = {}) {
  const clock = opts.now ?? (() => new Date());
  const inspections = new Map<string, number>();
  const codes = new Map<string, Grant>();
  const refresh = new Map<string, { scope: string; revoked: boolean }>();
  const access = new Map<string, { scope: string; exp: number }>();
  const requests: { method: string; path: string; body: string }[] = [];
  const state = { denyNext: false, omitRefreshToken: false, grantedScopeOverride: null as string | null, gscFailNext: 0 };

  const json = (res: ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  const bearer = (req: IncomingMessage, needs: string): boolean => {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const a = t ? access.get(t) : undefined;
    return !!a && a.exp > Date.now() && a.scope.split(" ").includes(needs);
  };
  const GSC = "https://www.googleapis.com/auth/webmasters.readonly";
  const GA = "https://www.googleapis.com/auth/analytics.readonly";

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const b = req.method === "POST" ? await body(req) : "";
    requests.push({ method: req.method ?? "GET", path: url.pathname, body: b });

    // --- OAuth consent: auto-approves (or denies) and redirects back ---
    if (url.pathname === "/o/oauth2/v2/auth") {
      const p = url.searchParams;
      const redirect = new URL(p.get("redirect_uri") ?? "");
      if (p.get("client_id") !== FAKE_GOOGLE_CLIENT.clientId || p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) {
        return json(res, 400, { error: "invalid_request" });
      }
      redirect.searchParams.set("state", p.get("state") ?? "");
      if (state.denyNext) {
        state.denyNext = false;
        redirect.searchParams.set("error", "access_denied");
      } else {
        const code = `4/fake-${randomBytes(12).toString("base64url")}`;
        codes.set(code, { scope: p.get("scope") ?? "", challenge: p.get("code_challenge")!, redirectUri: p.get("redirect_uri")!, clientId: p.get("client_id")! });
        redirect.searchParams.set("code", code);
      }
      res.writeHead(302, { Location: redirect.toString() });
      return res.end();
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const f = new URLSearchParams(b);
      if (f.get("client_id") !== FAKE_GOOGLE_CLIENT.clientId || f.get("client_secret") !== FAKE_GOOGLE_CLIENT.clientSecret) return json(res, 401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") {
        const g = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? ""); // single use
        if (!g) return json(res, 400, { error: "invalid_grant", error_description: "Bad Request" });
        if (g.redirectUri !== f.get("redirect_uri")) return json(res, 400, { error: "redirect_uri_mismatch" });
        const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== g.challenge) return json(res, 400, { error: "invalid_grant", error_description: "code_verifier does not match" });
        const scope = state.grantedScopeOverride ?? g.scope;
        const at = `ya29.fake-${randomBytes(12).toString("base64url")}`;
        access.set(at, { scope, exp: Date.now() + 3600_000 });
        const rt = `1//fake-refresh-${randomBytes(16).toString("base64url")}`;
        refresh.set(rt, { scope, revoked: false });
        return json(res, 200, { access_token: at, expires_in: 3599, scope, token_type: "Bearer", ...(state.omitRefreshToken ? {} : { refresh_token: rt }) });
      }
      if (f.get("grant_type") === "refresh_token") {
        const r = refresh.get(f.get("refresh_token") ?? "");
        if (!r || r.revoked) return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        const at = `ya29.fake-${randomBytes(12).toString("base64url")}`;
        access.set(at, { scope: r.scope, exp: Date.now() + 3600_000 });
        return json(res, 200, { access_token: at, expires_in: 3599, scope: r.scope, token_type: "Bearer" });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (url.pathname === "/revoke" && req.method === "POST") {
      const t = new URLSearchParams(b).get("token") ?? "";
      const r = refresh.get(t);
      if (!r) return json(res, 400, { error: "invalid_token" });
      r.revoked = true;
      return json(res, 200, {});
    }

    // --- test-only: issue a refresh token directly (seeds connect demo sites without a browser) ---
    if (url.pathname === "/__fake/refresh-token" && req.method === "POST") {
      const scope = String((JSON.parse(b || "{}") as { scope?: string }).scope ?? "");
      if (![GSC, GA].includes(scope)) return json(res, 400, { error: "invalid_scope" });
      const rt = `1//fake-refresh-${randomBytes(16).toString("base64url")}`;
      refresh.set(rt, { scope, revoked: false });
      return json(res, 200, { refresh_token: rt, scope });
    }

    // --- Search Console ---
    if (url.pathname === "/webmasters/v3/sites") {
      if (!bearer(req, GSC)) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } });
      return json(res, 200, { siteEntry: [
        { siteUrl: "sc-domain:sonorch.ai", permissionLevel: "siteOwner" },
        { siteUrl: "https://lumoras.ai/", permissionLevel: "siteFullUser" },
        { siteUrl: "sc-domain:northwind-dental.example", permissionLevel: "siteOwner" },
        { siteUrl: "https://unverified.example/", permissionLevel: "siteUnverifiedUser" },
      ] });
    }
    const sa = /^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(url.pathname);
    if (sa && req.method === "POST") {
      if (!bearer(req, GSC)) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
      const site = decodeURIComponent(sa[1]);
      if (state.gscFailNext) {
        const code = state.gscFailNext;
        state.gscFailNext = 0;
        return json(res, code, { error: { code, message: code === 429 ? "Quota exceeded for quota metric 'Queries'." : "Backend Error", status: code === 429 ? "RESOURCE_EXHAUSTED" : "INTERNAL" } });
      }
      return json(res, ...searchAnalytics(site, JSON.parse(b || "{}"), pacificToday(clock())));
    }

    // --- URL Inspection (read-only index status) ---
    if (url.pathname === "/v1/urlInspection/index:inspect" && req.method === "POST") {
      if (!bearer(req, GSC)) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
      const q = JSON.parse(b || "{}") as { inspectionUrl?: string; siteUrl?: string };
      const site = q.siteUrl ?? "", target = q.inspectionUrl ?? "";
      let u: URL;
      try {
        u = new URL(target);
      } catch {
        return json(res, 400, { error: { code: 400, message: "Invalid inspectionUrl." } });
      }
      const host = hostOf(site);
      const inside = site.startsWith("sc-domain:") ? u.hostname === host || u.hostname.endsWith(`.${host}`) : target.startsWith(site);
      if (!inside) return json(res, 403, { error: { code: 403, message: "You do not own this site, or the inspected URL is not part of this property.", status: "PERMISSION_DENIED" } });
      const used = (inspections.get(site) ?? 0) + 1;
      inspections.set(site, used);
      if (used > 2000) return json(res, 429, { error: { code: 429, message: "Quota exceeded for quota metric 'URL inspection'.", status: "RESOURCE_EXHAUSTED" } });
      return json(res, 200, { inspectionResult: inspection(u, site, clock()) });
    }

    // --- GA4 Admin and Data ---
    if (url.pathname === "/admin/v1beta/accountSummaries") {
      if (!bearer(req, GA)) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
      return json(res, 200, { accountSummaries: [
        { account: "accounts/100", displayName: "Lumoras", propertySummaries: [
          { property: "properties/111111111", displayName: "sonorch.ai - GA4", propertyType: "PROPERTY_TYPE_ORDINARY", parent: "accounts/100" },
          { property: "properties/222222222", displayName: "lumoras.ai", propertyType: "PROPERTY_TYPE_ORDINARY", parent: "accounts/100" },
          { property: "properties/333333333", displayName: "Northwind Dental", propertyType: "PROPERTY_TYPE_ORDINARY", parent: "accounts/100" },
        ] },
      ] });
    }
    const adm = /^\/admin\/v1beta\/(properties\/\d+)\/(dataStreams|keyEvents)$/.exec(url.pathname);
    if (adm) {
      if (!bearer(req, GA)) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
      const p = GA4_PROPERTIES[adm[1]];
      if (!p) return json(res, 403, { error: { code: 403, message: "User does not have sufficient permissions for this property.", status: "PERMISSION_DENIED" } });
      if (adm[2] === "dataStreams") {
        return json(res, 200, p.stream ? { dataStreams: [{ name: `${adm[1]}/dataStreams/5001`, type: "WEB_DATA_STREAM", displayName: p.host, webStreamData: { measurementId: "G-FAKE0000", defaultUri: p.stream }, createTime: "2025-01-10T12:00:00Z", updateTime: "2025-01-10T12:00:00Z" }] } : {});
      }
      return json(res, 200, p.keyEvents.length ? { keyEvents: p.keyEvents.map((e, i) => ({ name: `${adm[1]}/keyEvents/${700 + i}`, eventName: e, createTime: "2025-01-10T12:00:00Z", deletable: true, custom: true, countingMethod: "ONCE_PER_EVENT" })) } : {});
    }
    const rr = /^\/data\/v1beta\/(properties\/\d+):runReport$/.exec(url.pathname);
    if (rr && req.method === "POST") {
      if (!bearer(req, GA)) return json(res, 401, { error: { code: 401, message: "Request had invalid authentication credentials." } });
      if (!GA4_PROPERTIES[rr[1]]) return json(res, 403, { error: { code: 403, message: "User does not have sufficient permissions for this property.", status: "PERMISSION_DENIED" } });
      return json(res, ...runReport(rr[1], JSON.parse(b || "{}"), clock()));
    }

    json(res, 404, { error: { code: 404, message: "Not found" } });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requests,
    state,
    /** Simulates the user revoking access in their Google account. */
    revokeAll: () => refresh.forEach((r) => (r.revoked = true)),
    refreshTokens: () => [...refresh.entries()].map(([token, r]) => ({ token, ...r })),
    /** A refresh token for a read-only scope, as if a user had consented (seeds and tests). */
    issueRefreshToken: (kind: "search_console" | "ga4") => {
      const rt = `1//fake-refresh-${randomBytes(16).toString("base64url")}`;
      refresh.set(rt, { scope: kind === "ga4" ? GA : GSC, revoked: false });
      return rt;
    },
    /** URL inspections answered per property. */
    inspections,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

type J = Record<string, unknown>;
const err = (code: number, message: string): [number, unknown] => [code, { error: { code, message, status: code === 400 ? "INVALID_ARGUMENT" : "ERROR" } }];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** searchAnalytics.query over the synthetic rows, as documented (2026-08-11): grouping, sorting, paging, dataState, metadata. */
export function searchAnalytics(site: string, q: J, today: string): [number, unknown] {
  const start = String(q.startDate ?? ""), end = String(q.endDate ?? "");
  if (!DATE.test(start) || !DATE.test(end)) return err(400, "startDate and endDate are required (YYYY-MM-DD).");
  if (start > end) return err(400, "startDate must be earlier than or equal to endDate.");
  const dims = (Array.isArray(q.dimensions) ? q.dimensions : []).map(String);
  if (new Set(dims).size !== dims.length) return err(400, "A dimension may only be requested once.");
  const rowLimit = q.rowLimit === undefined ? 1000 : Number(q.rowLimit);
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25_000) return err(400, "rowLimit must be between 1 and 25000.");
  const startRow = q.startRow === undefined ? 0 : Number(q.startRow);
  if (!Number.isInteger(startRow) || startRow < 0) return err(400, "startRow must be non-negative.");
  const dataState = String(q.dataState ?? "final").toLowerCase();
  const incomplete = firstIncomplete(today);
  type R = { day: string; query: string; page: string; clicks: number; impressions: number; position: number };
  const base: R[] = [];
  for (let t = dayMs(start); t <= dayMs(end); t += 86_400_000) {
    const day = iso(t);
    if (dataState !== "all" && day >= incomplete) continue;
    if (dims.includes("query")) base.push(...dayRows(site, day, today));
    else if (dims.includes("page")) {
      // page totals include anonymised queries' impressions and clicks
      const byPage = new Map<string, FakeRow[]>();
      for (const r of dayRows(site, day, today)) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
      for (const [page, rs] of byPage) {
        const imp = rs.reduce((s, r) => s + r.impressions, 0), clicks = rs.reduce((s, r) => s + r.clicks, 0);
        const pos = rs.reduce((s, r) => s + r.position * r.impressions, 0) / imp;
        base.push({ day, query: "", page, clicks: clicks + Math.round(clicks * ANON_SHARE), impressions: imp + Math.round(imp * ANON_SHARE), position: Math.round(pos * 100) / 100 });
      }
    } else {
      const x = dayTotal(site, day, today);
      if (x) base.push({ day, query: "", page: "", ...x });
    }
  }
  const keyOf = (r: R) => dims.map((d) => (d === "date" ? r.day : d === "query" ? r.query : d === "page" ? r.page : ""));
  const groups = new Map<string, { keys: string[]; rows: R[] }>();
  for (const r of base) {
    const k = keyOf(r), id = JSON.stringify(k);
    const g = groups.get(id) ?? { keys: k, rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  }
  let rows = [...groups.values()].map((g) => {
    const clicks = g.rows.reduce((s, r) => s + r.clicks, 0), impressions = g.rows.reduce((s, r) => s + r.impressions, 0);
    const position = impressions ? g.rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : 0;
    return { keys: g.keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
  });
  const di = dims.indexOf("date");
  rows.sort((a, b) => (di >= 0 ? a.keys[di].localeCompare(b.keys[di]) : 0) || b.clicks - a.clicks || b.impressions - a.impressions || a.keys.join().localeCompare(b.keys.join()));
  rows = rows.slice(startRow, startRow + rowLimit);
  const out: J = { responseAggregationType: dims.includes("page") ? "byPage" : "byProperty" };
  if (rows.length) out.rows = rows;
  if (dataState === "all" && di >= 0 && end >= incomplete) out.metadata = { first_incomplete_date: incomplete };
  return [200, out];
}

/** URL Inspection result in the documented shape (UrlInspectionResult, 2025-01-21). */
function inspection(u: URL, site: string, now: Date) {
  const path = u.pathname;
  const crawled = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const base = { inspectionResultLink: `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(site)}&id=${encodeURIComponent(u.toString())}`, mobileUsabilityResult: { verdict: "VERDICT_UNSPECIFIED" }, richResultsResult: undefined };
  if (path === "/x" || path.includes("missing")) {
    return { ...base, indexStatusResult: { verdict: "FAIL", coverageState: "Not found (404)", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", lastCrawlTime: crawled, pageFetchState: "NOT_FOUND", crawledAs: "MOBILE" } };
  }
  if (/new|draft|ai-receptionist-for-small-business/.test(path)) {
    return { ...base, indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google", robotsTxtState: "ROBOTS_TXT_STATE_UNSPECIFIED", indexingState: "INDEXING_STATE_UNSPECIFIED", pageFetchState: "PAGE_FETCH_STATE_UNSPECIFIED" } };
  }
  if (/pricing/.test(path)) {
    return { ...base, indexStatusResult: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "PAGE_FETCH_STATE_UNSPECIFIED", referringUrls: [`${u.origin}/`] } };
  }
  return {
    ...base,
    indexStatusResult: {
      sitemap: [`${u.origin}/sitemap.xml`], referringUrls: [`${u.origin}/`], verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED",
      lastCrawlTime: crawled, pageFetchState: "SUCCESSFUL", googleCanonical: u.toString(), userCanonical: u.toString(), crawledAs: "MOBILE",
    },
  };
}

/** properties.runReport over the synthetic GA4 rows (RunReportResponse shape, 2026-04-23). */
export function runReport(property: string, q: J, now: Date): [number, unknown] {
  const p = GA4_PROPERTIES[property];
  // relative dates ("yesterday", "NdaysAgo") resolve in the property's own time zone, as GA4 does
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: p.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const dims = (Array.isArray(q.dimensions) ? q.dimensions : []).map((d) => String((d as J).name));
  const mets = (Array.isArray(q.metrics) ? q.metrics : []).map((m) => String((m as J).name));
  const known = new Set(["date", "sessionDefaultChannelGroup", "landingPage", "eventName"]);
  for (const d of dims) if (!known.has(d)) return err(400, `Field ${d} is not a valid dimension.`);
  for (const m of mets) if (m !== "sessions" && m !== "keyEvents") return err(400, `Field ${m} is not a valid metric.`);
  const range = (Array.isArray(q.dateRanges) ? q.dateRanges[0] : null) as J | null;
  const rel = (s: string) => (s === "today" ? today : s === "yesterday" ? iso(dayMs(today) - 86_400_000) : /^(\d+)daysAgo$/.test(s) ? iso(dayMs(today) - Number(s.replace("daysAgo", "")) * 86_400_000) : s);
  const start = rel(String(range?.startDate ?? "")), end = rel(String(range?.endDate ?? ""));
  if (!DATE.test(start) || !DATE.test(end) || start > end) return err(400, "Invalid date range.");
  // dimension filter: a stringFilter (EXACT), its notExpression, or an inListFilter, on the channel group
  const f = q.dimensionFilter as J | undefined;
  const inner = (f?.notExpression ?? f) as J | undefined;
  const filt = inner?.filter as J | undefined;
  const negate = !!f?.notExpression;
  const accepts = (channel: string) => {
    if (!filt) return true;
    if (filt.fieldName !== "sessionDefaultChannelGroup") return true;
    const sf = filt.stringFilter as J | undefined, lf = filt.inListFilter as J | undefined;
    const hit = sf ? channel === sf.value : lf ? (lf.values as string[]).includes(channel) : true;
    return negate ? !hit : hit;
  };
  type Row = { date: string; sessionDefaultChannelGroup: string; landingPage: string; eventName: string | null; sessions: number; keyEvents: number };
  const base: Row[] = [];
  for (let t = dayMs(start); t <= dayMs(end); t += 86_400_000) {
    const day = iso(t);
    for (const r of ga4DayRows(property, day, pacificToday(now))) if (accepts(r.channel)) base.push({ date: day.replace(/-/g, ""), sessionDefaultChannelGroup: r.channel, landingPage: r.landingPage, eventName: r.eventName, sessions: r.sessions, keyEvents: r.keyEvents });
  }
  const useRows = dims.includes("eventName") ? base.filter((r) => r.eventName) : base;
  const groups = new Map<string, { keys: string[]; s: number; k: number }>();
  for (const r of useRows) {
    const keys = dims.map((d) => String(r[d as keyof Row] ?? ""));
    const id = JSON.stringify(keys);
    const g = groups.get(id) ?? { keys, s: 0, k: 0 };
    g.s += r.sessions;
    g.k += r.keyEvents;
    groups.set(id, g);
  }
  let rows = [...groups.values()];
  const mf = (q.metricFilter as J | undefined)?.filter as J | undefined;
  if (mf?.fieldName === "keyEvents") rows = rows.filter((r) => r.k > 0);
  if (mf?.fieldName === "sessions") rows = rows.filter((r) => r.s > 0);
  const ob = Array.isArray(q.orderBys) ? ((q.orderBys[0] as J)?.metric as J | undefined)?.metricName : undefined;
  rows.sort((a, b) => (ob === "keyEvents" ? b.k - a.k : ob === "sessions" ? b.s - a.s : 0) || a.keys.join().localeCompare(b.keys.join()));
  const rowCount = rows.length;
  const offset = Number(q.offset ?? 0) || 0, limit = Number(q.limit ?? 10_000) || 10_000;
  rows = rows.slice(offset, offset + Math.min(limit, 250_000));
  const out: J = {
    dimensionHeaders: dims.map((name) => ({ name })),
    metricHeaders: mets.map((name) => ({ name, type: "TYPE_INTEGER" })),
    metadata: { currencyCode: "USD", timeZone: p.timeZone },
    kind: "analyticsData#runReport",
  };
  if (rowCount) {
    out.rows = rows.map((r) => ({ dimensionValues: r.keys.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m === "sessions" ? r.s : r.k) })) }));
    out.rowCount = rowCount;
  }
  return [200, out];
}
