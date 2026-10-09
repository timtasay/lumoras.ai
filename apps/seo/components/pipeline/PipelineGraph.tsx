"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { prefersReducedMotion } from "@/lib/ui/motion";

export type NodeStatus = "pending" | "running" | "done" | "waiting" | "failed" | "skipped";
export type GraphNode = { key: string; label: string; icon: IconName; status: NodeStatus; meta: string };

type Pt = { x: number; y: number };
const PULSE_MS = 700;
const TRAIL = [0, 0.05, 0.1, 0.15];

/** Segment i joins node i to node i+1: straight along a row, a U-turn at the end of a row. */
function segmentPath(a: Pt, b: Pt, singleColumn: boolean, bulge: number): string {
  if (singleColumn || Math.abs(a.y - b.y) < 4) return `M${a.x},${a.y}L${b.x},${b.y}`;
  if (Math.abs(a.x - b.x) < 4) return `M${a.x},${a.y}C${a.x + bulge},${a.y} ${b.x + bulge},${b.y} ${b.x},${b.y}`;
  const my = (a.y + b.y) / 2;
  return `M${a.x},${a.y}C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
}

const FINISHED = (s: NodeStatus) => s === "done" || s === "skipped";

/**
 * The ten steps as connected nodes (wide: two rows of five, snaking; narrow:
 * one column). The path between finished steps fills in ion; when a step
 * finishes, a pulse travels along the path to the next node. The parent owns
 * the statuses (a live run from server-sent events, or the /design replay);
 * this component only draws them and animates the changes.
 *
 * Motion: the pulse and the running ring move with transform only; the path
 * fills with stroke-dashoffset (paint only). Reduced motion: statuses change
 * in place, no travelling pulse.
 */
export function PipelineGraph({ nodes, selected, onSelect, detailId }: { nodes: GraphNode[]; selected: number | null; onSelect: (i: number | null) => void; detailId: string }) {
  const [pts, setPts] = useState<Pt[]>([]);
  const [single, setSingle] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const graphRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const segRefs = useRef<(SVGPathElement | null)[]>([]);
  const pulseRef = useRef<SVGGElement>(null);
  const raf = useRef(0);
  const prev = useRef<NodeStatus[] | null>(null);

  const measure = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const gr = g.getBoundingClientRect();
    const next = dotRefs.current.slice(0, nodes.length).map((d) => {
      if (!d) return { x: 0, y: 0 };
      const r = d.getBoundingClientRect();
      return { x: Math.round(r.left - gr.left + r.width / 2), y: Math.round(r.top - gr.top + r.height / 2) };
    });
    setPts(next);
    setSingle(next.every((p) => Math.abs(p.x - next[0].x) < 4));
    setBox({ w: Math.round(gr.width), h: Math.round(gr.height) });
  }, [nodes.length]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (graphRef.current) ro.observe(graphRef.current);
    return () => ro.disconnect();
  }, [measure]);

  /** Moves the pulse along segment i. */
  const travel = useCallback((i: number) => {
    const path = segRefs.current[i], g = pulseRef.current;
    if (!path || !g || prefersReducedMotion()) return;
    cancelAnimationFrame(raf.current);
    const len = path.getTotalLength();
    const dots = Array.from(g.children) as SVGElement[];
    const start = performance.now();
    g.style.opacity = "1";
    const frame = (now: number) => {
      const u = Math.min(1, (now - start) / PULSE_MS);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      dots.forEach((d, k) => {
        const p = path.getPointAtLength(Math.max(0, e - TRAIL[k]) * len);
        d.setAttribute("transform", `translate(${p.x} ${p.y})`);
      });
      if (u < 1) raf.current = requestAnimationFrame(frame);
      else g.style.opacity = "0";
    };
    raf.current = requestAnimationFrame(frame);
  }, []);

  // a step that just finished sends the pulse on to the next node (not on first paint)
  useEffect(() => {
    const now = nodes.map((n) => n.status);
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    let last = -1;
    now.forEach((s, i) => {
      if (FINISHED(s) && !FINISHED(before[i] ?? "pending") && i < now.length - 1) last = i;
    });
    if (last >= 0) travel(last);
  }, [nodes, travel]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const colW = pts.length > 1 ? Math.abs(pts[1].x - pts[0].x) : 0;
  const bulge = Math.max(40, Math.min(110, colW / 2 - 6));

  return (
    <div className="pipe-graph" ref={graphRef}>
      <svg className="pipe-svg" width={box.w} height={box.h} aria-hidden="true">
        {pts.length === nodes.length
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
                    data-on={FINISHED(nodes[i].status) && nodes[i + 1].status !== "pending" ? "" : undefined}
                    style={{ transitionDuration: `${PULSE_MS}ms` }}
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
        {nodes.map((s, i) => (
          <li key={s.key} className="pnode" data-status={s.status} data-selected={selected === i ? "" : undefined} data-step={s.key}>
            <button type="button" className="pnode-btn" aria-expanded={selected === i} aria-controls={detailId} onClick={() => onSelect(selected === i ? null : i)}>
              <span
                className="pnode-dot"
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
              >
                <Icon name={s.status === "done" ? "check" : s.status === "failed" ? "alert" : s.status === "skipped" ? "skip" : s.icon} />
                <span className="pnode-ring" aria-hidden="true" />
              </span>
              <span className="pnode-text">
                <span className="pnode-step mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="pnode-label">{s.label}</span>
                <span className="pnode-meta">{s.meta}</span>
                <span className="sr-only">, {STATUS_SR[s.status]}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const STATUS_SR: Record<NodeStatus, string> = { pending: "queued", running: "running", done: "done", waiting: "waiting", failed: "failed", skipped: "skipped" };

export function DetailEmpty({ children }: { children?: ReactNode }) {
  return (
    <p className="pd-empty">
      <Icon name="info" /> {children ?? "Select a step to see its inputs, outputs, cost and evidence."}
    </p>
  );
}
