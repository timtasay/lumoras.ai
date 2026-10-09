/**
 * Markdown, the way the published sites read it: remark (CommonMark + GFM),
 * the same parser stack lumoras.ai uses (apps/web/lib/content.ts). Used by
 * the lint (structure, links, words) and by the editor's preview. Raw HTML in
 * the body is never passed through (remark-rehype drops it), so a draft can
 * never inject markup into our pages.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

type MdNode = { type: string; depth?: number; url?: string; value?: string; children?: MdNode[]; position?: { start: { line: number } } };

export type Heading = { depth: number; text: string; line: number };
export type MdLink = { url: string; text: string; line: number };
export type Analysis = {
  headings: Heading[];
  links: MdLink[];
  words: number;
  /** Text of the blocks before the first heading (the "direct answer"). */
  intro: string;
  introSentences: number;
  /** Has raw HTML blocks or inline HTML (dropped when rendered). */
  html: boolean;
  text: string;
};

const textOf = (n: MdNode): string => (n.type === "text" || n.type === "inlineCode" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(n.type === "paragraph" ? "" : ""));

function walk(n: MdNode, fn: (n: MdNode) => void) {
  fn(n);
  for (const c of n.children ?? []) walk(c, fn);
}

export function parseMarkdown(md: string): MdNode {
  return unified().use(remarkParse).use(remarkGfm).parse(md) as unknown as MdNode;
}

/** Words as a reader counts them: whitespace-separated tokens of the visible text. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Sentences in a short passage: terminal punctuation followed by a space or the end. */
export function countSentences(text: string): number {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return 0;
  // ignore decimal points and common abbreviations
  const cleaned = t.replace(/\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St)\./gi, "$1").replace(/(\d)\.(\d)/g, "$1$2");
  return (cleaned.match(/[.!?]+(?=\s|$)/g) ?? []).length || 1;
}

export function analyzeMarkdown(md: string): Analysis {
  const tree = parseMarkdown(md);
  const headings: Heading[] = [];
  const links: MdLink[] = [];
  let html = false;
  walk(tree, (n) => {
    if (n.type === "heading") headings.push({ depth: n.depth ?? 1, text: textOf(n).trim(), line: n.position?.start.line ?? 0 });
    if (n.type === "link" && n.url) links.push({ url: n.url, text: textOf(n).trim(), line: n.position?.start.line ?? 0 });
    if (n.type === "html") html = true;
  });
  const blocks = tree.children ?? [];
  const introBlocks: MdNode[] = [];
  for (const b of blocks) {
    if (b.type === "heading") break;
    introBlocks.push(b);
  }
  const intro = introBlocks.filter((b) => b.type === "paragraph").map(textOf).join(" ").trim();
  const paras: string[] = [];
  walk(tree, (n) => {
    if (n.type === "paragraph" || n.type === "heading" || n.type === "tableCell") paras.push(textOf(n));
  });
  const text = paras.join("\n");
  return { headings, links, words: countWords(text), intro, introSentences: countSentences(intro), html, text };
}

/** Markdown → HTML for previews. Raw HTML is dropped, not escaped into the page. */
export function renderMarkdown(md: string): string {
  return String(unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeStringify).processSync(md));
}

/** "/insights/x#y?z" → "/insights/x"; absolute URLs on the site's own host reduce to their path. */
export function internalPath(url: string, siteDomain: string): string | null {
  if (url.startsWith("#")) return null;
  if (url.startsWith("/")) return url.split(/[?#]/)[0] || "/";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === siteDomain.replace(/^www\./, "")) return u.pathname || "/";
  } catch {
    // relative without a slash ("pricing"): treated as internal relative to the root
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return `/${url.split(/[?#]/)[0]}`;
  }
  return null;
}

export const isExternal = (url: string, siteDomain: string) => /^https?:\/\//i.test(url) && internalPath(url, siteDomain) === null;
