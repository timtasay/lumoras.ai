"use client";

import { useEffect, useRef, useState } from "react";
import { setHome } from "@/lib/home-bus";

type ZoneKey = "entrance" | "apparel" | "fitting" | "checkout";
type Daypart = {
  label: string;
  time: string;
  now: string;
  ring: string;
  ann: string;
  annZone: string;
  z: Record<ZoneKey, [string, number, number]>;
};

/** Order matches the particle field's daypart index (0 open … 3 close). */
const DP: Daypart[] = [
  {
    label: "Open", time: "9:00 am", now: "9:00 am · Open", ring: "var(--v-salon)", ann: "“Good morning. Fitting rooms are open and staffed.”", annZone: "All zones",
    z: { entrance: ["First Light · acoustic", 38, 84], apparel: ["First Light · acoustic", 34, 84], fitting: ["Room Tone · warm", 26, 72], checkout: ["First Light · acoustic", 32, 84] },
  },
  {
    label: "Midday", time: "12:00 pm", now: "12:00 pm · Midday", ring: "var(--v-dental)", ann: "“Express checkout is open at register two.”", annZone: "Checkout",
    z: { entrance: ["Daylight · indie pop", 52, 98], apparel: ["Daylight · indie pop", 48, 98], fitting: ["Room Tone · bright", 32, 86], checkout: ["Daylight · radio edit", 44, 96] },
  },
  {
    label: "4 pm rush", time: "4:00 pm", now: "4:00 pm · Rush", ring: "var(--v-restaurant)", ann: "“Curbside pickup for order 2214 is ready at the front door.”", annZone: "Entrance",
    z: { entrance: ["Energy set · house", 68, 118], apparel: ["Energy set · house", 62, 118], fitting: ["Low-end lift", 40, 100], checkout: ["Energy set · radio edit", 56, 112] },
  },
  {
    label: "Close", time: "8:45 pm", now: "8:45 pm · Close", ring: "var(--ring-close)", ann: "“We close in 15 minutes. Thank you for shopping with us tonight.”", annZone: "All zones",
    z: { entrance: ["Wind Down · ambient", 30, 76], apparel: ["Wind Down · ambient", 28, 76], fitting: ["Room Tone · low", 22, 70], checkout: ["Wind Down · ambient", 34, 76] },
  },
];
export const DEFAULT_DAYPART = 2;

const ROWS: [ZoneKey, string][] = [["entrance", "Entrance"], ["apparel", "Apparel"], ["fitting", "Fitting rooms"], ["checkout", "Checkout"]];

/** Floor-plan zone with its speaker and three expanding rings. */
function Zone({ z, d, cx, cy, r, children }: { z: ZoneKey; d: Daypart; cx: number; cy: number; r: number; children: React.ReactNode }) {
  const [, vol, bpm] = d.z[z];
  const style = {
    ["--amp" as string]: (0.35 + (vol / 100) * 0.9).toFixed(3),
    ["--spd" as string]: `${((60 / bpm) * 3.2).toFixed(2)}s`,
    ["--zf" as string]: `color-mix(in srgb, ${d.ring} ${Math.round(vol / 9)}%, transparent)`,
  };
  return (
    <g className="fz" style={style}>
      {children}
      <g className="rings" style={{ ["--o" as string]: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={r} />
        <circle cx={cx} cy={cy} r={r} />
        <circle cx={cx} cy={cy} r={r} />
      </g>
      <circle className="spk-o" cx={cx} cy={cy} r="9" />
      <circle className="spk" cx={cx} cy={cy} r="3.5" />
    </g>
  );
}

/** Retail Sound: floor plan with four zones, daypart switcher and zone readout. Daypart drives the particle rings too. */
export function RetailSound() {
  const [i, setI] = useState(DEFAULT_DAYPART);
  const [shown, setShown] = useState(DEFAULT_DAYPART); // text cross-fades 300ms behind the visuals
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const d = DP[i], t = DP[shown];
  const swapping = shown !== i;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const pick = (k: number) => {
    setI(k);
    setHome({ dp: k });
    if (timer.current) clearTimeout(timer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setShown(k);
    else timer.current = setTimeout(() => setShown(k), 300);
  };

  return (
    <div className="sound-wrap" style={{ ["--ring" as string]: d.ring }}>
      <div className="floor rv">
        <div className="floor-h">
          <span>Floor plan · <b>Flagship, 2nd Ave</b></span>
          <span>{d.now}</span>
        </div>
        <svg viewBox="0 0 640 420" role="img" aria-labelledby="fpTitle">
          <title id="fpTitle">Store floor plan with four sound zones: Entrance, Apparel, Fitting rooms and Checkout</title>
          <rect className="fp-wall" x="8" y="8" width="624" height="404" rx="16" fill="none" strokeWidth="1.5" />
          <Zone z="apparel" d={d} cx={220} cy={150} r={110}>
            <rect className="z" x="20" y="20" width="400" height="250" rx="10" />
            <rect className="fixture" x="52" y="70" width="110" height="10" rx="5" />
            <rect className="fixture" x="52" y="120" width="110" height="10" rx="5" />
            <rect className="fixture" x="52" y="170" width="110" height="10" rx="5" />
            <rect className="fixture" x="290" y="70" width="100" height="10" rx="5" />
            <rect className="fixture" x="290" y="200" width="100" height="10" rx="5" />
            <circle className="fixture" cx="330" cy="140" r="22" />
            <text x="36" y="44">Apparel</text>
          </Zone>
          <Zone z="fitting" d={d} cx={560} cy={150} r={80}>
            <rect className="z" x="430" y="20" width="190" height="250" rx="10" />
            <path className="fp-part" d="M430 105h70M430 185h70M500 20v250" />
            <text x="446" y="44">Fitting rooms</text>
          </Zone>
          <Zone z="entrance" d={d} cx={140} cy={350} r={90}>
            <rect className="z" x="20" y="280" width="240" height="120" rx="10" />
            <path className="fp-door" d="M80 412h100" strokeWidth="4" />
            <path className="fp-post" d="M80 404v14M180 404v14" strokeWidth="1.5" />
            <text x="36" y="304">Entrance</text>
          </Zone>
          <Zone z="checkout" d={d} cx={450} cy={330} r={90}>
            <rect className="z" x="270" y="280" width="350" height="120" rx="10" />
            <rect className="fixture" x="330" y="352" width="200" height="22" rx="6" />
            <text x="286" y="304">Checkout</text>
          </Zone>
        </svg>
        <div className="daypart" role="group" aria-label="Daypart" style={{ ["--i" as string]: i }}>
          <span className="thumb" aria-hidden="true" />
          {DP.map((x, k) => (
            <button key={x.label} type="button" aria-pressed={k === i} onClick={() => pick(k)}>
              <b>{x.label}</b>
              <span>{x.time}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="zlist rv" aria-live="polite">
        {ROWS.map(([z, name]) => {
          const [, vol, bpm] = d.z[z];
          return (
            <div className="zrow" key={z}>
              <h3>{name}</h3>
              <p className={swapping ? "set swap" : "set"}>{t.z[z][0]}</p>
              <p className="vol">
                <span>{vol}%</span>
                <small>{bpm} BPM</small>
              </p>
              <div className="bar">
                <i style={{ ["--v" as string]: (vol / 100).toFixed(2) }} />
              </div>
            </div>
          );
        })}
        <div className="ann">
          <span>
            <i aria-hidden="true" />
            Announcement queued · {t.annZone}
          </span>
          <p className={swapping ? "swap" : undefined}>{t.ann}</p>
        </div>
        <p className="sync mono">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2" />
            <path d="M21 4v5h-5M3 20v-5h5" />
          </svg>
          Synced to every location · one console
        </p>
      </div>
    </div>
  );
}
