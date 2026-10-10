"use server";
/**
 * Measurement actions. "Run now" (editors and owners: measure:run) only
 * queues work for the worker, which prices paid work first and refuses it
 * below the reserve exactly as a scheduled run would. Audit tasks (task:manage)
 * and cadence settings (site:update) write inside one audited transaction.
 * Next.js checks the Origin of every server action (CSRF).
 */
import { revalidatePath } from "next/cache";
import { formObject, inWorkspace, toActionError, type ActionState } from "@/lib/actions";
import { webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { isUuid, NotFoundError } from "@/lib/db/tenant";
import { getSite } from "@/lib/data/sites";
import { assignIssue, createFixTask, setTaskStatus } from "@/lib/measure/audit";
import { RUN_LABEL, type RunKind } from "@/lib/measure/runs";
import { queueMeasurement } from "@/lib/measure/web";
import { hit, LIMITS } from "@/lib/rate-limit";
import { measureSettingsInput } from "@/lib/validation";

const KINDS: RunKind[] = ["rank", "audit", "backlinks", "gsc", "ga4", "inspect"];
const ok = (message: string, data?: Record<string, unknown>): ActionState => ({ ok: true, message, at: Date.now(), data });

function ids(...v: string[]) {
  for (const x of v) if (!isUuid(x)) throw new NotFoundError("record");
}

export async function runMeasurementNowAction(slug: string, siteId: string, kind: string): Promise<ActionState> {
  try {
    ids(siteId);
    if (!(KINDS as string[]).includes(kind)) throw new NotFoundError("measurement");
    const k = kind as RunKind;
    const ws = await inWorkspace(slug, "measure:run", "measure.queue", async (tx, a) => {
      await getSite(tx, siteId);
      await tx.event("measure.queued", "sites", siteId, { kind: k });
      return a.workspace.id;
    });
    await hit(pool(), LIMITS.measurePerSite, siteId, webEnv().rateLimitScale);
    await queueMeasurement(ws, siteId, k, "manual");
    revalidatePath(`/w/${slug}/sites/${siteId}`, "layout");
    const paid = k === "rank" || k === "audit" || k === "backlinks";
    return ok(`${RUN_LABEL[k]} queued. ${paid ? "It is priced first and runs only if the budget allows it above the reserve." : "It is free and runs in a moment."}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function fixIssueAction(slug: string, siteId: string, issueId: string): Promise<ActionState> {
  try {
    ids(siteId, issueId);
    const r = await inWorkspace(slug, "task:manage", "task.fix", (tx, a) => createFixTask(tx, a.workspace.id, issueId, a.ctx.actorId));
    revalidatePath(`/w/${slug}/sites/${siteId}/audit`);
    return ok(r.created ? "Task created." : "This issue already has an open task.", { taskId: r.taskId, created: r.created });
  } catch (e) {
    return toActionError(e);
  }
}

export async function assignIssueAction(slug: string, siteId: string, issueId: string, userId: string): Promise<ActionState> {
  try {
    ids(siteId, issueId);
    if (userId && !isUuid(userId)) throw new NotFoundError("member");
    await inWorkspace(slug, "task:manage", "task.assign", (tx, a) => assignIssue(tx, a.workspace.id, issueId, userId || null));
    revalidatePath(`/w/${slug}/sites/${siteId}/audit`);
    return ok(userId ? "Assigned." : "Unassigned.");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Only members")) return { ok: false, error: e.message, at: Date.now() };
    return toActionError(e);
  }
}

export async function setTaskStatusAction(slug: string, siteId: string, taskId: string, status: string): Promise<ActionState> {
  try {
    ids(siteId, taskId);
    if (status !== "open" && status !== "in_progress" && status !== "done") throw new NotFoundError("status");
    await inWorkspace(slug, "task:manage", "task.status", (tx) => setTaskStatus(tx, taskId, status, new Date()));
    revalidatePath(`/w/${slug}/sites/${siteId}/audit`);
    return ok(status === "done" ? "Marked done." : status === "in_progress" ? "Marked in progress." : "Reopened.");
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveMeasureSettingsAction(slug: string, siteId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    ids(siteId);
    const v = measureSettingsInput.parse(formObject(fd));
    await inWorkspace(slug, "site:update", "site.measurement", (tx) =>
      tx.one(
        `UPDATE sites SET rank_cadence = $2, rank_device = $3, rank_depth = $4, rank_max_keywords = $5, audit_cadence = $6, audit_max_pages = $7,
           backlinks_cadence = $8, search_sync = $9, inspect_daily_cap = $10 WHERE id = $1 RETURNING id`,
        [siteId, v.rankCadence, v.rankDevice, v.rankDepth, v.rankMaxKeywords, v.auditCadence, v.auditMaxPages, v.backlinksCadence, v.searchSync, v.inspectDailyCap],
        "site",
      ),
    );
    revalidatePath(`/w/${slug}/sites/${siteId}`, "layout");
    return ok("Measurement settings saved.");
  } catch (e) {
    return toActionError(e);
  }
}
