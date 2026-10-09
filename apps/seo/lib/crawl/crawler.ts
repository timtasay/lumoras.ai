/**
 * Sitemap crawler: builds a site's route inventory from robots.txt, sitemap
 * indexes and sitemaps, then reads the title and description of a few key
 * pages (to pre-fill the brand profile). Every request goes through safeFetch
 * (SSRF guard). Pure: no database; lib/data/crawl.ts stores the result.
 *
 * Bounded: at most MAX_SITEMAPS sitemap files, nesting depth MAX_DEPTH,
 * MAX_URLS routes, 10 MB per sitemap (after decompression), one deadline for
 * the whole crawl. Only URLs on the site's own host (with or without www.)
 * are kept.
 *
 * TODO(Phase 3): a pg-boss cron job refreshes every active site's inventory
 * daily; for now a crawl runs on demand (onboarding and site settings).
 */
import { gunzipSync } from "node:zlib";
import { parseSitemap, sitemapsFromRobots, extractPageMeta, type PageMeta } from "./parse.ts";
import { safeFetch, SsrfError, type SafeFetchOptions } from "../net/safe-fetch.ts";

export const MAX_SITEMAPS = 50;
export const MAX_DEPTH = 3;
export const MAX_URLS = 50_000;
export const KEY_PAGES = 6;

export type CrawlEvent =
  | { type: "start"; domain: string }
  | { type: "robots"; found: boolean; sitemaps: number }
  | { type: "sitemap"; url: string; kind: "index" | "urlset" | "unknown"; entries: number }
  | { type: "problem"; url: string; message: string }
  | { type: "routes"; total: number }
  | { type: "page"; url: string; title: string | null }
  | { type: "done"; status: CrawlStatus; sitemaps: number; routes: number; problems: number };

export type CrawlStatus = "ok" | "partial" | "failed";
export type CrawledRoute = { url: string; path: string; lastmod: Date | null; source: string };
export type KeyPage = { url: string; path: string } & PageMeta;
export type CrawlResult = {
  status: CrawlStatus;
  sitemaps: string[];
  routes: CrawledRoute[];
  pages: KeyPage[];
  problems: { url: string; message: string }[];
  truncated: boolean;
};

export type CrawlOptions = {
  fetch?: SafeFetchOptions;
  onEvent?: (e: CrawlEvent) => void;
  deadlineMs?: number;
  keyPages?: number;
  /** Where to start (default https://<domain>). Tests point this at a local fake site. */
  origin?: string;
};

/** Same site: the domain itself or its www. twin. */
export function isSameSite(url: URL, domain: string) {
  const h = url.hostname.toLowerCase();
  const bare = domain.replace(/^www\./, "");
  return (url.protocol === "https:" || url.protocol === "http:") && (h === bare || h === `www.${bare}`);
}

const KEY_HINT = /^\/(about|company|pricing|plans|features|product|products|platform|services|solutions|how-it-works|why|enterprise)(\/|$)/;

/** Homepage first, then well-known pages (about, pricing, features…), then the shallowest others. */
export function pickKeyPages(routes: { url: string; path: string }[], n = KEY_PAGES) {
  const score = (p: string) => (p === "/" ? -100 : (KEY_HINT.test(p) ? -10 : 0) + p.split("/").filter(Boolean).length * 3 + p.length / 100);
  const seen = new Set<string>();
  return [...routes]
    .sort((a, b) => score(a.path) - score(b.path))
    .filter((r) => !seen.has(r.path) && !!seen.add(r.path))
    .slice(0, n);
}

function bodyText(buf: Buffer, maxBytes: number): string {
  // .xml.gz sitemaps arrive as raw gzip without Content-Encoding
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf, { maxOutputLength: maxBytes }).toString("utf8");
  return buf.toString("utf8");
}

export async function crawlSite(domain: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const emit = opts.onEvent ?? (() => {});
  const deadline = Date.now() + (opts.deadlineMs ?? 90_000);
  const left = () => Math.max(1000, Math.min(20_000, deadline - Date.now()));
  const problems: { url: string; message: string }[] = [];
  const problem = (url: string, e: unknown) => {
    const message = e instanceof SsrfError ? e.message : e instanceof Error ? e.message : String(e);
    problems.push({ url, message });
    emit({ type: "problem", url, message });
  };
  const get = (url: string, maxBytes: number, accept: string) =>
    safeFetch(url, { ...opts.fetch, maxBytes, accept, timeoutMs: left() });

  emit({ type: "start", domain });
  const origin = (opts.origin ?? `https://${domain}`).replace(/\/$/, "");

  // 1. robots.txt → Sitemap: lines (fall back to /sitemap.xml)
  let queue: { url: string; depth: number }[] = [];
  try {
    const r = await get(`${origin}/robots.txt`, 512 * 1024, "text/plain,*/*;q=0.5");
    const found = r.status >= 200 && r.status < 300 ? sitemapsFromRobots(r.body.toString("utf8")) : [];
    emit({ type: "robots", found: r.status >= 200 && r.status < 300, sitemaps: found.length });
    queue = found.map((url) => ({ url, depth: 0 }));
  } catch (e) {
    emit({ type: "robots", found: false, sitemaps: 0 });
    problem(`${origin}/robots.txt`, e);
  }
  if (!queue.length) queue = [{ url: `${origin}/sitemap.xml`, depth: 0 }];

  // 2. sitemaps, breadth first
  const seen = new Set<string>();
  const fetched: string[] = [];
  const routes = new Map<string, { url: string; path: string; lastmod: Date | null; source: string }>();
  let truncated = false;
  while (queue.length && fetched.length < MAX_SITEMAPS && Date.now() < deadline) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const r = await get(url, 10 * 1024 * 1024, "application/xml,text/xml,*/*;q=0.5");
      if (r.status < 200 || r.status >= 300) {
        problem(url, new Error(`HTTP ${r.status}`));
        continue;
      }
      fetched.push(url);
      const parsed = parseSitemap(bodyText(r.body, 10 * 1024 * 1024), MAX_URLS);
      if (parsed.kind === "index") {
        emit({ type: "sitemap", url, kind: "index", entries: parsed.sitemaps.length });
        if (depth + 1 > MAX_DEPTH) problem(url, new Error(`sitemap index nested deeper than ${MAX_DEPTH}; children skipped`));
        else for (const s of parsed.sitemaps) if (!seen.has(s)) queue.push({ url: s, depth: depth + 1 });
        truncated ||= parsed.truncated;
      } else if (parsed.kind === "urlset") {
        emit({ type: "sitemap", url, kind: "urlset", entries: parsed.urls.length });
        truncated ||= parsed.truncated;
        for (const u of parsed.urls) {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(u.loc);
          } catch {
            continue;
          }
          if (!isSameSite(parsedUrl, domain)) continue;
          parsedUrl.hash = "";
          const key = parsedUrl.href;
          if (!routes.has(key)) routes.set(key, { url: key, path: parsedUrl.pathname || "/", lastmod: u.lastmod, source: url });
          if (routes.size >= MAX_URLS) {
            truncated = true;
            break;
          }
        }
        emit({ type: "routes", total: routes.size });
      } else {
        emit({ type: "sitemap", url, kind: "unknown", entries: 0 });
        problem(url, new Error("not a sitemap (no <urlset> or <sitemapindex>)"));
      }
    } catch (e) {
      problem(url, e);
    }
    if (routes.size >= MAX_URLS) break;
  }
  if (queue.length && fetched.length >= MAX_SITEMAPS) {
    truncated = true;
    problems.push({ url: origin, message: `more than ${MAX_SITEMAPS} sitemap files; the rest were skipped` });
  }

  // 3. key pages: title + description for the brand profile
  const routeList = [...routes.values()];
  const candidates = routeList.length ? pickKeyPages(routeList, opts.keyPages ?? KEY_PAGES) : [{ url: `${origin}/`, path: "/" }];
  if (!candidates.some((c) => c.path === "/")) candidates.unshift({ url: `${origin}/`, path: "/" });
  const pages: KeyPage[] = [];
  for (const c of candidates.slice(0, opts.keyPages ?? KEY_PAGES)) {
    if (Date.now() >= deadline) break;
    try {
      const r = await get(c.url, 1024 * 1024, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
      if (r.status < 200 || r.status >= 300) {
        problem(c.url, new Error(`HTTP ${r.status}`));
        continue;
      }
      const meta = extractPageMeta(r.body.toString("utf8"));
      pages.push({ url: c.url, path: c.path, ...meta });
      emit({ type: "page", url: c.url, title: meta.title });
    } catch (e) {
      problem(c.url, e);
    }
  }

  const status: CrawlStatus = routes.size === 0 ? (pages.length ? "partial" : "failed") : problems.length || truncated ? "partial" : "ok";
  emit({ type: "done", status, sitemaps: fetched.length, routes: routes.size, problems: problems.length });
  return { status, sitemaps: fetched, routes: routeList, pages, problems, truncated };
}
