"use client";

import { useState } from "react";
import { Icon } from "../Icons";
import { setHome } from "@/lib/home-bus";

const ZONES = ["A · Sales floor", "B · Fitting rooms", "C · Entrance", "D · Checkout"];
const DP = [
  { label: "Open", time: "9:00 AM", name: "Doors open", c: "var(--s1)", next: "10:00 AM · Welcome message, all zones",
    z: [["Warm acoustic · 84 BPM", 0.45], ["Ambient piano · 70 BPM", 0.3], ["Bright indie · 96 BPM", 0.55], ["Acoustic soul · 88 BPM", 0.4]] },
  { label: "Midday", time: "12:30 PM", name: "Midday", c: "var(--s2)", next: "12:45 PM · Curbside pickup is ready at Door 2",
    z: [["Indie pop · 104 BPM", 0.6], ["Lo-fi soul · 86 BPM", 0.4], ["Indie pop · 104 BPM", 0.65], ["Neo-soul · 92 BPM", 0.5]] },
  { label: "Rush", time: "4:00 PM", name: "After-work rush", c: "var(--s3)", next: "4:30 PM · Weekend event, Zones A and C",
    z: [["Energy set · 118 BPM", 0.88], ["Nu-disco · 112 BPM", 0.6], ["Energy set · 118 BPM", 0.92], ["Funk edits · 108 BPM", 0.7]] },
  { label: "Close", time: "8:45 PM", name: "Closing", c: "var(--s4)", next: "8:45 PM · 15 minutes to close, all zones",
    z: [["Downtempo · 78 BPM", 0.3], ["Ambient · 66 BPM", 0.2], ["Downtempo · 78 BPM", 0.35], ["Quiet jazz · 72 BPM", 0.3]] },
] as const;

export function DaypartPreview() {
  const [k, setK] = useState(0);
  const d = DP[k];
  return (
    <>
      <div className="daypart" role="group" aria-label="Daypart preview" style={{ ["--dpc" as string]: d.c }}>
        {DP.map((x, i) => (
          <button
            key={x.label}
            className="dp"
            type="button"
            aria-pressed={i === k}
            onClick={() => {
              setK(i);
              setHome({ dp: i });
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="readout" aria-live="polite">
        <div className="ro-head mono">
          <span>SIM · Store 12 · {d.time}</span>
          <strong>{d.name}</strong>
        </div>
        <ul className="zones">
          {ZONES.map((zn, i) => (
            <li key={zn}>
              <span className="zn">{zn}</span>
              <span className="zt">{d.z[i][0]}</span>
              <span className="lvl" aria-hidden="true">
                <i style={{ ["--v" as string]: d.z[i][1] }} />
              </span>
            </li>
          ))}
        </ul>
        <p className="ro-next">
          <Icon name="mega" />
          <span>Next: {d.next}</span>
        </p>
      </div>
    </>
  );
}
