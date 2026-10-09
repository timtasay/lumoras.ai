/**
 * Voice Core orb, ported from prototypes/a-voice-core.html: three layered,
 * noise-shaped blobs, an orbit ring with a marker and a ring of spectrum ticks.
 * Shape and motion are per industry; colours come from CSS tokens
 * (--orb-<k>, -hi, -rim, --orb-light, --orb-tick, --orb-line) so both themes
 * are designed in CSS. Dark uses additive glow, light normal compositing.
 */
import { VERTICAL_KEYS, type VerticalKey } from "./console-data";

type RGB = [number, number, number];
type Shape = { h: number[]; spd: number; spike: number };
type Col = { c1: RGB; c2: RGB; rim: RGB };
type Pal = { light: number; tick: RGB; line: RGB; v: Record<VerticalKey, Col> };
export type OrbMode = "a" | "c" | "idle" | "done";
export type OrbApi = { setVertical: (k: VerticalKey) => void; setMode: (m: OrbMode) => void; dispose: () => void };

const SHAPES: Record<VerticalKey, Shape> = {
  salon: { h: [0.055, 0.036, 0.022, 0.012, 0.006], spd: 0.55, spike: 0.006 },
  restaurant: { h: [0.035, 0.06, 0.03, 0.02, 0.01], spd: 0.85, spike: 0.012 },
  dental: { h: [0.03, 0.018, 0.01, 0.006, 0.003], spd: 0.4, spike: 0.003 },
  auto: { h: [0.018, 0.03, 0.042, 0.034, 0.02], spd: 1.05, spike: 0.022 },
  home: { h: [0.07, 0.03, 0.034, 0.016, 0.01], spd: 0.75, spike: 0.01 },
  retail: { h: [0.04, 0.05, 0.036, 0.03, 0.024], spd: 1.15, spike: 0.016 },
};

const TAU = Math.PI * 2;
const clone = (p: Shape): Shape => ({ h: p.h.slice(), spd: p.spd, spike: p.spike });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixShape = (a: Shape, b: Shape, t: number): Shape => ({
  h: a.h.map((v, i) => v + (b.h[i] - v) * t),
  spd: lerp(a.spd, b.spd, t),
  spike: lerp(a.spike, b.spike, t),
});
const mixC = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mixCol = (a: Col, b: Col, t: number): Col => ({ c1: mixC(a.c1, b.c1, t), c2: mixC(a.c2, b.c2, t), rim: mixC(a.rim, b.rim, t) });
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function parseColor(str: string): RGB {
  const v = (str || "").trim();
  if (v[0] === "#") {
    let h = v.slice(1);
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = v.match(/[\d.]+/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [128, 128, 128];
}

function readPalette(): Pal {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => parseColor(cs.getPropertyValue(n));
  const v = {} as Record<VerticalKey, Col>;
  VERTICAL_KEYS.forEach((k) => {
    v[k] = { c1: g(`--orb-${k}`), c2: g(`--orb-${k}-hi`), rim: g(`--orb-${k}-rim`) };
  });
  const light = Math.max(0, Math.min(1, parseFloat(cs.getPropertyValue("--orb-light")) || 0));
  return { light, tick: g("--orb-tick"), line: g("--orb-line"), v };
}
const mixPal = (a: Pal, b: Pal, t: number): Pal => {
  const v = {} as Record<VerticalKey, Col>;
  VERTICAL_KEYS.forEach((k) => {
    v[k] = mixCol(a.v[k], b.v[k], t);
  });
  return { light: lerp(a.light, b.light, t), tick: mixC(a.tick, b.tick, t), line: mixC(a.line, b.line, t), v };
};

export function startOrb(cv: HTMLCanvasElement, initial: VerticalKey): OrbApi {
  const ctx = cv.getContext("2d");
  const noop: OrbApi = { setVertical: () => {}, setMode: () => {}, dispose: () => {} };
  if (!ctx) return noop;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduce = mq.matches;
  let W = 0, H = 0, wide = true;
  let cur = clone(SHAPES[initial]);
  let from: Shape | null = null, to: Shape | null = null, t0 = 0;
  let P = readPalette();
  let palFrom: Pal | null = null, palTo: Pal | null = null, pt0 = 0;
  let curK: VerticalKey = initial, toK: VerticalKey | null = null;
  let colFrom: Col | null = null, col: Col = P.v[initial];
  let mode: OrbMode = "done", energy = 0.3, phaseT = 0, last = performance.now();
  let visible = true, raf = 0, disposed = false;
  const scales = [1.08, 0.94, 0.78];
  if (reduce) { phaseT = 2.4; energy = 0.5; }

  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height; wide = W > 560 && window.innerWidth > 900;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function blob(cx: number, cy: number, R: number, scale: number, layer: number, t: number, e: number) {
    const p = new Path2D();
    const M = 140, dir = layer % 2 ? -1 : 1, amp = 0.65 + 1.35 * e;
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * TAU;
      let d = 0;
      for (let k = 0; k < cur.h.length; k++) d += cur.h[k] * Math.sin((k + 2) * a + dir * t * cur.spd * (1 + k * 0.37) + layer * 1.7 + k);
      d += cur.spike * Math.sin(11 * a - t * 3.2 * cur.spd) * (0.3 + e);
      const rr = R * scale * (1 + d * amp + 0.03 * e * Math.sin(t * 7 + layer));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (j) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
    return p;
  }

  // Dark: additive glow ('lighter'). Light: normal compositing, saturated body, darker rim, coloured drop shadow.
  function blobs(paths: Path2D[], solid: boolean, k: number, cx: number, cy: number, R: number) {
    const c = col, g = ctx!;
    g.save();
    g.globalCompositeOperation = solid ? "source-over" : "lighter";
    g.globalAlpha = k;
    if (solid) {
      g.shadowColor = rgba(c.rim, 0.3); g.shadowBlur = R * 0.6; g.shadowOffsetY = R * 0.16;
      const bg = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.2);
      bg.addColorStop(0, rgba(c.c2, 0.96)); bg.addColorStop(0.5, rgba(c.c1, 0.94)); bg.addColorStop(1, rgba(mixC(c.c1, c.rim, 0.55), 0.94));
      g.fillStyle = bg; g.fill(paths[0]);
      g.shadowColor = "rgba(0,0,0,0)"; g.shadowBlur = 0; g.shadowOffsetY = 0;
    }
    const alphas = solid ? [0.22, 0.34, 0.5] : [0.3, 0.4, 0.55];
    for (let L = 0; L < 3; L++) {
      const gg = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.25);
      if (solid) {
        gg.addColorStop(0, rgba(c.c2, alphas[L] * 1.4)); gg.addColorStop(0.55, rgba(c.c1, alphas[L])); gg.addColorStop(1, rgba(c.rim, alphas[L] * 0.6));
      } else {
        gg.addColorStop(0, rgba(c.c2, alphas[L])); gg.addColorStop(0.55, rgba(c.c1, alphas[L] * 0.75)); gg.addColorStop(1, rgba(c.c1, alphas[L] * 0.15));
      }
      g.fillStyle = gg; g.fill(paths[L]);
    }
    if (solid) { g.lineWidth = 1; g.strokeStyle = rgba(c.rim, 0.22); g.stroke(paths[1]); g.strokeStyle = rgba(c.rim, 0.14); g.stroke(paths[2]); }
    g.restore();
  }

  function sync(now: number) {
    if (palTo && palFrom) {
      const p = Math.min(1, (now - pt0) / 600);
      P = mixPal(palFrom, palTo, easeIO(p));
      if (p >= 1) { P = palTo; palTo = null; }
    }
    if (to && from && toK && colFrom) {
      const p = Math.min(1, (now - t0) / 800), e = easeIO(p);
      cur = mixShape(from, to, e); col = mixCol(colFrom, P.v[toK], e);
      if (p >= 1) { cur = clone(to); to = null; curK = toK; col = P.v[curK]; }
    } else col = P.v[curK];
  }

  function draw() {
    if (!W || !H) return;
    const g = ctx!, t = phaseT, e = energy, Lt = P.light, c = col;
    const cx = W * (wide ? 0.38 : 0.5), cy = H * (wide ? 0.42 : 0.5);
    const R = Math.min(W, H) * (wide ? 0.215 : 0.25);
    g.clearRect(0, 0, W, H);
    const amb = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.8);
    amb.addColorStop(0, rgba(c.c1, lerp(0.14 + 0.16 * e, 0.13 + 0.1 * e, Lt)));
    amb.addColorStop(0.5, rgba(c.c1, lerp(0.04 + 0.04 * e, 0.04 + 0.03 * e, Lt)));
    amb.addColorStop(1, rgba(c.c1, 0));
    g.fillStyle = amb; g.fillRect(0, 0, W, H);
    const deep = mixC(c.c1, c.rim, Lt);
    g.lineWidth = 1;
    g.strokeStyle = rgba(P.line, lerp(0.07, 0.13, Lt));
    g.beginPath(); g.arc(cx, cy, R * 1.95, 0, TAU); g.stroke();
    g.save(); g.setLineDash([2, 7]); g.lineDashOffset = -t * 8;
    g.strokeStyle = rgba(deep, lerp(0.28, 0.5, Lt)); g.beginPath(); g.arc(cx, cy, R * 1.42, 0, TAU); g.stroke(); g.restore();
    const ma = t * 0.35 * cur.spd + 1;
    g.fillStyle = rgba(mixC(c.c2, c.rim, Lt), 0.9);
    g.beginPath(); g.arc(cx + Math.cos(ma) * R * 1.95, cy + Math.sin(ma) * R * 1.95, 2.5 + 0.5 * Lt, 0, TAU); g.fill();
    const tick = mixC(c.c1, P.tick, Lt);
    const N = 120;
    g.lineWidth = 1.4;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU - Math.PI / 2;
      const v = 0.5 + 0.5 * Math.sin(i * 0.71 + t * 2.3 * cur.spd) * Math.sin(i * 0.23 - t * 1.4);
      const r0 = R * 1.55, len = R * (0.03 + 0.26 * e * v);
      g.strokeStyle = rgba(tick, lerp(0.12 + 0.55 * v * e, 0.18 + 0.52 * v * e, Lt));
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); g.stroke();
    }
    const paths = scales.map((sc, L) => blob(cx, cy, R, sc, L, t, e));
    if (Lt < 0.999) blobs(paths, false, 1 - Lt, cx, cy, R);
    if (Lt > 0.001) blobs(paths, true, Lt, cx, cy, R);
    g.lineWidth = 1.4 + 0.4 * Lt;
    g.strokeStyle = rgba(mixC(c.c2, c.rim, Lt), lerp(0.55 + 0.3 * e, 0.7 + 0.2 * e, Lt));
    g.stroke(paths[0]);
    const hg = g.createRadialGradient(cx - R * 0.28, cy - R * 0.32, 0, cx - R * 0.28, cy - R * 0.32, R * 0.7);
    hg.addColorStop(0, `rgba(255,255,255,${lerp(0.38, 0.5, Lt)})`); hg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hg; g.beginPath(); g.arc(cx, cy, R * 0.9, 0, TAU); g.fill();
  }

  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(64, now - last); last = now;
    sync(now);
    let tgt: number;
    if (mode === "a") tgt = 0.62 + 0.38 * Math.abs(Math.sin(now * 0.011) * Math.sin(now * 0.0047 + 1));
    else if (mode === "c") tgt = 0.38 + 0.08 * Math.sin(now * 0.006);
    else if (mode === "done") tgt = 0.34;
    else tgt = 0.26;
    energy += (tgt - energy) * Math.min(1, dt / 120);
    phaseT += (dt / 1000) * (1 + energy * 0.9);
    draw();
    loop();
  }
  function loop() {
    if (!disposed && !reduce && visible && !document.hidden && !raf) raf = requestAnimationFrame(frame);
  }

  const onTheme = () => {
    const next = readPalette();
    if (reduce || !visible || document.hidden) { P = next; palTo = null; sync(performance.now()); draw(); return; }
    palFrom = P; palTo = next; pt0 = performance.now(); loop();
  };
  const onVis = () => { if (!document.hidden) { last = performance.now(); loop(); } };
  const onMQ = () => {
    reduce = mq.matches;
    if (reduce) { if (raf) cancelAnimationFrame(raf); raf = 0; phaseT = 2.4; energy = 0.5; to = null; cur = clone(SHAPES[curK]); sync(performance.now()); draw(); }
    else { last = performance.now(); loop(); }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(cv);
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) { last = performance.now(); loop(); } })
    : null;
  io?.observe(cv);
  document.addEventListener("lumoras:themechange", onTheme);
  document.addEventListener("visibilitychange", onVis);
  mq.addEventListener("change", onMQ);
  resize();
  loop();

  return {
    setVertical(k) {
      if (reduce) { cur = clone(SHAPES[k]); to = null; curK = k; col = P.v[k]; draw(); return; }
      if (k === curK && !to) return;
      from = clone(cur); colFrom = col; to = SHAPES[k]; toK = k; t0 = performance.now();
      loop();
    },
    setMode(m) { mode = m; },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
      document.removeEventListener("lumoras:themechange", onTheme);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMQ);
    },
  };
}
