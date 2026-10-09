"use client";

import { useState } from "react";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarChart } from "@/components/charts/BarChart";
import { Donut } from "@/components/charts/Donut";
import { RankChart } from "@/components/charts/RankChart";
import { CalendarMini, type CalItem } from "@/components/ui/CalendarMini";
import { Segmented } from "@/components/ui/Fields";
import { addDays, day } from "@/lib/ui/format";

/* Sample data, deterministic so server and client render the same thing. */
const TODAY = day("2026-10-09");
const START = addDays(TODAY, -89);
const DATES = Array.from({ length: 90 }, (_, i) => addDays(START, i));
const CLICKS = DATES.map((d, i) => {
  const weekday = d.getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 0.72 : 1;
  const growth = 260 + i * 3.1;
  const wobble = Math.sin(i * 1.7) * 22 + Math.sin(i * 0.37) * 30;
  return Math.round((growth + wobble) * weekend);
});
const WEEKS = Array.from({ length: 12 }, (_, i) => addDays(TODAY, -7 * (11 - i)));
const fmtW = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const PUBLISHED = [1, 2, 2, 1, 2, 3, 2, 2, 1, 2, 3, 2].map((v, i) => ({ label: fmtW(WEEKS[i]), value: v }));
const RANKS = [
  { name: "salon no show policy", positions: [28, 24, 21, 17, 15, 12, 10, 9, 8, 7, 6, 6] },
  { name: "ai receptionist for salons", positions: [null, null, null, 38, 33, 29, 24, 21, 19, 17, 15, 14] },
  { name: "how to reduce no shows", positions: [15, 14, 14, 12, 12, 11, 11, 10, 9, 9, 9, 9] },
  { name: "ai answering service cost", positions: [19, 20, 22, 21, 24, 25, 23, 22, 22, 21, 22, 22] },
];

export function Charts({ replay }: { replay: number }) {
  return (
    <div className="chart-grid">
      <div className="span-2">
        <AreaChart
          title="Organic clicks"
          summary="sonorch.ai · last 90 days · from Search Console"
          dates={DATES}
          values={CLICKS}
          seriesLabel="clicks"
          replay={replay}
        />
      </div>
      <BarChart title="Articles published" summary="Per week, last 12 weeks" bars={PUBLISHED} seriesLabel="articles" height={300} replay={replay} />
      <Donut
        title="Spend this month"
        summary="By category, in credits"
        unit="Credits"
        centerLabel="credits used"
        segments={[
          { label: "SEO data", value: 620 },
          { label: "Drafting", value: 380 },
          { label: "Fact-checking", value: 214 },
          { label: "Social", value: 70 },
        ]}
        replay={replay}
      />
      <div className="span-2">
        <RankChart title="Rank movements" summary="Google position by week · 1 is best" dates={WEEKS} series={RANKS} replay={replay} />
      </div>
    </div>
  );
}

const SCEN = {
  ok: { days: 18, label: "Healthy" },
  low: { days: 6, label: "Below threshold" },
  empty: { days: 0, label: "Empty" },
} as const;

function calItems(days: number): CalItem[] {
  const items: CalItem[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = day(`2026-10-${String(d).padStart(2, "0")}`);
    const wd = date.getUTCDay();
    if (wd !== 2 && wd !== 5) continue; // Tuesday and Friday slots
    const iso = date.toISOString().slice(0, 10);
    if (date < TODAY) items.push({ date: iso, title: "Published article", status: "published" });
    else if (date < addDays(TODAY, days)) {
      const lead = (date.getTime() - TODAY.getTime()) / 86_400_000;
      items.push({ date: iso, title: lead <= 3 ? "Writing now (3 days ahead)" : "Scheduled article", status: lead <= 3 ? "generating" : "scheduled" });
    }
  }
  return items;
}

export function Calendar() {
  const [s, setS] = useState<keyof typeof SCEN>("low");
  return (
    <div className="cal-demo">
      <div className="row-demo">
        <Segmented
          label="Runway scenario"
          size="sm"
          value={s}
          onChange={setS}
          options={(Object.keys(SCEN) as (keyof typeof SCEN)[]).map((k) => ({ value: k, label: SCEN[k].label }))}
        />
      </div>
      <div className="cal-split">
        <CalendarMini year={2026} month={9} today={TODAY} items={calItems(SCEN[s].days)} runwayDays={SCEN[s].days} threshold={10} />
        <aside className="panel runway-note" aria-label="How the runway works">
          <p className="label">Runway rules</p>
          <ul>
            <li data-runway="ok">
              <span className="rw-key" aria-hidden="true" />
              <span>
                <strong>Healthy</strong> At or above the site threshold (default 10 days). Nothing to do.
              </span>
            </li>
            <li data-runway="low">
              <span className="rw-key" aria-hidden="true" />
              <span>
                <strong>Below threshold</strong> Amber band, dashboard banner and an email to the editors.
              </span>
            </li>
            <li data-runway="empty">
              <span className="rw-key" data-kind="gap" aria-hidden="true" />
              <span>
                <strong>Empty</strong> Red, hatched: the queue has run dry. This is what happened to sonorch.ai on 7 October.
              </span>
            </li>
          </ul>
          <p className="muted small">Articles are written 3 days before their slot (rolling), so the dots in blue are being drafted now.</p>
        </aside>
      </div>
    </div>
  );
}
