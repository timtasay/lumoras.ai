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
  created_at: Date;
};

export type SiteSummary = Site & { routes: number; authors: number; connections: number; failing_connections: number; brand_filled: number };

const SITE_COLS = "id, workspace_id, domain, name, industry, locale, country, serp_location, timezone, status, last_crawl_at, last_crawl_status, created_at";

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

export async function createSite(tx: Tx, workspaceId: string, s: SiteInput): Promise<Site> {
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
    `UPDATE sites SET name = $2, industry = $3, locale = $4, country = $5, serp_location = $6, timezone = $7
     WHERE id = $1 RETURNING ${SITE_COLS}`,
    [id, s.name, s.industry, s.locale, s.country, s.serpLocation, s.timezone],
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

export type Author = {
  id: string;
  site_id: string;
  name: string;
  role: string;
  bio: string;
  avatar_url: string | null;
  is_demo: boolean;
  created_at: Date;
};

export function listAuthors(tx: Tx, siteId: string): Promise<Author[]> {
  return tx.many<Author>("SELECT id, site_id, name, role, bio, avatar_url, is_demo, created_at FROM authors WHERE site_id = $1 ORDER BY created_at", [siteId]);
}

export function createAuthor(tx: Tx, workspaceId: string, siteId: string, a: AuthorInput): Promise<Author> {
  return tx.one<Author>(
    `INSERT INTO authors (workspace_id, site_id, name, role, bio, avatar_url) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, site_id, name, role, bio, avatar_url, is_demo, created_at`,
    [workspaceId, siteId, a.name, a.role, a.bio, a.avatarUrl],
  );
}

export function updateAuthor(tx: Tx, id: string, a: AuthorInput): Promise<Author> {
  return tx.one<Author>(
    `UPDATE authors SET name = $2, role = $3, bio = $4, avatar_url = $5 WHERE id = $1
     RETURNING id, site_id, name, role, bio, avatar_url, is_demo, created_at`,
    [id, a.name, a.role, a.bio, a.avatarUrl],
    "author",
  );
}

export async function deleteAuthor(tx: Tx, id: string): Promise<void> {
  if (!(await tx.exec("DELETE FROM authors WHERE id = $1", [id]))) throw new Error("author not found");
}
