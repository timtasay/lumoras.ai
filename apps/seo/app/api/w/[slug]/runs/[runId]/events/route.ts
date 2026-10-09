/**
 * GET /api/w/:slug/runs/:runId/events: the pipeline run view's live feed
 * (server-sent events). The worker persists every step; this stream reads the
 * persisted run every 750 ms inside the member's own row-level-security scope
 * and sends a `run` event whenever anything changed, plus a comment line
 * every 15 s to keep proxies from closing it. It ends when the run is
 * finished (succeeded, failed, canceled) or after 15 minutes; EventSource
 * reconnects by itself and gets a fresh snapshot.
 *
 * Polling persisted rows (rather than LISTEN/NOTIFY) keeps one database
 * connection per poll instead of one held open per viewer; see open-work.md.
 */
import { getViewer } from "@/lib/auth/app";
import { pool } from "@/lib/db/pool";
import { isUuid, withWorkspace } from "@/lib/db/tenant";
import { membershipBySlug } from "@/lib/data/workspaces";
import { runView } from "@/lib/pipeline/view";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; runId: string }> }) {
  const { slug, runId } = await params;
  if (!isUuid(runId)) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in first.", { status: 401 });
  const m = await membershipBySlug(pool(), viewer.user.id, slug);
  if (!m) return new Response("Not found", { status: 404 });
  const ctx = { workspaceId: m.id, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId };
  try {
    await withWorkspace(pool(), ctx, (tx) => runView(tx, runId), { readOnly: true });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      request.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      send("retry: 2000\n\n");
      const t0 = Date.now();
      let last = "";
      let beat = Date.now();
      while (!closed && Date.now() - t0 < 15 * 60_000) {
        try {
          const v = await withWorkspace(pool(), ctx, (tx) => runView(tx, runId), { readOnly: true });
          if (v.version !== last) {
            last = v.version;
            send(`event: run\ndata: ${JSON.stringify(v)}\n\n`);
          }
          if (["succeeded", "failed", "canceled"].includes(v.status)) {
            send("event: end\ndata: {}\n\n");
            break;
          }
        } catch {
          send("event: error\ndata: {}\n\n");
          break;
        }
        if (Date.now() - beat > 15_000) {
          send(": keep-alive\n\n");
          beat = Date.now();
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
