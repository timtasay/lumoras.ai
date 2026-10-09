/**
 * Storing a crawl: a crawl_runs row, the route inventory (upserted in one
 * statement, audited as one summary row by 0004's statement trigger), the
 * site's last-crawl fields and the brand pre-fill.
 */
import type { Tx } from "../db/tenant.ts";
import type { CrawlResult } from "../crawl/crawler.ts";
import { brandPrefill } from "../crawl/prefill.ts";
import { prefillBrand } from "./sites.ts";

export type CrawlRun = {
  id: string;
  site_id: string;
  status: "running" | "ok" | "partial" | "failed";
  started_at: Date;
  finished_at: Date | null;
  sitemaps: number;
  urls: number;
  problems: { url: string; message: string }[];
};

export class CrawlBusyError extends Error {
  constructor() {
    super("A crawl of this site is already running. Wait for it to finish.");
    this.name = "CrawlBusyError";
  }
}

/** Starts a run; refuses while another one for the site is running (stale runs older than 10 minutes are closed as failed). */
export async function startCrawlRun(tx: Tx, workspaceId: string, siteId: string): Promise<CrawlRun> {
  await tx.exec(
    `UPDATE crawl_runs SET status = 'failed', finished_at = now(), problems = '[{"url":"","message":"interrupted"}]'::jsonb
     WHERE site_id = $1 AND status = 'running' AND started_at < now() - interval '10 minutes'`,
    [siteId],
  );
  // lock the site row so two requests cannot both start a crawl
  await tx.one("SELECT id FROM sites WHERE id = $1 FOR UPDATE", [siteId], "site");
  if (await tx.maybe("SELECT 1 FROM crawl_runs WHERE site_id = $1 AND status = 'running'", [siteId])) throw new CrawlBusyError();
  return tx.one<CrawlRun>("INSERT INTO crawl_runs (workspace_id, site_id) VALUES ($1, $2) RETURNING *", [workspaceId, siteId]);
}

export async function finishCrawlRun(tx: Tx, workspaceId: string, siteId: string, runId: string, r: CrawlResult): Promise<{ added: number; seen: number }> {
  let added = 0;
  const now = new Date();
  // upsert in chunks of 5,000 (one statement each)
  for (let i = 0; i < r.routes.length; i += 5000) {
    const chunk = r.routes.slice(i, i + 5000);
    const rows = await tx.many<{ inserted: boolean }>(
      `INSERT INTO site_routes (workspace_id, site_id, url, path, lastmod, source, discovered_at, last_seen_at)
       SELECT $1, $2, u.url, u.path, u.lastmod, u.source, $7, $7
       FROM unnest($3::text[], $4::text[], $5::timestamptz[], $6::text[]) AS u(url, path, lastmod, source)
       ON CONFLICT (site_id, url) DO UPDATE SET lastmod = EXCLUDED.lastmod, source = EXCLUDED.source, last_seen_at = EXCLUDED.last_seen_at
       RETURNING (xmax = 0) AS inserted`,
      [workspaceId, siteId, chunk.map((x) => x.url), chunk.map((x) => x.path), chunk.map((x) => x.lastmod), chunk.map((x) => x.source), now],
    );
    added += rows.filter((x) => x.inserted).length;
  }
  await tx.exec(
    `UPDATE crawl_runs SET status = $2, finished_at = now(), sitemaps = $3, urls = $4, problems = $5::jsonb WHERE id = $1`,
    [runId, r.status, r.sitemaps.length, r.routes.length, JSON.stringify(r.problems.slice(0, 50))],
  );
  await tx.exec("UPDATE sites SET last_crawl_at = now(), last_crawl_status = $2 WHERE id = $1", [siteId, r.status]);
  if (r.pages.length) await prefillBrand(tx, siteId, brandPrefill(r.pages));
  return { added, seen: r.routes.length };
}

export function latestCrawl(tx: Tx, siteId: string): Promise<CrawlRun | null> {
  return tx.maybe<CrawlRun>("SELECT * FROM crawl_runs WHERE site_id = $1 ORDER BY started_at DESC LIMIT 1", [siteId]);
}

export type RouteRow = { url: string; path: string; lastmod: Date | null; discovered_at: Date; last_seen_at: Date };

export function listRoutes(tx: Tx, siteId: string, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<RouteRow[]> {
  return tx.many<RouteRow>(
    `SELECT url, path, lastmod, discovered_at, last_seen_at FROM site_routes
     WHERE site_id = $1 AND ($2::text IS NULL OR path ILIKE '%' || $2 || '%')
     ORDER BY path LIMIT $3 OFFSET $4`,
    [siteId, opts.q?.trim() || null, Math.min(opts.limit ?? 100, 500), opts.offset ?? 0],
  );
}

export async function countRoutes(tx: Tx, siteId: string): Promise<number> {
  return (await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM site_routes WHERE site_id = $1", [siteId])).n;
}
