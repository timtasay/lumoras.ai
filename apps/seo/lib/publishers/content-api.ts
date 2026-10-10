/**
 * "Lumoras Growth serves it" (docs/content-api.md, owner decision of 10
 * October 2026). The site reads its new articles from Lumoras Growth's posts
 * endpoint at request time, so publishing needs no commit, merge or deploy.
 *
 * Publishing writes nothing anywhere: it checks the article against the
 * site's post rules and returns the post exactly as the endpoint will serve
 * it. The pipeline stores that snapshot (publications.payload); the endpoint
 * lists snapshots whose date has arrived. Edits after publishing reach the
 * site only through a refresh, which stores a new snapshot.
 */
import { authorKey } from "./frontmatter.ts";
import { PublishError, type PublicationRef, type PublicationStatus, type PublishableArticle, type Publisher, type PublishResult, type Validation } from "./types.ts";

export type ContentApiConfig = {
  /** The article's path on the live site, e.g. /insights/{{slug}}. */
  livePath: string;
  /** Byline name → the site's author key. */
  authorKeys: Record<string, string>;
};

/** The sites' cover motifs and chip limits (docs/site-formats/sonorch.ai.md, seasonx.ai.md). */
export const POST_MOTIFS = ["calendar", "phone", "receipt", "card", "chart", "clock", "people", "list"] as const;
export const POST_CHIPS_MAX = 3;
export const POST_CHIP_LENGTH_MAX = 26;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One item of the endpoint's "posts" list (docs/content-api.md). */
export type ServedPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  readingMinutes: number;
  cover: { motif: string; chips: string[] };
  body: string;
};

function realDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The post as the site will show it, or a PublishError naming every rule it
 * breaks. `updatedAt` only for a refresh, and never before publishedAt.
 */
export function servedPost(a: PublishableArticle, cfg: Pick<ContentApiConfig, "authorKeys">, opts: { refresh?: boolean } = {}): ServedPost {
  const problems: string[] = [];
  const one = (label: string, v: string) => {
    if (!v.trim()) problems.push(`${label} is empty`);
    else if (v !== v.trim()) problems.push(`${label} has leading or trailing spaces`);
    else if (/[\r\n]/.test(v)) problems.push(`${label} has a line break`);
  };
  if (!SLUG.test(a.slug) || a.slug.length > 120) problems.push(`slug "${a.slug}" is not lowercase words joined by hyphens`);
  one("title", a.title);
  one("description", a.description);
  if (!realDate(a.date)) problems.push(`date "${a.date}" is not a real YYYY-MM-DD date`);
  if (!Number.isInteger(a.readingMinutes) || a.readingMinutes < 1) problems.push("reading time must be a whole number of minutes, at least 1");
  if (!(POST_MOTIFS as readonly string[]).includes(a.cover.kind)) problems.push(`cover "${a.cover.kind}" is not one of ${POST_MOTIFS.join(", ")}`);
  const chips = a.cover.chips;
  if (chips.length < 1 || chips.length > POST_CHIPS_MAX) problems.push(`the cover needs 1 to ${POST_CHIPS_MAX} chips, not ${chips.length}`);
  for (const c of chips) if (!c.trim() || c.length > POST_CHIP_LENGTH_MAX) problems.push(`cover chip "${c}" is empty or over ${POST_CHIP_LENGTH_MAX} characters`);
  if (/^#\s/m.test(a.bodyMd.replace(/^(```|~~~)[\s\S]*?^\1/gm, ""))) problems.push("the body has a level-1 heading (the page already shows the title)");
  if (!a.bodyMd.trim()) problems.push("the body is empty");
  let author = "";
  try {
    author = authorKey(a, cfg.authorKeys);
  } catch (e) {
    problems.push((e as Error).message.replace(/\.$/, ""));
  }
  if (problems.length) throw new PublishError(`Not published: ${problems.join("; ")}.`);
  const updated = opts.refresh && realDate(a.updated) && a.updated > a.date ? a.updated : null;
  return {
    slug: a.slug,
    title: a.title,
    description: a.description,
    publishedAt: a.date,
    ...(updated ? { updatedAt: updated } : {}),
    author,
    readingMinutes: a.readingMinutes,
    cover: { motif: a.cover.kind, chips: [...chips] },
    body: a.bodyMd.trim(),
  };
}

/** The site's posts endpoint: what goes in its INSIGHTS_API_URL. */
export const postsFeedUrl = (baseUrl: string, feedToken: string) => `${baseUrl.replace(/\/+$/, "")}/api/feeds/${feedToken}/posts.json`;

export function readContentApiConfig(config: Record<string, unknown>): ContentApiConfig {
  const lp = typeof config.livePath === "string" && config.livePath.startsWith("/") ? config.livePath : "/insights/{{slug}}";
  const keys = config.authorKeys && typeof config.authorKeys === "object" && !Array.isArray(config.authorKeys) ? config.authorKeys : {};
  return { livePath: lp, authorKeys: Object.fromEntries(Object.entries(keys as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")) };
}

export class ContentApiPublisher implements Publisher {
  readonly kind = "content_api" as const;
  constructor(
    private readonly cfg: ContentApiConfig,
    /** Where the site reads from, for Test (the endpoint URL; empty when the site's feed token is unknown here). */
    private readonly endpoint: string = "",
  ) {}

  async validate(): Promise<Validation> {
    const names = Object.entries(this.cfg.authorKeys);
    const checks = [
      { label: "Author keys", ok: names.length > 0, detail: names.length ? names.map(([n, k]) => `${n} → ${k}`).join(", ") : "None set, so nothing can publish. Add a line per byline: Name = key." },
      { label: "Where the site reads", ok: true, detail: this.endpoint ? `${this.endpoint} (set it as INSIGHTS_API_URL in the site's server env file)` : "The site's posts endpoint, shown on the connection." },
      { label: "Deploys", ok: true, detail: "None per article: the site picks up a new article within an hour of its date." },
    ];
    const ok = checks.every((c) => c.ok);
    return { ok, detail: ok ? "Ready: approved articles are served to the site on their date." : checks.find((c) => !c.ok)!.detail, checks };
  }

  private result(a: PublishableArticle, post: ServedPost, detail: string): PublishResult {
    return { status: "published", mode: "api", remoteId: post.slug, path: null, liveUrl: a.url, detail, payload: post };
  }

  async publish(a: PublishableArticle): Promise<PublishResult> {
    const post = servedPost(a, this.cfg);
    return this.result(a, post, `Served to the site from ${post.publishedAt}; it appears within an hour, no deploy needed.`);
  }

  async update(a: PublishableArticle, _prev: PublicationRef): Promise<PublishResult> {
    const post = servedPost(a, this.cfg, { refresh: true });
    return this.result(a, post, "The refreshed article replaces the old one on the site within an hour.");
  }

  async unpublish(a: PublishableArticle, _prev: PublicationRef): Promise<PublishResult> {
    return { status: "published", mode: "api", remoteId: a.slug, path: null, liveUrl: a.url, detail: "Taken down: the site drops it within an hour." };
  }

  async status(_prev: PublicationRef): Promise<PublicationStatus> {
    return { status: "published", detail: "Served by Lumoras Growth." };
  }
}
