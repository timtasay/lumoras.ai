import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { SITE_URL } from "./site";

/* ------------------------------------------------------------------ */
/* Where content lives                                                 */
/* ------------------------------------------------------------------ */

/**
 * Content root. Defaults to apps/web/content. `LUMORAS_CONTENT_DIR` can point
 * elsewhere (used for local fixtures while content is being written).
 */
const CONTENT_DIR = process.env.LUMORAS_CONTENT_DIR
  ? path.resolve(process.env.LUMORAS_CONTENT_DIR)
  : path.join(process.cwd(), "content");

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export const ART_KINDS = ["call", "people", "checklist", "ticket", "calendar", "music", "chart", "zones"] as const;
export type ArtKind = (typeof ART_KINDS)[number];
export type Art = { kind: ArtKind; chips: [string, string] };

export type TocItem = { id: string; text: string };

type Doc = {
  slug: string;
  title: string;
  description: string;
  html: string;
  readingMinutes: number;
  words: number;
};

export type Insight = Doc & {
  date: string;
  keyword: string;
  tags: string[];
  art: Art;
  author: string;
};

export const KB_TOPICS = [
  {
    id: "ai-receptionists",
    title: "AI receptionists",
    blurb: "What an AI receptionist does, how it books, and what it costs to run.",
  },
  {
    id: "voice-ai",
    title: "Voice AI",
    blurb: "How voice agents hear, understand and answer callers in real time.",
  },
  {
    id: "call-centers",
    title: "AI call centers",
    blurb: "Handling call volume across many locations with AI and people together.",
  },
  {
    id: "phone-lines",
    title: "Phone lines",
    blurb: "Numbers, forwarding and routing, so every call lands somewhere useful.",
  },
  {
    id: "missed-calls",
    title: "Missed calls",
    blurb: "Why calls go unanswered and how to stop losing the business behind them.",
  },
  {
    id: "store-audio",
    title: "Store audio",
    blurb: "Music, paging and announcements that run a store's sound on schedule.",
  },
] as const;
export type KbTopicId = (typeof KB_TOPICS)[number]["id"];

export type Guide = Doc & {
  topic: KbTopicId;
  updated: string;
  keyword: string;
  keyPoints: string[];
  order: number;
  toc: TocItem[];
};

export const HELP_CATEGORIES = [
  { id: "getting-started", title: "Getting started", blurb: "Set up, pick a product and understand billing." },
  { id: "phone-and-voice", title: "Phone and voice", blurb: "Numbers, hours, transfers and call transcripts." },
  { id: "pos-and-payments", title: "POS and payments", blurb: "Card payments, services and staff." },
  { id: "retail-sound", title: "Retail Sound", blurb: "Store zones, playlists and announcements." },
  { id: "account-and-data", title: "Account and data", blurb: "Locations, sign-in and customer data." },
] as const;
export type HelpCategoryId = (typeof HELP_CATEGORIES)[number]["id"];

export const APPLIES_TO = ["Sonorch", "SeasonX", "Lumoras POS", "Lumoras Voice", "Lumoras Sound"] as const;

export type HelpArticle = Doc & {
  category: HelpCategoryId;
  order: number;
  updated: string;
  appliesTo: string[];
  review: boolean;
  toc: TocItem[];
};

export type FaqItem = { q: string; a: string };
export type FaqGroup = { id: string; title: string; intro: string; items: FaqItem[] };
export type Faq = { groups: FaqGroup[] };

export type About = {
  hero: { eyebrow: string; title: string; lede: string };
  story: { time: string; title: string; text: string }[];
  intro: string;
  build: { title: string; items: { name: string; text: string; points: string[] }[] };
  products: { name: string; url: string; text: string }[];
  principles: { title: string; items: { title: string; text: string }[] };
  closing: { title: string; text: string };
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const AUTHOR = "Lumoras team";

function warn(msg: string) {
  console.warn(`[content] ${msg}`);
}

function readDir(sub: string): { slug: string; raw: string }[] {
  const dir = path.join(CONTENT_DIR, sub);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // missing directory: render the empty state
  }
  return names
    .filter((n) => n.endsWith(".md") && !n.startsWith("_") && !n.startsWith("."))
    .map((n) => {
      try {
        return { slug: n.replace(/\.md$/, ""), raw: fs.readFileSync(path.join(dir, n), "utf8") };
      } catch {
        return null;
      }
    })
    .filter((x): x is { slug: string; raw: string } => x !== null);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf8")) as T;
  } catch {
    return null;
  }
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v.trim() : v instanceof Date ? isoDate(v) : d);
const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
};
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()) : []);

/** gray-matter parses unquoted YAML dates into Date objects; normalise to YYYY-MM-DD. */
function isoDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  return "";
}

function countWords(md: string): number {
  return md.replace(/[`*_#>\[\]()!-]/g, " ").split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ */
/* Markdown → HTML                                                     */
/* ------------------------------------------------------------------ */

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function walk(node: HastNode, fn: (n: HastNode) => void) {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

/** Collect H2s for the table of contents and mark external links. */
function rehypeLumoras(toc: TocItem[]) {
  return () => (tree: HastNode) => {
    walk(tree, (n) => {
      if (n.type !== "element") return;
      if (n.tagName === "h2" && n.properties?.id) {
        toc.push({ id: String(n.properties.id), text: textOf(n) });
      }
      if (n.tagName === "a" && typeof n.properties?.href === "string") {
        const href = n.properties.href as string;
        if (/^https?:\/\//.test(href) && !href.startsWith(SITE_URL)) {
          n.properties.rel = ["noopener"];
        } else if (href.startsWith(SITE_URL)) {
          n.properties.href = href.slice(SITE_URL.length) || "/";
        }
      }
      if (n.tagName === "table") {
        // wrap-friendly marker class for horizontal scroll on small screens
        n.properties = { ...(n.properties ?? {}), className: ["md-table"] };
      }
    });
  };
}

export function renderMarkdown(md: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  try {
    const file = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rehypeLumoras(toc))
      .use(rehypeStringify)
      .processSync(md);
    return { html: String(file), toc };
  } catch (e) {
    warn(`markdown failed: ${(e as Error).message}`);
    return { html: "", toc: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Loaders (memoised per process)                                      */
/* ------------------------------------------------------------------ */

const memo = new Map<string, unknown>();
function cached<T>(key: string, fn: () => T): T {
  // Re-read in dev so content edits show up; cache in production builds.
  if (process.env.NODE_ENV !== "production") return fn();
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key) as T;
}

function parseArt(v: unknown): Art {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = (ART_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as ArtKind) : "call";
  const chips = strArr(o.chips);
  return { kind, chips: [chips[0] ?? "", chips[1] ?? ""] };
}

export function getInsights(): Insight[] {
  return cached("insights", () => {
    const out: Insight[] = [];
    for (const { slug, raw } of readDir("insights")) {
      try {
        const { data, content } = matter(raw);
        const title = str(data.title);
        if (!title) {
          warn(`insights/${slug}: missing title, skipped`);
          continue;
        }
        const words = countWords(content);
        out.push({
          slug,
          title,
          description: str(data.description),
          date: isoDate(data.date) || "2026-01-01",
          readingMinutes: num(data.readingMinutes, Math.max(1, Math.round(words / 220))),
          keyword: str(data.keyword),
          tags: strArr(data.tags),
          art: parseArt(data.art),
          author: str(data.author, AUTHOR) || AUTHOR,
          html: renderMarkdown(content).html,
          words,
        });
      } catch (e) {
        warn(`insights/${slug}: ${(e as Error).message}`);
      }
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));
  });
}

export function getInsight(slug: string): Insight | undefined {
  return getInsights().find((i) => i.slug === slug);
}

export function getRelatedInsights(slug: string, n = 3): Insight[] {
  const all = getInsights();
  const me = all.find((i) => i.slug === slug);
  if (!me) return all.slice(0, n);
  return all
    .filter((i) => i.slug !== slug)
    .map((i, idx) => ({ i, score: i.tags.filter((t) => me.tags.includes(t)).length * 10 - idx }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.i);
}

export function getGuides(): Guide[] {
  return cached("guides", () => {
    const topics = KB_TOPICS.map((t) => t.id) as string[];
    const out: Guide[] = [];
    for (const { slug, raw } of readDir("knowledge-base")) {
      try {
        const { data, content } = matter(raw);
        const title = str(data.title);
        if (!title) {
          warn(`knowledge-base/${slug}: missing title, skipped`);
          continue;
        }
        const words = countWords(content);
        const { html, toc } = renderMarkdown(content);
        const topic = topics.includes(str(data.topic)) ? (str(data.topic) as KbTopicId) : "ai-receptionists";
        out.push({
          slug,
          title,
          description: str(data.description),
          topic,
          updated: isoDate(data.updated) || "2026-01-01",
          readingMinutes: num(data.readingMinutes, Math.max(1, Math.round(words / 220))),
          keyword: str(data.keyword),
          keyPoints: strArr(data.keyPoints),
          order: num(data.order, 99),
          html,
          toc,
          words,
        });
      } catch (e) {
        warn(`knowledge-base/${slug}: ${(e as Error).message}`);
      }
    }
    return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  });
}

export function getGuide(slug: string): Guide | undefined {
  return getGuides().find((g) => g.slug === slug);
}

export function getRelatedGuides(slug: string, n = 3): Guide[] {
  const all = getGuides();
  const me = all.find((g) => g.slug === slug);
  const others = all.filter((g) => g.slug !== slug);
  if (!me) return others.slice(0, n);
  return [...others.filter((g) => g.topic === me.topic), ...others.filter((g) => g.topic !== me.topic)].slice(0, n);
}

export function getHelpArticles(): HelpArticle[] {
  return cached("help", () => {
    const cats = HELP_CATEGORIES.map((c) => c.id) as string[];
    const out: HelpArticle[] = [];
    for (const { slug, raw } of readDir("help-center")) {
      try {
        const { data, content } = matter(raw);
        const title = str(data.title);
        if (!title) {
          warn(`help-center/${slug}: missing title, skipped`);
          continue;
        }
        const words = countWords(content);
        const { html, toc } = renderMarkdown(content);
        out.push({
          slug,
          title,
          description: str(data.description),
          category: cats.includes(str(data.category)) ? (str(data.category) as HelpCategoryId) : "getting-started",
          order: num(data.order, 99),
          updated: isoDate(data.updated) || "2026-01-01",
          appliesTo: strArr(data.appliesTo),
          review: data.review === true,
          readingMinutes: num(data.readingMinutes, Math.max(1, Math.round(words / 220))),
          html,
          toc,
          words,
        });
      } catch (e) {
        warn(`help-center/${slug}: ${(e as Error).message}`);
      }
    }
    const catIdx = (c: string) => cats.indexOf(c);
    return out.sort((a, b) => catIdx(a.category) - catIdx(b.category) || a.order - b.order || a.title.localeCompare(b.title));
  });
}

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return getHelpArticles().find((h) => h.slug === slug);
}

export function getRelatedHelp(slug: string, n = 4): HelpArticle[] {
  const all = getHelpArticles();
  const me = all.find((h) => h.slug === slug);
  const others = all.filter((h) => h.slug !== slug);
  if (!me) return others.slice(0, n);
  const shares = (h: HelpArticle) => h.appliesTo.some((p) => me.appliesTo.includes(p));
  return [
    ...others.filter((h) => h.category === me.category),
    ...others.filter((h) => h.category !== me.category && shares(h)),
    ...others.filter((h) => h.category !== me.category && !shares(h)),
  ].slice(0, n);
}

export function getFaq(): Faq {
  return cached("faq", () => {
    const raw = readJson<{ groups?: unknown }>("faq.json");
    const groups = Array.isArray(raw?.groups) ? (raw!.groups as Record<string, unknown>[]) : [];
    return {
      groups: groups
        .map((g, gi) => ({
          id: str(g.id, `group-${gi + 1}`) || `group-${gi + 1}`,
          title: str(g.title),
          intro: str(g.intro),
          items: (Array.isArray(g.items) ? (g.items as Record<string, unknown>[]) : [])
            .map((it) => ({ q: str(it.q), a: str(it.a) }))
            .filter((it) => it.q && it.a),
        }))
        .filter((g) => g.title && g.items.length > 0),
    };
  });
}

export function getAbout(): About | null {
  return cached("about", () => {
    const a = readJson<Partial<About>>("about.json");
    if (!a || !a.hero || !a.hero.title) return null;
    return {
      hero: { eyebrow: a.hero.eyebrow ?? "About us", title: a.hero.title, lede: a.hero.lede ?? "" },
      story: Array.isArray(a.story) ? a.story : [],
      intro: a.intro ?? "",
      build: { title: a.build?.title ?? "", items: Array.isArray(a.build?.items) ? a.build!.items : [] },
      products: Array.isArray(a.products) ? a.products : [],
      principles: { title: a.principles?.title ?? "", items: Array.isArray(a.principles?.items) ? a.principles!.items : [] },
      closing: { title: a.closing?.title ?? "", text: a.closing?.text ?? "" },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-06" → "Oct 6, 2026" (timezone-safe, no Date parsing). */
export function formatDate(iso: string, long = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = (long ? MONTHS_LONG : MONTHS)[parseInt(m[2], 10) - 1] ?? "";
  return `${mon} ${parseInt(m[3], 10)}, ${m[1]}`;
}

export function topicTitle(id: string): string {
  return KB_TOPICS.find((t) => t.id === id)?.title ?? id;
}
export function categoryTitle(id: string): string {
  return HELP_CATEGORIES.find((c) => c.id === id)?.title ?? id;
}
export function tagLabel(tag: string): string {
  const t = tag.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
