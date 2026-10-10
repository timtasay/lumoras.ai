import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Status";
import { IssueActions, TaskStatus } from "@/components/measure/AuditActions";
import { RunNow } from "@/components/measure/RunNow";
import { can } from "@/lib/auth/permissions";
import { pool } from "@/lib/db/pool";
import { getSiteSettings } from "@/lib/data/sites";
import { listMembers } from "@/lib/data/workspaces";
import { groupIssues } from "@/lib/measure/audit-groups";
import { CADENCE_LABEL } from "@/lib/measure/cadence";
import { latestAudit, listTasks } from "@/lib/measure/dashboard";
import { recentRuns } from "@/lib/measure/runs";
import { dataForSeoPrice } from "@/lib/providers/operations";
import { providerInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";
import { relativeTime } from "@/lib/ui/time";
import { loadSite } from "@/lib/site-page";

export const metadata: Metadata = { title: "Site audit" };

const SEV_LABEL = { critical: "Critical", warning: "Warning", info: "Notice" } as const;

export default async function AuditPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const now = new Date();
  const { site, a, settings, view, tasks, runs } = await loadSite(slug, siteId, async (tx, s) => ({
    settings: await getSiteSettings(tx, s.id),
    view: await latestAudit(tx, s.id),
    tasks: await listTasks(tx, s.id),
    runs: await recentRuns(tx, s.id, "audit", 3),
  }));
  const members = (await listMembers(pool(), a.workspace.id)).filter((m) => m.role !== "viewer").map((m) => ({ id: m.user_id, label: m.name || m.email }));
  const canManage = can(a.role, "task:manage");
  const canRun = can(a.role, "measure:run");
  const info = providerInfo();
  const groups = groupIssues(view.issues);
  const total = view.issues.reduce((n, i) => n + i.count, 0);
  const crit = view.issues.filter((i) => i.severity === "critical").reduce((n, i) => n + i.count, 0);
  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const last = runs[0];
  const price = dataForSeoPrice({ op: "siteAudit.run", params: { domain: site.domain, maxPages: settings.audit_max_pages } });
  const running = last && (last.status === "waiting" || last.status === "running");

  return (
    <div className="stack-lg">
      <div className="mhead">
        <div>
          <h2 className="sub-h">Site audit</h2>
          <p className="muted small">
            {CADENCE_LABEL[settings.audit_cadence]} · up to {settings.audit_max_pages.toLocaleString("en-US")} pages
            {view.audit ? ` · last crawl ${relativeTime(view.audit.finished_at ?? view.audit.started_at, now)} (${view.audit.pages_crawled} pages)` : ""}
          </p>
        </div>
        {canRun && info.name !== "none" && !running ? <RunNow slug={slug} siteId={site.id} kind="audit" label="Audit now" note={`About ${formatMicros(price.micros)} (list price), priced again before it runs.`} /> : null}
      </div>
      {running ? (
        <div className="banner" role="status">
          <Icon name="radar" />
          <p>
            <strong>Crawling the site now.</strong> The issues below are from the previous audit until it finishes.
          </p>
        </div>
      ) : last && (last.status === "refused" || last.status === "failed") ? (
        <div className="banner" role="status">
          <Icon name="alert" />
          <p>
            <strong>The last audit was {last.status}.</strong> {last.detail}
          </p>
        </div>
      ) : null}

      {view.audit ? (
        <>
          <RevealGroup className="kpi-grid">
            {[
              <KpiTile key="t" label="Issues found" value={total} delta={view.previousTotal ? Math.round(((total - view.previousTotal) / view.previousTotal) * 1000) / 10 : undefined} deltaLabel="vs the previous audit" goodWhen="down" note={view.previousTotal === null ? "First audit" : undefined} />,
              <KpiTile key="c" label="Critical" value={crit} tone={crit ? "amber" : undefined} note={crit ? "Fix these first" : "None"} />,
              <KpiTile key="g" label="Issue types" value={view.issues.length} note={`In ${groups.length} group${groups.length === 1 ? "" : "s"}`} />,
              <KpiTile key="o" label="Open tasks" value={openTasks} note={tasks.length ? `${tasks.length - openTasks} done` : "Fix an issue to create one"} />,
            ]}
          </RevealGroup>

          <section aria-labelledby="groups-h" className="stack-lg">
            <h2 id="groups-h" className="sr-only">
              Issues by group
            </h2>
            {groups.map((g) => (
              <section key={g.group} className="panel audit-group" aria-labelledby={`g-${g.group}`}>
                <header>
                  <h3 id={`g-${g.group}`}>{g.label}</h3>
                  <span className="sev" data-sev={g.worst}>
                    {SEV_LABEL[g.worst]}
                  </span>
                  <span className="muted small">{g.total.toLocaleString("en-US")} issues</span>
                </header>
                <ul className="audit-issues">
                  {g.issues.map((i) => (
                    <li key={i.id} data-sev={i.severity}>
                      <span className="sev" data-sev={i.severity}>
                        {SEV_LABEL[i.severity]}
                      </span>
                      <div className="ai-main">
                        <strong>{i.title}</strong>
                        <span className="muted small">
                          {i.assignee ? `Assigned to ${i.assignee}` : "Unassigned"}
                          {i.task_id ? ` · task ${i.task_status === "in_progress" ? "in progress" : i.task_status === "done" ? "done" : "open"}` : ""}
                        </span>
                      </div>
                      {i.task_id ? <Badge tone={i.task_status === "done" ? "ion" : "info"} icon="check">{i.task_status === "done" ? "Fixed" : "Task"}</Badge> : null}
                      <IssueActions slug={slug} siteId={site.id} issueId={i.id} title={i.title} assignee={i.assignee_id} members={members} taskId={i.task_id} canManage={canManage} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>
        </>
      ) : (
        <EmptyState
          icon="audit"
          title={info.name === "none" ? "Audits are not configured yet" : "No audit yet"}
          text={info.name === "none" ? "Audits crawl the site through the SEO data provider, which Lumoras staff switch on. Then the site is audited monthly." : `A crawl of up to ${settings.audit_max_pages} pages finds broken links, titles over 60 characters, missing descriptions and more, grouped and assignable. Each issue's Fix button creates a task.`}
          primary={
            canRun && info.name !== "none" ? (
              <RunNow slug={slug} siteId={site.id} kind="audit" label="Run the first audit" variant="primary" note={`About ${formatMicros(price.micros)}, within the budget.`} />
            ) : (
              <Link href={`/w/${slug}/sites/${site.id}`} className={buttonClass("primary")}>
                <Icon name="back" /> Back to the dashboard
              </Link>
            )
          }
        />
      )}

      <section aria-labelledby="tasks-h">
        <div className="sec-head">
          <h2 id="tasks-h">Tasks</h2>
          <p className="muted">Created by an issue&apos;s Fix action; they stay open across audits until someone marks them done.</p>
        </div>
        {tasks.length ? (
          <div className="tbl-frame" role="region" aria-label="Tasks" tabIndex={0}>
            <table className="tbl tasks-tbl">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col" className="hide-phone">
                    Assignee
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="hide-phone">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} data-status={t.status}>
                    <th scope="row">
                      <span className="q">{t.title}</span>
                      <span className="pg">{t.detail}</span>
                    </th>
                    <td className="hide-phone">{t.assignee ?? <span className="muted">Unassigned</span>}</td>
                    <td>
                      <TaskStatus slug={slug} siteId={site.id} taskId={t.id} status={t.status} title={t.title} canManage={canManage} />
                    </td>
                    <td className="hide-phone">{relativeTime(t.created_at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No tasks yet.</p>
        )}
      </section>
    </div>
  );
}
