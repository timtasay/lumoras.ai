"use client";

import { AreaChart } from "@/components/charts/AreaChart";
import { day } from "@/lib/ui/format";

/**
 * Clicks and impressions over the last 90 days: two measures of different
 * scale, so two charts on the same timeline (never two y-axes). Days Google
 * may still revise are hatched as provisional.
 */
export function TrafficCharts({ days, compact = false }: { days: { day: string; clicks: number; impressions: number; final: boolean }[]; compact?: boolean }) {
  const dates = days.map((d) => day(d.day));
  const firstProv = days.findIndex((d) => !d.final);
  const prov = firstProv >= 0 ? firstProv : null;
  const clicks = days.reduce((s, d) => s + d.clicks, 0), imp = days.reduce((s, d) => s + d.impressions, 0);
  const n = days.length;
  return (
    <div className="traffic">
      <AreaChart
        title="Organic clicks"
        summary={`${clicks.toLocaleString("en-US")} clicks from Google Search in the last ${n} days${prov !== null ? "; the newest days are provisional" : ""}.`}
        dates={dates}
        values={days.map((d) => d.clicks)}
        seriesLabel="clicks"
        provisionalFrom={prov}
        height={compact ? 200 : 230}
      />
      <AreaChart
        title="Impressions"
        summary={`${imp.toLocaleString("en-US")} times the site appeared in Google results in the last ${n} days.`}
        dates={dates}
        values={days.map((d) => d.impressions)}
        seriesLabel="impressions"
        format="compact"
        provisionalFrom={prov}
        color="ice"
        height={compact ? 200 : 230}
      />
    </div>
  );
}
