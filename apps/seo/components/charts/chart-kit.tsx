"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/**
 * Shared pieces for the hand-written SVG charts (no charting library):
 * linear scales, nice ticks, a width observer, the figure frame with its
 * visually hidden data table, and the hover tooltip.
 *
 * Mark rules (dataviz method): 2px lines, ≥8px end markers with a 2px surface
 * ring, ≤24px bars with 4px rounded data ends, a 10% area wash, solid 1px
 * recessive gridlines, text in text tokens (never the series colour), one axis
 * only. Draw-in animations use stroke-dashoffset on pathLength=1 paths and
 * scale transforms on bars: paint and composite only, never layout.
 */

export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number] };

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain, [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** "Nice" tick values (1, 2, 2.5, 5 × 10^n steps) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Observes an element's content width (falls back until measured). */
export function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0].contentRect.width);
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Polyline path through points; null values break the line. */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = "", pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Column with a 4px rounded data end and a square baseline. */
export function columnPath(x: number, y: number, w: number, base: number, r = 4): string {
  const h = base - y;
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${base}Z`;
}

/**
 * The figure every chart sits in: title and summary (the accessible name),
 * an optional legend, the plot, and a visually hidden table with every value.
 */
export function ChartFigure({
  title,
  summary,
  legend,
  table,
  children,
  className,
  actions,
}: {
  title: string;
  summary: string;
  legend?: ReactNode;
  table: { caption: string; head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <figure className={className ? `chart ${className}` : "chart"} role="group" aria-label={title}>
      <figcaption className="chart-head">
        <div>
          <p className="chart-title">{title}</p>
          <p className="chart-sub">{summary}</p>
        </div>
        {actions}
      </figcaption>
      {legend}
      {children}
      {/* a table is never narrower than its content, so the clipping lives on a wrapper */}
      <div className="sr-only">
        <table>
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            {table.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </figure>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "box" }[] }) {
  return (
    <ul className="legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={it.kind === "box" ? "lg-box" : "lg-line"} style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Hover/focus readout: value first (strong), series second; positioned with transform only. */
export function Tooltip({
  x,
  y,
  width,
  title,
  rows,
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  const flip = x > width - 180;
  return (
    <div
      className="tip"
      style={{ transform: `translate(${flip ? x - 12 : x + 12}px, ${y}px) translate(${flip ? "-100%" : "0"}, -50%)` }}
      aria-hidden="true"
    >
      <p className="tip-title">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="tip-row">
          {r.color ? <span className="tip-key" style={{ background: r.color }} /> : null}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </p>
      ))}
    </div>
  );
}
