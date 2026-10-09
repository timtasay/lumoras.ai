"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Segmented, TextField } from "@/components/ui/Fields";
import { Badge, Chip } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { loggedIdeasAction, quoteResearchAction, runResearchAction, saveIdeasAction, type QuoteView, type RunView } from "@/app/(app)/w/[slug]/research-actions";
import { formatMicros } from "@/lib/research/money";
import type { AnnotatedRow } from "@/lib/research/service";
import type { SerpItem } from "@/lib/providers/types";
import { CostConfirm, Refusal } from "./CostConfirm";

type Kind = "ideas" | "serp";
type Stage = { s: "idle" } | { s: "quoted"; q: Extract<QuoteView, { ok: true }> } | { s: "result"; r: Extract<RunView, { ok: true }> } | { s: "refused"; reason: string; text: string; q?: Extract<QuoteView, { kind: "quote" }> } | { s: "error"; text: string };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The research panel: type a seed (keyword ideas) or a keyword (its SERP),
 * see the price and what it does to the budget, confirm, see the results.
 * Rule 4 shows up as "already researched" (no purchase); rule 7 marks what
 * the business does not sell; rule 6 groups variants under one target.
 */
export function ResearchPanel({ slug, siteId, nextSeeds, demo, canSave }: { slug: string; siteId: string; nextSeeds: string[]; demo: boolean; canSave: boolean }) {
  const params = useSearchParams();
  const [kind, setKind] = useState<Kind>("ideas");
  const [query, setQuery] = useState(params.get("seed") ?? "");
  const [stage, setStage] = useState<Stage>({ s: "idle" });
  const [busy, start] = useTransition();
  const [running, startRun] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const seedFromUrl = params.get("seed");

  // a "Research" link in the backlog sets ?seed=…: adopt it (state adjusted while rendering, not in an effect)
  const [adopted, setAdopted] = useState(seedFromUrl);
  if (seedFromUrl !== adopted) {
    setAdopted(seedFromUrl);
    if (seedFromUrl) {
      setQuery(seedFromUrl);
      setKind("ideas");
      setStage({ s: "idle" });
    }
  }
  useEffect(() => {
    if (seedFromUrl) formRef.current?.querySelector<HTMLInputElement>("input[name=query]")?.focus();
  }, [seedFromUrl]);

  const quote = () =>
    start(async () => {
      const q = await quoteResearchAction(slug, siteId, { kind, query });
      if (!q.ok) return setStage({ s: "error", text: q.error });
      if (q.kind === "quote" && q.refusal) return setStage({ s: "refused", reason: q.refusal, text: q.refusalText ?? "", q });
      setStage({ s: "quoted", q });
    });

  const run = (q: Extract<QuoteView, { ok: true }>) =>
    startRun(async () => {
      const r = q.kind === "logged" ? await loggedIdeasAction(slug, siteId, q.logId) : await runResearchAction(slug, siteId, { kind, query }, q.estimateMicros);
      if (!r.ok) return setStage(r.refusal ? { s: "refused", reason: r.refusal, text: r.error } : { s: "error", text: r.error });
      setStage({ s: "result", r });
      requestAnimationFrame(() => resultRef.current?.focus());
    });

  return (
    <div className="stack-lg">
      <div className="rp">
        <form
          ref={formRef}
          className="rp-form"
          onSubmit={(e) => {
            e.preventDefault();
            quote();
          }}
        >
          <Segmented
            label="What to research"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setStage({ s: "idle" });
            }}
            options={[
              { value: "ideas", label: "Keyword ideas" },
              { value: "serp", label: "SERP for a keyword" },
            ]}
          />
          <div className="rp-row">
            <TextField
              label={kind === "ideas" ? "Seed keyword" : "Keyword"}
              name="query"
              value={query}
              maxLength={80}
              autoComplete="off"
              placeholder={kind === "ideas" ? "salon pos" : "salon no show policy"}
              hint={kind === "ideas" ? "Up to 150 related keywords with volume, difficulty, CPC and intent." : "The top 20 Google results, to judge intent and competition."}
              onChange={(e) => {
                setQuery(e.target.value);
                if (stage.s !== "idle") setStage({ s: "idle" });
              }}
            />
            <Button type="submit" variant="secondary" icon="search" loading={busy} disabled={!query.trim()}>
              Get the price
            </Button>
          </div>
          {kind === "ideas" && nextSeeds.length ? (
            <p className="rp-next">
              Next in the backlog:
              {nextSeeds.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQuery(s);
                    setStage({ s: "idle" });
                  }}
                >
                  {s}
                </button>
              ))}
            </p>
          ) : null}
        </form>

        <div aria-live="polite">
          {stage.s === "idle" ? (
            <div className="rp-idle">
              <Icon name="db" />
              <p>Every paid lookup is priced first. You see the cost and what it does to the month&apos;s budget before anything is bought.</p>
            </div>
          ) : stage.s === "quoted" && stage.q.kind === "logged" ? (
            <section className="logged" aria-labelledby="logged-h">
              <p className="label" id="logged-h">
                Already researched
              </p>
              <p>
                This seed was researched on {dateLabel(stage.q.lastAt)}. Its data stays fresh until {dateLabel(stage.q.freshUntil)} (the site&apos;s maximum age), so it is not bought again.
              </p>
              <div className="cost-acts">
                <Button variant="primary" icon="eye" loading={running} onClick={() => run(stage.q)}>
                  Show the logged results · free
                </Button>
                <Button variant="ghost" onClick={() => setStage({ s: "idle" })}>
                  Cancel
                </Button>
              </div>
            </section>
          ) : stage.s === "quoted" && stage.q.kind === "quote" ? (
            <CostConfirm
              title={stage.q.label}
              estimateMicros={stage.q.estimateMicros}
              explain={stage.q.explain}
              cachedAt={stage.q.cachedAt}
              budget={stage.q.budget}
              pending={running}
              demo={demo}
              onConfirm={() => run(stage.q)}
              onCancel={() => setStage({ s: "idle" })}
            />
          ) : stage.s === "refused" ? (
            <Refusal reason={stage.reason} text={stage.text} budget={stage.q?.budget} callMicros={stage.q?.estimateMicros} slug={slug}>
              <Button variant="ghost" size="sm" onClick={() => setStage({ s: "idle" })}>
                Back
              </Button>
            </Refusal>
          ) : stage.s === "error" ? (
            <p className="form-alert" role="alert">
              <Icon name="alert" />
              {stage.text}
            </p>
          ) : null}
        </div>
      </div>

      {stage.s === "result" ? (
        <div className="res" ref={resultRef} tabIndex={-1} role="region" aria-label="Research results">
          {stage.r.kind === "ideas" ? <IdeasResult slug={slug} siteId={siteId} r={stage.r} canSave={canSave} /> : <SerpResult r={stage.r} />}
        </div>
      ) : null}
    </div>
  );
}

function ResultMeta({ status, at, cost }: { status: string; at: string; cost: number }) {
  return (
    <p className="res-meta">
      {status === "ok" ? <Badge tone="ion">Bought · {formatMicros(cost)}</Badge> : status === "cached" ? <Badge tone="info">Cache hit · free</Badge> : <Badge tone="info">From the research log · free</Badge>}
      <span>{dateLabel(at)}</span>
    </p>
  );
}

function SerpResult({ r }: { r: Extract<RunView, { ok: true; kind: "serp" }> }) {
  return (
    <>
      <div className="res-head">
        <h3 className="sub-h">Top results</h3>
        <ResultMeta status={r.status} at={r.at} cost={r.costMicros} />
      </div>
      <ol className="serp-list">
        {r.items.map((i: SerpItem) => (
          <li key={`${i.rank}-${i.url}`} className="serp-item">
            <span className="serp-rank" aria-label={`Position ${i.rank}`}>
              {i.rank}
            </span>
            <span className="serp-title">
              {i.title || i.domain} {i.type !== "organic" ? <Badge>{i.type.replace(/_/g, " ")}</Badge> : null}
            </span>
            <span className="serp-url">{i.url}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

const fitBadge = (r: AnnotatedRow) =>
  r.fit === "offered" ? <Badge tone="ion">Offered</Badge> : r.fit === "not_offered" ? <Badge tone="amber">Not offered</Badge> : <Badge>Unclear fit</Badge>;

export function KdCell({ kd }: { kd: number | null }) {
  if (kd === null) return <span className="muted">—</span>;
  const c = kd >= 60 ? "var(--flare)" : kd >= 35 ? "var(--amber)" : "var(--ion-fill)";
  return (
    <span className="kd">
      {kd}
      <span className="kd-bar" aria-hidden="true" style={{ ["--kd" as string]: kd / 100, ["--kd-c" as string]: c }} />
    </span>
  );
}

function IdeasResult({ slug, siteId, r, canSave }: { slug: string; siteId: string; r: Extract<RunView, { ok: true; kind: "ideas" }>; canSave: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [showExcluded, setShowExcluded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [saving, startSave] = useTransition();
  const capId = useId();
  const excluded = r.rows.filter((x) => x.fit === "not_offered").length;
  const groups = useMemo(() => {
    const byKey = new Map<string, AnnotatedRow[]>();
    for (const row of r.rows) byKey.set(row.variantKey, [...(byKey.get(row.variantKey) ?? []), row]);
    return [...byKey.values()]
      .map((members) => ({ target: members.find((m) => m.target) ?? members[0], members }))
      .filter((g) => showExcluded || g.target.fit !== "not_offered")
      .sort((a, b) => (b.target.volume ?? -1) - (a.target.volume ?? -1));
  }, [r.rows, showExcluded]);
  const selectable = groups.filter((g) => g.target.fit !== "not_offered").map((g) => g.target.keyword);
  const toggle = (k: string) => setPicked((p) => (p.has(k) ? new Set([...p].filter((x) => x !== k)) : new Set([...p, k])));

  return (
    <>
      <div className="res-head">
        <h3 className="sub-h">
          {groups.length} target{groups.length === 1 ? "" : "s"} from {r.rows.length} ideas
        </h3>
        <ResultMeta status={r.status} at={r.at} cost={r.costMicros} />
      </div>
      <div className="kt-filters">
        <Chip pressed={showExcluded} onToggle={() => setShowExcluded((v) => !v)} count={excluded}>
          Show what the business does not sell
        </Chip>
        <span className="muted small">Variants that differ only by place, plural or word order are grouped under one target (one article, never doorway pages).</span>
      </div>
      <div className="tbl-frame" role="region" aria-labelledby={capId} tabIndex={0}>
        <table className="tbl kt">
          <caption className="sr-only" id={capId}>
            Keyword ideas, grouped by variant
          </caption>
          <thead>
            <tr>
              {canSave ? (
                <th scope="col" className="sel">
                  <input
                    type="checkbox"
                    aria-label="Select every target"
                    checked={selectable.length > 0 && selectable.every((k) => picked.has(k))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(selectable) : new Set())}
                  />
                </th>
              ) : null}
              <th scope="col">Keyword</th>
              <th scope="col" className="n">
                Volume
              </th>
              <th scope="col" className="n">
                KD
              </th>
              <th scope="col" className="n hide-phone">
                CPC
              </th>
              <th scope="col" className="hide-phone">
                Intent
              </th>
              <th scope="col">Fit</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) =>
              [g.target, ...g.members.filter((m) => m !== g.target)].map((row) => {
                const isTarget = row === g.target;
                const no = row.fit === "not_offered";
                return (
                  <tr key={row.keyword} data-variant={isTarget ? undefined : ""} data-excluded={no ? "" : undefined} aria-selected={isTarget && picked.has(row.keyword) ? true : undefined}>
                    {canSave ? (
                      <td className="sel">
                        {isTarget ? <input type="checkbox" aria-label={`Select ${row.keyword}`} disabled={no} checked={picked.has(row.keyword)} onChange={() => toggle(row.keyword)} /> : null}
                      </td>
                    ) : null}
                    <th scope="row" className="kw">
                      {row.keyword}
                      {isTarget && g.members.length > 1 ? (
                        <span className="why">
                          +{g.members.length - 1} variant{g.members.length === 2 ? "" : "s"}
                          {row.places.length ? ` · handle ${row.places.join(", ")} inside this one article` : ""}
                        </span>
                      ) : null}
                      {no && row.fitReason ? <span className="why">Does not sell: {row.fitReason}</span> : null}
                    </th>
                    <td className="n">{row.volume?.toLocaleString("en-US") ?? "—"}</td>
                    <td className="n">
                      <KdCell kd={row.kd} />
                    </td>
                    <td className="n hide-phone">{row.cpcMicros === null ? "—" : `$${(row.cpcMicros / 1e6).toFixed(2)}`}</td>
                    <td className="hide-phone">{row.intent ?? <span className="muted">—</span>}</td>
                    <td>{isTarget ? fitBadge(row) : <Badge>Variant</Badge>}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {canSave ? (
        <div className="form-acts">
          <Button
            variant="primary"
            icon="plus"
            loading={saving}
            disabled={!picked.size}
            onClick={() =>
              startSave(async () => {
                const res = await saveIdeasAction(slug, siteId, r.logId, [...picked]);
                toast.push(res.ok ? { tone: "ok", title: res.message ?? "Saved." } : { tone: "danger", title: res.error ?? "Could not save." });
                if (res.ok) {
                  setPicked(new Set());
                  router.refresh();
                }
              })
            }
          >
            Save {picked.size || ""} to keywords
          </Button>
          <span className="muted small">Metrics are saved from the research log, not from this page.</span>
        </div>
      ) : null}
    </>
  );
}
