"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { KIND_LABEL, REVIEW_INDEX, STEPS, type PipelineStep } from "./steps";
import { PipelineGraph, type GraphNode } from "./PipelineGraph";

type StepStatus = "pending" | "running" | "done" | "waiting";
type RunState = "idle" | "running" | "waiting" | "done";

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The /design replay of the pipeline run view: the same graph the product
 * uses (PipelineGraph, fed live from persisted steps over server-sent events
 * in components/pipeline/LiveRun.tsx), driven here by a recorded sample run
 * replayed on timers so the motion can be reviewed without a worker.
 */
export function PipelineRun({ autoStart = true, speed = 1 }: { autoStart?: boolean; speed?: number }) {
  const toast = useToast();
  const [status, setStatus] = useState<StepStatus[]>(() => STEPS.map(() => "pending"));
  const [run, setRun] = useState<RunState>("idle");
  const [selected, setSelected] = useState<number | null>(STEPS.findIndex((s) => s.key === "factcheck"));
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const t0 = useRef(0);
  const started = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const detailId = useId();

  const clearAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms / speed));
  const setStep = (i: number, s: StepStatus) => setStatus((xs) => xs.map((x, k) => (k === i ? s : x)));

  const startStep = (i: number) => {
    if (i === REVIEW_INDEX) {
      setStep(i, "waiting");
      setRun("waiting");
      return;
    }
    setStep(i, "running");
    setRun("running");
    later(() => completeStep(i), STEPS[i].ms);
  };
  const completeStep = (i: number) => {
    setStep(i, "done");
    if (i === STEPS.length - 1) {
      setRun("done");
      return;
    }
    // the graph sends the pulse along the path; the next step starts when it lands
    later(() => startStep(i + 1), 700);
  };
  const begin = () => {
    clearAll();
    started.current = true;
    setStatus(STEPS.map(() => "pending"));
    t0.current = performance.now();
    setElapsed(0);
    later(() => startStep(0), 250);
  };
  const approve = () => {
    toast.push({ tone: "ok", title: "Approved", body: "Publishing through the Git connector." });
    completeStep(REVIEW_INDEX);
  };

  useEffect(() => {
    if (!autoStart || !rootRef.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && !started.current) {
        io.disconnect();
        begin();
      }
    }, { threshold: 0.25 });
    io.observe(rootRef.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);
  useEffect(() => () => clearAll(), []);
  useEffect(() => {
    if (run !== "running") return;
    const id = setInterval(() => setElapsed(performance.now() - t0.current), 250);
    return () => clearInterval(id);
  }, [run]);

  const doneSteps = STEPS.filter((_, i) => status[i] === "done");
  const cost = doneSteps.reduce((s, x) => s + x.cost, 0);
  const tokens = doneSteps.reduce((s, x) => s + (x.tokens ?? 0), 0);
  const current = status.findIndex((s) => s === "running" || s === "waiting");
  const light: { state: LightState; text: string } =
    run === "running"
      ? { state: "live", text: `Running · step ${current + 1} of ${STEPS.length}` }
      : run === "waiting"
        ? { state: "warn", text: "Awaiting review" }
        : run === "done"
          ? { state: "ok", text: "Published · run complete" }
          : { state: "idle", text: "Ready" };
  const sel: PipelineStep | null = selected === null ? null : STEPS[selected];
  const nodes: GraphNode[] = STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    status: status[i],
    meta: status[i] === "running" ? "Running…" : status[i] === "waiting" ? "Awaiting review" : status[i] === "done" ? (s.ms ? `${(s.ms / 1000).toFixed(1)}s · ${s.cost ? `$${s.cost.toFixed(2)}` : "free"}` : "Approved") : "Queued",
  }));

  return (
    <div className="pipe" data-run={run} ref={rootRef}>
      <header className="pipe-head">
        <div className="pipe-title">
          <p className="label">Sample run (replayed) · lumoras.ai · slot Tue 14 Oct</p>
          <h3>Rolling generation · “ai receptionist for salons”</h3>
          <StatusLight state={light.state}>{light.text}</StatusLight>
        </div>
        <dl className="pipe-stats">
          <div>
            <dt className="label">Elapsed</dt>
            <dd className="mono">{fmtTime(elapsed)}</dd>
          </div>
          <div>
            <dt className="label">Tokens</dt>
            <dd className="mono">{tokens.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="label">Cost</dt>
            <dd className="mono">${cost.toFixed(2)}</dd>
          </div>
        </dl>
        <div className="pipe-acts">
          {run === "waiting" ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => toast.push({ tone: "info", title: "Changes requested", body: "The draft goes back to the editor with your notes." })}>
                Request changes
              </Button>
              <Button variant="primary" size="sm" icon="check" onClick={approve}>
                Approve and publish
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" icon={run === "idle" ? "play" : "refresh"} onClick={begin} disabled={run === "running"}>
              {run === "idle" ? "Start run" : "Run again"}
            </Button>
          )}
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
                </p>
                <h4>{sel.label}</h4>
                <p className="pd-sum">{sel.summary}</p>
              </div>
              <Badge tone={status[selected!] === "done" ? "ion" : status[selected!] === "waiting" ? "amber" : status[selected!] === "running" ? "info" : "neutral"}>
                {status[selected!] === "pending" ? "Queued" : status[selected!] === "waiting" ? "Awaiting review" : status[selected!] === "done" ? "Done" : "Running"}
              </Badge>
            </div>
            <div className="pd-grid">
              <div>
                <p className="label">Inputs</p>
                <dl className="kv">
                  {sel.inputs.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="label">Outputs</p>
                <dl className="kv">
                  {sel.outputs.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{status[selected!] === "done" || sel.key === "review" ? v : "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <p className="label">Cost</p>
                <dl className="kv">
                  <div>
                    <dt>Model</dt>
                    <dd className="mono">{sel.model ?? "none"}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd className="mono">{sel.tokens ? sel.tokens.toLocaleString("en-US") : "0"}</dd>
                  </div>
                  <div>
                    <dt>Charged</dt>
                    <dd className="mono">{sel.cost ? `$${sel.cost.toFixed(2)}` : "free"}</dd>
                  </div>
                </dl>
              </div>
            </div>
            {sel.evidence ? (
              <div className="pd-evidence">
                <p className="label">Evidence per claim</p>
                <ul>
                  {sel.evidence.map((e) => (
                    <li key={e.claim} data-status={e.status}>
                      <Badge tone={e.status === "sourced" ? "ion" : e.status === "rewritten" ? "info" : "danger"} icon={e.status === "removed" ? "close" : "check"}>
                        {e.status}
                      </Badge>
                      <span className="ev-claim">{e.claim}</span>
                      <span className="ev-src">{e.source}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="pd-empty">
            <Icon name="info" /> Select a step to see its inputs, outputs, cost and evidence.
          </p>
        )}
      </section>
    </div>
  );
}
