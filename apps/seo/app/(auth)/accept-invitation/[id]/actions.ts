"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, auditFor, requireViewer } from "@/lib/auth/app";
import { runWithAudit } from "@/lib/auth/audit-context";
import { pool } from "@/lib/db/pool";
import { withWorkspace, isUuid } from "@/lib/db/tenant";
import { getInvitation, listMembers, notify } from "@/lib/data/workspaces";
import { toActionError, type ActionState } from "@/lib/actions";
import { ROLE_LABEL } from "@/lib/auth/permissions";

/** Accepts (or declines) an invitation addressed to the signed-in user's email. */
export async function respondToInvitation(id: string, accept: boolean): Promise<ActionState> {
  try {
    if (!isUuid(id)) return { ok: false, error: "This invitation link is not valid." };
    const viewer = await requireViewer(`/accept-invitation/${id}`);
    const inv = await getInvitation(pool(), id);
    if (!inv || inv.status !== "pending" || inv.expires_at < new Date()) return { ok: false, error: "This invitation is no longer open. Ask for a new one." };
    if (inv.email !== viewer.user.email.toLowerCase()) return { ok: false, error: `This invitation is for ${inv.email}. Sign in with that address to accept it.` };
    const h = await headers();
    const wsId = (await pool().query<{ organization_id: string }>("SELECT organization_id FROM auth_invitation WHERE id = $1", [id])).rows[0].organization_id;
    if (!accept) {
      await runWithAudit(auditFor(viewer, "invitation.reject", wsId), () => auth().api.rejectInvitation({ body: { invitationId: id }, headers: h }));
      return { ok: true, message: "Invitation declined." };
    }
    await runWithAudit(auditFor(viewer, "invitation.accept", wsId), () => auth().api.acceptInvitation({ body: { invitationId: id }, headers: h }));
    // tell the owners (in-app notification, written in the workspace's own scope)
    const owners = (await listMembers(pool(), wsId)).filter((m) => m.role === "owner" && m.user_id !== viewer.user.id).map((m) => m.user_id);
    await withWorkspace(pool(), { workspaceId: wsId, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId }, async (tx) => {
      await tx.action("notification.create");
      await notify(tx, wsId, owners, { kind: "member.joined", title: `${viewer.user.name || viewer.user.email} joined ${inv.workspace_name}`, body: `As ${ROLE_LABEL[inv.role].toLowerCase()}.`, href: `/w/${inv.workspace_slug}/settings` });
    });
  } catch (e) {
    return toActionError(e);
  }
  const inv = await getInvitation(pool(), id);
  redirect(`/w/${inv!.workspace_slug}`);
}
