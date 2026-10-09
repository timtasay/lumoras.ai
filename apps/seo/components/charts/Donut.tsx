"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/ui/format";
import { ChartFigure } from "./chart-kit";

const COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/**
 * Part-to-whole at a glance (≤4 parts), e.g. this month's spend by category.
 * Segments are stroked arcs separated by a 2px surface gap and draw in one
 * after another. The centre reads the total, or the hovered/focused part.
 */
export function Donut({
  title,
  summary,
  segments,
  unit,
  centerLabel,
  replay = 0,
}: {
  title: string;
  summary: string;
  segments: { label: string; value: number }[];
  unit: string;
  centerLabel: string;
  replay?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 180, r = 74, sw = 16, cx = size / 2, cy = size / 2;
  const gap = 2 / r + sw / r / 2; // 2px surface gap plus the round-cap overhang
  const spans = segments.map((s) => (s.value / total) * Math.PI * 2);
  const arcs = segments.map((s, i) => {
    const a = spans.slice(0, i).reduce((x, y) => x + y, 0);
    return { ...s, d: arc(cx, cy, r, a + gap / 2, a + spans[i] - gap / 2), i };
  });
  const shown = hover === null ? { value: total, label: centerLabel } : { value: segments[hover].value, label: segments[hover].label };
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;

  return (
    <ChartFigure
      title={title}
      summary={summary}
      className="chart-donut"
      table={{
        caption: title,
        head: ["Category", unit, "Share"],
        rows: segments.map((s) => [s.label, formatNumber(s.value), pct(s.value)]),
      }}
    >
      <div className="donut">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" key={replay}>
          <circle className="donut-track" cx={cx} cy={cy} r={r} />
          {arcs.map((s) => (
            <path
              key={s.label}
              className="donut-seg draw"
              data-dim={hover !== null && hover !== s.i ? "" : undefined}
              d={s.d}
              pathLength={1}
              style={{ stroke: COLORS[s.i], animationDelay: `${s.i * 160}ms` }}
              onPointerEnter={() => setHover(s.i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <span className="donut-value">{formatNumber(shown.value)}</span>
          <span className="donut-label">{shown.label}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {segments.map((s, i) => (
          <li
            key={s.label}
            className="dl-item"
            data-active={hover === i ? "" : undefined}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="lg-box" style={{ background: COLORS[i] }} aria-hidden="true" />
            <span className="dl-label">{s.label}</span>
            <span className="dl-val">{formatNumber(s.value)}</span>
            <span className="dl-pct">{pct(s.value)}</span>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}
