"use client";

import { useState } from "react";
import { formatDay, formatNumber, type NumberFormat } from "@/lib/ui/format";
import { ChartFigure, Tooltip, linePath, linear, niceTicks, useWidth } from "./chart-kit";

/**
 * Single-series area over time (e.g. organic clicks, 90 days). Crosshair
 * snaps to the nearest day on hover; arrow keys walk it from the keyboard.
 * Two measures of different scale belong in two charts, never two axes.
 */
export function AreaChart({
  title,
  summary,
  dates,
  values,
  seriesLabel,
  format = "int",
  height = 240,
  replay = 0,
}: {
  title: string;
  summary: string;
  dates: Date[];
  values: number[];
  seriesLabel: string;
  format?: NumberFormat;
  height?: number;
  replay?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 46, r: 14, t: 12, b: 28 };
  const ticks = niceTicks(0, Math.max(...values), 4);
  const x = linear([0, values.length - 1], [m.l, width - m.r]);
  const y = linear([0, ticks[ticks.length - 1]], [height - m.b, m.t]);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = linePath(pts);
  const area = `${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const xTickFr = width < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const xTickIdx = xTickFr.map((f) => Math.round(f * (values.length - 1)));

  const nearest = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    return Math.max(0, Math.min(values.length - 1, Math.round(((px - m.l) / (width - m.l - m.r)) * (values.length - 1))));
  };

  return (
    <ChartFigure
      title={title}
      summary={summary}
      table={{
        caption: `${title}: ${seriesLabel} per day`,
        head: ["Date", seriesLabel],
        rows: values.map((v, i) => [formatDay(dates[i]), formatNumber(v, format)]),
      }}
    >
      <div
        ref={ref}
        className="plot"
        tabIndex={0}
        aria-label={`${title}. Use the left and right arrow keys to read daily values.`}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget))}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          setHover((h) => {
            const cur = h ?? values.length - 1;
            if (e.key === "Home") return 0;
            if (e.key === "End") return values.length - 1;
            return Math.max(0, Math.min(values.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
          });
        }}
      >
        <svg width={width} height={height} aria-hidden="true" key={replay}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />
              <text className="axis" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {formatNumber(t, "compact")}
              </text>
            </g>
          ))}
          {xTickIdx.map((i, k) => (
            <text key={k} className="axis" x={x(i)} y={height - 8} textAnchor={k === 0 ? "start" : k === xTickIdx.length - 1 ? "end" : "middle"}>
              {formatDay(dates[i])}
            </text>
          ))}
          <path className="area-fill" d={area} />
          <path className="series-line draw" d={line} pathLength={1} />
          <circle className="end-dot" cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} />
          {hover !== null ? (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={m.t} y2={height - m.b} />
              <circle className="end-dot" cx={x(hover)} cy={y(values[hover])} r={4} />
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <Tooltip
            x={x(hover)}
            y={y(values[hover])}
            width={width}
            title={formatDay(dates[hover])}
            rows={[{ label: seriesLabel, value: formatNumber(values[hover], format), color: "var(--ion-fill)" }]}
          />
        ) : null}
        <p className="sr-only" aria-live="polite">
          {hover !== null ? `${formatDay(dates[hover])}: ${formatNumber(values[hover], format)} ${seriesLabel}` : ""}
        </p>
      </div>
    </ChartFigure>
  );
}
