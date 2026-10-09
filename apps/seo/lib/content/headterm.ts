/**
 * Rule 5: no two articles target the same head term. Before a topic is
 * accepted (and again in the lint), its primary keyword is compared with
 * every published and scheduled article's primary keyword for the site, and
 * with the keywords the site's existing pages already rank for. Two keywords
 * share a head term when their near-duplicate keys match (rule 6's variant
 * key: case, punctuation, plurals, word order, filler words and places
 * folded), so "salon no-show policies" collides with "no show policy salon".
 * Pure functions.
 */
import { normalizeKeyword, variantKey } from "../research/keywords.ts";

export type HeadTermSource = "published" | "scheduled" | "ranked";
export type ExistingTarget = { keyword: string; source: HeadTermSource; ref: string; itemId?: string };
export type HeadTermConflict = ExistingTarget & { key: string };

export const headTerm = (keyword: string) => variantKey(keyword);

export function headTermConflicts(keyword: string, existing: ExistingTarget[], opts: { ignoreItemId?: string } = {}): HeadTermConflict[] {
  const key = headTerm(keyword);
  const norm = normalizeKeyword(keyword);
  if (!key) return [];
  return existing
    .filter((e) => !(opts.ignoreItemId && e.itemId === opts.ignoreItemId))
    .filter((e) => headTerm(e.keyword) === key || normalizeKeyword(e.keyword) === norm)
    .map((e) => ({ ...e, key }));
}

export function describeConflict(c: HeadTermConflict): string {
  return c.source === "ranked"
    ? `"${c.keyword}" already ranks with ${c.ref}`
    : `"${c.keyword}" is the primary keyword of ${c.source === "published" ? "published" : "scheduled"} article ${c.ref}`;
}
