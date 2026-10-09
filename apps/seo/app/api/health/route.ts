/** Liveness for the container healthcheck and Caddy. No database call: a slow DB must not restart the web container. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "lumoras-seo", phase: 1 }, { headers: { "Cache-Control": "no-store" } });
}
