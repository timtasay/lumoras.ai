"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Status";
import { quoteOverviewAction, runOverviewAction, type OverviewQuote } from "@/app/(app)/w/[slug]/research-actions";
import type { DomainOverview as Overview } from "@/lib/providers/types";
import { formatMicros } from "@/lib/research/money";
import { CostConfirm, Refusal } from "./CostConfirm";

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));

/**
 * The domain overview: a paid lookup, so it is priced and budgeted like any
 * other. Shows the last result when there is one; otherwise a button that
 * gets the price first, then a confirm.
 */
export function DomainOverviewPanel({ slug, siteId, domain, last, canRun, demo }: { slug: string; siteId: string; domain: string; last: { data: Overview; at: string; costMicros: number } | null; canRun: boolean; demo: boolean }) {
  const router = useRouter();
  const [shown, setShown] = useState(last);
  const [q, setQ] = useState<Extract<OverviewQuote, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ reason: string; text: string } | null>(null);
  const [busy, start] = useTransition();
  const [running, startRun] = useTransition();

  const quote = () =>
    start(async () => {
      setError(null);
      const r = await quoteOverviewAction(slug, siteId);
      if (!r.ok) return setError(r.error);
      if (r.refusal) setRefusal({ reason: r.refusal, text: r.refusalText ?? "" });
      setQ(r);
    });
  const run = () =>
    startRun(async () => {
      const r = await runOverviewAction(slug, siteId, q!.estimateMicros);
      if (!r.ok) {
        if (r.refusal) setRefusal({ reason: r.refusal, text: r.error });
        else setError(r.error);
        return;
      }
      setShown({ data: r.data, at: r.at, costMicros: r.costMicros });
      setQ(null);
      router.refresh();
    });

  const tiles: [string, string][] = shown
    ? [
        ["Organic traffic", `${n(shown.data.organicTraffic)} /mo`],
        ["Ranking keywords", n(shown.data.organicKeywords)],
        ["In the top 3", n(shown.data.top3)],
        ["In the top 10", n(shown.data.top10)],
      ]
    : [];

  return (
    <section className="panel dov" aria-labelledby="dov-h">
      <div className="sec-head">
        <h2 id="dov-h">Domain overview</h2>
        <p className="muted small demo-flag">
          {demo ? <Badge tone="info" icon="info">Demo data</Badge> : null}
          Estimated organic footprint of {domain}
        </p>
      </div>
      {shown ? (
        <>
          <div className="dov-tiles">
            {tiles.map(([label, value], i) => (
              <div key={label} className="dov-tile" style={{ "--i": i } as CSSProperties}>
                <span className="label">{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <p className="dov-foot">
            <span>
              Fetched {new Date(shown.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · {shown.costMicros ? formatMicros(shown.costMicros) : "free (cache)"}
            </span>
            {canRun && !q ? (
              <Button size="sm" variant="ghost" icon="refresh" loading={busy} onClick={quote}>
                Refresh
              </Button>
            ) : null}
          </p>
        </>
      ) : !q && !refusal ? (
        <div className="rp-idle">
          <Icon name="radar" />
          <p>Traffic, ranking keywords and positions are paid data: priced first and charged to the workspace&apos;s SEO data budget.</p>
          {canRun ? (
            <Button variant="secondary" icon="search" loading={busy} onClick={quote}>
              Get the price
            </Button>
          ) : (
            <p className="muted small">Editors and owners can fetch it.</p>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="form-alert" role="alert">
          <Icon name="alert" />
          {error}
        </p>
      ) : null}
      {refusal ? (
        <Refusal reason={refusal.reason} text={refusal.text} budget={q?.budget} callMicros={q?.estimateMicros} slug={slug}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRefusal(null);
              setQ(null);
            }}
          >
            Back
          </Button>
        </Refusal>
      ) : q ? (
        <CostConfirm title="Domain overview" estimateMicros={q.estimateMicros} explain={q.explain} cachedAt={q.cachedAt} budget={q.budget} pending={running} demo={demo} onConfirm={run} onCancel={() => setQ(null)} />
      ) : null}
    </section>
  );
}
