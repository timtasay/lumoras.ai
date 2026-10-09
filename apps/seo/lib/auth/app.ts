/**
 * Auth inside the Next.js app: the Better Auth instance, and the per-request
 * questions every page and action asks: who is signed in, are they a platform
 * admin, are they impersonating, and which role do they hold in this workspace.
 * Results are cached per request (React cache).
 */
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createAuth, type Auth } from "./server.ts";
import { pool } from "../db/pool.ts";
import { webEnv } from "../config.ts";
import { sendEmail } from "../email.ts";
import { membershipBySlug, type Membership } from "../data/workspaces.ts";
import type { TenantContext } from "../db/tenant.ts";
import type { AuditContext } from "./audit-context.ts";
import { ROLE_LABEL, type WorkspaceRole } from "./permissions.ts";

const g = globalThis as { __seoAuth?: Auth };

export function auth(): Auth {
  if (!g.__seoAuth) {
    const env = webEnv();
    g.__seoAuth = createAuth({
      pool: pool(),
      baseUrl: env.baseUrl,
      secret: env.authSecret,
      secure: env.secure,
      google: env.google,
      rateLimitScale: env.rateLimitScale,
      mail: {
        magicLink: (to, url) =>
          sendEmail({
            to,
            kind: "magic-link",
            link: url,
            subject: "Your Lumoras Growth sign-in link",
            text: `Sign in to Lumoras Growth:\n\n${url}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
          }),
        invitation: (to, url, workspace, inviter, role) =>
          sendEmail({
            to,
            kind: "invitation",
            link: url,
            subject: `${inviter} invited you to ${workspace} on Lumoras Growth`,
            text: `${inviter} invited you to the ${workspace} workspace on Lumoras Growth as ${ROLE_LABEL[role as WorkspaceRole] ?? role}.\n\nAccept the invitation:\n\n${url}\n\nThe invitation expires in 7 days. Sign in with this email address (${to}) to accept it.`,
          }),
      },
    });
  }
  return g.__seoAuth;
}

export type Viewer = {
  user: { id: string; name: string; email: string; image: string | null };
  sessionId: string;
  isPlatformAdmin: boolean;
  /** Set while a platform admin is impersonating this user. */
  impersonator: { id: string; email: string; name: string } | null;
  activeWorkspaceId: string | null;
  requestId: string;
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const h = await headers();
  const s = await auth().api.getSession({ headers: h });
  if (!s) return null;
  const session = s.session as typeof s.session & { impersonatedBy?: string | null; activeOrganizationId?: string | null };
  const user = s.user as typeof s.user & { role?: string | null };
  let impersonator: Viewer["impersonator"] = null;
  if (session.impersonatedBy) {
    const r = await pool().query<{ id: string; email: string; name: string }>("SELECT id, email, name FROM auth_user WHERE id = $1", [session.impersonatedBy]);
    impersonator = r.rows[0] ?? null;
  }
  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    sessionId: session.id,
    // while impersonating, platform powers are off: you see exactly what the member sees
    isPlatformAdmin: user.role === "admin" && !impersonator,
    impersonator,
    activeWorkspaceId: session.activeOrganizationId ?? null,
    requestId: h.get("x-request-id") ?? randomUUID(),
  };
});

/** The signed-in viewer, or a redirect to sign-in. */
export async function requireViewer(next?: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return v;
}

export async function requirePlatformAdmin(): Promise<Viewer> {
  const v = await requireViewer("/agency");
  if (!v.isPlatformAdmin) notFound();
  return v;
}

export type WorkspaceAccess = { viewer: Viewer; workspace: Membership; role: WorkspaceRole; ctx: TenantContext };

/**
 * The viewer's membership in the workspace with this slug, or a 404 (the same
 * answer whether the workspace does not exist or belongs to someone else).
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceAccess> => {
  const viewer = await requireViewer(`/w/${slug}`);
  const m = await membershipBySlug(pool(), viewer.user.id, slug);
  if (!m) notFound();
  return {
    viewer,
    workspace: m,
    role: m.role,
    ctx: { workspaceId: m.id, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId },
  };
});

/** Audit context for Better Auth calls made on the viewer's behalf. */
export function auditFor(viewer: Viewer, action: string, workspaceId?: string | null): AuditContext {
  return { actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId, action, workspaceId: workspaceId ?? null };
}
