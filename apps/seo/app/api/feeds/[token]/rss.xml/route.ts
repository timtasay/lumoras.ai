/** Public RSS 2.0 feed of a site's published articles; the token is the only key. A disabled feed answers 404. */
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { loadFeed } from "@/lib/data/feeds";
import { rssFeed } from "@/lib/publishers/feed";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await loadFeed(pool(), token, webEnv().baseUrl, "rss");
  if (!feed) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(rssFeed(feed.site, feed.items), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" },
  });
}
