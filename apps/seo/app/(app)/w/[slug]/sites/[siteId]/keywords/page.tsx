import type { Metadata } from "next";
import { Suspense } from "react";
import { KpiTile } from "@/components/ui/Kpi";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Status";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeywordsTable } from "@/components/research/KeywordsTable";
import { ResearchLogTable } from "@/components/research/ResearchLogTable";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import { SeedBacklog } from "@/components/research/SeedBacklog";
import { ReadOnlyNote } from "@/components/forms/FormBits";
import { can } from "@/lib/auth/permissions";
import { listBacklog, listKeywords, listResearchLog } from "@/lib/data/research";
import { readBudgetState } from "@/lib/metering/metered";
import { OPERATION_POLICY, periodOf } from "@/lib/providers/operations";
import { providerInfo } from "@/lib/providers/registry";
import type { OperationName } from "@/lib/providers/types";
import { nextSeeds, seedDecision } from "@/lib/research/seeds";
import { loadSite } from "@/lib/site-page";

export const metadata: Metadata = { title: "Keywords" };

export default async function KeywordsPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const now = new Date();
  const { site, a, keywords, log, backlog, budget, siteSpend } = await loadSite(slug, siteId, async (tx, s) => ({
    keywords: await listKeywords(tx, s.id),
    log: await listResearchLog(tx, s.id, 300),
    backlog: await listBacklog(tx, s.id),
    budget: await readBudgetState(tx, "seo_credits", periodOf(now)),
    siteSpend: Number(
      (
        await tx.one<{ n: string }>(
          "SELECT coalesce(sum(cost_micros), 0)::text AS n FROM usage_ledger WHERE site_id = $1 AND category = 'seo_credits' AND status IN ('held', 'settled') AND period = $2",
          [s.id, periodOf(now)],
        )
      ).n,
    ),
  }));
  const info = providerInfo();
  const canRun = can(a.role, "research:run") && info.name !== "none";
  const canEdit = can(a.role, "keyword:manage");
  const next = nextSeeds(
    backlog.map((b) => ({ id: b.id, seed: b.seed, priority: b.priority, status: b.status, lastResearchedAt: b.last_researched_at, createdAt: b.created_at })),
    site.research_max_age_days,
    now,
    3,
  );
  const nextIds = new Set(next.map((n) => n.id));
  const counts = { targeted: keywords.filter((k) => k.status === "targeted").length, published: keywords.filter((k) => k.status !== "idea" && k.status !== "targeted").length };

  return (
    <div className="stack-lg">
      <div className="kpi-grid kw-kpis">
        <KpiTile label="Saved keywords" value={keywords.length} note={`${counts.targeted} targeted · ${counts.published} published or ranking`} />
        <KpiTile label="Lookups this month" value={log.filter((l) => new Date(l.created_at).getUTCMonth() === now.getUTCMonth()).length} note={`${log.filter((l) => l.status === "cached").length} free from the cache`} />
        <KpiTile label="This site's SEO data spend" value={siteSpend / 1e6} format="usd" note="This month, at what the provider billed" />
        <KpiTile
          label="Workspace budget left"
          value={Math.max(0, budget.spendable) / 1e6}
          format="usd"
          tone={budget.unset || budget.available <= budget.reserve ? "warn" : undefined}
          note={budget.unset ? "No budget set" : `of $${(budget.ceiling / 1e6).toFixed(2)}, above a $${(budget.reserve / 1e6).toFixed(2)} reserve`}
        />
      </div>

      <section id="research" className="panel pad" aria-labelledby="research-h">
        <div className="sec-head">
          <h2 id="research-h">Research</h2>
          <p className="muted small demo-flag">
            {info.demo ? <Badge tone="info" icon="info">Demo data · fake provider</Badge> : <Badge>{info.label}</Badge>}
            Priced first, charged to the workspace budget, logged.
          </p>
        </div>
        {info.name === "none" ? (
          <EmptyState icon="db" title="No SEO data provider yet" text="Paid research is off until Lumoras staff connect an SEO data provider (owner decision #3: DataForSEO directly or a self-hosted OpenSEO). Saved keywords, the backlog and the log still work." primary={<span className="muted small">Nothing here can spend money until then.</span>} />
        ) : canRun ? (
          <Suspense fallback={null}>
            <ResearchPanel slug={slug} siteId={site.id} nextSeeds={next.map((n) => n.seed)} demo={info.demo} canSave={canEdit} />
          </Suspense>
        ) : (
          <ReadOnlyNote>Your role can see research and its costs. Editors and owners run it.</ReadOnlyNote>
        )}
      </section>

      <Tabs
        label="Keywords, research log and seed backlog"
        tabs={[
          { id: "saved", label: "Saved keywords", count: keywords.length, content: <KeywordsTable slug={slug} siteId={site.id} canEdit={canEdit} rows={keywords.map((k) => ({ id: k.id, keyword: k.keyword, volume: k.search_volume, kd: k.keyword_difficulty, cpcMicros: k.cpc_micros, intent: k.intent, cluster: k.cluster, status: k.status, fit: k.fit, metricsAt: k.metrics_at?.toISOString() ?? null }))} /> },
          {
            id: "log",
            label: "Research log",
            count: log.length,
            content: (
              <ResearchLogTable
                rows={log.map((l) => ({ id: l.id, at: l.created_at.toISOString(), operation: l.operation, label: OPERATION_POLICY[l.operation as OperationName]?.label ?? l.operation, subject: l.subject, status: l.status, estimateMicros: l.estimate_micros, costMicros: l.cost_micros, results: l.result_count, detail: l.detail, actor: l.actor, provider: l.provider }))}
              />
            ),
          },
          {
            id: "seeds",
            label: "Seed backlog",
            count: backlog.length,
            content: (
              <SeedBacklog
                slug={slug}
                siteId={site.id}
                canEdit={canEdit}
                maxAgeDays={site.research_max_age_days}
                seeds={backlog.map((b) => {
                  const d = seedDecision(b.last_researched_at, site.research_max_age_days, now);
                  return { id: b.id, seed: b.seed, priority: b.priority, status: b.status, lastResearchedAt: b.last_researched_at?.toISOString() ?? null, count: b.research_count, next: nextIds.has(b.id), freshUntil: d.run ? null : d.freshUntil.toISOString() };
                })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
