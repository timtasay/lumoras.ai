/**
 * A site's posts endpoint when it publishes through Lumoras Growth
 * (docs/content-api.md): the site reads its new articles here at request
 * time, so publishing needs no deploy. Read-only; the token names the site.
 */
import { pool } from "@/lib/db/pool";
import { loadPostsFeed } from "@/lib/data/feeds";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await loadPostsFeed(pool(), token, new Date());
  if (!feed) return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(JSON.stringify(feed), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" },
  });
}
