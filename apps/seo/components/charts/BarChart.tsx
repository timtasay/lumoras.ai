"use client";

import { useState, type CSSProperties } from "react";
import { formatNumber } from "@/lib/ui/format";
import { ChartFigure, Tooltip, columnPath, linear, niceTicks, useWidth } from "./chart-kit";

/**
 * Columns for a single series over ordered categories (articles published per
 * week). Columns are ≤24px with a 4px rounded data end and grow from the
 * baseline (scaleY), 40ms apart. Each column is its own hover/focus target.
 */
export function BarChart({
  title,
  summary,
  bars,
  seriesLabel,
  height = 220,
  replay = 0,
}: {
  title: string;
  summary: string;
  bars: { label: string; value: number }[];
  seriesLabel: string;
  height?: number;
  replay?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 34, r: 8, t: 18, b: 28 };
  const ticks = niceTicks(0, Math.max(...bars.map((b) => b.value)), 3);
  const y = linear([0, ticks[ticks.length - 1]], [height - m.b, m.t]);
  const band = (width - m.l - m.r) / bars.length;
  const bw = Math.min(24, band * 0.62);
  const cx = (i: number) => m.l + band * i + band / 2;
  const maxI = bars.reduce((best, b, i) => (b.value > bars[best].value ? i : best), 0);
  const labelEvery = Math.ceil(bars.length / Math.max(2, Math.floor(width / 70)));

  return (
    <ChartFigure
      title={title}
      summary={summary}
      table={{ caption: title, head: ["Week", seriesLabel], rows: bars.map((b) => [b.label, b.value]) }}
    >
      <div ref={ref} className="plot">
        <svg width={width} height={height} key={replay} role="presentation">
          {ticks.map((t) => (
            <g key={t} aria-hidden="true">
              <line className="grid" x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => (
            <g key={b.label}>
              <path
                className="bar"
                data-hover={hover === i ? "" : undefined}
                d={columnPath(cx(i) - bw / 2, y(b.value), bw, y(0))}
                style={{ "--i": i } as CSSProperties}
                aria-hidden="true"
              />
              {(i === maxI || i === bars.length - 1) && (
                <text className="bar-val" x={cx(i)} y={y(b.value) - 6} textAnchor="middle" aria-hidden="true">
                  {b.value}
                </text>
              )}
              {i % labelEvery === 0 || i === bars.length - 1 ? (
                <text className="axis" x={cx(i)} y={height - 8} textAnchor="middle" aria-hidden="true">
                  {b.label}
                </text>
              ) : null}
              <rect
                className="hit"
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={height - m.t - m.b}
                tabIndex={0}
                role="img"
                aria-label={`${b.label}: ${b.value} ${seriesLabel}`}
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
            y={y(bars[hover].value)}
            width={width}
            title={bars[hover].label}
            rows={[{ label: seriesLabel, value: formatNumber(bars[hover].value), color: "var(--ion-fill)" }]}
          />
        ) : null}
      </div>
    </ChartFigure>
  );
}
