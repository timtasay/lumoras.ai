"use client";

import { useState, type CSSProperties } from "react";
import { columnDownPath, columnPath, linear, niceTicks } from "@/lib/ui/chart-math";
import { formatNumber } from "@/lib/ui/format";
import { ChartFigure, Legend, Tooltip, useWidth } from "./chart-kit";

/**
 * Gains and losses per period on one baseline: new items rise above it (ion),
 * lost items hang below it (flare). One axis, one unit; each period is one
 * hover/focus target with both numbers. Columns grow from the baseline
 * (scaleY), 40ms apart.
 */
export function NewLostChart({
  title,
  summary,
  periods,
  unit,
  height = 200,
}: {
  title: string;
  summary: string;
  periods: { label: string; added: number | null; lost: number | null }[];
  unit: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 34, r: 8, t: 14, b: 26 };
  // one whole-number step for both directions, so a gain and a loss of the same size look the same size
  const top = Math.max(1, ...periods.map((p) => p.added ?? 0)), bottom = Math.max(0, ...periods.map((p) => p.lost ?? 0));
  const up = niceTicks(0, top, 2);
  const step = Math.max(1, Math.round(up[1] - up[0]));
  const ticksUp: number[] = [];
  for (let t = 0; t < top + step; t += step) ticksUp.push(t);
  const ticksDown: number[] = [0];
  for (let t = step; t < bottom + step; t += step) ticksDown.push(t);
  const y = linear([-ticksDown[ticksDown.length - 1], ticksUp[ticksUp.length - 1]], [height - m.b, m.t]);
  const band = (width - m.l - m.r) / Math.max(1, periods.length);
  const bw = Math.min(24, band * 0.5);
  const cx = (i: number) => m.l + band * i + band / 2;
  const fmt = (v: number | null) => (v === null ? "no comparison" : formatNumber(v));
  return (
    <ChartFigure
      title={title}
      summary={summary}
      legend={<Legend items={[{ label: `New ${unit}`, color: "var(--ion-fill)", kind: "box" }, { label: `Lost ${unit}`, color: "var(--flare-fill)", kind: "box" }]} />}
      table={{ caption: `${title}: new and lost ${unit} per snapshot`, head: ["Snapshot", `New ${unit}`, `Lost ${unit}`], rows: periods.map((p) => [p.label, fmt(p.added), fmt(p.lost)]) }}
    >
      <div ref={ref} className="plot">
        <svg width={width} height={height} role="presentation">
          {[...ticksUp, ...ticksDown.slice(1).map((t) => -t)].map((t) => (
            <g key={t} aria-hidden="true">
              <line className={t === 0 ? "grid grid-strong" : "grid"} x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {formatNumber(Math.abs(t))}
              </text>
            </g>
          ))}
          {periods.map((p, i) => (
            <g key={p.label}>
              <path className="bar" data-hover={hover === i ? "" : undefined} d={columnPath(cx(i) - bw / 2, y(p.added ?? 0), bw, y(0))} style={{ "--i": i } as CSSProperties} aria-hidden="true" />
              <path className="bar bar-down" data-hover={hover === i ? "" : undefined} d={columnDownPath(cx(i) - bw / 2, y(0), bw, y(-(p.lost ?? 0)))} style={{ "--i": i } as CSSProperties} aria-hidden="true" />
              <text className="axis" x={cx(i)} y={height - 8} textAnchor="middle" aria-hidden="true">
                {p.label}
              </text>
              <rect
                className="hit"
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={height - m.t - m.b}
                tabIndex={0}
                role="img"
                aria-label={`${p.label}: ${fmt(p.added)} new, ${fmt(p.lost)} lost ${unit}`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
        {hover !== null ? (
          <Tooltip
            x={cx(hover)}
            y={y(0)}
            width={width}
            title={periods[hover].label}
            rows={[
              { label: `new ${unit}`, value: fmt(periods[hover].added), color: "var(--ion-fill)" },
              { label: `lost ${unit}`, value: fmt(periods[hover].lost), color: "var(--flare-fill)" },
            ]}
          />
        ) : null}
      </div>
    </ChartFigure>
  );
}
