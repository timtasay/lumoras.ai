import type { Metadata } from "next";
import { BudgetCard, LedgerTable, SpendChart, type CategoryView } from "@/components/budget/BudgetPanels";
import { Icon } from "@/components/Icons";
import { ReadOnlyNote } from "@/components/forms/FormBits";
import { KpiTile } from "@/components/ui/Kpi";
import { readWorkspace } from "@/lib/actions";
import { can } from "@/lib/auth/permissions";
import { dailySpend, listLedger } from "@/lib/data/research";
import { readBudgetState } from "@/lib/metering/metered";
import { CATEGORIES, periodOf } from "@/lib/providers/operations";
import { providerInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";

export const metadata: Metadata = { title: "Budget and usage" };

const META: Record<CategoryView["category"], Pick<CategoryView, "title" | "unit" | "text" | "phase">> = {
  seo_credits: { title: "SEO data", unit: "micros", text: "Keyword ideas, metrics, SERPs, domain and backlink data. Every lookup is priced first.", phase: null },
  llm_tokens: { title: "AI writing", unit: "micros", text: "Model usage for topic selection, drafting and fact-checking.", phase: 3 },
  social_posts: { title: "Social posts", unit: "posts", text: "Posts published to social networks.", phase: 5 },
};

export default async function BudgetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const now = new Date();
  const period = periodOf(now);
  const { a, states, days, ledger } = await readWorkspace(
    slug,
    async (tx, a) => ({
      a,
      // one connection per transaction: read the categories one after another
      states: await (async () => {
        const out = [];
        for (const c of CATEGORIES) out.push(await readBudgetState(tx, c, period));
        return out;
      })(),
      days: await dailySpend(tx, "seo_credits", period),
      ledger: await listLedger(tx, { period, limit: 500 }),
    }),
    "budget:read",
  );
  const canEdit = can(a.role, "budget:manage");
  const seo = states[0];
  const month = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cached = ledger.filter((l) => l.cached).length;
  const info = providerInfo();
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>{a.workspace.name}</b> · settings
          </p>
          <h1>Budget and usage</h1>
          <p className="lede">A monthly ceiling and a reserve per category. Paid calls are priced before they run and refused when they would dip into the reserve. Months run on UTC.</p>
        </div>
        <a className="btn btn-secondary btn-md" href={`/api/w/${slug}/usage?month=${period.slice(0, 7)}`} download>
          <span className="btn-label">
            <Icon name="doc" /> Export {month} as CSV
          </span>
        </a>
      </header>

      <div className="kpi-grid kw-kpis">
        <KpiTile label={`SEO data spent · ${month}`} value={seo.used / 1e6} format="usd" note={seo.unset ? "No budget set" : `of $${(seo.ceiling / 1e6).toFixed(2)}`} />
        <KpiTile label="Can still be spent" value={seo.spendable / 1e6} format="usd" tone={!seo.unset && seo.available <= seo.reserve ? "warn" : undefined} note={`$${(seo.reserve / 1e6).toFixed(2)} reserve kept back`} />
        <KpiTile label="Paid lookups" value={ledger.filter((l) => !l.cached && l.cost_micros > 0).length} note="This month" />
        <KpiTile label="Cache hits" value={cached} note="Repeats that cost nothing" />
      </div>

      {canEdit ? null : <ReadOnlyNote>Your role can see the budget and the ledger. Owners change the ceilings and reserves.</ReadOnlyNote>}
      <div className="budget-cards">
        {states.map((s) => (
          <BudgetCard key={s.category} slug={slug} canEdit={canEdit} c={{ category: s.category, ...META[s.category], ceiling: s.ceiling, reserve: s.reserve, used: s.used, held: s.held, available: s.available, spendable: s.spendable, unset: s.unset }} />
        ))}
      </div>

      <section className="sec" aria-labelledby="usage-h">
        <div className="sec-head">
          <h2 id="usage-h">Usage this month</h2>
          <p className="muted small">
            Provider: {info.label}. Amounts are what the provider billed (or the estimate, where it does not say), in US dollars; the CSV adds exact micro-dollars.
          </p>
        </div>
        <div className="usage-grid">
          <div>{seo.used > 0 ? <SpendChart days={days} /> : <p className="panel pad muted">No SEO data spend yet this month.</p>}</div>
          <div className="panel bcard">
            <p className="label">SEO data this month</p>
            <dl className="bcard-figs">
              <div>
                <dt>Settled</dt>
                <dd>{formatMicros(seo.settled)}</dd>
              </div>
              <div>
                <dt>In flight (held)</dt>
                <dd>{formatMicros(seo.held)}</dd>
              </div>
              <div>
                <dt>Reserve</dt>
                <dd>{formatMicros(seo.reserve)}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <LedgerTable
            rows={ledger.map((l) => ({ id: l.id, at: l.created_at.toISOString(), site: l.site_domain, category: l.category, operation: l.operation, status: l.status, cached: l.cached, units: l.units, estimate: l.estimate_micros, cost: l.cost_micros, actor: l.actor, detail: l.detail }))}
          />
        </div>
      </section>
    </div>
  );
}
