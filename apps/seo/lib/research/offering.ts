/**
 * Rule 7: only write about what the business actually offers. The brand
 * profile lists what it sells and what it explicitly does not; a keyword that
 * matches a "does not sell" term is excluded however good its CPC looks, and
 * one that matches nothing on either list is flagged as unclear fit for a
 * person to judge. Pure functions, no I/O.
 *
 * Brand lists are free text ("Home services (HVAC, plumbing, electrical)",
 * "Dental and medical clinics"), so each entry is split into terms on
 * brackets, commas, semicolons, slashes and the words "and"/"or"; a term
 * matches a keyword when every significant word of the term appears in the
 * keyword (plurals folded, any order).
 */
import { normalizeKeyword, stem } from "./keywords.ts";

export type Fit = "offered" | "not_offered" | "unknown";

// words that never carry the meaning of an offer on their own
const FILLER = new Set([
  "a", "an", "the", "for", "of", "to", "in", "on", "at", "by", "with", "that", "is", "are", "this", "it", "its", "our", "we", "you",
  "your", "and", "or", "not", "no", "any", "all", "etc", "e.g", "eg", "i.e", "ie", "only", "other", "such", "as", "like", "including",
  "software", "app", "apps", "tool", "tools", "business", "businesses", "company", "companies", "platform",
]);

export type OfferTerm = { source: string; words: string[] };

function significant(text: string): string[] {
  return normalizeKeyword(text)
    .split(" ")
    .filter((w) => w.length > 1 && !FILLER.has(w))
    .map(stem);
}

/** Splits brand-list entries into match terms. Entries that leave no significant word are dropped. */
export function offerTerms(entries: readonly string[]): OfferTerm[] {
  const out: OfferTerm[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const parts = entry.split(/[()[\]{},;/]|\s(?:and|or|&)\s|\s[-–—]\s/i);
    for (const part of parts) {
      const words = significant(part);
      if (!words.length) continue;
      const k = words.join(" ");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ source: entry, words });
    }
  }
  return out;
}

const matches = (kwWords: Set<string>, term: OfferTerm) => term.words.every((w) => kwWords.has(w));

export type FitResult = { fit: Fit; matched: OfferTerm | null };

/** Classifies one keyword against the sells / does-not-sell lists. "Does not sell" wins over "sells". */
export function classifyFit(keyword: string, sells: OfferTerm[], doesNotSell: OfferTerm[]): FitResult {
  const words = new Set(normalizeKeyword(keyword).split(" ").filter(Boolean).map(stem));
  const no = doesNotSell.find((t) => matches(words, t));
  if (no) return { fit: "not_offered", matched: no };
  const yes = sells.find((t) => matches(words, t) || t.words.some((w) => w.length > 3 && words.has(w)));
  if (yes) return { fit: "offered", matched: yes };
  return { fit: "unknown", matched: null };
}

export type Filtered<T> = { kept: (T & { fit: Fit })[]; excluded: { row: T; reason: string }[] };

/**
 * Filters research rows against a brand profile: rows that hit a "does not
 * sell" term are removed with the reason; the rest are kept and labelled
 * "offered" or "unknown".
 */
export function filterByOffering<T extends { keyword: string }>(rows: T[], brand: { sells: readonly string[]; doesNotSell: readonly string[] }): Filtered<T> {
  const sells = offerTerms(brand.sells), no = offerTerms(brand.doesNotSell);
  const kept: (T & { fit: Fit })[] = [];
  const excluded: { row: T; reason: string }[] = [];
  for (const r of rows) {
    const f = classifyFit(r.keyword, sells, no);
    if (f.fit === "not_offered") excluded.push({ row: r, reason: `matches "does not sell": ${f.matched!.source}` });
    else kept.push({ ...r, fit: f.fit });
  }
  return { kept, excluded };
}
