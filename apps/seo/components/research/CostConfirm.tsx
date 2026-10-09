"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Status";
import type { BudgetView } from "@/app/(app)/w/[slug]/research-actions";
import { formatMicros } from "@/lib/research/money";

/**
 * This month's SEO data budget as one bar: what is spent (ion), what this
 * call would add (striped; flare when it crosses the reserve) and the
 * reserve (amber hatch at the end, never spent). The numbers are also in
 * the text below, so colour is never the only signal.
 */
export function BudgetMeter({ budget, callMicros = 0, label = "SEO data budget this month" }: { budget: BudgetView; callMicros?: number; label?: string }) {
  const c = Math.max(budget.ceiling, 1);
  const used = Math.min(1, budget.used / c);
  const call = Math.min(1 - used, callMicros / c);
  const reserve = Math.min(1, budget.reserve / c);
  const over = callMicros > budget.spendable;
  const summary = budget.unset
    ? "No budget is set."
    : `${formatMicros(budget.used)} of ${formatMicros(budget.ceiling)} used; ${formatMicros(budget.reserve)} reserve; ${formatMicros(budget.spendable)} can still be spent${callMicros ? `; this lookup ${formatMicros(callMicros)}` : ""}.`;
  return (
    <div className="bmeter" data-over={over ? "" : undefined} style={{ "--used": used, "--call": call, "--reserve": reserve } as CSSProperties}>
      <div className="bmeter-track" role="img" aria-label={`${label}: ${summary}`}>
        <span className="bmeter-reserve" />
        <span className="bmeter-fill" />
        <span className="bmeter-call" />
      </div>
      <p className="bmeter-legend">
        <span>
          <i className="k-used" aria-hidden="true" /> Used {formatMicros(budget.used)}
          {budget.held ? ` (${formatMicros(budget.held)} in flight)` : ""}
        </span>
        {callMicros ? (
          <span>
            <i className="k-call" aria-hidden="true" /> This lookup {formatMicros(callMicros)}
          </span>
        ) : null}
        <span>
          <i className="k-res" aria-hidden="true" /> Reserve {formatMicros(budget.reserve)}
        </span>
        <span>of {formatMicros(budget.ceiling)}</span>
      </p>
    </div>
  );
}

const REFUSAL_TITLE: Record<string, string> = {
  no_budget: "No budget set for paid SEO data",
  below_reserve: "This workspace is at its reserve",
  would_cross_reserve: "This lookup would cross the reserve",
  over_ceiling: "Over the monthly ceiling",
  provider_balance: "The provider account is low",
  price_changed: "The price changed",
};

/** A refusal, designed: what happened, why, and where to go next. No confirm button. */
export function Refusal({ reason, text, budget, callMicros, slug, children }: { reason: string; text: string; budget?: BudgetView | null; callMicros?: number; slug: string; children?: ReactNode }) {
  return (
    <section className="refusal" role="alert" aria-labelledby="refusal-h" data-refusal={reason}>
      <span className="refusal-ico" aria-hidden="true">
        <Icon name="alert" />
      </span>
      <div>
        <h3 id="refusal-h">{REFUSAL_TITLE[reason] ?? "Not run"}</h3>
        <p>{text}</p>
        <p className="muted small">Nothing was bought and nothing was charged.</p>
      </div>
      {budget && !budget.unset ? <BudgetMeter budget={budget} callMicros={callMicros} /> : null}
      <div className="cost-acts">
        <Link href={`/w/${slug}/settings/budget`} className="btn btn-secondary btn-sm">
          <span className="btn-label">
            <Icon name="db" /> Budget and usage
          </span>
        </Link>
        {children}
      </div>
    </section>
  );
}

/** The price, shown before anything is bought (rule 11). Confirm runs it at no more than this. */
export function CostConfirm({
  title,
  estimateMicros,
  explain,
  cachedAt,
  budget,
  pending,
  demo,
  onConfirm,
  onCancel,
}: {
  title: string;
  estimateMicros: number;
  explain: string;
  cachedAt: string | null;
  budget: BudgetView;
  pending: boolean;
  demo: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cached = !!cachedAt;
  return (
    <section className="cost" data-cached={cached ? "" : undefined} aria-labelledby="cost-h" aria-live="polite">
      <div className="cost-head">
        <div>
          <p className="label" id="cost-h">
            {title} · estimated cost
          </p>
          <p className="cost-amt">
            {cached ? "$0.00" : formatMicros(estimateMicros)}
            <small>{cached ? "from the cache" : "at most"}</small>
          </p>
        </div>
        {demo ? (
          <Badge tone="info" icon="info">
            Demo data
          </Badge>
        ) : null}
      </div>
      {cached ? (
        <p className="cost-note">Already bought on {new Date(cachedAt!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}. Running it again reads the saved result: no provider call, no charge.</p>
      ) : (
        <>
          <p className="cost-explain">{explain}</p>
          <p className="cost-note">Charged to this workspace&apos;s SEO data budget at what the provider actually bills, never more than this without the ledger saying so.</p>
          <BudgetMeter budget={budget} callMicros={estimateMicros} />
        </>
      )}
      <div className="cost-acts">
        <Button variant="primary" icon="check" loading={pending} onClick={onConfirm}>
          {cached ? "Show the saved result" : `Confirm and run · ${formatMicros(estimateMicros)}`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
