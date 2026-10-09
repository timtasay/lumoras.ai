/**
 * Rule 9: internal links must resolve on the day the post goes live. A link
 * to an article scheduled for a later date 404s until then. Targets are the
 * site's real route inventory (crawled from its sitemaps) plus our own
 * articles that are published, or scheduled to go out on or before the
 * linking article's publish date. Pure functions.
 */

export type InventoryRoute = { path: string; title?: string | null };
export type OwnPage = { path: string; title: string; publishDate: string | null; status: string; itemId?: string };

export type LinkTarget = { path: string; title: string; source: "inventory" | "scheduled" | "published"; from: string | null };

export type LinkVerdict =
  | { ok: true; target: LinkTarget }
  | { ok: false; reason: "later" | "missing"; availableFrom: string | null; detail: string };

/** Normalises a path for comparison: no query or fragment, no trailing slash (except "/"), lower case. */
export function normPath(p: string): string {
  const bare = p.split(/[?#]/)[0] || "/";
  const trimmed = bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
  return trimmed.toLowerCase() || "/";
}

const LIVE = new Set(["published"]);
const SCHEDULED = new Set(["approved", "publishing", "awaiting_review", "changes_requested", "generating"]);

/** Every page a link may point to on `date` (YYYY-MM-DD). */
export function linkTargetsOn(date: string, routes: InventoryRoute[], pages: OwnPage[]): Map<string, LinkTarget> {
  const out = new Map<string, LinkTarget>();
  for (const r of routes) out.set(normPath(r.path), { path: normPath(r.path), title: r.title ?? r.path, source: "inventory", from: null });
  for (const p of pages) {
    const k = normPath(p.path);
    if (out.has(k)) continue;
    if (LIVE.has(p.status)) out.set(k, { path: k, title: p.title, source: "published", from: p.publishDate });
    else if (SCHEDULED.has(p.status) && p.publishDate && p.publishDate <= date) out.set(k, { path: k, title: p.title, source: "scheduled", from: p.publishDate });
  }
  return out;
}

/** Does `path` resolve on `date`? Says why not: scheduled for later, or not a page at all. */
export function resolveLink(path: string, date: string, routes: InventoryRoute[], pages: OwnPage[]): LinkVerdict {
  const k = normPath(path);
  // in-page anchors on the home page ("/#voice") resolve with their page
  const targets = linkTargetsOn(date, routes, pages);
  const t = targets.get(k);
  if (t) return { ok: true, target: t };
  const later = pages.find((p) => normPath(p.path) === k && SCHEDULED.has(p.status) && p.publishDate && p.publishDate > date);
  if (later) {
    return { ok: false, reason: "later", availableFrom: later.publishDate, detail: `${k} is scheduled for ${later.publishDate}, after this article goes live on ${date}: it would 404 until then.` };
  }
  return { ok: false, reason: "missing", availableFrom: null, detail: `${k} is not in the site's route inventory and is not one of its articles.` };
}

/** "/insights/{slug}" with the slug filled in. */
export function pagePath(pattern: string, slug: string): string {
  return normPath(pattern.replace(/\{\{\s*slug\s*\}\}|\{slug\}/g, slug));
}
