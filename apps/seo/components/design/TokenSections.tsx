"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { THEME_EVENT } from "@lumoras/ui-tokens/theme";
import { Button } from "@/components/ui/Button";
import { contrast, over, tokenColor } from "@/lib/ui/contrast";

type Role = "text" | "ui" | "fill" | "surface" | "decor";
type Tok = { name: string; role: Role; note?: string; on?: string };

/** Every token group the product uses, with the job each token may do. */
export const TOKEN_GROUPS: { title: string; text: string; tokens: Tok[] }[] = [
  {
    title: "Surfaces",
    text: "Deep near-black control room; white clean room. Panels layer on the void.",
    tokens: [
      { name: "--void", role: "surface", note: "page" },
      { name: "--void-2", role: "surface" },
      { name: "--panel", role: "surface", note: "cards" },
      { name: "--panel-2", role: "surface" },
      { name: "--glass-panel", role: "surface", note: "overlays, with blur" },
    ],
  },
  {
    title: "Ink",
    text: "Text tokens. Contrast is measured live against --panel in the current theme.",
    tokens: [
      { name: "--ink", role: "text", note: "primary" },
      { name: "--ink-2", role: "text", note: "secondary" },
      { name: "--mute", role: "text", note: "supporting" },
      { name: "--dim-text", role: "text", note: "meta, captions" },
      { name: "--dim", role: "decor", note: "never for text" },
    ],
  },
  {
    title: "Accents and states",
    text: "--ion: primary actions, live, positive. --flare / --warn: warnings and the runway alert. --ice / --info: information.",
    tokens: [
      { name: "--ion", role: "text", note: "links, live text" },
      { name: "--ion-fill", role: "fill", on: "--on-ion", note: "primary button" },
      { name: "--flare", role: "text", note: "warnings" },
      { name: "--ice", role: "ui", note: "graphics; use --info for text" },
      { name: "--info", role: "text" },
      { name: "--amber", role: "text", note: "runway below threshold" },
      { name: "--danger", role: "text", note: "errors, runway empty" },
      { name: "--danger-fill", role: "fill", on: "--on-danger", note: "danger button" },
    ],
  },
  {
    title: "Lines",
    text: "Hairlines separate; they are decoration. Control borders use --control-line (3:1).",
    tokens: [
      { name: "--line", role: "decor" },
      { name: "--line-2", role: "decor" },
      { name: "--line-3", role: "decor" },
      { name: "--control-line", role: "ui", note: "inputs, switches" },
    ],
  },
  {
    title: "Industry hues",
    text: "One per vertical, from lumoras.ai. Graphics and accents, 3:1 against panels.",
    tokens: [
      { name: "--v-salon", role: "ui", note: "salons" },
      { name: "--v-restaurant", role: "ui", note: "restaurants" },
      { name: "--v-dental", role: "ui", note: "dental" },
      { name: "--v-auto", role: "ui", note: "auto" },
      { name: "--v-home", role: "ui", note: "home services" },
      { name: "--v-retail", role: "ui", note: "retail" },
    ],
  },
  {
    title: "Chart series",
    text: "Fixed categorical order, validated for colour-vision deficiency and 3:1 on panels in each theme.",
    tokens: [
      { name: "--viz-1", role: "ui" },
      { name: "--viz-2", role: "ui" },
      { name: "--viz-3", role: "ui" },
      { name: "--viz-4", role: "ui" },
    ],
  },
  {
    title: "Spectrum",
    text: "The brand mark gradient and the particle field palette.",
    tokens: [
      { name: "--s1", role: "decor" },
      { name: "--s2", role: "decor" },
      { name: "--s3", role: "decor" },
      { name: "--s4", role: "decor" },
    ],
  },
];

/** Re-renders when the resolved theme changes (control, palette or system). */
function useThemeTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    document.addEventListener(THEME_EVENT, bump);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      document.removeEventListener(THEME_EVENT, bump);
      mq.removeEventListener("change", bump);
    };
  }, []);
  return tick;
}

type Measured = { value: string; ratio: number | null; pass: boolean | null; need: number | null };

function measure(t: Tok, probe: HTMLElement): Measured {
  const value = getComputedStyle(document.documentElement).getPropertyValue(t.name).trim();
  const panel = tokenColor("--panel", probe);
  const c = tokenColor(t.name, probe);
  if (!panel || !c || t.role === "surface" || t.role === "decor") return { value, ratio: null, pass: null, need: null };
  if (t.role === "fill" && t.on) {
    const on = tokenColor(t.on, probe);
    if (!on) return { value, ratio: null, pass: null, need: null };
    const r = contrast(over(on, over(c, panel)), over(c, panel));
    return { value, ratio: r, pass: r >= 4.5, need: 4.5 };
  }
  const need = t.role === "text" ? 4.5 : 3;
  const r = contrast(over(c, panel), panel);
  return { value, ratio: r, pass: r >= need, need };
}

export function Swatches() {
  const probe = useRef<HTMLSpanElement>(null);
  const tick = useThemeTick();
  const [m, setM] = useState<Record<string, Measured>>({});
  useEffect(() => {
    // after the theme reveal settles, read the tokens of the theme now in force
    const id = requestAnimationFrame(() => {
      const p = probe.current;
      if (!p) return;
      const out: Record<string, Measured> = {};
      for (const g of TOKEN_GROUPS) for (const t of g.tokens) out[t.name] = measure(t, p);
      setM(out);
    });
    return () => cancelAnimationFrame(id);
  }, [tick]);

  return (
    <div className="sw-groups">
      <span ref={probe} className="sr-only" aria-hidden="true" />
      {TOKEN_GROUPS.map((g) => (
        <div key={g.title} className="sw-group">
          <div className="sw-ghead">
            <h3>{g.title}</h3>
            <p>{g.text}</p>
          </div>
          <ul className="swatches">
            {g.tokens.map((t) => {
              const x = m[t.name];
              return (
                <li key={t.name} className="swatch" data-token={t.name} data-role={t.role}>
                  <span className="sw-chip" style={{ "--c": `var(${t.name})` } as CSSProperties} aria-hidden="true">
                    {t.role === "fill" && t.on ? <span style={{ color: `var(${t.on})` }}>Aa</span> : t.role === "text" ? <span style={{ color: `var(${t.name})` }}>Aa</span> : null}
                  </span>
                  <span className="sw-meta">
                    <code className="sw-name">{t.name}</code>
                    <span className="sw-val mono">{x?.value ?? "…"}</span>
                    {t.note ? <span className="sw-note">{t.note}</span> : null}
                  </span>
                  {x?.ratio ? (
                    <span className="sw-ratio" data-pass={x.pass ? "" : undefined} title={`Needs ${x.need}:1 (${t.role === "text" || t.role === "fill" ? "text, WCAG 1.4.3" : "graphics, WCAG 1.4.11"})`}>
                      <span className="mono" data-ratio={x.ratio.toFixed(2)}>
                        {x.ratio.toFixed(1)}:1
                      </span>
                      <span>{x.pass ? (x.need === 4.5 ? "AA" : "3:1") : "Fails"}</span>
                    </span>
                  ) : (
                    <span className="sw-ratio" data-na="">
                      <span>{t.role === "surface" ? "surface" : "decor"}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const TYPE: { cls: string; label: string; sample: string; spec: string }[] = [
  { cls: "ty-3xl", label: "Display", sample: "Nine days of runway", spec: "Sora 600 · 56 / 1.0 · -0.04em" },
  { cls: "ty-2xl", label: "Page title", sample: "Content calendar", spec: "Sora 600 · 38 / 1.05" },
  { cls: "ty-xl", label: "Section", sample: "Striking-distance queries", spec: "Sora 600 · 28 / 1.1" },
  { cls: "ty-lg", label: "Card title", sample: "lumoras.ai · weekly report", spec: "Sora 600 · 21 / 1.2" },
  { cls: "ty-md", label: "Lead", sample: "Rolling generation writes each article three days before its slot.", spec: "Geist 400 · 17 / 1.55" },
  { cls: "ty-base", label: "Body", sample: "Every factual claim is checked against a primary source before it can be published.", spec: "Geist 400 · 15 / 1.55" },
  { cls: "ty-sm", label: "Small", sample: "Updated 4 minutes ago by the worker.", spec: "Geist 400 · 13.5 / 1.5" },
  { cls: "ty-label", label: "Label", sample: "Organic clicks · 28 days", spec: "Geist Mono 400 · 11 · 0.14em caps" },
];

export function TypeScale() {
  return (
    <div className="type-grid">
      <ul className="type-list">
        {TYPE.map((t) => (
          <li key={t.cls}>
            <span className="type-meta">
              <span className="label">{t.label}</span>
              <span className="mono muted">{t.spec}</span>
            </span>
            <span className={`type-sample ${t.cls}`}>{t.sample}</span>
          </li>
        ))}
      </ul>
      <div className="panel tabnum">
        <p className="label">Tabular numerals: every metric</p>
        <table>
          <caption className="sr-only">Tabular numerals sample</caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col" className="n">Clicks</th>
              <th scope="col" className="n">Position</th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">sonorch.ai</th><td className="n">12,480</td><td className="n">8.4</td></tr>
            <tr><th scope="row">seasonx.ai</th><td className="n">1,111</td><td className="n">14.2</td></tr>
            <tr><th scope="row">lumoras.ai</th><td className="n">908</td><td className="n">21.7</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SPACE = ["--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6", "--sp-7", "--sp-8", "--sp-9", "--sp-10"];
const RADII = ["--r-xs", "--r-sm", "--r-md", "--r", "--r-lg", "--r-pill"];
const ELEV: { name: string; text: string }[] = [
  { name: "--elev-1", text: "Cards at rest" },
  { name: "--elev-2", text: "Raised: menus, popovers" },
  { name: "--elev-3", text: "Overlays: dialogs, palette" },
  { name: "--glow-ion", text: "Primary action" },
  { name: "--glow-live", text: "Live state only" },
  { name: "--focus-ring", text: "Focus (with the --ion outline)" },
];

export function SpaceRadiiElevation() {
  return (
    <div className="sre">
      <div className="sre-col">
        <h3>Spacing</h3>
        <ul className="space-list">
          {SPACE.map((s) => (
            <li key={s}>
              <code>{s}</code>
              <span className="space-bar" style={{ width: `var(${s})` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
      <div className="sre-col">
        <h3>Radii</h3>
        <ul className="radii">
          {RADII.map((r) => (
            <li key={r}>
              <span className="radius-box" style={{ borderRadius: `var(${r})` }} aria-hidden="true" />
              <code>{r}</code>
            </li>
          ))}
        </ul>
      </div>
      <div className="sre-col sre-wide">
        <h3>Elevation and glow</h3>
        <ul className="elev">
          {ELEV.map((e) => (
            <li key={e.name} className="elev-tile" style={{ boxShadow: `var(${e.name})` }}>
              <code>{e.name}</code>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const MOTION: { name: string; ms: string; use: string; ease: string }[] = [
  { name: "--dur-fast", ms: "140ms", use: "Hover, press, toggles", ease: "--ease-out" },
  { name: "--dur-ui", ms: "180ms", use: "Interface feedback, leaving", ease: "--ease-in" },
  { name: "--dur-panel", ms: "320ms", use: "Panels, dialogs, reveals", ease: "--ease-out" },
  { name: "--dur-route", ms: "380ms", use: "Route and list → detail morphs", ease: "--ease-out" },
  { name: "--dur-chart", ms: "900ms", use: "Charts drawing in", ease: "--ease-out" },
];

export function MotionDemo() {
  const [on, setOn] = useState(false);
  return (
    <div className="motion">
      <div className="motion-head">
        <p className="muted">
          Motion shows state, progress and cause. Enter with ease-out, leave with ease-in, no bounce on data. Transform and
          opacity only. Under reduced motion everything is instant or a cross-fade.
        </p>
        <Button size="sm" icon="play" onClick={() => setOn((o) => !o)} aria-pressed={on}>
          {on ? "Send back" : "Play"}
        </Button>
      </div>
      <ul className="motion-list" data-on={on ? "" : undefined}>
        {MOTION.map((m) => (
          <li key={m.name}>
            <span className="motion-meta">
              <code>{m.name}</code>
              <span className="mono muted">
                {m.ms} · {m.ease}
              </span>
              <span className="motion-use">{m.use}</span>
            </span>
            <span className="motion-track" aria-hidden="true">
              <span className="motion-runner" style={{ transitionDuration: `var(${m.name})`, transitionTimingFunction: `var(${on ? "--ease-out" : "--ease-in"})` }}>
                <span className="motion-dot" />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
