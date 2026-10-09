/**
 * Better Auth's endpoints (/api/auth/*). Requests that change state run inside
 * an audit context naming the signed-in user (and the platform admin, while
 * impersonating), so the audit triggers on Better Auth's tables record who
 * did it. Better Auth itself checks the Origin (CSRF) and rate-limits per IP.
 */
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/app";
import { runWithAudit } from "@/lib/auth/audit-context";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  if (request.method === "GET") return runWithAudit({ actorId: null, requestId }, () => auth().handler(request));
  const s = await auth().api.getSession({ headers: request.headers }).catch(() => null);
  const session = s?.session as { impersonatedBy?: string | null; activeOrganizationId?: string | null } | undefined;
  const action = `auth.${new URL(request.url).pathname.replace(/^\/api\/auth\//, "").replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")}`;
  return runWithAudit(
    {
      actorId: s?.user.id ?? null,
      impersonatorId: session?.impersonatedBy ?? null,
      requestId,
      action,
      workspaceId: session?.activeOrganizationId ?? null,
    },
    () => auth().handler(request),
  );
}

export const GET = handle;
export const POST = handle;
