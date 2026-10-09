"use client";

import { useEffect, useRef, useState } from "react";
import { CALLS, VERTICAL_KEYS, type VerticalKey } from "./console-data";
import { startOrb, type OrbApi, type OrbMode } from "./orb-engine";

type Run = { k: VerticalKey; animate: boolean; n: number };
type Prog = { step: number; chars: number; phase: OrbMode; complete: boolean; time: string };

const STATES: Record<OrbMode, string> = { a: "Lumoras is speaking", c: "Listening to caller", idle: "Thinking", done: "Call complete" };
const HOLD = 2200, PAUSE_A = 420, PAUSE_C = 300, LEAD = 350, STILL = 4200;

function plan(k: VerticalKey) {
  const s = CALLS[k].script;
  const chars = s.reduce((a, l) => a + l.t.length, 0);
  const spd = Math.max(12, Math.min(26, 5200 / chars));
  let total = LEAD + HOLD;
  s.forEach((l) => {
    total += Math.ceil(l.t.length / (l.w === "c" ? 2 : 1)) * spd + (l.w === "a" ? PAUSE_A : PAUSE_C);
  });
  return { spd, total };
}
const nextKey = (k: VerticalKey) => VERTICAL_KEYS[(VERTICAL_KEYS.indexOf(k) + 1) % VERTICAL_KEYS.length];
const completeProg = (k: VerticalKey): Prog => ({ step: CALLS[k].script.length, chars: 0, phase: "done", complete: true, time: CALLS[k].dur });

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5L20 7" />
  </svg>
);

/**
 * Live voice-agent demo: industry chips, the canvas orb, a typewriter
 * transcript and the POS ticket it writes. Server-renders the completed salon
 * call; on the client it auto-advances through industries while visible.
 * Reduced motion: a still, completed call per chip.
 */
export function VoiceConsole() {
  const [run, setRun] = useState<Run>({ k: "salon", animate: false, n: 0 });
  const [prog, setProg] = useState<Prog>(() => completeProg("salon"));
  const [chipDur, setChipDur] = useState(0);
  const auto = useRef(true);
  const reduce = useRef(false);
  const visible = useRef(true);
  const wake = useRef<(() => void) | null>(null);
  const orb = useRef<OrbApi | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  // orb + visibility tracking
  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce.current) auto.current = false;
    if (canvasRef.current) orb.current = startOrb(canvasRef.current, "salon");
    const el = consoleRef.current;
    const io =
      el && "IntersectionObserver" in window
        ? new IntersectionObserver((es) => {
            visible.current = es[0].isIntersecting;
            if (visible.current && wake.current) wake.current();
          })
        : null;
    if (el) io?.observe(el);
    const onVis = () => {
      if (!document.hidden && wake.current) wake.current();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      orb.current?.dispose();
      orb.current = null;
    };
  }, []);

  // the call player
  useEffect(() => {
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const t = setTimeout(() => {
          timers.delete(t);
          res();
        }, ms);
        timers.add(t);
      });
    const whenVisible = () =>
      new Promise<void>((res) => {
        const ok = () => visible.current && !document.hidden;
        if (ok()) return res();
        wake.current = () => {
          if (ok()) {
            wake.current = null;
            res();
          }
        };
      });
    const advance = async (hold: number) => {
      await sleep(hold);
      await whenVisible();
      if (alive && auto.current) setRun((r) => ({ k: nextKey(r.k), animate: true, n: r.n + 1 }));
    };
    const setMode = (m: OrbMode) => orb.current?.setMode(m);

    (async () => {
      const { k } = run;
      const v = CALLS[k];
      orb.current?.setVertical(k);
      if (!run.animate) {
        setProg(completeProg(k));
        setMode("done");
        setChipDur(auto.current ? STILL : 0);
        if (auto.current) await advance(STILL);
        return;
      }
      const { spd, total } = plan(k);
      setChipDur(auto.current ? total : 0);
      setProg({ step: 0, chars: 0, phase: "idle", complete: false, time: "00:00" });
      setMode("idle");
      await sleep(LEAD);
      for (let i = 0; i < v.script.length; i++) {
        if (!alive) return;
        const l = v.script[i];
        setProg({ step: i, chars: 0, phase: l.w, complete: false, time: l.ts });
        setMode(l.w);
        // time-based typing: characters follow elapsed time, so a busy main thread
        // can't stretch the call past the chip's progress bar
        const stepN = l.w === "c" ? 2 : 1;
        const lineStart = performance.now();
        for (let c = 0; c < l.t.length; ) {
          await sleep(spd);
          if (!alive) return;
          c = Math.min(l.t.length, Math.floor((performance.now() - lineStart) / spd) * stepN);
          const typed = c;
          setProg((p) => ({ ...p, chars: typed }));
        }
        setProg({ step: i + 1, chars: 0, phase: "idle", complete: false, time: l.ts });
        setMode("idle");
        await sleep(l.w === "a" ? PAUSE_A : PAUSE_C);
      }
      if (!alive) return;
      setProg(completeProg(k));
      setMode("done");
      if (auto.current) await advance(HOLD);
    })();

    return () => {
      alive = false;
      wake.current = null;
      timers.forEach(clearTimeout);
    };
  }, [run]);

  const choose = (k: VerticalKey) => {
    auto.current = false;
    setRun((r) => ({ k, animate: !reduce.current, n: r.n + 1 }));
  };

  const v = CALLS[run.k];
  const filled = new Set<number | "t" | "s">();
  if (prog.complete) {
    v.ticket.rows.forEach((_, i) => filled.add(i));
    filled.add("t");
    filled.add("s");
  } else {
    v.script.slice(0, prog.step).forEach((l) => l.f?.forEach((x) => filled.add(x)));
  }
  const actsOn = new Set(prog.complete ? v.script.map((l) => l.act) : v.script.slice(0, prog.step).map((l) => l.act));

  return (
    <div className="console" id="console" ref={consoleRef} aria-label="Live voice agent demo" role="region" style={{ ["--vc" as string]: v.color }}>
      <div className="console-bar mono">
        <span className="lights" aria-hidden="true"><i /><i /><i /></span>
        <span>Lumoras Voice <span className="hide-sm">· Live demo</span></span>
        <span className="hide-sm">Agent <b>{v.agent}</b></span>
        <span className="push rec"><i aria-hidden="true" />Call <b>{v.id}</b></span>
      </div>
      <div className="chips-scroll">
        <div className="chips" role="group" aria-label="Choose an industry">
          <span className="lbl mono">Industry</span>
          {VERTICAL_KEYS.map((k) => {
            const on = k === run.k;
            return (
              <button
                key={k}
                type="button"
                className={on && chipDur > 0 ? "chip is-running" : "chip"}
                aria-pressed={on}
                style={{ ["--c" as string]: CALLS[k].color, ["--dur" as string]: `${chipDur}ms` }}
                onClick={() => choose(k)}
              >
                {CALLS[k].label}
                <i className="prog" aria-hidden="true" key={on ? `p${run.n}` : "p"} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="console-grid">
        <div className="orb-cell">
          <canvas id="orb" ref={canvasRef} aria-hidden="true" />
          <p className="hud tl mono">Voice orb · <b>{v.label}</b></p>
          <p className="hud tr mono">Inbound · <b>24/7</b><br />First ring</p>
          <p className="orb-state mono" data-s={prog.phase}>
            <i aria-hidden="true" />
            <span>{STATES[prog.phase]}</span>
          </p>
        </div>
        <article className={run.n > 0 ? "ticket morph" : "ticket"} key={`t${run.n}`} aria-live="polite" aria-label="POS ticket">
          <header className="tk-head">
            <span className="tk-kind">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" />
                <path d="M9 8h6M9 12h6" />
              </svg>
              {v.ticket.kind}
            </span>
            <span>{v.ticket.id}</span>
          </header>
          <p className="tk-prod mono">{v.ticket.product} · ticket</p>
          <dl className="tk-rows">
            {v.ticket.rows.map(([dt, dd], i) => (
              <div key={dt} className={filled.has(i) ? "tk-row is-in" : "tk-row"}>
                <dt>{dt}</dt>
                <dd>
                  <span className="val">{dd}</span>
                  <span className="ph" aria-hidden="true" />
                </dd>
              </div>
            ))}
          </dl>
          <div className={filled.has("t") ? "tk-total is-in" : "tk-total"}>
            <span>{v.ticket.totalLabel}</span>
            <b>{v.ticket.total}</b>
          </div>
          <div className={filled.has("s") ? "tk-status is-done" : "tk-status"}>
            <span className="st-wait"><i aria-hidden="true" />Writing to POS</span>
            <span className="st-done">{v.ticket.status} ✓</span>
          </div>
        </article>
        <div className="call-cell">
          <div className="call-head">
            <span className="avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
              </svg>
            </span>
            <div className="call-who">
              <p>{v.caller}</p>
              <p className="mono">{v.line}</p>
            </div>
            <span className="call-time mono">{prog.time}</span>
          </div>
          <ol className="transcript" aria-label="Call transcript">
            {v.script.map((l, i) => {
              const done = prog.complete || i < prog.step;
              const active = !done && i === prog.step && (prog.phase === "a" || prog.phase === "c");
              const typed = done ? l.t : active ? l.t.slice(0, prog.chars) : "";
              return (
                <li key={`${run.k}-${i}`} className={`ln ln-${l.w}${done ? " is-done" : ""}${active ? " is-active" : ""}`}>
                  <span className="who mono">
                    {l.w === "a" ? "Lumoras" : "Caller"}
                    <em>{l.ts}</em>
                  </span>
                  <p className="say">
                    <span className="ghost">{l.t}</span>
                    <span className="typed" aria-hidden="true">{typed}</span>
                  </p>
                </li>
              );
            })}
          </ol>
          <div className="acts">
            <span className="lbl mono">Agent actions</span>
            {v.script
              .filter((l) => l.act)
              .map((l) => (
                <span key={l.act} className={actsOn.has(l.act) ? "act is-on" : "act"}>
                  <Check />
                  {l.act}
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
