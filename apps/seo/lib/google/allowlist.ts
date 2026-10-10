/**
 * The Google endpoints this app may call, and nothing else. Every request the
 * Google client makes (lib/google/api.ts, lib/google/oauth.ts) passes
 * assertGoogleUrl() first, so a mistake or an injected URL cannot reach an
 * API we never meant to use.
 *
 * The Indexing API is refused by name: Google allows it only for job postings
 * and livestream pages (build prompt section 4), and asking it to crawl
 * ordinary articles breaks its terms. We read index status with the URL
 * Inspection API (read-only) instead. test/unit/google-guard.test.ts also
 * scans the source for any Indexing API address.
 */
export type AllowedEndpoint = { host: string; path: RegExp; what: string };

export const GOOGLE_ALLOWLIST: readonly AllowedEndpoint[] = [
  { host: "accounts.google.com", path: /^\/o\/oauth2\/v2\/auth$/, what: "OAuth consent" },
  { host: "oauth2.googleapis.com", path: /^\/(token|revoke)$/, what: "OAuth token and revoke" },
  { host: "www.googleapis.com", path: /^\/webmasters\/v3\/sites(\/[^/]+\/searchAnalytics\/query)?$/, what: "Search Console sites.list and searchAnalytics.query" },
  { host: "searchconsole.googleapis.com", path: /^\/v1\/urlInspection\/index:inspect$/, what: "URL Inspection (read-only index status)" },
  { host: "analyticsadmin.googleapis.com", path: /^\/v1beta\/(accountSummaries|properties\/\d+\/(dataStreams|keyEvents))$/, what: "GA4 Admin: account summaries, data streams, key events (read)" },
  { host: "analyticsdata.googleapis.com", path: /^\/v1beta\/properties\/\d+:runReport$/, what: "GA4 Data API runReport" },
];

/** Never, under any configuration (hosts and paths of Google's Indexing API). */
export const FORBIDDEN_GOOGLE: readonly RegExp[] = [/(^|\.)indexing\.googleapis\.com$/i, /urlNotifications/i, /\/auth\/indexing/i];

export class GoogleEndpointRefused extends Error {
  constructor(url: string, why: string) {
    super(`refused to call ${url.slice(0, 160)}: ${why}`);
    this.name = "GoogleEndpointRefused";
  }
}

/**
 * Throws unless `url` is one of the allowed Google endpoints. With a test
 * origin (GOOGLE_API_TEST_ORIGIN, loopback only) the same paths are accepted
 * on that origin, mapped the way googleEndpoints() maps them.
 */
export function assertGoogleUrl(raw: string, testOrigin: string | null = null): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new GoogleEndpointRefused(raw, "not a URL");
  }
  const query = (() => {
    try {
      return decodeURIComponent(u.search);
    } catch {
      return u.search;
    }
  })();
  for (const f of FORBIDDEN_GOOGLE) if (f.test(u.hostname) || f.test(u.pathname) || f.test(query)) throw new GoogleEndpointRefused(raw, "the Indexing API is never used (job postings and livestreams only)");
  if (testOrigin && u.origin === new URL(testOrigin).origin) {
    const p = u.pathname
      .replace(/^\/o\/oauth2\/v2\/auth$/, "accounts.google.com/o/oauth2/v2/auth")
      .replace(/^\/(token|revoke)$/, "oauth2.googleapis.com/$1")
      .replace(/^\/webmasters\/v3/, "www.googleapis.com/webmasters/v3")
      .replace(/^\/v1\/urlInspection/, "searchconsole.googleapis.com/v1/urlInspection")
      .replace(/^\/admin\/v1beta/, "analyticsadmin.googleapis.com/v1beta")
      .replace(/^\/data\/v1beta/, "analyticsdata.googleapis.com/v1beta");
    const slash = p.indexOf("/");
    const host = p.slice(0, slash), path = p.slice(slash);
    if (GOOGLE_ALLOWLIST.some((e) => e.host === host && e.path.test(path))) return u;
    throw new GoogleEndpointRefused(raw, "not an allowed Google endpoint (test origin)");
  }
  if (u.protocol !== "https:") throw new GoogleEndpointRefused(raw, "Google is only called over https");
  if (!GOOGLE_ALLOWLIST.some((e) => e.host === u.hostname && e.path.test(u.pathname))) throw new GoogleEndpointRefused(raw, "not an allowed Google endpoint");
  return u;
}
