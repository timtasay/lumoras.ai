"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { Button, buttonClass } from "@/components/ui/Button";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { KIND_LABEL } from "@/lib/pipeline/steps";
import type { RunView, StepView } from "@/lib/pipeline/view";
import { formatMicros } from "@/lib/research/money";
import type { ActionState } from "@/lib/actions-state";
import { DetailEmpty, PipelineGraph, type GraphNode, type NodeStatus } from "./PipelineGraph";

export const STEP_ICON: Record<string, IconName> = {
  context: "db",
  scan: "search",
  topic: "target",
  brief: "doc",
  draft: "pen",
  factcheck: "shield",
  lint: "lint",
  review: "gate",
  publish: "send",
  after: "trend",
};

const toNode = (s: StepView["status"]): NodeStatus => (s === "succeeded" ? "done" : s);

function nodeMeta(s: StepView, run: RunView): string {
  switch (s.status) {
    case "running":
      return "Running…";
    case "waiting":
      return s.key === "review" ? "Awaiting review" : s.key === "publish" ? `At the slot · ${run.item.slotLabel}` : "Waiting";
    case "succeeded":
      return `${((s.durationMs ?? 0) / 1000).toFixed(1)}s · ${s.costMicros ? formatMicros(s.costMicros) : "free"}`;
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Queued";
  }
}

/** Short, readable rendering of a JSON value for the step panels. */
function Val({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return <span className="muted">none</span>;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">none</span>;
    if (v.every((x) => typeof x === "string" || typeof x === "number")) return v.slice(0, 8).join(" · ") + (v.length > 8 ? ` +${v.length - 8}` : "");
    return `${v.length} item${v.length === 1 ? "" : "s"}`;
  }
  return `${Object.keys(v as object).length} fields`;
}

const HIDDEN = new Set(["evidence", "results", "candidates", "rejected", "research", "tools", "searchConsole", "fetched", "rationale", "internalLinks", "droppedLinks", "outline", "questions", "claimsToSource", "authors", "hooks", "live", "brand"]);

function Kv({ obj }: { obj: Record<string, unknown> | null }) {
  const rows = Object.entries(obj ?? {}).filter(([k]) => !HIDDEN.has(k));
  if (!rows.length) return <p className="muted small">Nothing recorded.</p>;
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
          <dd>
            <Val v={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Evidence = { claim: string; status: string; sourceUrl: string | null; quote: string | null; note: string; primary: boolean };
type LintRow = { rule: string; label: string; status: "pass" | "warn" | "fail"; detail: string };

function StepExtras({ s }: { s: StepView }) {
  const o = s.output ?? {};
  const ev = Array.isArray(o.evidence) ? (o.evidence as Evidence[]) : null;
  const lint = Array.isArray(o.results) ? (o.results as LintRow[]) : null;
  const rationale = o.rationale && typeof o.rationale === "object" ? (o.rationale as Record<string, string>) : null;
  const rejected = Array.isArray(o.rejected) ? (o.rejected as { keyword: string; reason: string }[]) : null;
  const links = Array.isArray(o.internalLinks) ? (o.internalLinks as { path: string; anchor: string }[]) : null;
  const dropped = Array.isArray(o.droppedLinks) ? (o.droppedLinks as { path: string; reason: string }[]) : null;
  return (
    <>
      {rationale ? (
        <div className="pd-evidence">
          <p className="label">Why this target</p>
          <dl className="kv">
            {Object.entries(rationale).map(([k, v]) => (
              <div key={k}>
                <dt>{k === "whyNow" ? "Why now" : k.charAt(0).toUpperCase() + k.slice(1)}</dt>
                <dd className="wrap">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {rejected?.length ? (
        <details className="pd-more">
          <summary>
            {rejected.length} candidate{rejected.length === 1 ? "" : "s"} refused by the rules
          </summary>
          <ul className="pd-list">
            {rejected.map((r) => (
              <li key={r.keyword}>
                <span className="mono">{r.keyword}</span> <span className="muted">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {links?.length ? (
        <div className="pd-evidence">
          <p className="label">Internal links, live on the publish date</p>
          <ul className="pd-list">
            {links.map((l) => (
              <li key={l.path}>
                <Icon name="check" className="inline-ico ok" /> <span className="mono">{l.path}</span> <span className="muted">“{l.anchor}”</span>
              </li>
            ))}
            {dropped?.map((l) => (
              <li key={`x${l.path}`}>
                <Icon name="close" className="inline-ico bad" /> <span className="mono">{l.path}</span> <span className="muted">dropped: {l.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ev ? (
        <div className="pd-evidence">
          <p className="label">Evidence per claim</p>
          <ul>
            {ev.map((e, i) => (
              <li key={i} data-status={e.status}>
                <Badge tone={e.status === "sourced" ? "ion" : e.status === "rewritten" ? "info" : e.status === "removed" ? "neutral" : "danger"} icon={e.status === "unverifiable" ? "alert" : e.status === "removed" ? "close" : "check"}>
                  {e.status}
                </Badge>
                <span className="ev-claim">{e.claim}</span>
                <span className="ev-src">
                  {e.sourceUrl ?? "no source"}
                  {e.primary ? " · primary" : ""}
                  {e.quote ? ` · “${e.quote.slice(0, 140)}”` : ""}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {lint ? (
        <div className="pd-evidence">
          <p className="label">Lint, rule by rule</p>
          <ul className="lint-list">
            {lint.map((r, i) => (
              <li key={i} data-status={r.status}>
                <Icon name={r.status === "pass" ? "check" : "alert"} />
                <span className="lint-name">{r.label}</span>
                <span className="lint-detail">{r.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * The pipeline run view (the signature screen), live: the page renders the
 * persisted run; an EventSource keeps it current while the worker runs the
 * steps, so nodes light up and the pulse travels as each step completes.
 */
export function LiveRun({
  slug,
  initial,
  canRun,
  retry,
  demo,
}: {
  slug: string;
  initial: RunView;
  canRun: boolean;
  retry: (step: string) => Promise<ActionState>;
  demo: boolean;
}) {
  const [run, setRun] = useState(initial);
  const [live, setLive] = useState(false);
  const focus = run.steps.findIndex((s) => s.status === "running" || s.status === "waiting" || s.status === "failed");
  const [selected, setSelected] = useState<number | null>(focus >= 0 ? focus : run.steps.findIndex((s) => s.key === "factcheck"));
  const [busy, start] = useTransition();
  const toast = useToast();
  const detailId = useId();

  useEffect(() => {
    if (["succeeded", "failed", "canceled"].includes(run.status) && run.id === initial.id) return;
    const es = new EventSource(`/api/w/${slug}/runs/${initial.id}/events`);
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("run", (e) => setRun(JSON.parse((e as MessageEvent).data) as RunView));
    es.addEventListener("end", () => {
      setLive(false);
      es.close();
    });
    es.addEventListener("error", () => setLive(false));
    return () => es.close();
    // re-subscribe after a retry restarts a finished run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, initial.id, run.status === "queued"]);

  const nodes: GraphNode[] = useMemo(() => run.steps.map((s) => ({ key: s.key, label: s.label, icon: STEP_ICON[s.key] ?? "flow", status: toNode(s.status), meta: nodeMeta(s, run) })), [run]);
  const current = run.steps.findIndex((s) => s.status === "running" || s.status === "waiting");
  const failed = run.steps.find((s) => s.status === "failed");
  const light: { state: LightState; text: string } =
    run.status === "running" || run.status === "queued"
      ? { state: "live", text: current >= 0 ? `Running · step ${current + 1} of ${run.steps.length}` : "Queued for the worker" }
      : run.status === "waiting"
        ? { state: "warn", text: run.currentStep === "publish" ? "Approved · publishes at its slot" : "Awaiting review" }
        : run.status === "succeeded"
          ? { state: "ok", text: "Published · run complete" }
          : run.status === "failed"
            ? { state: "error", text: `Failed at ${failed?.label ?? run.currentStep ?? "a step"}` }
            : { state: "idle", text: "Canceled" };
  const work = run.steps.reduce((t, s) => t + (s.durationMs ?? 0), 0);
  const sel = selected === null ? null : run.steps[selected];
  const doRetry = (key: string) =>
    start(async () => {
      const r = await retry(key);
      toast.push(r.ok ? { tone: "ok", title: r.message ?? "Queued." } : { tone: "danger", title: r.error ?? "Could not retry." });
      if (r.ok) setRun((x) => ({ ...x, status: "queued" }));
    });

  return (
    <div className="pipe" data-run={run.status} aria-busy={run.status === "running" || undefined}>
      <header className="pipe-head">
        <div className="pipe-title">
          <p className="label">
            Run {run.id.slice(0, 8)} · {run.domain} · slot {run.item.slotLabel} {demo ? <Badge tone="info">Demo model</Badge> : null}
          </p>
          <h2 className="pipe-h">{run.item.keyword ? `“${run.item.keyword}”` : "Choosing a topic…"}</h2>
          <div className="pipe-lights">
            <StatusLight state={light.state}>{light.text}</StatusLight>
            {live ? <span className="pipe-live mono">LIVE</span> : null}
          </div>
        </div>
        <dl className="pipe-stats">
          <div>
            <dt className="label">Working time</dt>
            <dd className="mono">{(work / 1000).toFixed(1)}s</dd>
          </div>
          <div>
            <dt className="label">Tokens</dt>
            <dd className="mono">{run.tokens.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="label">Cost</dt>
            <dd className="mono">{formatMicros(run.costMicros)}</dd>
          </div>
        </dl>
        <div className="pipe-acts">
          <Link href={`/w/${slug}/content/${run.item.id}`} className={buttonClass(run.status === "waiting" && run.currentStep === "review" ? "primary" : "secondary", "sm")}>
            <span className="btn-label">
              <Icon name="pen" /> {run.status === "waiting" && run.currentStep === "review" ? "Review the article" : "Open the article"}
            </span>
          </Link>
          {failed && canRun ? (
            <Button size="sm" variant="secondary" icon="refresh" loading={busy} onClick={() => doRetry(failed.key)}>
              Retry {failed.label.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </header>

      <PipelineGraph nodes={nodes} selected={selected} onSelect={setSelected} detailId={detailId} />

      <section id={detailId} className="pipe-detail" aria-live="polite" aria-label={sel ? `Step details: ${sel.label}` : "Step details"}>
        {sel ? (
          <div className="pd" key={sel.key}>
            <div className="pd-head">
              <div>
                <p className="label">
                  Step {String(selected! + 1).padStart(2, "0")} · {KIND_LABEL[sel.kind]}
                  {sel.attempt > 1 ? ` · attempt ${sel.attempt}` : ""}
                </p>
                <h3 className="pd-h">{sel.label}</h3>
                <p className="pd-sum">{sel.summary}</p>
              </div>
              <div className="pd-side">
                <Badge tone={sel.status === "succeeded" ? "ion" : sel.status === "waiting" ? "amber" : sel.status === "running" ? "info" : sel.status === "failed" ? "danger" : "neutral"}>
                  {sel.status === "succeeded" ? "Done" : sel.status.charAt(0).toUpperCase() + sel.status.slice(1)}
                </Badge>
                {canRun && ["succeeded", "failed", "skipped"].includes(sel.status) && run.status !== "running" && run.status !== "queued" && sel.key !== "after" ? (
                  <Button size="sm" variant="ghost" icon="refresh" loading={busy} onClick={() => doRetry(sel.key)}>
                    {sel.status === "failed" ? "Retry this step" : "Run again from here"}
                  </Button>
                ) : null}
              </div>
            </div>
            {sel.error ? (
              <p className="form-alert" role="alert">
                <Icon name="alert" />
                {sel.error}
              </p>
            ) : null}
            <div className="pd-grid">
              <div>
                <p className="label">Inputs</p>
                <Kv obj={sel.input} />
              </div>
              <div>
                <p className="label">Outputs</p>
                {sel.status === "pending" ? <p className="muted small">Not run yet.</p> : <Kv obj={sel.output} />}
              </div>
              <div>
                <p className="label">Cost</p>
                <dl className="kv">
                  <div>
                    <dt>Model</dt>
                    <dd className="mono">{sel.model ?? "none"}</dd>
                  </div>
                  <div>
                    <dt>Tokens in · out</dt>
                    <dd className="mono">
                      {(sel.tokens.input + sel.tokens.cacheRead + sel.tokens.cacheWrite).toLocaleString("en-US")} · {sel.tokens.output.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div>
                    <dt>Cache read · write</dt>
                    <dd className="mono">
                      {sel.tokens.cacheRead.toLocaleString("en-US")} · {sel.tokens.cacheWrite.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div>
                    <dt>Charged</dt>
                    <dd className="mono">{sel.costMicros ? formatMicros(sel.costMicros) : "free"}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd className="mono">{sel.durationMs !== null ? `${(sel.durationMs / 1000).toFixed(2)}s` : "–"}</dd>
                  </div>
                </dl>
              </div>
            </div>
            <StepExtras s={sel} />
          </div>
        ) : (
          <DetailEmpty />
        )}
      </section>
    </div>
  );
}
