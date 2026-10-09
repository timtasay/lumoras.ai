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
import type { PublishableArticle } from "./types.ts";

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

function valueOf(a: PublishableArticle, key: Placeholder): unknown {
  switch (key) {
    case "author.name":
      return a.author?.name ?? "";
    case "author.role":
      return a.author?.role ?? "";
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

export function renderFrontmatter(template: string, a: PublishableArticle): string {
  const bad = unknownPlaceholders(template);
  if (bad.length) throw new Error(`unknown placeholder(s) in the frontmatter template: ${bad.join(", ")}`);
  const body = template.replace(TOKEN, (_, k: Placeholder) => yamlValue(valueOf(a, k))).trim();
  const fenced = body.startsWith("---") ? body : `---\n${body}\n---`;
  return fenced.endsWith("---") ? fenced : `${fenced}\n---`;
}

/** The whole file: frontmatter, a blank line, the Markdown body, one trailing newline. */
export function renderPostFile(template: string, a: PublishableArticle): string {
  return `${renderFrontmatter(template, a)}\n\n${a.bodyMd.trim()}\n`;
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
