"use server";
/**
 * Platform-admin actions. Reads go through the audited platform_* SQL
 * functions; acting inside a workspace means impersonating one of its members
 * (Better Auth admin plugin), recorded as impersonation.start/stop with the
 * workspace, the admin and the member.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, auditFor, requirePlatformAdmin } from "@/lib/auth/app";
import { runWithAudit } from "@/lib/auth/audit-context";
import { toActionError, type ActionState } from "@/lib/actions";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { isUuid, withActor } from "@/lib/db/tenant";
import { platformMembers } from "@/lib/data/workspaces";
import { hit, LIMITS } from "@/lib/rate-limit";

export type ImpersonationTarget = { userId: string; name: string; email: string; role: string; isAdmin: boolean };

export async function membersForImpersonation(workspaceId: string): Promise<ImpersonationTarget[]> {
  const v = await requirePlatformAdmin();
  if (!isUuid(workspaceId)) return [];
  const rows = await withActor(pool(), { actorId: v.user.id, requestId: v.requestId }, (tx) => platformMembers(tx, workspaceId));
  return rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, isAdmin: r.is_platform_admin }));
}

export async function impersonateAction(workspaceId: string, userId: string): Promise<ActionState> {
  let slug: string;
  try {
    const v = await requirePlatformAdmin();
    if (!isUuid(workspaceId) || !isUuid(userId)) return { ok: false, error: "Unknown workspace or member." };
    const members = await withActor(pool(), { actorId: v.user.id, requestId: v.requestId }, (tx) => platformMembers(tx, workspaceId));
    const target = members.find((m) => m.user_id === userId);
    if (!target) return { ok: false, error: "That person is not a member of this workspace." };
    if (target.is_platform_admin) return { ok: false, error: "Platform admins cannot be impersonated." };
    await hit(pool(), LIMITS.impersonatePerAdmin, v.user.id, webEnv().rateLimitScale);
    const h = await headers();
    await runWithAudit(auditFor(v, "impersonation.start", workspaceId), () => auth().api.impersonateUser({ body: { userId }, headers: h }));
    slug = (await pool().query<{ slug: string }>("SELECT slug FROM auth_organization WHERE id = $1", [workspaceId])).rows[0].slug;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/w/${slug}`);
}
