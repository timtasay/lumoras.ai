"use client";

import { useActionState } from "react";
import { ActionFeedback, submitKeepingValues } from "@/components/forms/FormBits";
import { BarChart } from "@/components/charts/BarChart";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Fields";
import { Button } from "@/components/ui/Button";
import { Badge, StatusLight } from "@/components/ui/Status";
import { BudgetMeter } from "@/components/research/CostConfirm";
import { setBudgetAction } from "@/app/(app)/w/[slug]/research-actions";
import { idle } from "@/lib/actions-state";
import { formatMicros, microsToDecimal } from "@/lib/research/money";

export type CategoryView = {
  category: "seo_credits" | "llm_tokens" | "social_posts";
  title: string;
  unit: "micros" | "posts";
  text: string;
  ceiling: number;
  reserve: number;
  used: number;
  held: number;
  available: number;
  spendable: number;
  unset: boolean;
  phase: number | null;
};

const fmt = (v: number, unit: CategoryView["unit"]) => (unit === "posts" ? `${v.toLocaleString("en-US")} posts` : formatMicros(v));

/** One budget category: this month's figures, the meter, and (owners) the ceiling and reserve form. */
export function BudgetCard({ slug, c, canEdit }: { slug: string; c: CategoryView; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setBudgetAction.bind(null, slug), idle);
  const fe = state.fieldErrors ?? {};
  const below = !c.unset && c.available <= c.reserve;
  const value = (v: number) => (c.unit === "posts" ? String(v) : microsToDecimal(v));
  return (
    <section className="panel bcard" aria-labelledby={`b-${c.category}`} data-state={below ? "below" : undefined}>
      <div className="bcard-head">
        <div>
          <h3 id={`b-${c.category}`}>{c.title}</h3>
          <p className="muted small">{c.text}</p>
        </div>
        {c.phase ? <Badge tone="info">Used from Phase {c.phase}</Badge> : c.unset ? <StatusLight state="warn">No budget</StatusLight> : below ? <StatusLight state="error">At the reserve</StatusLight> : <StatusLight state="ok">Within budget</StatusLight>}
      </div>
      <dl className="bcard-figs">
        <div>
          <dt>Used</dt>
          <dd>{fmt(c.used, c.unit)}</dd>
        </div>
        <div>
          <dt>Can spend</dt>
          <dd>{fmt(c.spendable, c.unit)}</dd>
        </div>
        <div>
          <dt>Reserve</dt>
          <dd>{fmt(c.reserve, c.unit)}</dd>
        </div>
      </dl>
      {c.unit === "micros" ? <BudgetMeter budget={c} label={`${c.title} this month`} /> : null}
      {canEdit ? (
        <form action={action} onSubmit={submitKeepingValues(action)} noValidate>
          <ActionFeedback state={state} />
          <input type="hidden" name="category" value={c.category} />
          <TextField label={c.unit === "posts" ? "Monthly ceiling (posts)" : "Monthly ceiling (US$)"} name="ceiling" inputMode="decimal" defaultValue={value(c.ceiling)} error={fe.ceiling} />
          <TextField label={c.unit === "posts" ? "Reserve (posts)" : "Reserve (US$)"} name="reserve" inputMode="decimal" defaultValue={value(c.reserve)} hint="Never spent: calls that would dip into it are refused." error={fe.reserve} />
          <div className="form-acts">
            <Button type="submit" variant="secondary" size="sm" icon="check" loading={pending}>
              Save {c.title.toLowerCase()}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Month-to-date daily spend as columns (a hidden data table goes with it). */
export function SpendChart({ days }: { days: { day: string; micros: number }[] }) {
  const total = days.reduce((s, d) => s + d.micros, 0);
  return (
    <BarChart
      title="SEO data spend per day, this month"
      summary={`${formatMicros(total)} spent so far this month across ${days.filter((d) => d.micros > 0).length} day(s).`}
      seriesLabel="Spend (US cents)"
      categoryLabel="Day"
      bars={days.map((d) => ({ label: d.day.slice(5), value: Math.round(d.micros / 1000) / 10 }))}
      height={200}
    />
  );
}

export type LedgerItem = { id: string; at: string; site: string | null; category: string; operation: string; status: string; cached: boolean; units: number; estimate: number; cost: number; actor: string; detail: string | null };

export function LedgerTable({ rows }: { rows: LedgerItem[] }) {
  if (!rows.length) return <EmptyState icon="db" title="No usage this month" text="Every paid lookup, cache hit and refusal-free call lands here with its estimate, its actual cost and who ran it." primary={<span className="muted small">Research a seed from a site&apos;s Keywords tab.</span>} />;
  const cols: Column<LedgerItem>[] = [
    { key: "at", header: "When", sortValue: (r) => r.at, render: (r) => <span className="mono small">{r.at.slice(0, 16).replace("T", " ")}</span> },
    { key: "site", header: "Site", sortValue: (r) => r.site ?? "", render: (r) => r.site ?? <span className="muted">deleted site</span>, hideOnPhone: true },
    { key: "op", header: "Operation", sortValue: (r) => r.operation, render: (r) => <span className="mono small">{r.operation}</span> },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => (r.cached ? <Badge tone="info">cache hit</Badge> : <Badge tone={r.status === "settled" ? "ion" : r.status === "held" ? "amber" : "neutral"}>{r.status}</Badge>) },
    { key: "est", header: "Estimate", numeric: true, sortValue: (r) => r.estimate, render: (r) => formatMicros(r.estimate), hideOnPhone: true },
    { key: "cost", header: "Charged", numeric: true, sortValue: (r) => r.cost, render: (r) => formatMicros(r.cost) },
    { key: "who", header: "By", sortValue: (r) => r.actor, render: (r) => <span className="muted small">{r.actor}</span>, hideOnPhone: true },
  ];
  return <DataTable caption="Usage ledger, this month" columns={cols} rows={rows} rowKey={(r) => r.id} initialSort={{ key: "at", dir: "desc" }} />;
}
