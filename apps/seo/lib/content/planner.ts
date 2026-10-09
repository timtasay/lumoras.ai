/**
 * The site plan job (every few minutes per site, and after anything that
 * changes the calendar):
 *
 *   1. lay out empty slots from the site's schedule up to its horizon (never
 *      in the past: rule 3), one item per schedule slot;
 *   2. wake rolling generation for slots inside their lead window (rule 2;
 *      batch mode: the next N slots), if the pipeline can run at all;
 *   3. skip empty slots whose time has passed (an article written now would
 *      carry today's date, not the slot's, so the slot is simply missed and
 *      the runway says so);
 *   4. release approved articles whose slot has come (publish step);
 *   5. recompute the runway and alert when it is short (rule 1).
 */
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { createPlanned, setStatus, topicSupply, TOPICS_PER_SEED } from "../data/content.ts";
import { getSiteSettings, listAuthors, type SiteSettings } from "../data/sites.ts";
import { notify } from "../data/workspaces.ts";
import { readBudgetState } from "../metering/metered.ts";
import { periodOf } from "../providers/operations.ts";
import { QUEUES, type PipelineDeps } from "../pipeline/deps.ts";
import { startRun } from "../pipeline/runner.ts";
import { computeRunway, shouldAlert, type Runway, type RunwaySlot } from "./runway.ts";
import { generationDue, localParts, slotsBetween } from "./schedule.ts";
import type { ContentStatus } from "./status.ts";

export type PlanResult = { created: number; started: number; skipped: number; released: number; runway: Runway; alerted: boolean; blockedReason: string | null };

/** Why rolling generation cannot run for this site right now (null: it can). */
export async function generationBlocker(tx: Tx, site: SiteSettings, now: Date): Promise<string | null> {
  if (site.status !== "active") return `The site is ${site.status}.`;
  if (!site.schedule_active) return "The schedule is off.";
  if (!(await listAuthors(tx, site.id)).length) return "No author is configured (bylines must be real people).";
  if (!site.publish_connection_id) return "No publishing connection is set.";
  const conn = await tx.maybe<{ status: string; label: string }>("SELECT status, label FROM connections WHERE id = $1", [site.publish_connection_id]);
  if (!conn) return "The publishing connection was removed.";
  if (conn.status === "error") return `The publishing connection (${conn.label}) is failing its test.`;
  const llm = await readBudgetState(tx, "llm_tokens", periodOf(now));
  if (llm.unset) return "No model-usage budget is set for this workspace.";
  if (llm.spendable <= 0) return "The workspace is at its model-usage reserve for the month.";
  return null;
}

export async function siteRunway(tx: Tx, site: SiteSettings, now: Date): Promise<{ runway: Runway; blockedReason: string | null }> {
  const today = localParts(now, site.timezone).date;
  const rows = await tx.many<{ id: string; slot_at: Date; status: ContentStatus }>(
    "SELECT id, slot_at, status FROM content_items WHERE site_id = $1 AND slot_at >= $2 AND status NOT IN ('rejected', 'skipped', 'unpublished') ORDER BY slot_at",
    [site.id, new Date(now.getTime() - 36 * 3_600_000)],
  );
  const blockedReason = await generationBlocker(tx, site, now);
  const supply = await topicSupply(tx, site.id);
  const slots: RunwaySlot[] = rows.map((r) => {
    const date = localParts(r.slot_at, site.timezone).date;
    const past = r.slot_at < now;
    const coverage =
      r.status === "approved" || r.status === "publishing" || r.status === "published"
        ? "ready"
        : r.status === "awaiting_review"
          ? past
            ? "blocked"
            : "review"
          : r.status === "failed" || r.status === "changes_requested"
            ? past
              ? "blocked"
              : "pending"
            : "pending";
    return { date, coverage, itemId: r.id };
  });
  // rolling slots past the laid-out horizon would also be covered, but the horizon bounds the claim
  const runway = computeRunway({ today, slots, blockedReason, topicSupply: supply.seeds * TOPICS_PER_SEED + supply.ideas, thresholdDays: site.runway_threshold_days });
  return { runway, blockedReason };
}

export async function planSite(deps: PipelineDeps, ctx: TenantContext, siteId: string): Promise<PlanResult> {
  const now = deps.now();
  const plan = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("schedule.plan");
    const site = await getSiteSettings(tx, siteId);
    let created = 0, skipped = 0;
    if (site.schedule_active && site.status === "active") {
      const slots = slotsBetween({ days: site.schedule_days, time: site.schedule_time, timezone: site.timezone }, now, new Date(now.getTime() + site.horizon_days * 86_400_000));
      for (const at of slots) if (await createPlanned(tx, ctx.workspaceId, site.id, at, at, ctx.actorId)) created++;
    }
    // empty slots whose time passed are missed, not back-dated
    const missed = await tx.many<{ id: string }>("SELECT id FROM content_items WHERE site_id = $1 AND status = 'planned' AND slot_at < $2", [site.id, now]);
    for (const m of missed) {
      await setStatus(tx, m.id, "skipped", "The slot passed before an article was written.");
      skipped++;
    }
    const blocked = await generationBlocker(tx, site, now);
    let due: { id: string }[] = [];
    if (!blocked) {
      const planned = await tx.many<{ id: string; slot_at: Date }>("SELECT id, slot_at FROM content_items WHERE site_id = $1 AND status = 'planned' ORDER BY slot_at LIMIT 50", [site.id]);
      due =
        site.generation_mode === "batch"
          ? planned.slice(0, Math.max(0, site.batch_size - (await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM content_items WHERE site_id = $1 AND status = 'generating'", [site.id])).n))
          : planned.filter((p) => generationDue(p.slot_at, site.lead_days, site.timezone, now));
    }
    const release = await tx.many<{ id: string; current_run_id: string | null }>("SELECT id, current_run_id FROM content_items WHERE site_id = $1 AND status = 'approved' AND slot_at <= $2", [site.id, now]);
    return { site, created, skipped, due, release };
  });

  let started = 0;
  for (const d of plan.due) {
    await startRun(deps, ctx, d.id, plan.site.generation_mode === "batch" ? "batch" : "schedule");
    started++;
  }
  for (const r of plan.release) if (r.current_run_id) await deps.enqueue(QUEUES.run, { workspaceId: ctx.workspaceId, runId: r.current_run_id }, { singletonKey: `run:${r.current_run_id}:publish` });

  const rw = await checkRunway(deps, ctx, siteId);
  return { created: plan.created, started, skipped: plan.skipped, released: plan.release.length, runway: rw.runway, alerted: rw.alerted, blockedReason: rw.blockedReason };
}

/** Recomputes a site's runway, stores it, and alerts (email + in-app) when it is short. */
export async function checkRunway(deps: PipelineDeps, ctx: TenantContext, siteId: string): Promise<{ runway: Runway; alerted: boolean; blockedReason: string | null }> {
  const now = deps.now();
  const r = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("runway.check");
    const site = await getSiteSettings(tx, siteId);
    const { runway, blockedReason } = await siteRunway(tx, site, now);
    await tx.exec("UPDATE sites SET runway_days = $2, runway_level = $3, runway_reason = $4, runway_checked_at = $5 WHERE id = $1", [site.id, runway.days, runway.level, runway.reason, now]);
    const alert = shouldAlert(runway.level, { level: site.runway_alerted_level, at: site.runway_alerted_at }, now);
    let recipients: { id: string; email: string }[] = [];
    let slug = "";
    if (runway.level === "ok" && site.runway_alerted_level) await tx.exec("UPDATE sites SET runway_alerted_level = NULL, runway_alerted_at = NULL WHERE id = $1", [site.id]);
    if (alert) {
      await tx.action("runway.alert");
      recipients = await tx.many<{ id: string; email: string }>(
        "SELECT u.id, u.email FROM auth_member m JOIN auth_user u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.role IN ('owner', 'editor') ORDER BY u.email",
        [ctx.workspaceId],
      );
      slug = (await tx.one<{ slug: string }>("SELECT slug FROM auth_organization WHERE id = $1", [ctx.workspaceId])).slug;
      const title = runway.level === "empty" ? `${site.domain}: the content queue is empty` : `${site.domain}: ${runway.days} day${runway.days === 1 ? "" : "s"} of content left`;
      await notify(tx, ctx.workspaceId, recipients.map((x) => x.id), { kind: "runway", title, body: runway.reason, href: `/w/${slug}/content?site=${site.id}` });
      await tx.exec("UPDATE sites SET runway_alerted_level = $2, runway_alerted_at = $3 WHERE id = $1", [site.id, runway.level, now]);
      await tx.event("runway.alert", "sites", site.id, { level: runway.level, days: runway.days, threshold: site.runway_threshold_days, recipients: recipients.length });
    }
    return { site, runway, blockedReason, alert, recipients, slug };
  });
  if (r.alert) {
    for (const to of r.recipients) {
      await deps
        .mail({
          to: to.email,
          kind: "runway-alert",
          subject: r.runway.level === "empty" ? `${r.site.domain}: nothing left to publish` : `${r.site.domain}: ${r.runway.days} days of content left`,
          text: `${r.site.domain} has ${r.runway.level === "empty" ? "no scheduled content" : `${r.runway.days} days of scheduled content`}; the alert threshold is ${r.site.runway_threshold_days} days.\n\n${r.runway.reason}\n\nOpen the calendar: ${deps.baseUrl}/w/${r.slug}/content?site=${r.site.id}\n\nThe queue must never run dry silently: this alert repeats weekly until the runway is back above the threshold.`,
        })
        .catch((e: unknown) => deps.log.warn("runway email failed", { to: to.email, err: e instanceof Error ? e.message : String(e) }));
    }
  }
  return { runway: r.runway, alerted: r.alert, blockedReason: r.blockedReason };
}
