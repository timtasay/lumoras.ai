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
import { platformBudgets, platformHealth, platformWorkspaces } from "@/lib/data/workspaces";
import { Sparkline } from "@/components/charts/Sparkline";
import { formatNumber } from "@/lib/ui/format";
import { ProviderStatus } from "@/components/google/ProviderStatus";
import { provider, providerInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";
import { relativeTime } from "@/lib/ui/time";
import { impersonateAction, membersForImpersonation } from "./actions";

export const metadata: Metadata = { title: "Agency home" };

const pct = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);

export default async function AgencyHome() {
  const v = await requirePlatformAdmin();
  // the audited cross-workspace reads (0005, 0006, 0008: platform_* functions only; each read is in the audit log)
  const { list, budgets, health } = await withActor(pool(), { actorId: v.user.id, requestId: v.requestId }, async (tx) => ({ list: await platformWorkspaces(tx), budgets: await platformBudgets(tx), health: await platformHealth(tx) }));
  const healthOf = (id: string) => health.find((h) => h.workspace_id === id);
  const seoBudget = (id: string) => budgets.find((b) => b.workspace_id === id && b.category === "seo_credits");
  const p = provider();
  const bal = p ? await p.balance().catch(() => ({ micros: null, note: "Balance unavailable right now" })) : { micros: null, note: "No provider configured" };
  const sites = list.reduce((n, w) => n + w.sites, 0);
  const failing = health.reduce((n, h) => n + h.failing, 0);
  const totalClicks = health.reduce((n, h) => n + Number(h.clicks_28d), 0);
  const published = health.reduce((n, h) => n + h.published_month, 0);
  const awaiting = health.reduce((n, h) => n + h.awaiting_review, 0);
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
          <KpiTile key="c" label="Organic clicks" value={totalClicks} format="compact" note="Last 28 days, every connected site" />,
          <KpiTile key="p" label="Published this month" value={published} note={`${awaiting} awaiting review`} />,
          <KpiTile key="f" label="Failing connections" value={failing} tone={failing ? "amber" : undefined} note={failing ? "Connections or syncs in error" : "None failing"} />,
        ]}
      </RevealGroup>
      <ProviderStatus info={providerInfo()} balance={bal.micros} note={bal.note ?? null} />
      <section className="sec" aria-labelledby="ws-list-h">
        <div className="sec-head">
          <h2 id="ws-list-h">Workspaces</h2>
          <p className="muted">Runway, articles published this month, organic clicks (Search Console, 28 days and the weekly trend), budget, reviews waiting and anything failing.</p>
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
                {(() => {
                  const h = healthOf(w.id);
                  const clicks = Number(h?.clicks_28d ?? 0), prev = Number(h?.clicks_prev_28d ?? 0);
                  const weekly = (h?.clicks_weekly ?? []).map(Number);
                  const change = pct(clicks, prev);
                  const b = seoBudget(w.id);
                  const used = b ? Number(b.used) : 0, ceiling = b ? Number(b.monthly_ceiling) : 0, reserve = b ? Number(b.reserve) : 0;
                  const budgetState = !ceiling ? "warn" : ceiling - used <= reserve ? "error" : "ok";
                  const runwayState = !h?.runway_level ? "idle" : h.runway_level === "ok" ? "ok" : h.runway_level === "low" ? "warn" : "error";
                  const bad = (h?.failing ?? 0) + (h?.measure_failed ?? 0);
                  return (
                    <>
                      <div className="ag-clicks">
                        <div>
                          <span className="label">Organic clicks, 28 days</span>
                          <span className="ag-num">
                            {h?.gsc_sites ? formatNumber(clicks, "compact") : "–"}
                            {h?.gsc_sites && change !== null ? (
                              <span className="sc-delta" data-good={change >= 0 ? "good" : "bad"}>
                                {change >= 0 ? "+" : "−"}
                                {Math.abs(change)}%
                              </span>
                            ) : null}
                          </span>
                          <span className="muted small">{h?.gsc_sites ? `${h.gsc_sites} site${h.gsc_sites === 1 ? "" : "s"} on Search Console` : "No site connected to Search Console"}</span>
                        </div>
                        {h?.gsc_sites && weekly.some((x) => x > 0) ? <Sparkline data={weekly} label={`${w.name}: organic clicks per week, last 12 weeks`} width={120} height={36} /> : null}
                      </div>
                      <ul className="health" aria-label={`Health of ${w.name}`}>
                        <li className="health-item">
                          <span className="label">Runway</span>
                          <StatusLight state={runwayState}>{h?.runway_days !== null && h?.runway_days !== undefined ? `${h.runway_days} day${h.runway_days === 1 ? "" : "s"}` : "No schedule"}</StatusLight>
                        </li>
                        <li className="health-item">
                          <span className="label">Published this month</span>
                          <span className="health-n">{h?.published_month ?? 0}</span>
                        </li>
                        <li className="health-item">
                          <span className="label">Awaiting review</span>
                          <span className="health-n" data-warn={h?.awaiting_review ? "" : undefined}>
                            {h?.awaiting_review ?? 0}
                          </span>
                        </li>
                        <li className="health-item">
                          <span className="label">Budget</span>
                          <StatusLight state={budgetState}>{ceiling ? `${formatMicros(used)} of ${formatMicros(ceiling)}` : "Not set"}</StatusLight>
                        </li>
                        <li className="health-item">
                          <span className="label">Failing</span>
                          <StatusLight state={bad ? "error" : "ok"}>{bad ? [h?.failing ? `${h.failing} connection${h.failing === 1 ? "" : "s"}` : "", h?.measure_failed ? `${h.measure_failed} measurement` : ""].filter(Boolean).join(", ") : "Nothing"}</StatusLight>
                        </li>
                      </ul>
                    </>
                  );
                })()}
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
