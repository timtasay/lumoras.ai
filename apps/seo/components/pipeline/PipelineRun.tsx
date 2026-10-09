"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { prefersReducedMotion } from "@/lib/ui/motion";
import { KIND_LABEL, REVIEW_INDEX, STEPS, type PipelineStep } from "./steps";

type StepStatus = "pending" | "running" | "done" | "waiting";
type RunState = "idle" | "running" | "waiting" | "done";
type Pt = { x: number; y: number };

const PULSE_MS = 700;
const TRAIL = [0, 0.05, 0.1, 0.15];

/** Segment i joins node i to node i+1: straight along a row, a U-turn at the end of a row. */
function segmentPath(a: Pt, b: Pt, singleColumn: boolean, bulge: number): string {
  if (singleColumn || Math.abs(a.y - b.y) < 4) return `M${a.x},${a.y}L${b.x},${b.y}`;
  if (Math.abs(a.x - b.x) < 4) {
    return `M${a.x},${a.y}C${a.x + bulge},${a.y} ${b.x + bulge},${b.y} ${b.x},${b.y}`;
  }
  const my = (a.y + b.y) / 2;
  return `M${a.x},${a.y}C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
}

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The pipeline run view (signature screen, simulated in Phase 0): ten steps
 * as connected nodes. When a step completes, a pulse travels along the path
 * to the next node. The run pauses at the review gate until someone
 * approves. Every node expands into its inputs, outputs, cost and evidence.
 *
 * Motion: the pulse and the running ring use transform only; the completed
 * path fills with stroke-dashoffset (paint only). Reduced motion: states
 * change in place, no travelling pulse. Phase 3 replaces the timers with
 * server-sent events from the worker.
 */
export function PipelineRun({ autoStart = true, speed = 1 }: { autoStart?: boolean; speed?: number }) {
  const toast = useToast();
  const [status, setStatus] = useState<StepStatus[]>(() => STEPS.map(() => "pending"));
  const [run, setRun] = useState<RunState>("idle");
  const [selected, setSelected] = useState<number | null>(STEPS.findIndex((s) => s.key === "factcheck"));
  const [elapsed, setElapsed] = useState(0);
  const [pts, setPts] = useState<Pt[]>([]);
  const [single, setSingle] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const graphRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const segRefs = useRef<(SVGPathElement | null)[]>([]);
  const pulseRef = useRef<SVGGElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const raf = useRef(0);
  const t0 = useRef(0);
  const started = useRef(false);
  const detailId = useId();

  /* ---------- geometry: node centres → path segments ---------- */
  const measure = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const gr = g.getBoundingClientRect();
    const next = dotRefs.current.map((d) => {
      if (!d) return { x: 0, y: 0 };
      const r = d.getBoundingClientRect();
      return { x: Math.round(r.left - gr.left + r.width / 2), y: Math.round(r.top - gr.top + r.height / 2) };
    });
    setPts(next);
    setSingle(next.every((p) => Math.abs(p.x - next[0].x) < 4));
    setBox({ w: Math.round(gr.width), h: Math.round(gr.height) });
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (graphRef.current) ro.observe(graphRef.current);
    return () => ro.disconnect();
  }, [measure]);

  /* ---------- simulation ---------- */
  const clearAll = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    cancelAnimationFrame(raf.current);
    if (pulseRef.current) pulseRef.current.style.opacity = "0";
  };
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms / speed));

  const setStep = (i: number, s: StepStatus) => setStatus((xs) => xs.map((x, k) => (k === i ? s : x)));

  /** Moves the comet along segment i, then calls done. */
  const travel = (i: number, done: () => void) => {
    const path = segRefs.current[i], g = pulseRef.current;
    if (!path || !g || prefersReducedMotion()) {
      done();
      return;
    }
    const len = path.getTotalLength();
    const dots = Array.from(g.children) as SVGElement[];
    const start = performance.now();
    g.style.opacity = "1";
    const frame = (now: number) => {
      const u = Math.min(1, (now - start) / (PULSE_MS / speed));
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // ease-in-out: leaves one node, lands on the next
      dots.forEach((d, k) => {
        const p = path.getPointAtLength(Math.max(0, e - TRAIL[k]) * len);
        d.setAttribute("transform", `translate(${p.x} ${p.y})`);
      });
      if (u < 1) raf.current = requestAnimationFrame(frame);
      else {
        g.style.opacity = "0";
        done();
      }
    };
    raf.current = requestAnimationFrame(frame);
  };

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
    travel(i, () => startStep(i + 1));
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

  // start once the graph scrolls into view
  useEffect(() => {
    if (!autoStart || !graphRef.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && !started.current) {
        io.disconnect();
        begin();
      }
    }, { threshold: 0.25 });
    io.observe(graphRef.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(() => () => clearAll(), []);

  // elapsed clock, only while running
  useEffect(() => {
    if (run !== "running") return;
    const id = setInterval(() => setElapsed(performance.now() - t0.current), 250);
    return () => clearInterval(id);
  }, [run]);

  /* ---------- derived ---------- */
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
  // the U-turn swings out by most of half a column, clear of the node labels
  const colW = pts.length > 1 ? Math.abs(pts[1].x - pts[0].x) : 0;
  const bulge = Math.max(40, Math.min(110, colW / 2 - 6));

  return (
    <div className="pipe" data-run={run}>
      <header className="pipe-head">
        <div className="pipe-title">
          <p className="label">Run 1042 · lumoras.ai · slot Tue 14 Oct</p>
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

      <div className="pipe-graph" ref={graphRef}>
        <svg className="pipe-svg" width={box.w} height={box.h} aria-hidden="true">
          {pts.length === STEPS.length
            ? pts.slice(0, -1).map((p, i) => {
                const d = segmentPath(p, pts[i + 1], single, bulge);
                return (
                  <g key={i}>
                    <path className="pipe-track" d={d} />
                    <path
                      ref={(el) => {
                        segRefs.current[i] = el;
                      }}
                      className="pipe-fill"
                      data-on={status[i] === "done" ? "" : undefined}
                      style={{ transitionDuration: `${PULSE_MS / speed}ms` }}
                      d={d}
                      pathLength={1}
                    />
                  </g>
                );
              })
            : null}
          <g ref={pulseRef} className="pipe-pulse" style={{ opacity: 0 }}>
            {TRAIL.map((_, k) => (
              <circle key={k} r={k === 0 ? 5 : 4 - k} style={{ opacity: 1 - k * 0.25 } as CSSProperties} />
            ))}
          </g>
        </svg>
        <ol className="pipe-nodes">
          {STEPS.map((s, i) => (
            <li key={s.key} className="pnode" data-status={status[i]} data-selected={selected === i ? "" : undefined}>
              <button
                type="button"
                className="pnode-btn"
                aria-expanded={selected === i}
                aria-controls={detailId}
                onClick={() => setSelected((x) => (x === i ? null : i))}
              >
                <span
                  className="pnode-dot"
                  ref={(el) => {
                    dotRefs.current[i] = el;
                  }}
                >
                  <Icon name={status[i] === "done" ? "check" : s.icon} />
                  <span className="pnode-ring" aria-hidden="true" />
                </span>
                <span className="pnode-text">
                  <span className="pnode-step mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="pnode-label">{s.label}</span>
                  <span className="pnode-meta">
                    {status[i] === "running"
                      ? "Running…"
                      : status[i] === "waiting"
                        ? "Awaiting review"
                        : status[i] === "done"
                          ? s.ms
                            ? `${(s.ms / 1000).toFixed(1)}s · ${s.cost ? `$${s.cost.toFixed(2)}` : "free"}`
                            : "Approved"
                          : "Queued"}
                  </span>
                  <span className="sr-only">, {status[i] === "pending" ? "queued" : status[i]}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

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
