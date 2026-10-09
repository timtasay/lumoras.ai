"use client";

import { Icon } from "@/components/Icons";
import { formatNumber, type NumberFormat } from "@/lib/ui/format";
import { useCountUp } from "@/lib/ui/motion";
import { Sparkline } from "@/components/charts/Sparkline";

/**
 * KPI tile: label, value that counts up on load (tabular numerals, so the
 * width never jitters), a signed delta coloured by whether the movement is
 * good, and an optional 12-point trend sparkline.
 */
export function KpiTile({
  label,
  value,
  format = "int",
  suffix,
  delta,
  deltaLabel = "vs previous 28 days",
  goodWhen = "up",
  trend,
  tone,
  note,
  replay = 0,
}: {
  label: string;
  value: number;
  format?: NumberFormat;
  suffix?: string;
  /** Percent change (e.g. 12.4 or -3.1). */
  delta?: number;
  deltaLabel?: string;
  goodWhen?: "up" | "down";
  trend?: number[];
  /** Highlights the tile (amber runway warning, for example). */
  tone?: "warn" | "amber" | "danger";
  note?: string;
  replay?: number;
}) {
  const shown = useCountUp(value, 1100, replay);
  const finalText = formatNumber(value, format) + (suffix ?? "");
  const dir = delta === undefined || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good = dir === "flat" ? "neutral" : (dir === goodWhen) ? "good" : "bad";
  return (
    <div className="kpi" data-tone={tone}>
      <p className="kpi-label">{label}</p>
      <div className="kpi-main">
        <p className="kpi-value">
          <span aria-hidden="true">
            {formatNumber(format === "dec1" || format === "usd" ? shown : Math.round(shown), format)}
            {suffix ? <span className="kpi-suffix">{suffix}</span> : null}
          </span>
          <span className="sr-only">{finalText}</span>
        </p>
        {trend ? <Sparkline data={trend} width={80} height={28} label={`${label}, last ${trend.length} weeks`} replay={replay} /> : null}
      </div>
      <div className="kpi-foot">
        {delta !== undefined ? (
          <p className="kpi-delta" data-good={good}>
            {dir !== "flat" ? <Icon name={dir === "up" ? "up" : "down"} /> : null}
            <span>
              {delta > 0 ? "+" : ""}
              {formatNumber(delta, "pct")}
            </span>
            <span className="kpi-delta-label">{deltaLabel}</span>
          </p>
        ) : note ? (
          <p className="kpi-note">{note}</p>
        ) : null}
      </div>
    </div>
  );
}
