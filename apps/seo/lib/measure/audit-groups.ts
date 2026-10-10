/**
 * Site-audit issues, grouped for people (section 9: "issues grouped and
 * assignable, and a fix action that creates a task"). Providers name issue
 * types differently (OpenSEO "title-too-long", DataForSEO "title_too_long");
 * this maps both onto one vocabulary: a group, a plain title and the task a
 * fix creates ("Shorten 17 titles over 60 characters"). Unknown types fall
 * into "Other" with the provider's own title. Pure.
 */
export const AUDIT_GROUPS = ["links", "metadata", "content", "indexing", "performance", "media", "other"] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

export const GROUP_LABEL: Record<AuditGroup, string> = {
  links: "Links and status codes",
  metadata: "Titles and descriptions",
  content: "Content",
  indexing: "Indexing and canonicals",
  performance: "Speed",
  media: "Images and media",
  other: "Other",
};

type Known = { group: AuditGroup; noun: string; fix: string };

/** Normalised type (lowercase, separators as "_") → group, a count noun and the fix verb phrase. */
const KNOWN: Record<string, Known> = {
  title_too_long: { group: "metadata", noun: "titles over 60 characters", fix: "Shorten" },
  title_too_short: { group: "metadata", noun: "titles under 30 characters", fix: "Lengthen" },
  no_title: { group: "metadata", noun: "pages without a title", fix: "Write titles for" },
  duplicate_title: { group: "metadata", noun: "duplicate titles", fix: "Make unique:" },
  missing_meta_description: { group: "metadata", noun: "pages without a meta description", fix: "Write descriptions for" },
  no_description: { group: "metadata", noun: "pages without a meta description", fix: "Write descriptions for" },
  duplicate_description: { group: "metadata", noun: "duplicate meta descriptions", fix: "Make unique:" },
  description_too_long: { group: "metadata", noun: "descriptions over 160 characters", fix: "Shorten" },
  broken_internal_link: { group: "links", noun: "broken internal links", fix: "Fix" },
  broken_links: { group: "links", noun: "broken links", fix: "Fix" },
  is_broken: { group: "links", noun: "broken pages", fix: "Fix" },
  is_4xx_code: { group: "links", noun: "pages answering 4xx", fix: "Fix or redirect" },
  is_5xx_code: { group: "links", noun: "pages answering 5xx", fix: "Fix" },
  redirect_chain: { group: "links", noun: "redirect chains", fix: "Shorten" },
  is_redirect: { group: "links", noun: "internal links to redirects", fix: "Point directly:" },
  no_h1_tag: { group: "content", noun: "pages without an H1", fix: "Add an H1 to" },
  duplicate_h1: { group: "content", noun: "pages with more than one H1", fix: "Keep one H1 on" },
  low_content_rate: { group: "content", noun: "thin pages", fix: "Expand" },
  duplicate_content: { group: "content", noun: "pages with duplicate content", fix: "Consolidate" },
  canonical_to_redirect: { group: "indexing", noun: "canonicals pointing at redirects", fix: "Fix" },
  no_canonical: { group: "indexing", noun: "pages without a canonical", fix: "Add canonicals to" },
  noindex: { group: "indexing", noun: "noindex pages", fix: "Review" },
  orphan_page: { group: "indexing", noun: "orphan pages", fix: "Link to" },
  high_loading_time: { group: "performance", noun: "slow pages", fix: "Speed up" },
  large_page_size: { group: "performance", noun: "heavy pages", fix: "Slim down" },
  no_image_alt: { group: "media", noun: "images without alt text", fix: "Add alt text to" },
  missing_alt: { group: "media", noun: "images without alt text", fix: "Add alt text to" },
};

export const normalizeIssueType = (t: string) => t.trim().toLowerCase().replace(/[\s-]+/g, "_").slice(0, 120);

export type IssueView = { group: AuditGroup; title: string; taskTitle: string };

/** How an issue reads on screen and as a task. */
export function describeIssue(type: string, count: number, providerTitle: string): IssueView {
  const k = KNOWN[normalizeIssueType(type)];
  const clean = providerTitle.replace(/\s+/g, " ").trim().slice(0, 160) || normalizeIssueType(type).replace(/_/g, " ");
  if (!k) return { group: "other", title: clean, taskTitle: `Fix: ${clean} (${count.toLocaleString("en-US")})`.slice(0, 200) };
  const noun = count === 1 ? k.noun.replace(/^pages /, "page ").replace(/s\b(?= |$)/, "") : k.noun;
  return { group: k.group, title: `${count.toLocaleString("en-US")} ${noun}`, taskTitle: `${k.fix} ${count.toLocaleString("en-US")} ${noun}`.slice(0, 200) };
}

export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;
export type Severity = keyof typeof SEVERITY_ORDER;

/** Issues grouped for the audit screen: groups with critical issues first, issues by severity then count. */
export function groupIssues<T extends { issue_type: string; severity: Severity; count: number; category: string }>(issues: T[]): { group: AuditGroup; label: string; issues: T[]; worst: Severity; total: number }[] {
  const by = new Map<AuditGroup, T[]>();
  for (const i of issues) {
    const g = (AUDIT_GROUPS as readonly string[]).includes(i.category) ? (i.category as AuditGroup) : "other";
    by.set(g, [...(by.get(g) ?? []), i]);
  }
  return [...by.entries()]
    .map(([group, list]) => {
      const sorted = [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
      return { group, label: GROUP_LABEL[group], issues: sorted, worst: sorted[0].severity, total: sorted.reduce((s, x) => s + x.count, 0) };
    })
    .sort((a, b) => SEVERITY_ORDER[a.worst] - SEVERITY_ORDER[b.worst] || b.total - a.total);
}
