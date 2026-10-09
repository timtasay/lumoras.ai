import type { Metadata } from "next";
import Link from "next/link";
import { ImpersonateMenu } from "@/components/audit/ImpersonateMenu";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge, StatusLight } from "@/components/ui/Status";
import { requirePlatformAdmin } from "@/lib/auth/app";
import { pool } from "@/lib/db/pool";
import { withActor } from "@/lib/db/tenant";
import { platformBudgets, platformWorkspaces } from "@/lib/data/workspaces";
import { ProviderStatus } from "@/components/google/ProviderStatus";
import { provider, providerInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";
import { relativeTime } from "@/lib/ui/time";
import { impersonateAction, membersForImpersonation } from "./actions";

export const metadata: Metadata = { title: "Agency home" };

/** Health at a glance (build prompt section 12): label, full name, phase that fills it in. */
const LATER: [string, string, number][] = [
  ["Runway", "Runway (days of scheduled content)", 3],
  ["Published", "Articles published this month", 3],
  ["Clicks", "Organic clicks trend", 4],
  ["Reviews", "Items awaiting review", 3],
];

export default async function AgencyHome() {
  const v = await requirePlatformAdmin();
  // the audited cross-workspace read (0005_platform.sql)
  const { list, budgets } = await withActor(pool(), { actorId: v.user.id, requestId: v.requestId }, async (tx) => ({ list: await platformWorkspaces(tx), budgets: await platformBudgets(tx) }));
  const seoBudget = (id: string) => budgets.find((b) => b.workspace_id === id && b.category === "seo_credits");
  const p = provider();
  const bal = p ? await p.balance().catch(() => ({ micros: null, note: "Balance unavailable right now" })) : { micros: null, note: "No provider configured" };
  const sites = list.reduce((n, w) => n + w.sites, 0);
  const failing = list.reduce((n, w) => n + w.failing_connections, 0);
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>Lumoras staff</b> · agency home
          </p>
          <h1>Every workspace</h1>
          <p className="lede">Health at a glance for each client. Opening this page was recorded in the platform audit log; entering a workspace means impersonating a member, which is recorded too.</p>
        </div>
        <Link href="/agency/audit" className={buttonClass("secondary")}>
          <Icon name="shield" /> Platform audit
        </Link>
      </header>
      <RevealGroup className="kpi-grid">
        {[
          <KpiTile key="w" label="Workspaces" value={list.length} note={`${list.filter((w) => w.status === "active").length} active, ${list.filter((w) => w.status === "onboarding").length} onboarding`} />,
          <KpiTile key="s" label="Sites" value={sites} note="Across every workspace" />,
          <KpiTile key="m" label="Members" value={list.reduce((n, w) => n + w.members, 0)} note="Client and staff seats" />,
          <KpiTile key="f" label="Failing connections" value={failing} tone={failing ? "amber" : undefined} note={failing ? "Needs a look" : "None failing"} />,
        ]}
      </RevealGroup>
      <ProviderStatus info={providerInfo()} balance={bal.micros} note={bal.note ?? null} />
      <section className="sec" aria-labelledby="ws-list-h">
        <div className="sec-head">
          <h2 id="ws-list-h">Workspaces</h2>
          <p className="muted">Runway, articles, clicks and reviews fill in as their phases arrive.</p>
        </div>
        {list.length ? (
          <RevealGroup className="agency-grid" as="ul">
            {list.map((w) => (
              <article key={w.id} className="panel agency-card">
                <header>
                  <span className="ws-mark" aria-hidden="true">
                    {w.name[0]?.toUpperCase()}
                  </span>
                  <div className="site-id">
                    <h3>{w.name}</h3>
                    <p className="muted small">{w.owners.length ? w.owners.join(", ") : "No owner"}</p>
                  </div>
                  <Badge tone={w.status === "active" ? "ion" : w.status === "onboarding" ? "amber" : "neutral"}>{w.status ?? "unknown"}</Badge>
                </header>
                <dl className="site-stats four">
                  <div>
                    <dt className="label">Sites</dt>
                    <dd>{w.sites}</dd>
                  </div>
                  <div>
                    <dt className="label">Routes</dt>
                    <dd>{w.routes.toLocaleString("en-US")}</dd>
                  </div>
                  <div>
                    <dt className="label">Members</dt>
                    <dd>{w.members}</dd>
                  </div>
                  <div>
                    <dt className="label">Active</dt>
                    <dd className="small">{w.last_activity_at ? relativeTime(w.last_activity_at) : "None"}</dd>
                  </div>
                </dl>
                <ul className="health" aria-label={`Health of ${w.name}`}>
                  {LATER.map(([label, full, phase]) => (
                    <li key={label} className="health-item" data-later="" title={`${full}: arrives in Phase ${phase}`}>
                      <span className="label">
                        {label}
                        <span className="sr-only"> ({full})</span>
                      </span>
                      <span className="health-val">
                        <span className="health-ghost" aria-hidden="true" />
                        <span className="sr-only">not measured yet,</span> P{phase}
                      </span>
                    </li>
                  ))}
                  {(() => {
                    const b = seoBudget(w.id);
                    const used = b ? Number(b.used) : 0, ceiling = b ? Number(b.monthly_ceiling) : 0, reserve = b ? Number(b.reserve) : 0;
                    const state = !ceiling ? "warn" : ceiling - used <= reserve ? "error" : "ok";
                    return (
                      <li className="health-item">
                        <span className="label">Budget</span>
                        <StatusLight state={state}>{ceiling ? `${formatMicros(used)} of ${formatMicros(ceiling)}` : "Not set"}</StatusLight>
                      </li>
                    );
                  })()}
                  <li className="health-item">
                    <span className="label">Connections</span>
                    <StatusLight state={w.failing_connections ? "error" : "ok"}>{w.failing_connections ? `${w.failing_connections} failing` : "OK"}</StatusLight>
                  </li>
                </ul>
                <footer className="agency-acts">
                  <Link href={`/agency/audit?workspace=${w.id}`} className={buttonClass("ghost", "sm")}>
                    <Icon name="history" /> Audit trail
                  </Link>
                  <ImpersonateMenu workspaceId={w.id} workspaceName={w.name} load={membersForImpersonation} impersonate={impersonateAction} />
                </footer>
              </article>
            ))}
          </RevealGroup>
        ) : (
          <EmptyState icon="building" title="No workspaces yet" text="Create the first client workspace. sonorch.ai, seasonx.ai and lumoras.ai are the first three." primary={<Link href="/onboarding" className={buttonClass("primary")}>New workspace</Link>} />
        )}
      </section>
    </div>
  );
}
