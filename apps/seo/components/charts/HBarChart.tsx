"use client";

import { useState, type CSSProperties } from "react";
import { barRightPath, linear, niceTicks } from "@/lib/ui/chart-math";
import { formatNumber } from "@/lib/ui/format";
import { ChartFigure, useWidth } from "./chart-kit";

/**
 * Horizontal bars for comparing a few named things on one measure (the site
 * against its competitors). The highlighted row (the site itself) is ion,
 * the others recessive; labels sit above each bar so long domains never
 * squeeze the plot at 375px. Values are printed at the bar's end.
 */
export function HBarChart({
  title,
  summary,
  rows,
  unit,
}: {
  title: string;
  summary: string;
  rows: { label: string; value: number | null; highlight?: boolean; note?: string }[];
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const rowH = 44, barH = 12, labelW = 0;
  const m = { l: 2, r: 64, t: 4 };
  const ticks = niceTicks(0, Math.max(1, ...rows.map((r) => r.value ?? 0)), 3);
  const x = linear([0, ticks[ticks.length - 1]], [m.l + labelW, width - m.r]);
  const height = m.t + rows.length * rowH;
  return (
    <ChartFigure title={title} summary={summary} table={{ caption: `${title} (${unit})`, head: ["Domain", unit], rows: rows.map((r) => [r.label, r.value === null ? "unknown" : formatNumber(r.value)]) }}>
      <div ref={ref} className="plot">
        <svg width={width} height={height} role="presentation" className="hbars">
          {rows.map((r, i) => {
            const y0 = m.t + i * rowH;
            return (
              <g key={r.label} data-highlight={r.highlight ? "" : undefined} data-hover={hover === i ? "" : undefined}>
                <text className="hbar-label" x={m.l} y={y0 + 13} aria-hidden="true">
                  {r.label}
                  {r.note ? <tspan className="hbar-note"> · {r.note}</tspan> : null}
                </text>
                <rect className="hbar-track" x={x(0)} y={y0 + 20} width={Math.max(0, x(ticks[ticks.length - 1]) - x(0))} height={barH} rx={4} aria-hidden="true" />
                <path className="hbar" d={barRightPath(x(0), y0 + 20, Math.max(0, x(r.value ?? 0) - x(0)), barH)} style={{ "--i": i } as CSSProperties} aria-hidden="true" />
                <text className="hbar-val" x={Math.min(width - 4, x(r.value ?? 0) + 8)} y={y0 + 30} aria-hidden="true">
                  {r.value === null ? "–" : formatNumber(r.value, "compact")}
                </text>
                <rect
                  className="hit"
                  x={0}
                  y={y0}
                  width={width}
                  height={rowH}
                  tabIndex={0}
                  role="img"
                  aria-label={`${r.label}: ${r.value === null ? "unknown" : formatNumber(r.value)} ${unit}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFigure>
  );
}
