/**
 * Index status of published URLs through Search Console's URL Inspection API
 * (read-only: it reports what Google has indexed and never asks Google to
 * crawl; the Indexing API is never used). Google allows 2,000 inspections per
 * property per day and 600 per minute; we inspect at most the site's daily
 * cap (default 20), one per second.
 *
 * What gets inspected, in order:
 *   1. published articles (newest first): never inspected, or not indexed and
 *      not looked at for two days, or indexed and not looked at for 14 days;
 *   2. the brand profile's key pages, and the pages with the most Search
 *      impressions in the last 28 days, every 30 days.
 */
import { withWorkspace, type TenantContext } from "../db/tenant.ts";
import { getSiteSettings } from "../data/sites.ts";
import { GoogleApiError, gscInspectUrl } from "../google/api.ts";
import { GoogleNotReadyError, withGoogle } from "../google/service.ts";
import { pacificDate } from "./cadence.ts";
import { finishRun, pace, type MeasureDeps, type RunTrigger } from "./runs.ts";

type Candidate = { url: string; itemId: string | null; source: "published" | "key_page" | "search" };

const sameSite = (url: string, domain: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

export type InspectResult = { status: "ok" | "skipped"; inspected: number; indexed: number; errors: number; detail: string };

export async function inspectSite(deps: MeasureDeps, ctx: TenantContext, siteId: string, opts: { trigger: RunTrigger; runId?: string | null; pauseMs?: number } = { trigger: "schedule" }): Promise<InspectResult> {
  const now = deps.now();
  const done = async (r: InspectResult) => {
    if (opts.runId) await withWorkspace(deps.db, ctx, async (tx) => { await tx.action("inspect.finish"); await finishRun(tx, opts.runId!, r.status === "ok" ? "succeeded" : "skipped", { detail: r.detail, stats: { inspected: r.inspected, indexed: r.indexed, errors: r.errors }, now }); });
    return r;
  };
  if (!deps.google) return done({ status: "skipped", inspected: 0, indexed: 0, errors: 0, detail: "Google is not configured on this server." });
  const { site, todo } = await withWorkspace(deps.db, ctx, async (tx) => {
    const site = await getSiteSettings(tx, siteId);
    const usedToday = await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM url_inspections WHERE site_id = $1 AND inspected_at >= $2", [siteId, new Date(now.getTime() - 24 * 3_600_000)]);
    const budget = Math.max(0, site.inspect_daily_cap - usedToday.n);
    const last = new Map((await tx.many<{ url: string; verdict: string; inspected_at: Date }>("SELECT url, verdict, inspected_at FROM url_inspections WHERE site_id = $1", [siteId])).map((r) => [r.url, r]));
    const age = (u: string) => (last.has(u) ? (now.getTime() - last.get(u)!.inspected_at.getTime()) / 86_400_000 : Infinity);
    const published = await tx.many<{ id: string; live_url: string }>("SELECT id, live_url FROM content_items WHERE site_id = $1 AND status = 'published' AND live_url IS NOT NULL ORDER BY published_at DESC NULLS LAST LIMIT 200", [siteId]);
    const keyPages = (await tx.maybe<{ key_pages: { url?: string }[] }>("SELECT key_pages FROM brand_profiles WHERE site_id = $1", [siteId]))?.key_pages ?? [];
    const top = await tx.many<{ page: string }>(
      "SELECT page FROM gsc_page_daily WHERE site_id = $1 AND day > $2::date - 28 GROUP BY page ORDER BY sum(impressions) DESC LIMIT 10",
      [siteId, pacificDate(now)],
    );
    const out: Candidate[] = [];
    for (const p of published) {
      const a = age(p.live_url), v = last.get(p.live_url)?.verdict;
      if (a === Infinity || (v !== "PASS" && a >= 2) || a >= 14) out.push({ url: p.live_url, itemId: p.id, source: "published" });
    }
    for (const u of [...keyPages.map((k) => String(k.url ?? "")), ...top.map((t) => t.page)]) {
      if (u && sameSite(u, site.domain) && age(u) >= 30 && !out.some((c) => c.url === u)) out.push({ url: u, itemId: null, source: keyPages.some((k) => k.url === u) ? "key_page" : "search" });
    }
    return { site, todo: out.filter((c) => sameSite(c.url, site.domain)).slice(0, budget) };
  }, { readOnly: true });
  if (!todo.length) return done({ status: "ok", inspected: 0, indexed: 0, errors: 0, detail: "Nothing to inspect today." });

  let inspected = 0, indexed = 0, errors = 0;
  try {
    await withGoogle(deps.google, ctx, siteId, "search_console", async (token, conn) => {
      for (const c of todo) {
        await pace(`inspect:${conn.property}`, opts.pauseMs ?? 1000);
        let r: Awaited<ReturnType<typeof gscInspectUrl>> | null = null;
        let error: string | null = null;
        try {
          r = await gscInspectUrl(deps.google!.endpoints, token, conn.property, c.url, deps.google!.fetch);
        } catch (e) {
          if (e instanceof GoogleApiError && (e.status === 429 || e.status === 401)) throw e; // out of quota or access: stop for today
          error = e instanceof Error ? e.message.slice(0, 300) : "inspection failed";
        }
        inspected++;
        if (r?.verdict === "PASS") indexed++;
        if (error) errors++;
        await withWorkspace(deps.db, ctx, async (tx) => {
          await tx.action("inspect.url");
          await tx.exec(
            `INSERT INTO url_inspections (workspace_id, site_id, url, item_id, source, verdict, coverage_state, indexing_state, page_fetch_state, robots_txt_state, last_crawl_time, google_canonical, user_canonical, result_link, error, inspected_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (site_id, url) DO UPDATE SET item_id = coalesce(EXCLUDED.item_id, url_inspections.item_id), source = EXCLUDED.source, verdict = EXCLUDED.verdict,
               coverage_state = EXCLUDED.coverage_state, indexing_state = EXCLUDED.indexing_state, page_fetch_state = EXCLUDED.page_fetch_state, robots_txt_state = EXCLUDED.robots_txt_state,
               last_crawl_time = EXCLUDED.last_crawl_time, google_canonical = EXCLUDED.google_canonical, user_canonical = EXCLUDED.user_canonical, result_link = EXCLUDED.result_link,
               error = EXCLUDED.error, inspected_at = EXCLUDED.inspected_at`,
            [ctx.workspaceId, siteId, c.url, c.itemId, c.source, r?.verdict ?? "ERROR", r?.coverageState ?? "", r?.indexingState ?? "", r?.pageFetchState ?? "", r?.robotsTxtState ?? "",
              r?.lastCrawlTime && !Number.isNaN(Date.parse(r.lastCrawlTime)) ? new Date(r.lastCrawlTime) : null, r?.googleCanonical ?? null, r?.userCanonical ?? null, r?.inspectionResultLink ?? null, error, now],
          );
          if (c.itemId && r) await tx.exec("UPDATE publications SET indexing = $2::jsonb WHERE item_id = $1 AND status IN ('open', 'merged', 'published')", [c.itemId, JSON.stringify(r)]);
        });
      }
    });
  } catch (e) {
    if (e instanceof GoogleNotReadyError) return done({ status: "skipped", inspected, indexed, errors, detail: e.message });
    if (e instanceof GoogleApiError && e.status === 429) return done({ status: "ok", inspected, indexed, errors, detail: `Stopped at Google's inspection quota after ${inspected}; the rest waits for tomorrow.` });
    throw e;
  }
  return done({ status: "ok", inspected, indexed, errors, detail: `Inspected ${inspected} URL${inspected === 1 ? "" : "s"} of ${site.domain}: ${indexed} indexed.` });
}
