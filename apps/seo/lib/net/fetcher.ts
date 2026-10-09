/**
 * Fetching pages for the pipeline: the fact-check step's sources, the lint's
 * external link checks and the live-URL check after publishing.
 *
 *   live      every request through safeFetch (the SSRF guard): DNS checked
 *             on every hop, private and metadata addresses refused, size and
 *             time capped. Production.
 *   recorded  answers from recorded pages (lib/llm/fixtures.ts) and nothing
 *             else: tests and development, where nothing may reach the
 *             internet. Unknown URLs answer 404.
 *
 * Fetched text is untrusted: callers pass it to a model only wrapped as data.
 */
import { safeFetch, SsrfError, type SafeFetchPolicy } from "./safe-fetch.ts";

export type FetchedPage = { url: string; status: number; title: string | null; text: string; error?: string };
export type LinkStatus = { url: string; ok: boolean; status: number | null; error: string | null };

export interface PageFetcher {
  readonly kind: "live" | "recorded";
  fetchPage(url: string): Promise<FetchedPage>;
  checkLink(url: string): Promise<LinkStatus>;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Visible text of an HTML page (scripts, styles and tags removed, entities decoded, whitespace collapsed), capped. */
export function htmlToText(html: string, max = 40_000): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return { title: title ? htmlToText(title, 300).text : null, text: text.slice(0, max) };
}

export class LiveFetcher implements PageFetcher {
  readonly kind = "live" as const;
  constructor(private readonly policy: SafeFetchPolicy = {}) {}

  async fetchPage(url: string): Promise<FetchedPage> {
    try {
      const r = await safeFetch(url, { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", maxBytes: 3 * 1024 * 1024, timeoutMs: 15_000, policy: this.policy });
      const type = String(r.headers["content-type"] ?? "");
      const raw = r.body.toString("utf8");
      const { title, text } = /html/i.test(type) || /<html/i.test(raw.slice(0, 500)) ? htmlToText(raw) : { title: null, text: raw.slice(0, 40_000) };
      return { url: r.url, status: r.status, title, text };
    } catch (e) {
      return { url, status: 0, title: null, text: "", error: e instanceof SsrfError ? e.message : "fetch failed" };
    }
  }

  async checkLink(url: string): Promise<LinkStatus> {
    try {
      // GET, not HEAD: many servers answer HEAD wrongly; the body is capped small and discarded
      const r = await safeFetch(url, { maxBytes: 512 * 1024, timeoutMs: 12_000, policy: this.policy });
      return { url, ok: r.status >= 200 && r.status < 300, status: r.status, error: null };
    } catch (e) {
      if (e instanceof SsrfError && e.code === "too_large") return { url, ok: true, status: 200, error: null };
      return { url, ok: false, status: null, error: e instanceof Error ? e.message.slice(0, 200) : "failed" };
    }
  }
}

export class RecordedFetcher implements PageFetcher {
  readonly kind = "recorded" as const;
  readonly requests: string[] = [];
  constructor(private readonly pages: Record<string, { status: number; title: string; text: string }>) {}

  private lookup(url: string) {
    let key = url;
    try {
      const u = new URL(url);
      key = u.pathname === "" ? `${u.origin}/` : u.href;
    } catch {
      /* not a URL */
    }
    return this.pages[key] ?? this.pages[key.replace(/\/$/, "")] ?? this.pages[`${key}/`];
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    this.requests.push(url);
    const p = this.lookup(url);
    return p ? { url, status: p.status, title: p.title, text: p.text } : { url, status: 404, title: null, text: "", error: "not in the recorded pages" };
  }

  async checkLink(url: string): Promise<LinkStatus> {
    this.requests.push(url);
    const p = this.lookup(url);
    return p ? { url, ok: p.status >= 200 && p.status < 300, status: p.status, error: null } : { url, ok: false, status: 404, error: null };
  }
}

/** Is `quote` really on the page? Case, whitespace, quotes and dashes folded. */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
  const q = norm(quote);
  return q.length >= 8 && norm(pageText).includes(q);
}
