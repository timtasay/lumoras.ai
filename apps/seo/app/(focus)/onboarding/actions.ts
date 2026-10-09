"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, auditFor, requireViewer } from "@/lib/auth/app";
import { runWithAudit } from "@/lib/auth/audit-context";
import { toActionError, formObject, type ActionState } from "@/lib/actions";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { slugTaken } from "@/lib/data/workspaces";
import { hit, LIMITS } from "@/lib/rate-limit";
import { workspaceInput } from "@/lib/validation";

/** Step 1: creates the workspace (a Better Auth organization; the workspaces row follows by trigger, audited). */
export async function createWorkspaceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const v = await requireViewer("/onboarding");
    const input = workspaceInput.parse(formObject(fd));
    if (await slugTaken(pool(), input.slug)) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { slug: "That address is taken. Try another." }, at: Date.now() };
    await hit(pool(), LIMITS.workspacePerUser, v.user.id, webEnv().rateLimitScale);
    const h = await headers();
    await runWithAudit(auditFor(v, "workspace.create"), () => auth().api.createOrganization({ body: { name: input.name, slug: input.slug }, headers: h }));
    slug = input.slug;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/w/${slug}/onboarding/site`);
}
