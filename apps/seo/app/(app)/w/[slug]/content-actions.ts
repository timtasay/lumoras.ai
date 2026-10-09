"use server";
/**
 * Content actions: the calendar (reschedule, skip, run now), the pipeline
 * (retry or resume from a step), the editor (save, submit for review,
 * restore a version, comment) and the review gate (approve, reject, request
 * changes). Each: membership, the permission map, validation, then the
 * audited workspace transaction. Model work never runs here: starting or
 * retrying a run only queues it for the worker.
 */
import { revalidatePath } from "next/cache";
import { inWorkspace, toActionError, formObject, type ActionState } from "@/lib/actions";
import { requireWorkspace } from "@/lib/auth/app";
import { assertCan } from "@/lib/auth/permissions";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { isUuid, withWorkspace } from "@/lib/db/tenant";
import { addComment, getItem, listVersions, reschedule, setStatus } from "@/lib/data/content";
import { getSiteSettings } from "@/lib/data/sites";
import { approvalBlockers, decideReview, ReviewBlockedError, saveEdit, submitForReview, type Decision } from "@/lib/content/review";
import { canScheduleAt, localParts, zonedToUtc } from "@/lib/content/schedule";
import { TransitionError } from "@/lib/content/status";
import { enqueue, webPipelineDeps } from "@/lib/jobs/client";
import { QUEUES, StepError } from "@/lib/pipeline/deps";
import { retryFrom, startRun } from "@/lib/pipeline/runner";
import { runLint } from "@/lib/pipeline/run-steps";
import { isStepKey } from "@/lib/data/content";
import { hit, LIMITS } from "@/lib/rate-limit";
import { editInput } from "@/lib/validation";

const fail = (error: string): ActionState => ({ ok: false, error, at: Date.now() });

function known(e: unknown): ActionState | null {
  if (e instanceof ReviewBlockedError || e instanceof TransitionError || e instanceof StepError) return fail(e.message);
  return null;
}

const refresh = (slug: string) => revalidatePath(`/w/${slug}`, "layout");

// ---------------------------------------------------------------- calendar
/** Moves an article to another day, keeping its local time. Never into the past unless the site allows back-dating. */
export async function rescheduleAction(slug: string, itemId: string, date: string): Promise<ActionState> {
  try {
    if (!isUuid(itemId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Pick a day on the calendar.");
    const r = await inWorkspace(slug, "content:schedule", "content.reschedule", async (tx) => {
      const item = await getItem(tx, itemId, { lock: true });
      if (["published", "publishing", "rejected", "unpublished"].includes(item.status)) return { error: "Published articles keep their date." };
      const site = await getSiteSettings(tx, item.site_id);
      const at = zonedToUtc(date, localParts(item.slot_at, site.timezone).time, site.timezone);
      const ok = canScheduleAt(at, new Date(), site.allow_backdating);
      if (!ok.ok) return { error: ok.reason };
      await reschedule(tx, itemId, at);
      return { item, site, at };
    });
    if ("error" in r) return fail(r.error!);
    const a = await requireWorkspace(slug);
    // links are checked against the inventory as of the NEW date (rule 9)
    if (r.item.body_md) await runLint(webPipelineDeps(), a.ctx, r.site, itemId, { checkLinks: false });
    if (r.item.status === "approved" && r.item.current_run_id) await enqueue(QUEUES.run, { workspaceId: a.workspace.id, runId: r.item.current_run_id }, { startAfter: r.at, singletonKey: `run:${r.item.current_run_id}:${r.at.getTime()}` });
    refresh(slug);
    return { ok: true, message: `Moved to ${date}.`, at: Date.now(), data: { slotAt: r.at.toISOString() } };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

export async function skipSlotAction(slug: string, itemId: string): Promise<ActionState> {
  try {
    await inWorkspace(slug, "content:schedule", "content.skip", (tx) => setStatus(tx, itemId, "skipped", "Skipped by a person."));
    refresh(slug);
    return { ok: true, message: "Slot skipped.", at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

/** Starts writing now (instead of waiting for the lead window). Spends model budget, so: pipeline:run. */
export async function runNowAction(slug: string, itemId: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "pipeline:run");
    if (!isUuid(itemId)) return fail("Unknown article.");
    await hit(pool(), LIMITS.pipelinePerUser, a.viewer.user.id, webEnv().rateLimitScale);
    const runId = await startRun(webPipelineDeps(), a.ctx, itemId, "manual");
    refresh(slug);
    return { ok: true, message: "Writing has started.", at: Date.now(), data: { runId } };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

// ---------------------------------------------------------------- pipeline
export async function retryStepAction(slug: string, runId: string, step: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "pipeline:run");
    if (!isUuid(runId) || !isStepKey(step)) return fail("Unknown step.");
    await hit(pool(), LIMITS.pipelinePerUser, a.viewer.user.id, webEnv().rateLimitScale);
    await retryFrom(webPipelineDeps(), a.ctx, runId, step);
    refresh(slug);
    return { ok: true, message: `Running again from ${step}.`, at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

// ---------------------------------------------------------------- review gate
export async function reviewAction(slug: string, itemId: string, decision: Decision, note: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "content:approve");
    if (!isUuid(itemId) || !["approved", "rejected", "changes_requested"].includes(decision)) return fail("Unknown decision.");
    await decideReview(webPipelineDeps(), a.ctx, a.role, itemId, decision, String(note ?? "").slice(0, 4000));
    refresh(slug);
    return { ok: true, message: decision === "approved" ? "Approved. It goes out at its slot." : decision === "rejected" ? "Rejected. The slot will be written again." : "Changes requested. The editors are notified.", at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

// ---------------------------------------------------------------- editor
export async function saveEditAction(slug: string, itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "content:edit");
    if (!isUuid(itemId)) return fail("Unknown article.");
    const input = editInput.parse(formObject(fd));
    const chips = input.coverChips.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 6);
    const deps = webPipelineDeps();
    const version = await saveEdit(deps, a.ctx, itemId, { title: input.title, description: input.description, bodyMd: input.bodyMd, cover: { kind: input.coverKind, chips } }, input.note || null);
    const site = await withWorkspace(pool(), a.ctx, async (tx) => getSiteSettings(tx, (await getItem(tx, itemId)).site_id), { readOnly: true });
    await runLint(deps, a.ctx, site, itemId);
    refresh(slug);
    return { ok: true, message: `Saved as version ${version}. Lint ran again; the fact-check runs when you submit.`, at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

export async function submitForReviewAction(slug: string, itemId: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "content:edit");
    assertCan(a.role, "pipeline:run");
    await submitForReview(webPipelineDeps(), a.ctx, itemId);
    refresh(slug);
    return { ok: true, message: "Sent through the fact-check and lint, then back to review.", at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

export async function restoreVersionAction(slug: string, itemId: string, version: number): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "content:edit");
    const v = await withWorkspace(pool(), a.ctx, async (tx) => (await listVersions(tx, itemId)).find((x) => x.version === version) ?? null, { readOnly: true });
    if (!v) return fail("That version no longer exists.");
    const deps = webPipelineDeps();
    const n = await saveEdit(deps, a.ctx, itemId, { title: v.title, description: v.description, bodyMd: v.body_md, cover: v.cover }, `Restored version ${version}`);
    const site = await withWorkspace(pool(), a.ctx, async (tx) => getSiteSettings(tx, (await getItem(tx, itemId)).site_id), { readOnly: true });
    await runLint(deps, a.ctx, site, itemId);
    refresh(slug);
    return { ok: true, message: `Version ${version} restored as version ${n}.`, at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

export async function commentAction(slug: string, itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const body = String(fd.get("body") ?? "").trim();
    if (!body) return { ok: false, error: "Write a comment first.", fieldErrors: { body: "Write a comment first." }, at: Date.now() };
    if (body.length > 4000) return { ok: false, error: "At most 4,000 characters.", fieldErrors: { body: "At most 4,000 characters." }, at: Date.now() };
    await inWorkspace(slug, "comment:create", "content.comment", async (tx, a) => {
      const item = await getItem(tx, itemId);
      await addComment(tx, a.workspace.id, itemId, a.viewer.user.id, body, item.version);
    });
    refresh(slug);
    return { ok: true, message: "Comment added.", at: Date.now() };
  } catch (e) {
    return known(e) ?? toActionError(e);
  }
}

export async function approvalStateAction(slug: string, itemId: string): Promise<string[]> {
  const a = await requireWorkspace(slug);
  return withWorkspace(pool(), a.ctx, async (tx) => approvalBlockers(await getItem(tx, itemId)), { readOnly: true });
}
