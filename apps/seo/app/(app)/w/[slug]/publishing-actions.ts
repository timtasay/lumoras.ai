"use server";
/**
 * Site schedule and publishing settings: the schedule, lead days, generation
 * mode, review mode (autopilot only with an explicit acknowledgement),
 * back-dating (off by default, on only with an acknowledgement), runway
 * threshold; which connection publishes; the connector's live Test; the
 * public feed. Onboarding steps 7 and 8 use the same actions.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { inWorkspace, toActionError, formObject, type ActionState } from "@/lib/actions";
import { requireWorkspace } from "@/lib/auth/app";
import { assertCan } from "@/lib/auth/permissions";
import { keyring, webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { isUuid, withWorkspace } from "@/lib/db/tenant";
import { setConnectionStatus } from "@/lib/data/connections";
import { getSiteSettings } from "@/lib/data/sites";
import { advanceOnboarding } from "@/lib/data/workspaces";
import { slotsBetween } from "@/lib/content/schedule";
import { enqueue, webPipelineDeps } from "@/lib/jobs/client";
import { QUEUES } from "@/lib/pipeline/deps";
import { createPublisher, publisherFor } from "@/lib/publishers/registry";
import { PublishError } from "@/lib/publishers/types";
import { hit, LIMITS } from "@/lib/rate-limit";
import { scheduleInput } from "@/lib/validation";

const fail = (error: string): ActionState => ({ ok: false, error, at: Date.now() });

export async function saveScheduleAction(slug: string, siteId: string, onboarding: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    if (!isUuid(siteId)) return fail("Unknown site.");
    const s = scheduleInput.parse(formObject(fd));
    const r = await inWorkspace(slug, "site:update", "site.schedule", async (tx, a) => {
      const before = await getSiteSettings(tx, siteId);
      await tx.exec(
        `UPDATE sites SET schedule_days = $2, schedule_time = $3, schedule_active = $4, generation_mode = $5, lead_days = $6, batch_size = $7, horizon_days = $8,
           runway_threshold_days = $9, allow_backdating = $10,
           autopilot_acknowledged_at = CASE WHEN $11 = 'autopilot' AND review_mode <> 'autopilot' THEN now() ELSE autopilot_acknowledged_at END,
           autopilot_acknowledged_by = CASE WHEN $11 = 'autopilot' AND review_mode <> 'autopilot' THEN $12 ELSE autopilot_acknowledged_by END,
           review_mode = $11
         WHERE id = $1`,
        [siteId, [...new Set(s.days)].sort(), s.time, s.active, s.generationMode, s.leadDays, s.batchSize, s.horizonDays, s.runwayThreshold, s.allowBackdating, s.reviewMode, a.viewer.user.id],
      );
      if (s.reviewMode === "autopilot" && before.review_mode !== "autopilot") await tx.event("site.autopilot_on", "sites", siteId, { acknowledged: true });
      if (s.allowBackdating && !before.allow_backdating) await tx.event("site.backdating_on", "sites", siteId, { acknowledged: true });
      // empty future slots that the new schedule no longer has are removed (written articles keep their dates)
      const now = new Date();
      const keep = new Set(slotsBetween({ days: s.days, time: s.time, timezone: before.timezone }, now, new Date(now.getTime() + s.horizonDays * 86_400_000)).map((d) => d.toISOString()));
      const planned = await tx.many<{ id: string; schedule_slot_at: Date }>("SELECT id, schedule_slot_at FROM content_items WHERE site_id = $1 AND status = 'planned' AND schedule_slot_at IS NOT NULL AND slot_at > now()", [siteId]);
      const drop = planned.filter((p) => !s.active || !keep.has(p.schedule_slot_at.toISOString())).map((p) => p.id);
      if (drop.length) await tx.exec("DELETE FROM content_items WHERE id = ANY($1) AND status = 'planned'", [drop]);
      if (onboarding) await advanceOnboarding(tx, "done");
      return { workspaceId: a.workspace.id, dropped: drop.length };
    });
    await enqueue(QUEUES.plan, { workspaceId: r.workspaceId, siteId }, { singletonKey: `plan:${siteId}` }).catch(() => {});
    revalidatePath(`/w/${slug}`, "layout");
    if (onboarding) redirect(`/w/${slug}/onboarding/done`);
    return { ok: true, message: s.active ? "Schedule saved. Slots are laid out within a minute." : "Saved. The schedule is off: nothing new is written.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setPublishConnectionAction(slug: string, siteId: string, connectionId: string | null): Promise<ActionState> {
  try {
    if (!isUuid(siteId) || (connectionId !== null && !isUuid(connectionId))) return fail("Unknown connection.");
    await inWorkspace(slug, "connection:manage", "site.publish_connection", async (tx) => {
      if (connectionId) {
        const c = await tx.one<{ kind: string }>("SELECT kind FROM connections WHERE id = $1 AND site_id = $2", [connectionId, siteId], "connection");
        if (c.kind !== "git" && c.kind !== "webhook") throw new PublishError("Only Git and webhook connections publish in this phase.");
      }
      await tx.exec("UPDATE sites SET publish_connection_id = $2 WHERE id = $1", [siteId, connectionId]);
    });
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: connectionId ? "Articles for this site publish through this connection." : "No publishing connection: nothing will publish.", at: Date.now() };
  } catch (e) {
    if (e instanceof PublishError) return fail(e.message);
    return toActionError(e);
  }
}

/** The live Test: checks the repository, token, branch and folder (Git) or sends a signed ping (webhook). Changes nothing on the client's side. */
export async function testPublishConnectionAction(slug: string, siteId: string, connectionId: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "connection:manage");
    if (!isUuid(siteId) || !isUuid(connectionId)) return fail("Unknown connection.");
    await hit(pool(), LIMITS.publishTestPerSite, siteId, webEnv().rateLimitScale);
    const deps = webPipelineDeps();
    const { publisher, site } = await withWorkspace(
      pool(),
      a.ctx,
      async (tx) => {
        const site = await getSiteSettings(tx, siteId);
        return { site, ...(await publisherFor(tx, keyring(), a.workspace.id, connectionId, { domain: site.domain }, deps.outbound, createPublisher)) };
      },
      { readOnly: true },
    );
    const v = await publisher.validate();
    await withWorkspace(pool(), a.ctx, async (tx) => {
      await tx.action("connection.test");
      await setConnectionStatus(tx, connectionId, v.ok ? "ok" : "error", v.ok ? v.detail : v.detail);
    });
    revalidatePath(`/w/${slug}`, "layout");
    void site;
    return v.ok ? { ok: true, message: v.detail, at: Date.now(), data: { checks: v.checks } } : { ok: false, error: v.detail, at: Date.now(), data: { checks: v.checks } };
  } catch (e) {
    if (e instanceof PublishError) return fail(e.message);
    return toActionError(e);
  }
}

export async function setFeedAction(slug: string, siteId: string, enabled: boolean): Promise<ActionState> {
  try {
    await inWorkspace(slug, "site:update", "site.feed", (tx) => tx.exec("UPDATE sites SET feed_enabled = $2 WHERE id = $1", [siteId, enabled]));
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: enabled ? "The feed is public at its address." : "The feed is off.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

/** Onboarding step 7: the publishing connector is chosen (or skipped). */
export async function finishPublishingStep(slug: string): Promise<ActionState> {
  try {
    await inWorkspace(slug, "site:update", "workspace.onboarding", (tx) => advanceOnboarding(tx, "schedule"));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/onboarding/schedule`);
}
