/**
 * Site audits (section 9): monthly by default, through the provider's
 * siteAudit.run / status / issues, priced first and metered like every paid
 * call. The run starts the crawl and waits; a poll job reads the status (free)
 * and, when the crawl is done, the issues (free). Issues are stored per audit,
 * grouped for people (lib/measure/audit-groups.ts), and keep their assignee
 * and task from the previous audit when the same issue type comes back.
 *
 * The "fix" action turns an issue into a task ("Shorten 17 titles over 60
 * characters"), once: a second click finds the open task.
 */
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { getSiteSettings } from "../data/sites.ts";
import { BudgetRefusedError, meteredCall, quoteCall, type MeterDeps } from "../metering/metered.ts";
import { ProviderError } from "../providers/types.ts";
import { formatMicros } from "../research/money.ts";
import { QUEUES } from "../pipeline/deps.ts";
import { describeIssue, normalizeIssueType } from "./audit-groups.ts";
import { alertRun, claimRun, finishRun, type MeasureDeps, type RunTrigger } from "./runs.ts";

export type AuditOutcome =
  | { status: "skipped"; reason: string; runId: string | null }
  | { status: "refused"; reason: string; runId: string; estimateMicros: number }
  | { status: "waiting"; runId: string; auditId: string }
  | { status: "succeeded"; runId: string; auditId: string; issues: number }
  | { status: "failed"; runId: string; reason: string };

export async function startSiteAudit(deps: MeasureDeps, ctx: TenantContext, siteId: string, opts: { windowKey: string; trigger: RunTrigger; pollAfterMs?: number }): Promise<AuditOutcome> {
  const now = deps.now();
  const site = await withWorkspace(deps.db, ctx, (tx) => getSiteSettings(tx, siteId), { readOnly: true });
  if (opts.trigger === "schedule" && (site.audit_cadence === "off" || site.status !== "active")) return { status: "skipped", reason: "audits are off for this site", runId: null };
  const claimed = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("audit.run");
    return claimRun(tx, ctx.workspaceId, siteId, "audit", opts.windowKey, opts.trigger, ctx.actorId, now);
  });
  if (!claimed) return { status: "skipped", reason: `already done for ${opts.windowKey}`, runId: null };
  const runId = claimed.id;
  const finish = (status: "skipped" | "refused" | "failed" | "waiting", f: Parameters<typeof finishRun>[3], alert?: [string, string]) =>
    withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action(`audit.${status}`);
      await finishRun(tx, runId, status, f);
      if (alert) await alertRun(tx, ctx.workspaceId, site, "audit", runId, alert[0], alert[1], "/audit");
    });
  if (!deps.seo) {
    await finish("skipped", { detail: "No SEO data provider is configured, so the site cannot be audited yet.", now });
    return { status: "skipped", reason: "no provider", runId };
  }
  const meter: MeterDeps = { db: deps.db, provider: deps.seo, now: deps.now };
  const mctx = { ...ctx, siteId };
  const op = { op: "siteAudit.run" as const, params: { domain: site.domain, maxPages: site.audit_max_pages } };
  try {
    const quote = await quoteCall(meter, mctx, op);
    if (quote.refusal) {
      const text = `${quote.refusalText} An audit of up to ${site.audit_max_pages} pages would cost about ${formatMicros(quote.estimate.micros)}.`;
      await finish("refused", { detail: text, estimateMicros: quote.estimate.micros, retryAfter: new Date(now.getTime() + 24 * 3_600_000), now }, ["site audit refused by the budget", text]);
      return { status: "refused", reason: quote.refusal, runId, estimateMicros: quote.estimate.micros };
    }
    let auditRow = "";
    const res = await meteredCall(meter, mctx, op, {
      confirmMaxMicros: quote.estimate.micros,
      onSettled: async (tx, data) => {
        auditRow = (await tx.one<{ id: string }>(
          "INSERT INTO audits (workspace_id, site_id, run_id, provider, provider_audit_id, max_pages, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [ctx.workspaceId, siteId, runId, meter.provider.name, data.auditId.slice(0, 300), site.audit_max_pages, now],
        )).id;
      },
    });
    await finish("waiting", { detail: "Crawling the site.", estimateMicros: quote.estimate.micros, costMicros: res.costMicros, providerRef: res.data.auditId, stats: { auditId: auditRow }, now });
    if (deps.enqueue) await deps.enqueue(QUEUES.auditPoll, { workspaceId: ctx.workspaceId, siteId, runId }, { startAfter: new Date(now.getTime() + (opts.pollAfterMs ?? 60_000)), singletonKey: `audit-poll:${runId}:1` });
    return { status: "waiting", runId, auditId: auditRow };
  } catch (e) {
    if (e instanceof BudgetRefusedError) {
      await finish("refused", { detail: e.message, estimateMicros: e.estimateMicros, retryAfter: new Date(now.getTime() + 24 * 3_600_000), now }, ["site audit refused by the budget", e.message]);
      return { status: "refused", reason: e.reason, runId, estimateMicros: e.estimateMicros };
    }
    const retryable = e instanceof ProviderError && !!e.opts.retryable;
    const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
    await finish("failed", { detail: `The audit could not start: ${msg}`, retryAfter: retryable ? now : new Date(now.getTime() + 6 * 3_600_000), now }, retryable ? undefined : ["site audit failed", msg]);
    if (retryable) throw e;
    return { status: "failed", runId, reason: msg };
  }
}

/** Reads a running audit's status; when done, its issues. Re-queues itself while the crawl runs (up to a day). */
export async function pollSiteAudit(deps: MeasureDeps, ctx: TenantContext, data: { siteId: string; runId: string; attempt?: number }): Promise<AuditOutcome> {
  const now = deps.now();
  const a = await withWorkspace(deps.db, ctx, (tx) => tx.maybe<{ id: string; provider_audit_id: string; status: string; started_at: Date }>("SELECT id, provider_audit_id, status, started_at FROM audits WHERE run_id = $1", [data.runId]), { readOnly: true });
  if (!a || a.status !== "running" || !deps.seo) return { status: "skipped", reason: "no running audit", runId: data.runId };
  const site = await withWorkspace(deps.db, ctx, (tx) => getSiteSettings(tx, data.siteId), { readOnly: true });
  const meter: MeterDeps = { db: deps.db, provider: deps.seo, now: deps.now };
  const mctx = { ...ctx, siteId: data.siteId };
  const fail = async (detail: string): Promise<AuditOutcome> => {
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("audit.failed");
      await tx.exec("UPDATE audits SET status = 'failed', finished_at = $2 WHERE id = $1", [a.id, now]);
      await finishRun(tx, data.runId, "failed", { detail, retryAfter: new Date(now.getTime() + 6 * 3_600_000), now });
      await alertRun(tx, ctx.workspaceId, site, "audit", data.runId, "site audit failed", detail, "/audit");
    });
    return { status: "failed", runId: data.runId, reason: detail };
  };
  let st;
  try {
    st = await meteredCall(meter, mctx, { op: "siteAudit.status", params: { auditId: a.provider_audit_id } });
  } catch (e) {
    if (e instanceof ProviderError && !e.opts.retryable) return fail(`The provider lost the audit: ${e.message.slice(0, 200)}`);
    throw e;
  }
  if (st.data.state === "failed") return fail("The provider's crawl failed.");
  if (st.data.state === "running") {
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("audit.progress");
      await tx.exec("UPDATE audits SET pages_crawled = $2, pages_total = $3 WHERE id = $1", [a.id, st.data.pagesCrawled, st.data.pagesTotal]);
    });
    const attempt = (data.attempt ?? 1) + 1;
    if (now.getTime() - a.started_at.getTime() > 24 * 3_600_000) return fail("The crawl did not finish within a day.");
    if (deps.enqueue) await deps.enqueue(QUEUES.auditPoll, { workspaceId: ctx.workspaceId, siteId: data.siteId, runId: data.runId, attempt }, { startAfter: new Date(now.getTime() + Math.min(30, 2 ** attempt) * 60_000), singletonKey: `audit-poll:${data.runId}:${attempt}` });
    return { status: "waiting", runId: data.runId, auditId: a.id };
  }
  const issues = await meteredCall(meter, mctx, { op: "siteAudit.issues", params: { auditId: a.provider_audit_id } });
  const n = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("audit.issues");
    const n = await storeIssues(tx, ctx.workspaceId, data.siteId, a.id, issues.data);
    await tx.exec("UPDATE audits SET status = 'done', pages_crawled = $2, pages_total = $3, finished_at = $4 WHERE id = $1", [a.id, st.data.pagesCrawled, st.data.pagesTotal, now]);
    await finishRun(tx, data.runId, "succeeded", { detail: `${st.data.pagesCrawled} pages crawled; ${n} issue type${n === 1 ? "" : "s"} found.`, stats: { pages: st.data.pagesCrawled, issueTypes: n }, now });
    return n;
  });
  return { status: "succeeded", runId: data.runId, auditId: a.id, issues: n };
}

/** Stores an audit's issues (merged by normalised type), carrying assignees and open tasks over from the previous audit. */
export async function storeIssues(tx: Tx, workspaceId: string, siteId: string, auditId: string, raw: { type: string; severity: "critical" | "warning" | "info"; count: number; title: string }[]): Promise<number> {
  const merged = new Map<string, { type: string; severity: "critical" | "warning" | "info"; count: number; title: string }>();
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  for (const r of raw) {
    const type = normalizeIssueType(r.type);
    if (!type || !(r.count > 0)) continue;
    const m = merged.get(type);
    if (m) {
      m.count += Math.round(r.count);
      if (rank[r.severity] < rank[m.severity]) m.severity = r.severity;
    } else merged.set(type, { type, severity: r.severity in rank ? r.severity : "warning", count: Math.round(r.count), title: r.title });
  }
  const prev = await tx.many<{ issue_type: string; assignee_id: string | null; task_id: string | null }>(
    `SELECT i.issue_type, i.assignee_id, i.task_id FROM audit_issues i JOIN audits a ON a.id = i.audit_id
     WHERE i.site_id = $1 AND a.id = (SELECT id FROM audits WHERE site_id = $1 AND status = 'done' AND id <> $2 ORDER BY started_at DESC LIMIT 1)`,
    [siteId, auditId],
  );
  const carry = new Map(prev.map((p) => [p.issue_type, p]));
  for (const m of merged.values()) {
    const v = describeIssue(m.type, m.count, m.title);
    const c = carry.get(m.type);
    const openTask = c?.task_id ? await tx.maybe<{ id: string }>("SELECT id FROM tasks WHERE id = $1 AND status <> 'done'", [c.task_id]) : null;
    await tx.exec(
      `INSERT INTO audit_issues (workspace_id, site_id, audit_id, issue_type, category, severity, count, title, assignee_id, task_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (audit_id, issue_type) DO UPDATE SET count = EXCLUDED.count, severity = EXCLUDED.severity, title = EXCLUDED.title`,
      [workspaceId, siteId, auditId, m.type, v.group, m.severity, m.count, v.title.slice(0, 200), c?.assignee_id ?? null, openTask?.id ?? null],
    );
  }
  return merged.size;
}

/** The "fix" action: one open task per site and issue type (a second click returns the same task). */
export async function createFixTask(tx: Tx, workspaceId: string, issueId: string, actorId: string): Promise<{ taskId: string; created: boolean }> {
  const i = await tx.one<{ id: string; site_id: string; issue_type: string; count: number; title: string; assignee_id: string | null; severity: string }>(
    "SELECT id, site_id, issue_type, count, title, assignee_id, severity FROM audit_issues WHERE id = $1 FOR UPDATE",
    [issueId],
    "audit issue",
  );
  const v = describeIssue(i.issue_type, i.count, i.title);
  const made = await tx.maybe<{ id: string }>(
    `INSERT INTO tasks (workspace_id, site_id, title, detail, source, issue_type, assignee_id, created_by) VALUES ($1, $2, $3, $4, 'audit', $5, $6, $7)
     ON CONFLICT (site_id, issue_type) WHERE issue_type IS NOT NULL AND status <> 'done' DO NOTHING RETURNING id`,
    [workspaceId, i.site_id, v.taskTitle, `From the site audit (${i.severity}): ${v.title}.`, i.issue_type, i.assignee_id, actorId],
  );
  const taskId = made?.id ?? (await tx.one<{ id: string }>("SELECT id FROM tasks WHERE site_id = $1 AND issue_type = $2 AND status <> 'done'", [i.site_id, i.issue_type])).id;
  await tx.exec("UPDATE audit_issues SET task_id = $2 WHERE id = $1", [i.id, taskId]);
  return { taskId, created: !!made };
}

/** Assigns an issue (and its open task) to a member of the workspace, or unassigns it (null). */
export async function assignIssue(tx: Tx, workspaceId: string, issueId: string, userId: string | null): Promise<void> {
  if (userId) {
    const member = await tx.maybe("SELECT 1 FROM auth_member WHERE organization_id = $1 AND user_id = $2", [workspaceId, userId]);
    if (!member) throw new Error("Only members of this workspace can be assigned.");
  }
  const i = await tx.one<{ task_id: string | null }>("UPDATE audit_issues SET assignee_id = $2 WHERE id = $1 RETURNING task_id", [issueId, userId], "audit issue");
  if (i.task_id) await tx.exec("UPDATE tasks SET assignee_id = $2 WHERE id = $1 AND status <> 'done'", [i.task_id, userId]);
}

export async function setTaskStatus(tx: Tx, taskId: string, status: "open" | "in_progress" | "done", now: Date): Promise<void> {
  await tx.one("UPDATE tasks SET status = $2, done_at = CASE WHEN $2 = 'done' THEN $3::timestamptz ELSE NULL END WHERE id = $1 RETURNING id", [taskId, status, now], "task");
}
