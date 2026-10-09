/**
 * Small, dependency-free parsers for what the crawler reads: robots.txt
 * Sitemap lines, sitemap XML (urlset and sitemapindex, per sitemaps.org) and
 * page <title> / meta description. Inputs are untrusted; every parser is
 * bounded (caps on entries) and never evaluates anything.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const text = (s: string) => decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();

/** `Sitemap:` lines of a robots.txt (case-insensitive), absolute URLs only. */
export function sitemapsFromRobots(robots: string, max = 50): string[] {
  const out: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!m) continue;
    try {
      const u = new URL(m[1]);
      if ((u.protocol === "http:" || u.protocol === "https:") && !out.includes(u.href)) out.push(u.href);
    } catch {
      /* skip junk */
    }
    if (out.length >= max) break;
  }
  return out;
}

export type SitemapUrl = { loc: string; lastmod: Date | null };
export type ParsedSitemap =
  | { kind: "urlset"; urls: SitemapUrl[]; truncated: boolean }
  | { kind: "index"; sitemaps: string[]; truncated: boolean }
  | { kind: "unknown" };

function lastmodOf(block: string): Date | null {
  const m = /<(?:[a-z0-9]+:)?lastmod>([\s\S]*?)<\/(?:[a-z0-9]+:)?lastmod>/i.exec(block);
  if (!m) return null;
  const d = new Date(text(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}
const locOf = (block: string) => {
  const m = /<(?:[a-z0-9]+:)?loc>([\s\S]*?)<\/(?:[a-z0-9]+:)?loc>/i.exec(block);
  return m ? text(m[1]) : null;
};

/** Parses sitemap XML. Tolerates namespaces prefixes, CDATA, entities and whitespace. */
export function parseSitemap(xml: string, maxEntries = 50_000): ParsedSitemap {
  const head = xml.slice(0, 4096);
  const isIndex = /<(?:[a-z0-9]+:)?sitemapindex[\s>]/i.test(head) || (!/<(?:[a-z0-9]+:)?urlset[\s>]/i.test(head) && /<(?:[a-z0-9]+:)?sitemapindex[\s>]/i.test(xml));
  const isSet = /<(?:[a-z0-9]+:)?urlset[\s>]/i.test(xml);
  if (isIndex) {
    const sitemaps: string[] = [];
    const re = /<(?:[a-z0-9]+:)?sitemap>([\s\S]*?)<\/(?:[a-z0-9]+:)?sitemap>/gi;
    let m: RegExpExecArray | null;
    let truncated = false;
    while ((m = re.exec(xml))) {
      const loc = locOf(m[1]);
      if (loc) sitemaps.push(loc);
      if (sitemaps.length >= maxEntries) {
        truncated = true;
        break;
      }
    }
    return { kind: "index", sitemaps, truncated };
  }
  if (isSet) {
    const urls: SitemapUrl[] = [];
    const re = /<(?:[a-z0-9]+:)?url>([\s\S]*?)<\/(?:[a-z0-9]+:)?url>/gi;
    let m: RegExpExecArray | null;
    let truncated = false;
    while ((m = re.exec(xml))) {
      const loc = locOf(m[1]);
      if (loc) urls.push({ loc, lastmod: lastmodOf(m[1]) });
      if (urls.length >= maxEntries) {
        truncated = true;
        break;
      }
    }
    return { kind: "urlset", urls, truncated };
  }
  return { kind: "unknown" };
}

export type PageMeta = { title: string | null; description: string | null; siteName: string | null; h1: string | null };

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

const clip = (s: string | null, n: number) => (s ? (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s) : null);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** <title>, meta description, og:site_name and the first <h1> of an HTML page (bounded). */
export function extractPageMeta(html: string): PageMeta {
  const doc = html.slice(0, 512 * 1024);
  const head = doc.slice(0, 256 * 1024);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  let description: string | null = null;
  let siteName: string | null = null;
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (!description && (name === "description" || name === "og:description")) description = attr(tag, "content");
    if (!siteName && name === "og:site_name") siteName = attr(tag, "content");
  }
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(doc);
  return {
    title: clip(t ? squash(decodeEntities(t[1])) : null, 300),
    description: clip(description ? squash(description) : null, 600),
    siteName: clip(siteName ? squash(siteName) : null, 120),
    h1: clip(h1 ? squash(decodeEntities(h1[1].replace(/<[^>]+>/g, " "))) : null, 300),
  };
}
