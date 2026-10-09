/**
 * Review decisions on an article awaiting review: approve, reject or request
 * changes. Callers check the permission (content:approve: owners, editors and
 * reviewers; never viewers) before calling. Approval is refused while the
 * lint fails or any claim is unverifiable (rule 8): a reviewer cannot wave
 * an unsourced claim through, they request changes instead.
 */
import { withWorkspace, type TenantContext } from "../db/tenant.ts";
import { addReview, createPlanned, getItem, saveVersion, setStatus } from "../data/content.ts";
import { notify } from "../data/workspaces.ts";
import { afterApproval, retryFrom } from "../pipeline/runner.ts";
import type { PipelineDeps } from "../pipeline/deps.ts";
import { REVIEWABLE } from "./status.ts";
import type { WorkspaceRole } from "../auth/permissions.ts";

export type Decision = "approved" | "rejected" | "changes_requested";

export class ReviewBlockedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`This article cannot be approved yet: ${reasons.join(" ")}`);
    this.name = "ReviewBlockedError";
  }
}

/** Why approval is not possible right now (empty: it is). */
export function approvalBlockers(item: { status: string; lint_passed: boolean | null; fact_check_passed: boolean | null; unverifiable_claims: number }): string[] {
  const out: string[] = [];
  if (!(REVIEWABLE as readonly string[]).includes(item.status)) out.push(`It is ${item.status.replace(/_/g, " ")}, not awaiting review.`);
  if (item.unverifiable_claims > 0) out.push(`${item.unverifiable_claims} claim${item.unverifiable_claims === 1 ? " is" : "s are"} unverifiable: each needs a primary source or must be removed.`);
  else if (item.fact_check_passed !== true) out.push("The fact-check has not passed for this version.");
  if (item.lint_passed !== true) out.push("Lint has failing rules.");
  return out;
}

export async function decideReview(deps: PipelineDeps, ctx: TenantContext, role: WorkspaceRole, itemId: string, decision: Decision, note: string): Promise<{ newItemId: string | null }> {
  const r = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action(`content.${decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "request_changes"}`);
    const item = await getItem(tx, itemId, { lock: true });
    if (decision === "approved") {
      const blockers = approvalBlockers(item);
      if (blockers.length) throw new ReviewBlockedError(blockers);
    } else if (!(REVIEWABLE as readonly string[]).includes(item.status)) {
      throw new ReviewBlockedError([`It is ${item.status.replace(/_/g, " ")}, not awaiting review.`]);
    }
    if (decision === "changes_requested" && !note.trim()) throw new ReviewBlockedError(["Say what should change."]);
    await addReview(tx, ctx.workspaceId, item.id, item.version, decision, note.trim(), ctx.actorId, role);
    await setStatus(tx, item.id, decision, decision === "approved" ? "Approved; goes out at its slot." : decision === "rejected" ? `Rejected: ${note.trim() || "no reason given"}` : `Changes requested: ${note.trim()}`);
    let newItemId: string | null = null;
    if (decision === "rejected") {
      if (item.current_run_id) await tx.exec("UPDATE pipeline_runs SET status = 'canceled', finished_at = now() WHERE id = $1", [item.current_run_id]);
      // the slot is still there: it gets a fresh item, written again when its lead window comes
      if (item.slot_at > deps.now()) newItemId = await createPlanned(tx, ctx.workspaceId, item.site_id, item.slot_at, item.schedule_slot_at, ctx.actorId);
    }
    if (decision !== "approved") {
      const editors = await tx.many<{ user_id: string }>("SELECT user_id FROM auth_member WHERE organization_id = $1 AND role IN ('owner', 'editor')", [ctx.workspaceId]);
      const ws = await tx.one<{ slug: string }>("SELECT slug FROM auth_organization WHERE id = $1", [ctx.workspaceId]);
      await notify(tx, ctx.workspaceId, editors.map((e) => e.user_id).filter((u) => u !== ctx.actorId), {
        kind: "review",
        title: `${decision === "rejected" ? "Rejected" : "Changes requested"}: ${item.title || item.primary_keyword || "an article"}`,
        body: note.trim().slice(0, 300),
        href: `/w/${ws.slug}/content/${item.id}`,
      });
    }
    return { newItemId };
  });
  if (decision === "approved") await afterApproval(deps, ctx, itemId);
  return r;
}

/**
 * An editor's edit: a new version, then the free lint again. The body may
 * now carry new claims, so the fact-check is marked stale and must run again
 * (submitForReview does that) before anyone can approve.
 */
export async function saveEdit(deps: PipelineDeps, ctx: TenantContext, itemId: string, v: { title: string; description: string; bodyMd: string; cover: Record<string, unknown> }, note: string | null): Promise<number> {
  return withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("content.edit");
    const item = await getItem(tx, itemId, { lock: true });
    if (!["awaiting_review", "changes_requested", "approved", "failed"].includes(item.status)) throw new ReviewBlockedError([`It is ${item.status.replace(/_/g, " ")}: it cannot be edited now.`]);
    const bodyChanged = item.body_md.trim() !== v.bodyMd.trim();
    const version = await saveVersion(tx, ctx.workspaceId, itemId, v, "editor", ctx.actorId, note);
    if (bodyChanged) await tx.exec("UPDATE content_items SET fact_check_passed = NULL WHERE id = $1", [itemId]);
    // an approved article that is edited goes back to review
    if (item.status === "approved") await setStatus(tx, itemId, "awaiting_review", "Edited after approval: review again.");
    return version;
  });
}

/** Sends an edited article back through the fact-check, the lint and the review gate. */
export async function submitForReview(deps: PipelineDeps, ctx: TenantContext, itemId: string): Promise<void> {
  const item = await withWorkspace(deps.db, ctx, (tx) => getItem(tx, itemId), { readOnly: true });
  if (!item.current_run_id) throw new ReviewBlockedError(["This article has no pipeline run to resume."]);
  await retryFrom(deps, ctx, item.current_run_id, item.fact_check_passed === true ? "lint" : "factcheck");
}
