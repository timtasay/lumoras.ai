"use client";

import { useState } from "react";
import { formatDay, formatNumber, type NumberFormat } from "@/lib/ui/format";
import { timeTickIndices, valueTicks } from "@/lib/ui/chart-math";
import { ChartFigure, Tooltip, linePath, linear, useWidth } from "./chart-kit";

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
  provisionalFrom,
  color = "ion",
}: {
  title: string;
  summary: string;
  dates: Date[];
  values: number[];
  seriesLabel: string;
  format?: NumberFormat;
  height?: number;
  replay?: number;
  /** Index of the first day the source may still revise (Search Console's data lag): drawn as a hatched band. */
  provisionalFrom?: number | null;
  /** Series hue: ion (clicks, sessions) or ice (impressions). */
  color?: "ion" | "ice";
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 46, r: 14, t: 12, b: 28 };
  const ticks = valueTicks(values, 4);
  const x = linear([0, values.length - 1], [m.l, width - m.r]);
  const y = linear([0, ticks[ticks.length - 1]], [height - m.b, m.t]);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = linePath(pts);
  const area = `${line}L${x(values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const xTickIdx = timeTickIndices(values.length, width);
  const step = values.length > 1 ? (width - m.l - m.r) / (values.length - 1) : 0;
  const prov = provisionalFrom !== undefined && provisionalFrom !== null && provisionalFrom < values.length ? provisionalFrom : null;

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
        rows: values.map((v, i) => [formatDay(dates[i]), `${formatNumber(v, format)}${prov !== null && i >= prov ? " (provisional)" : ""}`]),
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
          {prov !== null ? (
            <g className="prov">
              <rect className="prov-band" x={x(prov) - step / 2} y={m.t} width={Math.max(0, width - m.r - (x(prov) - step / 2))} height={height - m.t - m.b} />
              <text className="zone-label" x={width - m.r - 4} y={m.t + 10} textAnchor="end">
                Provisional
              </text>
            </g>
          ) : null}
          <path className="area-fill" data-color={color} d={area} />
          <path className="series-line draw" data-color={color} d={line} pathLength={1} />
          <circle className="end-dot" data-color={color} cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} />
          {hover !== null ? (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={m.t} y2={height - m.b} />
              <circle className="end-dot" data-color={color} cx={x(hover)} cy={y(values[hover])} r={4} />
            </g>
          ) : null}
        </svg>
        {hover !== null ? (
          <Tooltip
            x={x(hover)}
            y={y(values[hover])}
            width={width}
            title={formatDay(dates[hover])}
            rows={[{ label: prov !== null && hover >= prov ? `${seriesLabel} (provisional)` : seriesLabel, value: formatNumber(values[hover], format), color: color === "ice" ? "var(--ice)" : "var(--ion-fill)" }]}
          />
        ) : null}
        <p className="sr-only" aria-live="polite">
          {hover !== null ? `${formatDay(dates[hover])}: ${formatNumber(values[hover], format)} ${seriesLabel}` : ""}
        </p>
      </div>
    </ChartFigure>
  );
}
