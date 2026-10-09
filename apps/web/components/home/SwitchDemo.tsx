"use client";

import { useState, type ReactNode } from "react";

type Ap = { s: number; l: number; text: string; sub?: string; one?: boolean; open?: boolean; vb?: boolean; dl?: string };
const COLS: Ap[][] = [
  [
    { s: 0, l: 3, text: "Root touch-up", sub: "10:00 · K. Lee" },
    { s: 4, l: 2, text: "Open", open: true },
    { s: 4, l: 2, text: "Gloss", sub: "Booked by Voice", vb: true, dl: ".25s" },
    { s: 6, l: 2, text: "Toner", sub: "1:00 · R. Diaz" },
    { s: 9, l: 3, text: "Open", open: true },
    { s: 9, l: 3, text: "Balayage", sub: "Booked by Voice", vb: true, dl: ".45s" },
  ],
  [
    { s: 1, l: 1, text: "Cut", sub: "10:30", one: true },
    { s: 2, l: 1, text: "Open", open: true },
    { s: 2, l: 1, text: "Fade", sub: "Voice", vb: true, one: true, dl: ".35s" },
    { s: 4, l: 2, text: "Cut + beard", sub: "12:00 · J. Park" },
    { s: 7, l: 1, text: "Cut", sub: "1:30", one: true },
    { s: 9, l: 1, text: "Open", open: true },
    { s: 9, l: 1, text: "Cut", sub: "Voice", vb: true, one: true, dl: ".55s" },
    { s: 10, l: 2, text: "Kids cut ×2", sub: "3:00" },
  ],
  [
    { s: 0, l: 2, text: "Gel mani", sub: "10:00 · S. Wu" },
    { s: 3, l: 2, text: "Open", open: true },
    { s: 3, l: 2, text: "Pedicure", sub: "Rebooked by Voice", vb: true, dl: ".65s" },
    { s: 6, l: 2, text: "Acrylic fill", sub: "1:00 · M. Ortiz" },
    { s: 9, l: 2, text: "Mani", sub: "2:30" },
  ],
];
const TOTALS = [
  ["Bookings today", "9", "14"],
  ["Calls answered", "Front desk", "23 / 23"],
  ["Open slots", "5", "0"],
] as const;
const TIMES =["10a", "", "11a", "", "12p", "", "1p", "", "2p", "", "3p", ""];

const Tick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5L20 7" />
  </svg>
);

/** "Start with the POS. Add voice whenever you're ready." with the voice on/off switch and POS mock. */
export function SwitchDemo({ deeper }: { deeper?: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <div className="wrap sw-wrap">
      <div className="sw-copy scrim">
        <p className="eyebrow"><b>04</b> POS first, voice anytime</p>
        <h2 id="sw-h">Start with the POS. Add voice whenever you&apos;re ready.</h2>
        <p className="lede">
          Voice is a switch, not a migration. Run the counter on Lumoras POS, a point of sale built for small businesses and
          multi-location brands alike. Turn voice on day one or a year later: it picks up the same customers, the same calendar and
          the same menu you already run.
        </p>
        <div className={on ? "switch-row is-on" : "switch-row"}>
          <button className="switch" type="button" role="switch" aria-checked={on} aria-labelledby="swLbl" onClick={() => setOn((x) => !x)}>
            <i aria-hidden="true" />
          </button>
          <div className="sl" id="swLbl">
            <b>Lumoras Voice</b>
            <span className="off-t">Off · POS only</span>
            <span className="on-t">On · answering every call</span>
          </div>
        </div>
        <ul className="sw-list">
          <li><Tick />No re-entry. Services, prices, staff and policies are already there.</li>
          <li><Tick />Every call, transcript and booking sits on the customer record.</li>
          <li><Tick />Switch it off for a holiday, back on Monday. Nothing to rebuild.</li>
        </ul>
        {deeper}
      </div>

      <div className={on ? "posmock voice rv" : "posmock rv"}>
        <div className="pm-bar">
          <b>Lumoras POS</b>
          <span>Main St · Thursday</span>
          <span className="vbadge">
            <i aria-hidden="true" />
            <span>{on ? "Voice live" : "Voice off"}</span>
          </span>
        </div>
        <div className="pm-body">
          <div className="sched">
            <div className="sched-h mono">
              <span />
              <span>Maya · Color</span>
              <span>Theo · Cuts</span>
              <span>Ana · Nails</span>
            </div>
            <div className="sched-g">
              <div className="times" aria-hidden="true">
                {TIMES.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
              {COLS.map((col, c) => (
                <div className="col" key={c}>
                  {col.map((a, i) => (
                    <div
                      key={i}
                      className={`ap${a.open ? " open" : ""}${a.vb ? " vb" : ""}${a.one ? " one" : ""}`}
                      style={{ ["--s" as string]: a.s, ["--l" as string]: a.l, ...(a.dl ? { ["--dl" as string]: a.dl } : {}) }}
                      aria-hidden={a.vb && !on ? true : a.open && on ? true : undefined}
                    >
                      {a.text}
                      {a.sub ? <small>{a.sub}</small> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <aside className="vpanel" aria-label="Voice layer" aria-hidden={!on}>
            <div className="vpanel-in">
              <div className="vp-h">
                <span>Voice layer</span>
                <b><i className="live-dot" aria-hidden="true" />Live</b>
              </div>
              <div className="mini-orb" aria-hidden="true" />
              <ul className="calls">
                <li><span className="t">2:14p</span><span className="o">(941) ••• 0172</span><span className="r"><b>Booked</b> balayage · $25 deposit</span></li>
                <li><span className="t">1:52p</span><span className="o">(813) ••• 4410</span><span className="r"><b>Rebooked</b> pedicure to 11:30</span></li>
                <li><span className="t">1:30p</span><span className="o">(727) ••• 9083</span><span className="r">Answered parking question</span></li>
                <li><span className="t">11:06a</span><span className="o">(941) ••• 2257</span><span className="r"><b>Booked</b> fade with Theo</span></li>
              </ul>
              <p className="snip"><span>Transcript · 2:14p</span>&ldquo;Maya has 2:30 Thursday for a 90-minute balayage. Want a gloss with that?&rdquo;</p>
            </div>
          </aside>
        </div>
        <dl className="pm-totals">
          {TOTALS.map(([dt, off, onV]) => (
            <div key={dt}>
              <dt>{dt}</dt>
              <dd>
                <span className="v1 num" aria-hidden={on || undefined}>{off}</span>
                <span className="v2 num" aria-hidden={!on || undefined}>{onV}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
