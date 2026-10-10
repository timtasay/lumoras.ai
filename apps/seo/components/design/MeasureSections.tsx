"use client";

import { HBarChart } from "@/components/charts/HBarChart";
import { NewLostChart } from "@/components/charts/NewLostChart";
import { MoveBadge, PosPill } from "@/components/measure/MoveBadge";
import { HealthPanel, SearchConsoleState } from "@/components/measure/States";
import { movement } from "@/lib/measure/movement";
import type { MeasurementHealth } from "@/lib/measure/health";

const health = (state: MeasurementHealth["state"], headline: string, signals: MeasurementHealth["signals"]): MeasurementHealth => ({ state, headline, signals, lastDataDay: null, zeroDays: 0, window: { start: "", end: "" }, checkedAt: "" });

/** Phase 4 patterns: movement badges, GA4 measurement health, the designed not-connected states, gain/loss and comparison charts. Sample data. */
export function Measure({ replay }: { replay: number }) {
  return (
    <div className="ds-stack" key={replay}>
      <div className="panel pad">
        <p className="label">Rank movement</p>
        <ul className="moves" aria-label="Movement examples">
          {([[14, 9], [3, 7], [5, 5], [null, 18], [22, null], [undefined, 8]] as [number | null | undefined, number | null][]).map(([a, b], i) => (
            <li key={i}>
              <span className="mv-kw">{`sample keyword ${i + 1}`}</span>
              <PosPill p={b} />
              <MoveBadge m={movement(a, b)} />
            </li>
          ))}
        </ul>
      </div>
      <HealthPanel base="/design" health={health("ok", "GA4 is reporting: 1,984 sessions in the last 14 days, data through 8 October.", [])} />
      <HealthPanel base="/design" health={health("warn", "GA4 numbers may be incomplete: check the signals below.", [{ code: "gsc_mismatch", level: "warn", text: "Search Console counted 1,200 clicks but GA4 only 140 organic sessions over the same days. The tag may be missing on some pages or blocked by consent." }])} />
      <HealthPanel base="/design" health={health("error", "GA4 is not measuring this site: zero here does not mean zero traffic.", [{ code: "no_data", level: "error", text: "GA4 recorded no sessions at all in the last 14 days. A missing or broken tag reads exactly like zero traffic: check that the GA4 tag is on every page." }, { code: "no_key_events", level: "info", text: "No key events are set up in GA4, so leads and sales from search cannot be counted." }])} />
      <div className="ds-grid-2">
        <SearchConsoleState state="unconfigured" base="/design" canManage />
        <SearchConsoleState state="none" base="/design" canManage />
        <SearchConsoleState state="syncing" base="/design" canManage />
        <SearchConsoleState state="error" base="/design" canManage={false} detail="Google refused access to the property. Connect again under Connections." />
      </div>
      <div className="bl-grid">
        <NewLostChart title="New and lost referring domains" summary="Sample: against the previous snapshot." unit="referring domains" periods={[{ label: "Q2 2026", added: null, lost: null }, { label: "Q3 2026", added: 6, lost: 2 }, { label: "Q4 2026", added: 4, lost: 3 }]} />
        <HBarChart title="Against the competitors" summary="Sample: referring domains, the site highlighted." unit="referring domains" rows={[{ label: "rival-one.example", value: 379 }, { label: "this-site.example", value: 269, highlight: true, note: "this site" }, { label: "rival-two.example", value: 218 }]} />
      </div>
    </div>
  );
}
