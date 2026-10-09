"use client";

import { useState } from "react";
import { formatDay } from "@/lib/ui/format";
import { ChartFigure, Legend, Tooltip, linePath, linear, useWidth } from "./chart-kit";

const COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];

/**
 * Rank position over time for up to four keywords. The axis is inverted
 * (position 1 at the top) and the top-3 and page-one zones are marked.
 * Gaps (not ranking) break the line. Fixed series order and colours: a
 * keyword keeps its colour whatever the filter.
 */
export function RankChart({
  title,
  summary,
  dates,
  series,
  maxPos = 40,
  height = 260,
  replay = 0,
}: {
  title: string;
  summary: string;
  dates: Date[];
  series: { name: string; positions: (number | null)[] }[];
  maxPos?: number;
  height?: number;
  replay?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 40, r: 14, t: 10, b: 28 };
  const n = dates.length;
  const x = linear([0, n - 1], [m.l, width - m.r]);
  const y = linear([1, maxPos], [m.t, height - m.b]);
  const ticks = [1, 10, 20, 30, 40].filter((t) => t <= maxPos);
  const xTicks = [0, Math.round((n - 1) / 2), n - 1];
  const nearest = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left - m.l) / (width - m.l - m.r)) * (n - 1))));
  };
  const pos = (p: number | null) => (p === null ? "not ranking" : `#${p}`);

  return (
    <ChartFigure
      title={title}
      summary={summary}
      legend={<Legend items={series.map((s, i) => ({ label: s.name, color: COLORS[i] }))} />}
      table={{
        caption: `${title}: Google position by week (1 is best)`,
        head: ["Week of", ...series.map((s) => s.name)],
        rows: dates.map((d, i) => [formatDay(d), ...series.map((s) => pos(s.positions[i]))]),
      }}
    >
      <div
        ref={ref}
        className="plot"
        tabIndex={0}
        aria-label={`${title}. Use the left and right arrow keys to read positions by week.`}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === "ArrowRight" ? 1 : -1))));
        }}
      >
        <svg width={width} height={height} aria-hidden="true" key={replay}>
          <rect className="zone" x={m.l} y={y(1) - 4} width={width - m.l - m.r} height={y(3) - y(1) + 8} />
          <text className="zone-label" x={m.l + 8} y={y(2)} dy="0.32em">
            Top 3
          </text>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 10 ? "grid grid-strong" : "grid"} x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {t === 1 ? "#1" : t}
              </text>
            </g>
          ))}
          <text className="zone-label" x={m.l + 8} y={y(10) + 12}>
            Page one ↑
          </text>
          {xTicks.map((i, k) => (
            <text key={k} className="axis" x={x(i)} y={height - 8} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>
              {formatDay(dates[i])}
            </text>
          ))}
          {series.map((s, si) => (
            <path
              key={s.name}
              className="series-line draw"
              style={{ stroke: COLORS[si], animationDelay: `${si * 120}ms` }}
              d={linePath(s.positions.map((p, i) => (p === null ? null : { x: x(i), y: y(p) })))}
              pathLength={1}
            />
          ))}
          {series.map((s, si) => {
            const last = s.positions[n - 1];
            return last === null ? null : <circle key={s.name} className="end-dot" style={{ fill: COLORS[si] }} cx={x(n - 1)} cy={y(last)} r={4} />;
          })}
          {hover !== null ? (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={m.t} y2={height - m.b} />
              {series.map((s, si) => {
                const p = s.positions[hover];
                return p === null ? null : <circle key={s.name} className="end-dot" style={{ fill: COLORS[si] }} cx={x(hover)} cy={y(p)} r={4} />;
              })}
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <Tooltip
            x={x(hover)}
            y={height / 2}
            width={width}
            title={`Week of ${formatDay(dates[hover])}`}
            rows={series.map((s, si) => ({ label: s.name, value: pos(s.positions[hover]), color: COLORS[si] }))}
          />
        ) : null}
        <p className="sr-only" aria-live="polite">
          {hover !== null ? `Week of ${formatDay(dates[hover])}: ${series.map((s) => `${s.name} ${pos(s.positions[hover])}`).join(", ")}` : ""}
        </p>
      </div>
    </ChartFigure>
  );
}
