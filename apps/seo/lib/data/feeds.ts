/**
 * Public feeds (section 8.3). The unguessable token finds one site whose feed
 * is enabled (feed_site(), SECURITY DEFINER, returns ids only); the articles
 * are then read inside that site's workspace scope like any other request,
 * so row-level security still applies. Only published articles are listed.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { withActor, withWorkspace } from "../db/tenant.ts";
import { livePathPattern, loadPublishConnection } from "../publishers/registry.ts";
import { pagePath } from "../content/links.ts";
import type { FeedArticle, FeedSite } from "../publishers/feed.ts";
import { schemaTypeFor } from "../publishers/byline.ts";
import type { ServedPost } from "../publishers/content-api.ts";

export const FEED_ACTOR = "system:feed";

export async function loadFeed(db: pg.Pool, token: string, baseUrl: string, kind: "json" | "rss"): Promise<{ site: FeedSite; items: FeedArticle[] } | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hit = await withActor(db, { actorId: FEED_ACTOR }, (tx) => tx.maybe<{ workspace_id: string; site_id: string }>("SELECT workspace_id, site_id FROM feed_site($1)", [token]), { readOnly: true });
  if (!hit) return null;
  return withWorkspace(
    db,
    { workspaceId: hit.workspace_id, actorId: FEED_ACTOR, requestId: randomUUID() },
    async (tx) => {
      const site = await tx.one<{ name: string; domain: string; publish_connection_id: string | null }>("SELECT name, domain, publish_connection_id FROM sites WHERE id = $1", [hit.site_id], "site");
      const pattern = site.publish_connection_id ? await loadPublishConnection(tx, site.publish_connection_id).then(livePathPattern, () => "/blog/{{slug}}") : "/blog/{{slug}}";
      const rows = await tx.many<{ id: string; slug: string; title: string; description: string; body_md: string; publish_date: string; updated_at: Date; live_url: string | null; primary_keyword: string; brief: { tags?: string[] } | null; author: string | null; author_kind: string | null }>(
        `SELECT c.id, c.slug, c.title, c.description, c.body_md, to_char(c.publish_date, 'YYYY-MM-DD') AS publish_date, c.updated_at, c.live_url, c.primary_keyword, c.brief, a.name AS author, a.kind AS author_kind
         FROM content_items c LEFT JOIN authors a ON a.id = c.author_id
         WHERE c.site_id = $1 AND c.status = 'published' AND c.slug IS NOT NULL AND c.publish_date IS NOT NULL
         ORDER BY c.publish_date DESC, c.published_at DESC NULLS LAST LIMIT 50`,
        [hit.site_id],
      );
      return {
        site: { name: site.name, domain: site.domain, feedUrl: `${baseUrl}/api/feeds/${token}/${kind === "json" ? "feed.json" : "rss.xml"}` },
        items: rows.map((r) => ({
          id: r.id,
          url: r.live_url ?? `https://${site.domain}${pagePath(pattern, r.slug)}`,
          title: r.title,
          description: r.description,
          bodyMd: r.body_md,
          date: r.publish_date,
          updatedAt: r.updated_at,
          author: r.author,
          authorType: r.author ? schemaTypeFor(r.author_kind === "organization" ? "organization" : "person") : null,
          tags: Array.isArray(r.brief?.tags) ? r.brief!.tags!.map(String).slice(0, 8) : [],
          keyword: r.primary_keyword ?? "",
        })),
      };
    },
    { readOnly: true },
  );
}

/**
 * The posts endpoint of a site that publishes through Lumoras Growth
 * (docs/content-api.md). posts_feed_site() finds the site by its feed token
 * only when its publishing connection is content_api; the snapshots stored at
 * publishing are then read in that workspace under row-level security. The
 * newest snapshot per slug wins (a refresh replaces the article); only posts
 * whose date has arrived (UTC) are listed.
 */
export async function loadPostsFeed(db: pg.Pool, token: string, now: Date): Promise<{ version: 1; site: string; generatedAt: string; posts: ServedPost[] } | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hit = await withActor(db, { actorId: FEED_ACTOR }, (tx) => tx.maybe<{ workspace_id: string; site_id: string; domain: string }>("SELECT workspace_id, site_id, domain FROM posts_feed_site($1)", [token]), { readOnly: true });
  if (!hit) return null;
  const today = now.toISOString().slice(0, 10);
  const rows = await withWorkspace(
    db,
    { workspaceId: hit.workspace_id, actorId: FEED_ACTOR, requestId: randomUUID() },
    (tx) =>
      tx.many<{ payload: unknown }>(
        `SELECT payload FROM (
           SELECT DISTINCT ON (p.payload->>'slug') p.payload, p.status
           FROM publications p
           WHERE p.site_id = $1 AND p.publisher = 'content_api' AND p.payload IS NOT NULL AND p.status IN ('published', 'unpublished')
           ORDER BY p.payload->>'slug', p.created_at DESC
         ) latest
         WHERE status = 'published' AND payload->>'publishedAt' <= $2
         ORDER BY payload->>'publishedAt' DESC, payload->>'slug'
         LIMIT 500`,
        [hit.site_id, today],
      ),
    { readOnly: true },
  );
  return { version: 1, site: hit.domain, generatedAt: now.toISOString(), posts: rows.map((r) => r.payload).filter(isServedPost).map(inContractOrder) };
}

/** jsonb reorders keys; the endpoint lists fields in the contract's order (docs/content-api.md). */
function inContractOrder(p: ServedPost): ServedPost {
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    publishedAt: p.publishedAt,
    ...(typeof p.updatedAt === "string" ? { updatedAt: p.updatedAt } : {}),
    author: p.author,
    readingMinutes: p.readingMinutes,
    cover: { motif: p.cover.motif, chips: p.cover.chips.map(String) },
    body: p.body,
  };
}

/** A stored snapshot still has the served shape (defensive: rows are only written by ContentApiPublisher). */
function isServedPost(v: unknown): v is ServedPost {
  const p = v as ServedPost;
  return !!p && typeof p.slug === "string" && typeof p.title === "string" && typeof p.description === "string" && typeof p.publishedAt === "string" && typeof p.author === "string" && Number.isInteger(p.readingMinutes) && !!p.cover && typeof p.cover.motif === "string" && Array.isArray(p.cover.chips) && typeof p.body === "string";
}
