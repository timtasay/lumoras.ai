/**
 * Frontmatter templates and file names for Git file-per-post publishing.
 *
 * A template is the YAML block a site expects, with {{placeholders}}:
 *
 *   ---
 *   title: {{title}}
 *   date: {{date}}
 *   art:
 *     kind: {{cover.kind}}
 *     chips: {{cover.chips}}
 *   ---
 *
 * Every value is written as JSON (a double-quoted string, a number, or a
 * flow sequence), which is valid YAML 1.2 and reads back exactly with any
 * YAML parser (gray-matter, js-yaml, Hugo, Astro): no quoting rules to get
 * wrong, no way for a title with a colon or a quote to break the file or
 * inject a key. Unknown placeholders are refused when the connection is
 * saved and tested, never discovered at publish time.
 */
import { PublishError, type PublishableArticle } from "./types.ts";

export const PLACEHOLDERS = [
  "title",
  "description",
  "date",
  "updated",
  "slug",
  "keyword",
  "secondaryKeywords",
  "tags",
  "cluster",
  "readingMinutes",
  "words",
  "url",
  "path",
  "author.name",
  "author.role",
  /** person | organization */
  "author.kind",
  /** schema.org type: Person | Organization */
  "author.type",
  /** The site's own key for the byline (sonorch.ai: "tran"), from the connection's author keys. */
  "author.key",
  "cover.kind",
  "cover.chips",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const TOKEN = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

/** Placeholders in a template that we do not know. */
export function unknownPlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TOKEN)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) out.push(m[1]);
  return [...new Set(out)];
}

/** How a connection renders files beyond the template: the body's format and the site's author keys. */
export type RenderOptions = {
  /** "mdx": the body is escaped so MDX reads it as text (see escapeMdxBody). Default "markdown". */
  bodyFormat?: BodyFormat;
  /** Byline name → the site's key for it, for {{author.key}}. */
  authorKeys?: Record<string, string>;
};
export const BODY_FORMATS = ["markdown", "mdx"] as const;
export type BodyFormat = (typeof BODY_FORMATS)[number];

/** The site's key for the article's byline. Refuses, naming what to add, when there is none. */
export function authorKey(a: Pick<PublishableArticle, "author">, keys: Record<string, string> = {}): string {
  if (!a.author) throw new PublishError("This site's format needs an author key, but the article has no byline. Choose one of the site's authors.");
  const k = keys[a.author.name];
  if (!k) {
    const known = Object.keys(keys);
    throw new PublishError(`No author key for "${a.author.name}". Add a line "${a.author.name} = <key>" to the connection's author keys${known.length ? ` (it has: ${known.join(", ")})` : ""}.`);
  }
  return k;
}

function valueOf(a: PublishableArticle, key: Placeholder, o: RenderOptions): unknown {
  switch (key) {
    case "author.key":
      return authorKey(a, o.authorKeys);
    case "author.name":
      return a.author?.name ?? "";
    case "author.role":
      return a.author?.role ?? "";
    case "author.kind":
      return a.author?.kind ?? "";
    case "author.type":
      return a.author?.type ?? "";
    case "cover.kind":
      return a.cover.kind;
    case "cover.chips":
      return a.cover.chips;
    default:
      return a[key as keyof PublishableArticle];
  }
}

/** One YAML-safe value: JSON for strings and sequences, plain digits for finite numbers. */
export function yamlValue(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
  // JSON escapes quotes, backslashes and control characters; U+2028/2029 too in modern engines
  return JSON.stringify(v == null ? "" : String(v));
}

export function renderFrontmatter(template: string, a: PublishableArticle, o: RenderOptions = {}): string {
  const bad = unknownPlaceholders(template);
  if (bad.length) throw new Error(`unknown placeholder(s) in the frontmatter template: ${bad.join(", ")}`);
  const body = template.replace(TOKEN, (_, k: Placeholder) => yamlValue(valueOf(a, k, o))).trim();
  const fenced = body.startsWith("---") ? body : `---\n${body}\n---`;
  return fenced.endsWith("---") ? fenced : `${fenced}\n---`;
}

/** The whole file: frontmatter, a blank line, the body (escaped for MDX when asked), one trailing newline. */
export function renderPostFile(template: string, a: PublishableArticle, o: RenderOptions = {}): string {
  const body = o.bodyFormat === "mdx" ? escapeMdxBody(a.bodyMd) : a.bodyMd;
  return `${renderFrontmatter(template, a, o)}\n\n${body.trim()}\n`;
}

/**
 * Markdown made safe to compile as MDX, where a bare "<" opens a JSX tag, "{"
 * and "}" open a JavaScript expression and an HTML comment fails the build
 * (docs/site-formats/sonorch.ai.md). Outside code, "<", "{" and "}" become
 * character escapes that render as themselves, an autolink <https://x>
 * becomes [https://x](https://x) and HTML comments are dropped. Fenced code
 * blocks and inline code spans are left exactly as written: MDX keeps them
 * literal, and an escape there would show its backslash.
 */
export function escapeMdxBody(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) out.push(escapeProse(prose.join("\n")));
    prose = [];
  };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
    } else if (open && !(open[1][0] === "`" && line.slice(open.index + open[1].length).includes("`"))) {
      flush();
      fence = open[1];
      out.push(line);
    } else prose.push(line);
  }
  flush();
  return out.join("\n");
}

function escapeProse(text: string): string {
  const noComments = text.replace(/<!--[\s\S]*?(-->|$)/g, "");
  // split around inline code spans (a run of n backticks closed by the same run)
  return noComments
    .split(/(`+)([\s\S]*?[^`])\1(?!`)/)
    .map((part, i, all) => {
      // split() with two groups: [text, ticks, code, text, ticks, code, …]
      if (i % 3 === 1) return part + all[i + 1] + part;
      if (i % 3 === 2) return "";
      return part
        .replace(/<(https?:\/\/[^\s<>]+)>/g, "[$1]($1)")
        .replace(/(^|[^\\])([<{}])/g, "$1\\$2")
        .replace(/(^|[^\\])([<{}])/g, "$1\\$2");
    })
    .join("");
}

/** "{{slug}}.md" → "no-show-policy.md". Only the slug and the date may appear in a file name. */
export function renderFilename(pattern: string, a: Pick<PublishableArticle, "slug" | "date">): string {
  const name = pattern.replace(/\{\{\s*slug\s*\}\}/g, a.slug).replace(/\{\{\s*date\s*\}\}/g, a.date);
  if (/\{\{|\}\}|\.\.|^\/|\\/.test(name) || !/^[\w./-]+$/.test(name)) throw new Error(`file name pattern gives an unsafe name: ${name}`);
  return name;
}

export function joinPath(dir: string, name: string): string {
  const d = dir.replace(/^\/+|\/+$/g, "");
  const p = d ? `${d}/${name}` : name;
  if (p.split("/").some((seg) => seg === ".." || seg === ".")) throw new Error(`unsafe path: ${p}`);
  return p;
}

/** lumoras.ai's insights format (docs/content-spec.md). */
export const LUMORAS_INSIGHTS_TEMPLATE = `---
title: {{title}}
description: {{description}}
date: {{date}}
readingMinutes: {{readingMinutes}}
keyword: {{keyword}}
tags: {{tags}}
art:
  kind: {{cover.kind}}
  chips: {{cover.chips}}
---`;

/** A neutral default for Next.js MDX, Astro, Hugo and Jekyll sites. */
export const DEFAULT_TEMPLATE = `---
title: {{title}}
description: {{description}}
date: {{date}}
author: {{author.name}}
tags: {{tags}}
---`;
