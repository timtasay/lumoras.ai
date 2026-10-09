"use server";
/** Actions shared by every signed-in page. */
import { requireViewer } from "@/lib/auth/app";
import { pool } from "@/lib/db/pool";
import { withWorkspace } from "@/lib/db/tenant";
import { listMemberships, markNotificationsRead } from "@/lib/data/workspaces";

export async function markAllNotificationsRead(): Promise<void> {
  const v = await requireViewer();
  for (const m of await listMemberships(pool(), v.user.id)) {
    await withWorkspace(pool(), { workspaceId: m.id, actorId: v.user.id, impersonatorId: v.impersonator?.id ?? null, requestId: v.requestId }, async (tx) => {
      await tx.action("notification.read");
      await markNotificationsRead(tx, v.user.id);
    });
  }
}
