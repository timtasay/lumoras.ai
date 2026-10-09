/**
 * POST /api/w/:slug/sites/:siteId/crawl: crawls the site's sitemaps now and
 * streams progress as NDJSON (one CrawlEvent per line, then a final
 * {"type":"stored",…} or {"type":"error",…}). The onboarding scan visual and
 * the site page read this stream.
 *
 * Guards, in order: same-origin JSON request (CSRF), signed-in member,
 * crawl:run permission, rate limits per site and per workspace, one running
 * crawl per site. The fetches go through the SSRF guard (lib/net/safe-fetch.ts).
 * No transaction is held open while fetching: one short transaction records
 * the start, another stores the result.
 */
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/app";
import { can } from "@/lib/auth/permissions";
import { log, webEnv } from "@/lib/config";
import { crawlSite, type CrawlEvent } from "@/lib/crawl/crawler";
import { pool } from "@/lib/db/pool";
import { isUuid, withWorkspace } from "@/lib/db/tenant";
import { finishCrawlRun, startCrawlRun, CrawlBusyError } from "@/lib/data/crawl";
import { getSite } from "@/lib/data/sites";
import { membershipBySlug, notify } from "@/lib/data/workspaces";
import { hit, LIMITS, RateLimitedError } from "@/lib/rate-limit";
import { crossOriginReason } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

const json = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const env = webEnv();
  const why = crossOriginReason(request, env.baseUrl);
  if (why) return json(403, `Cross-origin request refused (${why}).`);
  const { slug, siteId } = await params;
  if (!isUuid(siteId)) return json(404, "Site not found.");
  const viewer = await getViewer();
  if (!viewer) return json(401, "Sign in first.");
  const m = await membershipBySlug(pool(), viewer.user.id, slug);
  if (!m) return json(404, "Site not found.");
  if (!can(m.role, "crawl:run")) return json(403, "Your role cannot run a crawl. Ask an editor or owner.");
  const ctx = { workspaceId: m.id, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId };

  let site, run;
  try {
    await hit(pool(), LIMITS.crawlPerSite, siteId, env.rateLimitScale);
    await hit(pool(), LIMITS.crawlPerWorkspace, m.id, env.rateLimitScale);
    ({ site, run } = await withWorkspace(pool(), ctx, async (tx) => {
      await tx.action("crawl.start");
      const s = await getSite(tx, siteId);
      const r = await startCrawlRun(tx, m.id, s.id);
      return { site: s, run: r };
    }));
  } catch (e) {
    if (e instanceof RateLimitedError) return json(429, e.message);
    if (e instanceof CrawlBusyError) return json(409, e.message);
    if ((e as Error).name === "NotFoundError") return json(404, "Site not found.");
    log().error("crawl start failed", { err: e as Error });
    return json(500, "Could not start the crawl.");
  }

  const test = env.crawlerTestOrigins.get(site.domain);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* client went away; the crawl still finishes and is stored */
        }
      };
      try {
        const result = await crawlSite(site.domain, {
          origin: test?.origin,
          fetch: { policy: { testResolve: new Map([...env.crawlerTestOrigins].map(([d, v]) => [d, v.address])) } },
          onEvent: (e: CrawlEvent) => send(e),
        });
        const stored = await withWorkspace(pool(), ctx, async (tx) => {
          await tx.action("crawl.finish");
          const r = await finishCrawlRun(tx, m.id, site.id, run.id, result);
          await notify(tx, m.id, [viewer.user.id], {
            kind: "crawl.finished",
            title: `Crawl finished: ${site.domain}`,
            body: `${result.routes.length.toLocaleString("en-US")} routes from ${result.sitemaps.length} sitemap${result.sitemaps.length === 1 ? "" : "s"}${result.problems.length ? `, ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}` : ""}.`,
            href: `/w/${slug}/sites/${site.id}`,
          });
          return r;
        });
        send({ type: "stored", status: result.status, routes: result.routes.length, added: stored.added, sitemaps: result.sitemaps.length, pages: result.pages.length, problems: result.problems.slice(0, 10) });
      } catch (e) {
        log().error("crawl failed", { err: e as Error, site: site.id });
        await withWorkspace(pool(), ctx, async (tx) => {
          await tx.action("crawl.finish");
          await tx.exec("UPDATE crawl_runs SET status = 'failed', finished_at = now() WHERE id = $1", [run.id]);
        }).catch(() => {});
        send({ type: "error", message: "The crawl stopped unexpectedly. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
