/**
 * Sites, brand profiles and authors. Every function takes a Tx from
 * withWorkspace(): row-level security scopes it to one workspace, and the
 * audit triggers record each write. Functions never take a workspace id to
 * filter by; the transaction already decides that.
 */
import type { Tx } from "../db/tenant.ts";
import type { AuthorInput, BrandInput, SeoRules, SiteInput } from "../validation.ts";

export type Site = {
  id: string;
  workspace_id: string;
  domain: string;
  name: string;
  industry: string;
  locale: string;
  country: string;
  serp_location: string;
  timezone: string;
  status: "active" | "paused" | "archived";
  last_crawl_at: Date | null;
  last_crawl_status: "ok" | "partial" | "failed" | null;
  /** Rule 4: seeds are not re-researched until their data is older than this. */
  research_max_age_days: number;
  created_at: Date;
};

/** Phase 3: schedule, rolling generation, review mode, back-dating, runway and publishing. */
export type SiteSettings = Site & {
  schedule_days: number[];
  schedule_time: string;
  schedule_active: boolean;
  generation_mode: "rolling" | "batch";
  lead_days: number;
  batch_size: number;
  horizon_days: number;
  review_mode: "approval" | "autopilot";
  autopilot_acknowledged_by: string | null;
  autopilot_acknowledged_at: Date | null;
  allow_backdating: boolean;
  runway_threshold_days: number;
  runway_days: number | null;
  runway_level: "ok" | "low" | "empty" | null;
  runway_reason: string | null;
  runway_checked_at: Date | null;
  runway_alerted_level: "low" | "empty" | null;
  runway_alerted_at: Date | null;
  publish_connection_id: string | null;
  feed_enabled: boolean;
  feed_token: string;
  /** Phase 4: measurement cadences (lib/measure/cadence.ts). */
  rank_cadence: "off" | "daily" | "weekly" | "fortnightly" | "monthly";
  rank_device: "desktop" | "mobile";
  rank_depth: number;
  rank_max_keywords: number;
  audit_cadence: "off" | "monthly" | "quarterly";
  audit_max_pages: number;
  backlinks_cadence: "off" | "monthly" | "quarterly";
  search_sync: boolean;
  inspect_daily_cap: number;
  /** Owner decision #3: the OpenSEO project this site's research runs in (null: the default project, else found by domain). */
  openseo_project_id: string | null;
};

const SETTINGS_COLS = `schedule_days, to_char(schedule_time, 'HH24:MI') AS schedule_time, schedule_active, generation_mode, lead_days, batch_size, horizon_days,
  review_mode, autopilot_acknowledged_by, autopilot_acknowledged_at, allow_backdating, runway_threshold_days, runway_days, runway_level, runway_reason,
  runway_checked_at, runway_alerted_level, runway_alerted_at, publish_connection_id, feed_enabled, feed_token,
  rank_cadence, rank_device, rank_depth, rank_max_keywords, audit_cadence, audit_max_pages, backlinks_cadence, search_sync, inspect_daily_cap, openseo_project_id`;

export function getSiteSettings(tx: Tx, id: string): Promise<SiteSettings> {
  return tx.one<SiteSettings>(`SELECT ${SITE_COLS}, ${SETTINGS_COLS} FROM sites WHERE id = $1`, [id], "site");
}

export function listSiteSettings(tx: Tx): Promise<SiteSettings[]> {
  return tx.many<SiteSettings>(`SELECT ${SITE_COLS}, ${SETTINGS_COLS} FROM sites ORDER BY created_at, domain`);
}

export type SiteSummary = Site & { routes: number; authors: number; connections: number; failing_connections: number; brand_filled: number };

const SITE_COLS = "id, workspace_id, domain, name, industry, locale, country, serp_location, timezone, status, last_crawl_at, last_crawl_status, research_max_age_days, created_at";

export function listSites(tx: Tx): Promise<SiteSummary[]> {
  return tx.many<SiteSummary>(
    `SELECT ${SITE_COLS.split(", ").map((c) => `s.${c}`).join(", ")},
       (SELECT count(*)::int FROM site_routes r WHERE r.site_id = s.id) AS routes,
       (SELECT count(*)::int FROM authors a WHERE a.site_id = s.id) AS authors,
       (SELECT count(*)::int FROM connections c WHERE c.site_id = s.id) AS connections,
       (SELECT count(*)::int FROM connections c WHERE c.site_id = s.id AND c.status = 'error') AS failing_connections,
       coalesce((SELECT (CASE WHEN b.overview <> '' THEN 1 ELSE 0 END) + (CASE WHEN cardinality(b.sells) > 0 THEN 1 ELSE 0 END)
                  + (CASE WHEN cardinality(b.does_not_sell) > 0 THEN 1 ELSE 0 END) + (CASE WHEN cardinality(b.voice_rules) > 0 THEN 1 ELSE 0 END)
                  + (CASE WHEN b.audience <> '' THEN 1 ELSE 0 END)
                 FROM brand_profiles b WHERE b.site_id = s.id), 0) AS brand_filled
     FROM sites s ORDER BY s.created_at, s.domain`,
  );
}

export function getSite(tx: Tx, id: string): Promise<Site> {
  return tx.one<Site>(`SELECT ${SITE_COLS} FROM sites WHERE id = $1`, [id], "site");
}

export async function createSite(tx: Tx, workspaceId: string, s: Omit<SiteInput, "researchMaxAgeDays">): Promise<Site> {
  const site = await tx.one<Site>(
    `INSERT INTO sites (workspace_id, domain, name, industry, locale, country, serp_location, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${SITE_COLS}`,
    [workspaceId, s.domain, s.name, s.industry, s.locale, s.country, s.serpLocation, s.timezone],
  );
  await tx.exec("INSERT INTO brand_profiles (workspace_id, site_id) VALUES ($1, $2)", [workspaceId, site.id]);
  return site;
}

export function updateSite(tx: Tx, id: string, s: Omit<SiteInput, "domain">): Promise<Site> {
  return tx.one<Site>(
    `UPDATE sites SET name = $2, industry = $3, locale = $4, country = $5, serp_location = $6, timezone = $7, research_max_age_days = $8
     WHERE id = $1 RETURNING ${SITE_COLS}`,
    [id, s.name, s.industry, s.locale, s.country, s.serpLocation, s.timezone, s.researchMaxAgeDays],
    "site",
  );
}

export async function deleteSite(tx: Tx, id: string): Promise<void> {
  if (!(await tx.exec("DELETE FROM sites WHERE id = $1", [id]))) throw new Error("site not found");
}

export type KeyPageRow = { url: string; title: string; description: string };
export type BrandProfile = {
  id: string;
  site_id: string;
  overview: string;
  current_goal: string;
  positioning: string;
  audience: string;
  sells: string[];
  does_not_sell: string[];
  competitors: string[];
  key_pages: KeyPageRow[];
  product_facts: string[];
  forbidden_claims: string[];
  voice_rules: string[];
  seo_rules: SeoRules;
  banned_words: string[];
  example_articles: string[];
  prefilled_at: Date | null;
  updated_at: Date;
};

export function getBrand(tx: Tx, siteId: string): Promise<BrandProfile> {
  return tx.one<BrandProfile>("SELECT * FROM brand_profiles WHERE site_id = $1", [siteId], "brand profile");
}

export function updateBrand(tx: Tx, siteId: string, b: BrandInput): Promise<BrandProfile> {
  return tx.one<BrandProfile>(
    `UPDATE brand_profiles SET overview = $2, current_goal = $3, positioning = $4, audience = $5, sells = $6, does_not_sell = $7,
       competitors = $8, key_pages = $9::jsonb, product_facts = $10, forbidden_claims = $11, voice_rules = $12, seo_rules = $13::jsonb,
       banned_words = $14, example_articles = $15
     WHERE site_id = $1 RETURNING *`,
    [
      siteId, b.overview, b.currentGoal, b.positioning, b.audience, b.sells, b.doesNotSell, b.competitors,
      JSON.stringify(b.keyPages), b.productFacts, b.forbiddenClaims, b.voiceRules, JSON.stringify(b.seoRules), b.bannedWords, b.exampleArticles,
    ],
    "brand profile",
  );
}

/**
 * Fills EMPTY brand fields from the crawl (never overwrites what a person wrote),
 * and marks the profile as pre-filled.
 */
export async function prefillBrand(tx: Tx, siteId: string, p: { overview: string; positioning: string; keyPages: KeyPageRow[] }): Promise<void> {
  await tx.exec(
    `UPDATE brand_profiles SET
       overview = CASE WHEN overview = '' THEN $2 ELSE overview END,
       positioning = CASE WHEN positioning = '' THEN $3 ELSE positioning END,
       key_pages = CASE WHEN key_pages = '[]'::jsonb THEN $4::jsonb ELSE key_pages END,
       prefilled_at = now()
     WHERE site_id = $1`,
    [siteId, p.overview.slice(0, 4000), p.positioning.slice(0, 2000), JSON.stringify(p.keyPages)],
  );
}

/** A byline: a real person, or the client's organization ("Lumoras team"). Published as schema.org Person or Organization. */
export type AuthorKind = "person" | "organization";

export type Author = {
  id: string;
  site_id: string;
  kind: AuthorKind;
  name: string;
  role: string;
  bio: string;
  avatar_url: string | null;
  is_demo: boolean;
  created_at: Date;
};

export function listAuthors(tx: Tx, siteId: string): Promise<Author[]> {
  return tx.many<Author>("SELECT id, site_id, kind, name, role, bio, avatar_url, is_demo, created_at FROM authors WHERE site_id = $1 ORDER BY created_at", [siteId]);
}

/** An author as saved: kind defaults to a person. */
type AuthorSave = Omit<AuthorInput, "kind"> & { kind?: AuthorKind };

export function createAuthor(tx: Tx, workspaceId: string, siteId: string, a: AuthorSave): Promise<Author> {
  const kind = a.kind ?? "person";
  return tx.one<Author>(
    `INSERT INTO authors (workspace_id, site_id, kind, name, role, bio, avatar_url) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, site_id, kind, name, role, bio, avatar_url, is_demo, created_at`,
    [workspaceId, siteId, kind, a.name, kind === "organization" ? "" : a.role, a.bio, a.avatarUrl],
  );
}

export function updateAuthor(tx: Tx, id: string, a: AuthorSave): Promise<Author> {
  const kind = a.kind ?? "person";
  return tx.one<Author>(
    `UPDATE authors SET kind = $2, name = $3, role = $4, bio = $5, avatar_url = $6 WHERE id = $1
     RETURNING id, site_id, kind, name, role, bio, avatar_url, is_demo, created_at`,
    [id, kind, a.name, kind === "organization" ? "" : a.role, a.bio, a.avatarUrl],
    "author",
  );
}

export async function deleteAuthor(tx: Tx, id: string): Promise<void> {
  if (!(await tx.exec("DELETE FROM authors WHERE id = $1", [id]))) throw new Error("author not found");
}
