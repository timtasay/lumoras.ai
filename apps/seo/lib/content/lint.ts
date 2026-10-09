/**
 * The lint step (section 7, step 7): deterministic code, never a model.
 * Every rule reads its limits from the site's brand profile (rule 13: writing
 * rules are data), and returns pass, warn or fail with a reason a person can
 * act on. A failing blocking rule holds the article: it cannot be approved
 * for publishing (autopilot) and the review screen shows why.
 *
 * Inputs that need the network (are the external links up?) are gathered
 * before the lint by the link checker and passed in as data, so the lint
 * itself stays pure and testable.
 */
import { analyzeMarkdown, internalPath, isExternal, type Analysis } from "./markdown.ts";
import { resolveLink, type InventoryRoute, type OwnPage } from "./links.ts";
import { describeConflict, headTermConflicts, type ExistingTarget } from "./headterm.ts";
import { normalizeKeyword, stem } from "../research/keywords.ts";
import type { SeoRules } from "../validation.ts";

export type LintStatus = "pass" | "warn" | "fail";
export type LintResult = { rule: LintRule; label: string; status: LintStatus; detail: string; blocking: boolean };

export const LINT_RULES = [
  "title_length",
  "keyword_in_title",
  "description_length",
  "slug",
  "headings",
  "direct_answer",
  "word_count",
  "banned_words",
  "punctuation",
  "internal_link_count",
  "internal_links_resolve",
  "external_links_ok",
  "duplicate_head_term",
  "author",
  "cover",
] as const;
export type LintRule = (typeof LINT_RULES)[number];

export const RULE_LABEL: Record<LintRule, string> = {
  title_length: "Title length",
  keyword_in_title: "Keyword in the title",
  description_length: "Description length",
  slug: "URL slug",
  headings: "Heading structure",
  direct_answer: "Direct answer first",
  word_count: "Word count",
  banned_words: "Banned words",
  punctuation: "Em dashes and emoji",
  internal_link_count: "Internal links",
  internal_links_resolve: "Internal links live on the publish date",
  external_links_ok: "External links return 200",
  duplicate_head_term: "No duplicate head term",
  author: "Configured author",
  cover: "Cover art spec",
};

export type LinkCheck = { url: string; ok: boolean; status: number | null; error?: string | null; checkedAt?: string };

export type LintInput = {
  title: string;
  description: string;
  bodyMd: string;
  slug: string | null;
  primaryKeyword: string | null;
  authorId: string | null;
  cover: Record<string, unknown>;
  /** YYYY-MM-DD the article goes live. */
  publishDate: string;
  rules: SeoRules;
  bannedWords: string[];
  siteDomain: string;
  authors: { id: string; name: string; is_demo: boolean }[];
  routes: InventoryRoute[];
  /** The site's other articles (this one excluded) with their live paths. */
  pages: OwnPage[];
  /** Results of the external link checker, by URL; a missing URL is "not checked yet". */
  linkChecks: Map<string, LinkCheck>;
  /** Published and scheduled primary keywords and the site's ranked keywords (this item excluded). */
  existingTargets: ExistingTarget[];
  itemId?: string;
};

const res = (rule: LintRule, status: LintStatus, detail: string, blocking = status === "fail"): LintResult => ({ rule, label: RULE_LABEL[rule], status, detail, blocking });

const EMOJI = /\p{Extended_Pictographic}/u;

/** Does the title contain the keyword (normalised, plural-tolerant, any order of its words)? */
export function keywordInTitle(title: string, keyword: string): boolean {
  const t = normalizeKeyword(title);
  const k = normalizeKeyword(keyword);
  if (!k) return false;
  if (` ${t} `.includes(` ${k} `)) return true;
  const words = new Set(t.split(" ").map(stem));
  return k.split(" ").map(stem).every((w) => words.has(w));
}

/** Banned words found in the text (whole words or phrases, case-insensitive). */
export function bannedWordsIn(text: string, banned: string[]): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, " ")} `;
  return banned.filter((w) => {
    const needle = w.toLowerCase().trim().replace(/[^\p{L}\p{N}'-]+/gu, " ");
    return needle && hay.includes(` ${needle} `);
  });
}

export function lintArticle(input: LintInput, analysis: Analysis = analyzeMarkdown(input.bodyMd)): LintResult[] {
  const r = input.rules;
  const out: LintResult[] = [];
  const title = input.title.trim();
  const desc = input.description.trim();

  // title
  if (!title) out.push(res("title_length", "fail", "The article has no title."));
  else if (title.length > r.titleMax) out.push(res("title_length", "fail", `${title.length} characters; the limit is ${r.titleMax}.`));
  else out.push(res("title_length", "pass", `${title.length} of ${r.titleMax} characters.`));

  if (!input.primaryKeyword) out.push(res("keyword_in_title", "fail", "No primary keyword is set."));
  else if (!keywordInTitle(title, input.primaryKeyword)) out.push(res("keyword_in_title", "fail", `"${input.primaryKeyword}" does not appear in the title.`));
  else out.push(res("keyword_in_title", "pass", `"${input.primaryKeyword}" is in the title.`));

  if (desc.length < r.descriptionMin || desc.length > r.descriptionMax) {
    out.push(res("description_length", "fail", `${desc.length} characters; it must be ${r.descriptionMin}–${r.descriptionMax}.`));
  } else out.push(res("description_length", "pass", `${desc.length} characters (${r.descriptionMin}–${r.descriptionMax}).`));

  if (!input.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 120) out.push(res("slug", "fail", "The slug must be lowercase words joined by single dashes."));
  else if (input.pages.some((p) => p.path.endsWith(`/${input.slug}`))) out.push(res("slug", "fail", `Another article already uses /${input.slug}.`));
  else out.push(res("slug", "pass", `/${input.slug}`));

  // structure
  const h1 = analysis.headings.filter((h) => h.depth === 1);
  const h2 = analysis.headings.filter((h) => h.depth === 2);
  const problems: string[] = [];
  if (r.noH1InBody && h1.length) problems.push(`${h1.length} "#" heading(s) in the body (line ${h1[0].line}); the title is the H1`);
  if (h2.length < r.minSections) problems.push(`${h2.length} "##" section(s); at least ${r.minSections} expected`);
  let prev = 1;
  for (const h of analysis.headings) {
    if (h.depth > prev + 1 && h.depth > 2) {
      problems.push(`"${h.text.slice(0, 40)}" jumps to level ${h.depth} after level ${prev} (line ${h.line})`);
      break;
    }
    prev = h.depth;
  }
  if (analysis.headings.some((h) => !h.text)) problems.push("an empty heading");
  out.push(problems.length ? res("headings", "fail", `${problems.join("; ")}.`) : res("headings", "pass", `${h2.length} sections, levels in order.`));

  if (r.introMinSentences > 0) {
    const n = analysis.intro ? analysis.introSentences : 0;
    const max = r.introMaxSentences || Infinity;
    if (n < r.introMinSentences || n > max) {
      out.push(res("direct_answer", "fail", n ? `The opening before the first heading has ${n} sentence(s); expected ${r.introMinSentences}${Number.isFinite(max) ? `–${max}` : "+"}.` : "The body does not open with a direct answer before the first heading."));
    } else out.push(res("direct_answer", "pass", `Opens with a ${n}-sentence answer.`));
  } else out.push(res("direct_answer", "pass", "Not required for this site."));

  if (analysis.words < r.bodyMinWords || analysis.words > r.bodyMaxWords) {
    out.push(res("word_count", "fail", `${analysis.words.toLocaleString("en-US")} words; the range is ${r.bodyMinWords.toLocaleString("en-US")}–${r.bodyMaxWords.toLocaleString("en-US")}.`));
  } else out.push(res("word_count", "pass", `${analysis.words.toLocaleString("en-US")} words.`));

  // wording
  const allText = `${title}\n${desc}\n${analysis.text}`;
  const banned = bannedWordsIn(allText, input.bannedWords);
  out.push(banned.length ? res("banned_words", "fail", `Uses ${banned.map((b) => `"${b}"`).join(", ")}.`) : res("banned_words", "pass", input.bannedWords.length ? `None of ${input.bannedWords.length} banned words.` : "No banned words configured."));

  const punct: string[] = [];
  if (r.noEmDash) {
    const n = (allText.match(/—/g) ?? []).length;
    if (n) punct.push(`${n} em dash${n === 1 ? "" : "es"}`);
  }
  if (r.noEmoji && EMOJI.test(allText)) punct.push("emoji");
  out.push(punct.length ? res("punctuation", "fail", `Found ${punct.join(" and ")}; this site's voice rules forbid them.`) : res("punctuation", "pass", r.noEmDash || r.noEmoji ? "None found." : "Not restricted for this site."));

  // links
  const internal = analysis.links.map((l) => ({ ...l, path: internalPath(l.url, input.siteDomain) })).filter((l): l is typeof l & { path: string } => l.path !== null);
  const uniqueInternal = [...new Set(internal.map((l) => l.path))];
  if (uniqueInternal.length < r.internalLinksMin || uniqueInternal.length > r.internalLinksMax) {
    out.push(res("internal_link_count", "fail", `${uniqueInternal.length} internal link(s); expected ${r.internalLinksMin}–${r.internalLinksMax}.`));
  } else out.push(res("internal_link_count", "pass", `${uniqueInternal.length} internal links.`));

  const broken = uniqueInternal.map((p) => ({ p, v: resolveLink(p, input.publishDate, input.routes, input.pages) })).filter((x) => !x.v.ok);
  out.push(
    broken.length
      ? res("internal_links_resolve", "fail", broken.map((b) => (b.v.ok ? "" : b.v.detail)).join(" "))
      : res("internal_links_resolve", "pass", uniqueInternal.length ? `All ${uniqueInternal.length} resolve on ${input.publishDate}.` : "No internal links."),
  );

  const external = [...new Set(analysis.links.filter((l) => isExternal(l.url, input.siteDomain)).map((l) => l.url))];
  const bad = external.filter((u) => input.linkChecks.get(u) && !input.linkChecks.get(u)!.ok);
  const unchecked = external.filter((u) => !input.linkChecks.get(u));
  if (bad.length) {
    out.push(res("external_links_ok", "fail", bad.map((u) => `${u} (${input.linkChecks.get(u)!.status ?? input.linkChecks.get(u)!.error ?? "failed"})`).join(", ")));
  } else if (unchecked.length) out.push(res("external_links_ok", "warn", `${unchecked.length} external link(s) not checked yet.`, true));
  else out.push(res("external_links_ok", "pass", external.length ? `All ${external.length} answered 200.` : "No external links."));

  if (analysis.html) out.push(res("headings", "warn", "Raw HTML in the body is dropped when published.", false));

  // rule 5
  if (input.primaryKeyword) {
    const c = headTermConflicts(input.primaryKeyword, input.existingTargets, { ignoreItemId: input.itemId });
    out.push(c.length ? res("duplicate_head_term", "fail", `${c.map(describeConflict).join("; ")}.`) : res("duplicate_head_term", "pass", "No other page targets this head term."));
  } else out.push(res("duplicate_head_term", "fail", "No primary keyword to check."));

  // rule 10
  const author = input.authors.find((a) => a.id === input.authorId);
  if (!author) out.push(res("author", "fail", "The byline is not one of this site's configured authors."));
  else if (author.is_demo) out.push(res("author", "warn", `${author.name} is a demo placeholder: replace it with a real person before this goes live under the client's name.`, false));
  else out.push(res("author", "pass", `${author.name}.`));

  // cover
  const kind = typeof input.cover.kind === "string" ? input.cover.kind : "";
  const chips = Array.isArray(input.cover.chips) ? input.cover.chips.filter((c): c is string => typeof c === "string") : [];
  const coverProblems: string[] = [];
  if (!kind) coverProblems.push("no cover kind");
  else if (r.coverKinds.length && !r.coverKinds.includes(kind)) coverProblems.push(`kind "${kind}" is not one of ${r.coverKinds.join(", ")}`);
  if (r.coverChips && chips.length !== r.coverChips) coverProblems.push(`${chips.length} chip(s); ${r.coverChips} expected`);
  const long = chips.filter((c) => !c.trim() || c.length > r.coverChipMax);
  if (long.length) coverProblems.push(`chip(s) empty or over ${r.coverChipMax} characters: ${long.map((c) => `"${c}"`).join(", ")}`);
  out.push(coverProblems.length ? res("cover", "fail", `${coverProblems.join("; ")}.`) : res("cover", "pass", `${kind}${chips.length ? ` · ${chips.join(" · ")}` : ""}`));

  return out;
}

export const lintPassed = (results: LintResult[]) => !results.some((x) => x.blocking && x.status !== "pass");
export const lintSummary = (results: LintResult[]) => ({
  pass: results.filter((x) => x.status === "pass").length,
  warn: results.filter((x) => x.status === "warn").length,
  fail: results.filter((x) => x.status === "fail").length,
  total: results.length,
});
