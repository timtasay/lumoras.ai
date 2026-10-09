/**
 * What each model step is told, what it receives, and the exact shape it
 * must answer in. Inputs from our own database (brand profile, rules, the
 * allowed link targets, candidates computed by code) go in an <input> JSON
 * block; anything from outside (Search Console queries, SERP titles, fetched
 * pages) goes in <untrusted_data> blocks and is never treated as an
 * instruction. Final answers are structured output, validated with zod.
 *
 * The system prompts are fixed strings (no dates, ids or per-run values), so
 * the provider's prompt cache hits on every turn and every run of a step.
 */
import * as z from "zod";
import { UNTRUSTED_RULE, untrusted } from "../llm/loop.ts";
import type { LlmMessage, LlmRequest } from "../llm/types.ts";

const COMMON = [
  "You are one step of a content pipeline that writes SEO articles for a client's website.",
  UNTRUSTED_RULE,
  "You have no tool that publishes, edits settings or sees credentials. Code checks every answer you give and enforces the site's rules; do not try to work around them.",
  "Never invent a person, a credential, a customer, a statistic or a quote. Never state a number about the business that is not in its product facts; example arithmetic is fine when it is labelled as an example.",
  "Answer with one JSON object that matches the requested schema, and nothing else.",
].join("\n");

export const SYSTEM = {
  topic: `${COMMON}\n\nYour step: topic selection. Code has already applied the site's rules (no duplicate head term, no geographic doorway variants, only what the business offers) and gives you the allowed candidates. Pick exactly ONE candidate keyword, from the list, by its exact text. You may check keyword metrics or one SERP with the tools when intent is unclear; each call is paid from the client's budget, so use them only when they change the decision. Explain why this target, now: volume, difficulty, CPC, intent, fit and timing.`,
  brief: `${COMMON}\n\nYour step: the brief. Plan one article for the given target: a title containing the primary keyword, a slug, an outline of ## sections, the reader's questions, 3 to 6 internal links chosen ONLY from the allowed link targets (they exist on the publish date; anything else would 404), and every factual claim the article will need a source for. Choose a cover from the allowed kinds.`,
  draft: `${COMMON}\n\nYour step: the draft. Write the article in Markdown following the brief, the voice rules and the SEO rules exactly: the title, a description, and the body. Start the body with the direct answer the rules ask for, then ## sections; never use a # heading in the body. Use only the brief's internal links, with descriptive anchor text. Do not write a byline or describe the author: the byline is added by code from the site's configured authors.`,
  factcheck: `${COMMON}\n\nYour step: the fact-check. List every factual claim in the draft. For each, either give a primary source and an exact quote from it that supports the claim (fetch the page with fetch_source first; quotes are checked against what was fetched), cite the brand profile's product facts for claims about the business itself (source "brand-profile:product-facts", quote the fact exactly), rewrite the claim so it is supported, or remove it. Mark a claim "unverifiable" if you could not support it; unverifiable claims block publishing. Return the corrected body.`,
} as const;

export function taskMessage(input: unknown, outside: { source: string; text: string }[] = []): string {
  return [`<input>\n${JSON.stringify(input)}\n</input>`, ...outside.map((o) => untrusted(o.source, o.text))].join("\n\n");
}

/** The <input> JSON of the first user message (FakeLlm reads it; it is ours, not untrusted). */
export function readInput<T>(req: Pick<LlmRequest, "messages">): T {
  const first = req.messages.find((m): m is Extract<LlmMessage, { role: "user" }> => m.role === "user");
  const text = !first ? "" : typeof first.content === "string" ? first.content : first.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = /<input>\n([\s\S]*?)\n<\/input>/.exec(text);
  return (m ? JSON.parse(m[1]) : {}) as T;
}

// ---------------------------------------------------------------------------
// topic
// ---------------------------------------------------------------------------
export type TopicCandidate = { keyword: string; volume: number | null; kd: number | null; cpcUsd: number | null; intent: string | null; fit: string; places: string[]; variants: number; source: string };
export type TopicInput = {
  site: { domain: string; name: string; sells: string[]; doesNotSell: string[]; goal: string };
  candidates: TopicCandidate[];
  publishDate: string;
  existingCount: number;
};
export const topicOutput = z.strictObject({
  keyword: z.string().min(1).max(200),
  secondary: z.array(z.string().max(200)).max(8),
  cluster: z.string().max(80),
  intent: z.enum(["informational", "navigational", "commercial", "transactional"]),
  rationale: z.strictObject({
    volume: z.string().max(300),
    difficulty: z.string().max(300),
    cpc: z.string().max(300),
    intent: z.string().max(300),
    fit: z.string().max(300),
    whyNow: z.string().max(500),
  }),
});
export type TopicOutput = z.infer<typeof topicOutput>;

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------
export type LinkOption = { path: string; title: string };
export type BriefInput = {
  site: { domain: string; name: string; audience: string; positioning: string; productFacts: string[]; forbiddenClaims: string[]; voiceRules: string[] };
  target: { keyword: string; secondary: string[]; intent: string; places: string[]; cluster: string };
  refresh: { url: string; title: string } | null;
  publishDate: string;
  linkTargets: LinkOption[];
  links: { min: number; max: number };
  cover: { kinds: string[]; chips: number; chipMax: number };
  titleMax: number;
  existingTitles: string[];
};
export const briefOutput = z.strictObject({
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(120),
  intent: z.string().max(200),
  outline: z.array(z.strictObject({ heading: z.string().max(200), points: z.array(z.string().max(300)).max(10) })).min(1).max(15),
  questions: z.array(z.string().max(300)).max(15),
  internalLinks: z.array(z.strictObject({ path: z.string().max(500), anchor: z.string().max(200), why: z.string().max(300) })).max(10),
  claimsToSource: z.array(z.string().max(500)).max(30),
  cover: z.strictObject({ kind: z.string().max(40), chips: z.array(z.string().max(80)).max(6) }),
  tags: z.array(z.string().max(40)).max(8),
});
export type BriefOutput = z.infer<typeof briefOutput>;

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------
export type DraftInput = {
  site: { domain: string; name: string; voiceRules: string[]; bannedWords: string[]; productFacts: string[]; forbiddenClaims: string[] };
  rules: { titleMax: number; descriptionMin: number; descriptionMax: number; bodyMinWords: number; bodyMaxWords: number; introMinSentences: number; introMaxSentences: number; noEmDash: boolean; noEmoji: boolean };
  brief: BriefOutput & { keyword: string; secondary: string[]; places: string[] };
  refreshOf: { title: string; bodyMd: string } | null;
};
export const draftOutput = z.strictObject({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(600),
  bodyMd: z.string().min(1).max(100_000),
  cover: z.strictObject({ kind: z.string().max(40), chips: z.array(z.string().max(80)).max(6) }),
});
export type DraftOutput = z.infer<typeof draftOutput>;

// ---------------------------------------------------------------------------
// fact-check
// ---------------------------------------------------------------------------
export const BRAND_SOURCE = "brand-profile:product-facts";
export type FactInput = {
  site: { domain: string; productFacts: string[]; forbiddenClaims: string[] };
  claimsToSource: string[];
  title: string;
  bodyMd: string;
};
export const factOutput = z.strictObject({
  claims: z
    .array(
      z.strictObject({
        claim: z.string().min(1).max(600),
        status: z.enum(["sourced", "rewritten", "removed", "unverifiable"]),
        sourceUrl: z.string().max(2048).nullable(),
        quote: z.string().max(1200).nullable(),
        replacement: z.string().max(600).nullable(),
        note: z.string().max(500),
      }),
    )
    .max(60),
  bodyMd: z.string().min(1).max(100_000),
});
export type FactOutput = z.infer<typeof factOutput>;

/** JSON schema for structured output (strict objects: every property required, no extras). */
export const jsonSchemaOf = (s: z.ZodType) => z.toJSONSchema(s, { target: "draft-2020-12" }) as Record<string, unknown>;
