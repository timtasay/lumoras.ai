/**
 * Spectrum particle field (from prototypes/c-spectrum.html), running behind the
 * Voice Core homepage. Nine formations (sphere, waveform, receipt, call
 * rings, constellation, orbits, globe, stream, sphere) with staggered morphs.
 * The constellation clusters sit behind the vertical cards (#vgrid .vcard) so a
 * hovered card lights its own cluster. Colours come from CSS tokens and
 * cross-fade on theme change; each formation has its own dim level so Voice
 * Core text stays legible. Pauses when the tab is hidden, renders a single
 * static frame under reduced motion.
 */
import { homeState, onHome } from "@/lib/home-bus";

type RGBA = [number, number, number, number];
type RGB = [number, number, number];
type Palette = {
  stops: RGBA[];
  blend: GlobalCompositeOperation;
  size: number;
  alpha: number;
  core: number;
  mid: number;
  glow: number;
  glowA: number;
  line: RGBA;
  lineA: number;
  arcA: number;
  pathA: number;
  spr: HTMLCanvasElement[];
  colorAt: (h: number) => RGB;
};

export function startField(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = mq.matches;
  const TAU = Math.PI * 2;
  let W = 0, H = 0, DPR = 1;
  const SMALL = Math.min(window.innerWidth, (screen && screen.width) || window.innerWidth) < 700;
  const N = SMALL ? 900 : 2200;
  let disposed = false;

  function rng(seed: number) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = rng(20261008);
  const F32 = () => new Float32Array(N);
  const r1 = F32(), r2 = F32(), r3 = F32(), r4 = F32();
  for (let i = 0; i < N; i++) { r1[i] = R(); r2[i] = R(); r3[i] = R(); r4[i] = R(); }

  const pX = F32(), pY = F32(), pH = F32(), pA = F32(), pS = F32();
  const fX = F32(), fY = F32(), fH = F32(), fA = F32(), fS = F32();
  const tX = F32(), tY = F32(), tH = F32(), tA = F32(), tS = F32();
  const oX = F32(), oY = F32();

  /* ---------- palette + sprites from CSS tokens ---------- */
  const rgb = (c: ArrayLike<number>, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const probe = document.createElement("canvas").getContext("2d");
  function parseColor(str: string, fallback: RGBA): RGBA {
    str = (str || "").trim();
    if (!str) return fallback;
    let m = /^#([0-9a-f]{3,8})$/i.exec(str);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = h.split("").map((x) => x + x).join("");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    m = /rgba?\(([^)]+)\)/i.exec(str);
    if (!m) {
      if (!probe) return fallback;
      probe.fillStyle = "#000";
      probe.fillStyle = str;
      const out = String(probe.fillStyle);
      return out === str ? fallback : parseColor(out, fallback);
    }
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  const NB = 48;
  const PAL_FADE = 600;
  function readPalette(): Palette {
    const cs = getComputedStyle(root);
    const tok = (n: string) => cs.getPropertyValue(n).trim();
    const num = (n: string, d: number) => { const v = parseFloat(tok(n)); return Number.isFinite(v) ? v : d; };
    const stops = ["--s1", "--s2", "--s3", "--s4"].map((n) => parseColor(tok(n), [128, 128, 128, 1]));
    const colorAt = (h: number): RGB => {
      h = Math.max(0, Math.min(1, h)) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(h)), f = h - k;
      const a = stops[k], b = stops[k + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    };
    const P: Palette = {
      stops,
      blend: tok("--cv-blend") === "lighter" ? "lighter" : "source-over",
      size: num("--cv-size", 1), alpha: num("--cv-alpha", 1),
      core: num("--cv-core", 90), mid: num("--cv-mid", 0.16), glow: num("--cv-glow", 0.42), glowA: num("--cv-glow-a", 0.28),
      line: parseColor(tok("--cv-line"), [143, 151, 184, 1]), lineA: num("--cv-line-a", 0.16),
      arcA: num("--cv-arc-a", 0.42), pathA: num("--cv-path-a", 0.35),
      spr: [],
      colorAt,
    };
    for (let b = 0; b < NB; b++) {
      const c = colorAt(b / (NB - 1));
      const s = document.createElement("canvas");
      s.width = s.height = 32;
      const g = s.getContext("2d");
      if (g) {
        const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        const core: RGB = [clamp255(c[0] + P.core), clamp255(c[1] + P.core), clamp255(c[2] + P.core)];
        gr.addColorStop(0, rgb(core, 1));
        gr.addColorStop(Math.max(0, Math.min(1, P.mid)), rgb(c, 0.95));
        gr.addColorStop(Math.max(0, Math.min(1, P.glow)), rgb(c, P.glowA));
        gr.addColorStop(1, rgb(c, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, 32, 32);
      }
      P.spr.push(s);
    }
    return P;
  }
  let PAL = readPalette();
  let PREV: Palette | null = null;
  let palT0 = 0;

  /* ---------- formation data ---------- */
  // 0 sphere (fibonacci)
  const SPX = F32(), SPY = F32(), SPZ = F32();
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = GA * i;
    SPX[i] = Math.cos(th) * rr; SPY[i] = y; SPZ[i] = Math.sin(th) * rr;
  }

  // 1 waveform
  const BARS = SMALL ? 40 : 72;
  const nBar = Math.floor(N * 0.82);
  const perBar = Math.ceil(nBar / BARS);
  const WB = new Uint16Array(N), WU = F32();
  for (let i = 0; i < N; i++) {
    if (i < nBar) { WB[i] = i % BARS; const j = Math.floor(i / BARS); WU[i] = ((j + 0.5) / perBar) * 2 - 1; }
    else { WU[i] = (i - nBar) / (N - nBar); }
  }
  const amp = new Float32Array(BARS);

  // 2 receipt
  const RX = F32(), RY = F32(), RN = F32(), RE = new Uint8Array(N);
  (function buildReceipt() {
    const rr = rng(7);
    const C = Math.max(24, Math.round(Math.sqrt(N / (1.75 * 0.46))));
    const RT = Math.round(C * 1.75);
    const g: number[] = [];
    let row = 0;
    const put = (r: number, c0: number, c1: number, step = 1) => { for (let c = c0; c < c1; c += step) g.push(c, r); };
    const hw = Math.round(C * 0.5), h0 = Math.round((C - hw) / 2);
    for (let k = 0; k < 3; k++) put(row++, h0, h0 + hw);
    row++;
    const sw = Math.round(C * 0.34), s0 = Math.round((C - sw) / 2); put(row++, s0, s0 + sw);
    row += 2;
    put(row++, 0, C, 2); row++;
    while (row < RT - 20) {
      const L = Math.round(C * (0.25 + rr() * 0.33)), pr = 5 + Math.floor(rr() * 3);
      for (let k = 0; k < 2; k++) { put(row, 0, L); put(row, C - pr, C); row++; }
      row++;
      if (rr() < 0.3) { put(row++, 3, 3 + Math.round(C * (0.12 + rr() * 0.12))); row++; }
    }
    put(row++, 0, C, 2); row++;
    for (let k = 0; k < 3; k++) { put(row, 0, Math.round(C * 0.32)); put(row, C - 11, C); row++; }
    row++;
    put(row++, 0, C, 2); row++;
    const bars: boolean[] = []; for (let c = 0; c < C - 4; c++) bars.push(rr() < 0.56);
    for (let k = 0; k < 6; k++) { for (let c = 2; c < C - 2; c++) if (bars[c - 2]) g.push(c, row); row++; }
    const rows = row, d = 1.9 / rows, slots = g.length / 2;
    const take = Math.min(slots, N);
    for (let i = 0; i < take; i++) {
      const si = Math.floor((i * slots) / take);
      const c = g[si * 2], r = g[si * 2 + 1];
      RX[i] = (c - (C - 1) / 2) * d; RY[i] = (r - (rows - 1) / 2) * d; RN[i] = r / (rows - 1);
    }
    const left = N - take;
    if (left > 0) {
      const hx = (C / 2 + 1.2) * d, hy = (rows / 2 + 1.2) * d;
      const per = hx * 4 + hy * 4;
      for (let k = 0; k < left; k++) {
        const i = take + k;
        let s = (k / left) * per, x: number, y: number;
        if (s < hx * 2) { x = -hx + s; y = -hy; }
        else if ((s -= hx * 2) < hy * 2) { x = hx; y = -hy + s; }
        else if ((s -= hy * 2) < hx * 2) { x = hx - s; y = hy + (Math.abs(((s / (d * 3)) % 2) - 1) - 0.5) * d * 2.2; }
        else { s -= hx * 2; x = -hx; y = hy - s; }
        RX[i] = x; RY[i] = y; RN[i] = (y + hy) / (2 * hy); RE[i] = 1;
      }
    }
  })();

  // 3 rings (retail order calls; homeState.dp picks the call, which sets ring speed and hue)
  const SPK = [[-0.62, -0.42], [0.58, -0.5], [-0.42, 0.5], [0.66, 0.4]];
  const RING_N = 7;
  const RS = new Uint8Array(N), RP = F32(), RCORE = new Uint8Array(N);
  for (let i = 0; i < N; i++) { RS[i] = i % 4; RCORE[i] = r1[i] < 0.07 ? 1 : 0; RP[i] = Math.floor(r2[i] * RING_N) / RING_N + r3[i] * 0.012; }
  const RING_MOODS = [
    { speed: 0.12, h0: 0.0, h1: 0.32, gain: 0.85 },
    { speed: 0.2, h0: 0.12, h1: 0.55, gain: 0.95 },
    { speed: 0.4, h0: 0.5, h1: 0.98, gain: 1.15 },
    { speed: 0.08, h0: 0.72, h1: 1.0, gain: 0.7 },
  ];
  let dpTarget = Math.max(0, Math.min(3, homeState.dp));
  const dp = Object.assign({}, RING_MOODS[dpTarget]);
  let ringClock = 0;

  // 4 constellation: one cluster per vertical card. Cluster centres follow the
  // cards on screen (offsets cached on resize, grid position read per frame);
  // without the grid they fall back to a sunflower layout around the anchor.
  const grid = document.getElementById("vgrid");
  const cards = grid ? Array.from(grid.querySelectorAll<HTMLElement>(".vcard")) : [];
  const NC = Math.max(2, cards.length || 12);
  const CL: [number, number][] = [];
  for (let k = 0; k < NC; k++) {
    const rr = 0.98 * Math.sqrt((k + 0.6) / NC), a = k * 2.39996 + 0.7;
    CL.push([Math.cos(a) * rr * 1.12, Math.sin(a) * rr * 0.98]);
  }
  /** per card: centre x/y relative to the grid's top-left, and cluster radius (px) */
  const CARD = new Float32Array(NC * 3);
  let gridX = 0, gridY = 0, attached = false;
  let EDGES: [number, number][] = [];
  function nearestEdges(pos: (k: number) => [number, number]) {
    const out: [number, number][] = [];
    const seen = new Set<string>();
    for (let k = 0; k < NC; k++) {
      const pk = pos(k);
      const dists: [number, number][] = [];
      for (let j = 0; j < NC; j++) if (j !== k) { const pj = pos(j); dists.push([j, (pj[0] - pk[0]) ** 2 + (pj[1] - pk[1]) ** 2]); }
      dists.sort((a, b) => a[1] - b[1]);
      for (let m = 0; m < 2 && m < dists.length; m++) {
        const j = dists[m][0], key = Math.min(j, k) + "-" + Math.max(j, k);
        if (!seen.has(key)) { seen.add(key); out.push([k, j]); }
      }
    }
    return out;
  }
  function measureCards() {
    attached = false;
    if (!grid || cards.length !== NC) { EDGES = nearestEdges((k) => CL[k]); return; }
    if (grid.offsetWidth < 1) { EDGES = nearestEdges((k) => CL[k]); return; }
    // layout offsets (the grid is the cards' offsetParent), so scroll-reveal transforms don't skew them
    cards.forEach((c, k) => {
      CARD[k * 3] = c.offsetLeft + c.offsetWidth / 2;
      CARD[k * 3 + 1] = c.offsetTop + c.offsetHeight / 2;
      CARD[k * 3 + 2] = Math.min(c.offsetWidth, c.offsetHeight) * 0.42;
    });
    attached = true;
    EDGES = nearestEdges((k) => [CARD[k * 3], CARD[k * 3 + 1]]);
  }
  function locateGrid() {
    if (!attached || !grid) return;
    const g = grid.getBoundingClientRect();
    gridX = g.left; gridY = g.top;
  }
  const CC = new Uint8Array(N), CR = F32(), CAng = F32();
  for (let i = 0; i < N; i++) { CC[i] = i % NC; CR[i] = 0.07 + 0.93 * Math.pow(r1[i], 1.7); CAng[i] = r2[i] * TAU; }
  let hlTarget = homeState.hl;
  let hlIdx = hlTarget, hlAmt = 0;

  // 5 triad (product family)
  const TRI = [
    { c: [Math.cos(-Math.PI / 2) * 0.36, Math.sin(-Math.PI / 2) * 0.36], tx: 1.15, ty: 0.0, h0: 0.0, h1: 0.3 },
    { c: [Math.cos(-Math.PI / 2 + TAU / 3) * 0.36, Math.sin(-Math.PI / 2 + TAU / 3) * 0.36], tx: 0.9, ty: 2.1, h0: 0.6, h1: 0.72 },
    { c: [Math.cos(-Math.PI / 2 + (2 * TAU) / 3) * 0.36, Math.sin(-Math.PI / 2 + (2 * TAU) / 3) * 0.36], tx: 1.25, ty: 4.2, h0: 0.88, h1: 1.0 },
  ];

  // 6 globe
  const NODES: [number, number][] = [];
  (function () { const rr = rng(42); for (let n = 0; n < 10; n++) NODES.push([(rr() - 0.5) * 1.9, rr() * TAU]); })();
  const ARCS: [number, number][] = [];
  (function () {
    const v = NODES.map((n) => [Math.cos(n[0]) * Math.sin(n[1]), -Math.sin(n[0]), Math.cos(n[0]) * Math.cos(n[1])]);
    const seen = new Set<string>();
    v.forEach((a, i) => {
      v.map((b, j) => [j, Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))] as [number, number])
        .filter((e) => e[0] !== i && e[1] < 1.7)
        .sort((x, y) => x[1] - y[1])
        .slice(0, 2)
        .forEach(([j]) => { const k = Math.min(i, j) + "-" + Math.max(i, j); if (!seen.has(k)) { seen.add(k); ARCS.push([i, j]); } });
    });
  })();
  const GLat = F32(), GLon = F32(), GT = new Uint8Array(N), GN = new Uint8Array(N);
  const PARS = [-1.05, -0.7, -0.35, 0, 0.35, 0.7, 1.05];
  for (let i = 0; i < N; i++) {
    if (r1[i] < 0.64) {
      if (i % 2 === 0) { GLon[i] = (Math.floor(r2[i] * 12) * TAU) / 12; GLat[i] = (r3[i] - 0.5) * Math.PI; }
      else { GLat[i] = PARS[Math.floor(r2[i] * PARS.length)]; GLon[i] = r3[i] * TAU; }
      GT[i] = 0;
    } else if (r1[i] < 0.76) {
      const n = Math.floor(r2[i] * NODES.length); GN[i] = n; GT[i] = 1;
      GLat[i] = NODES[n][0] + (r3[i] - 0.5) * 0.05; GLon[i] = NODES[n][1] + (r4[i] - 0.5) * 0.05;
    } else { GT[i] = 2; GLat[i] = Math.asin(2 * r3[i] - 1); GLon[i] = r4[i] * TAU; }
  }

  // 7 path
  const PNX = [-1.5, -0.5, 0.5, 1.5];

  /* ---------- anchors (tuned for the Voice Core layout) ---------- */
  function anchor(k: number): [number, number, number] {
    const m = Math.min(W, H);
    if (W < 900) {
      switch (k) {
        case 0: return [W * 0.62, H * 0.3, Math.min(W * 0.46, H * 0.3)];
        case 1: return [W * 0.5, H * 0.5, W * 0.3];
        case 2: return [W * 0.5, H * 0.5, H * 0.32];
        case 3: return [W * 0.5, H * 0.5, Math.min(W * 0.62, H * 0.4)];
        case 7: return [W * 0.5, H * 0.5, W * 0.28];
        case 8: return [W * 0.5, H * 0.45, Math.min(W * 0.46, H * 0.3)];
        default: return [W * 0.5, H * 0.5, Math.min(W * 0.42, H * 0.3)];
      }
    }
    switch (k) {
      case 0: return [W * 0.74, H * 0.36, m * 0.3];
      case 1: return [W * 0.5, H * 0.5, W * 0.31];
      case 2: return [W * 0.68, H * 0.34, H * 0.3];
      case 3: return [W * 0.5, H * 0.5, Math.min(W * 0.4, H * 0.62)];
      case 4: return [W * 0.5, H * 0.52, Math.min(W * 0.36, H * 0.4)];
      case 5: return [W * 0.6, H * 0.64, Math.min(W * 0.24, H * 0.4)];
      case 6: return [W * 0.24, H * 0.6, Math.min(W * 0.17, H * 0.32)];
      case 7: return [W * 0.5, H * 0.56, W * 0.3];
      case 8: return [W * 0.5, H * 0.5, m * 0.38];
    }
    return [W / 2, H / 2, m * 0.3];
  }
  /** Per-formation brightness, so the field stays behind the Voice Core content (hero orb, copy, panels). */
  const FDIM = [0.62, 0.8, 0.85, 0.9, 1, 0.85, 0.85, 0.85, 0.78];
  let dim = FDIM[Math.max(0, Math.min(8, homeState.form))];

  /* ---------- formations: write tX..tS ---------- */
  type FormFn = (t: number, cx: number, cy: number, sc: number, dr: number) => void;
  const fSphere: FormFn = (t, cx, cy, sc, dr) => {
    const rot = t * 0.12, tilt = 0.38, cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
    const br = (1 + 0.035 * Math.sin(t * 0.9) * dr) * sc;
    for (let i = 0; i < N; i++) {
      const j = 1 + (r1[i] - 0.5) * 0.05 + Math.sin(t * 1.3 + r2[i] * TAU) * 0.012 * dr;
      const x = SPX[i] * j, y = SPY[i] * j, z = SPZ[i] * j;
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      const f = (3 / (3 - z2)) * br;
      tX[i] = cx + x1 * f; tY[i] = cy + y2 * f;
      const d = (z2 + 1) * 0.5;
      tA[i] = 0.14 + 0.86 * d * d; tS[i] = 0.62 + 0.62 * d;
      tH[i] = 0.5 + 0.46 * y2 + 0.1 * x1;
    }
  };
  const fWave: FormFn = (t, cx, cy, sc) => {
    for (let b = 0; b < BARS; b++) {
      const p = b / (BARS - 1), win = Math.pow(Math.sin(Math.PI * p), 0.7);
      const e = Math.abs(Math.sin(p * 9 + t * 2.3) * 0.55 + Math.sin(p * 23 - t * 3.1) * 0.3 + Math.sin(p * 4 + t * 1.1) * 0.35);
      amp[b] = 0.05 + 0.78 * e * win * (0.6 + 0.4 * Math.sin(t * 1.7 + p * 3));
    }
    for (let i = 0; i < N; i++) {
      if (i < nBar) {
        const b = WB[i], p = b / (BARS - 1), u = WU[i];
        tX[i] = cx + (p * 3 - 1.5) * sc;
        tY[i] = cy + u * amp[b] * sc;
        const au = Math.abs(u);
        tA[i] = 0.4 + 0.6 * (1 - au * 0.6); tS[i] = 0.8 + 0.25 * (1 - au);
        tH[i] = p * 0.98;
      } else {
        const p = WU[i], x = p * 3.4 - 1.7;
        tX[i] = cx + x * sc;
        tY[i] = cy + (Math.sin(x * 5 - t * 2.2) * 0.05 + Math.sin(x * 11 + t * 3) * 0.02) * sc + (r3[i] - 0.5) * 3;
        tA[i] = 0.32 * Math.sin(Math.PI * p); tS[i] = 0.6; tH[i] = p;
      }
    }
  };
  const fReceipt: FormFn = (t, cx, cy, sc, dr) => {
    const sway = 0.3 + Math.sin(t * 0.35) * 0.12 * dr, ca = Math.cos(sway), sa = Math.sin(sway);
    const scan = reduced ? 0.42 : ((t * 0.2) % 1.4) - 0.2;
    for (let i = 0; i < N; i++) {
      const x = RX[i], y = RY[i], z = x * sa;
      const f = (3.2 / (3.2 - z)) * sc;
      tX[i] = cx + x * ca * f + Math.sin(t * 0.8 + r1[i] * TAU) * 0.6 * dr;
      tY[i] = cy + y * f;
      const ny = RN[i], g = Math.exp(-((ny - scan) * (ny - scan)) / 0.0018);
      tA[i] = (RE[i] ? 0.28 : 0.62) + g * 0.7; tS[i] = 0.82 + g * 0.6;
      tH[i] = 0.04 + ny * 0.92;
    }
  };
  const fRings: FormFn = (t, cx, cy, sc, dr) => {
    for (let i = 0; i < N; i++) {
      const s = RS[i], sp = SPK[s];
      let rad: number, a: number, h: number;
      if (RCORE[i]) {
        rad = 0.02 + r3[i] * 0.05 * (1 + 0.4 * Math.sin(ringClock * TAU * 2)); a = r4[i] * TAU + t * 0.5 * dr;
        tA[i] = 0.85 * dp.gain; tS[i] = 1.05; h = dp.h0;
      } else {
        const fr = (RP[i] + ringClock) % 1;
        rad = fr * 0.62 + (r3[i] - 0.5) * 0.012; a = r4[i] * TAU;
        const fade = Math.pow(1 - fr, 1.35);
        tA[i] = (0.1 + 0.9 * fade) * dp.gain * Math.min(1, fr * 14); tS[i] = 0.7 + 0.45 * fade;
        h = dp.h0 + (dp.h1 - dp.h0) * fr;
      }
      tX[i] = cx + (sp[0] + Math.cos(a) * rad) * sc;
      tY[i] = cy + (sp[1] + Math.sin(a) * rad * 0.6) * 0.82 * sc;
      tH[i] = h + s * 0.025;
    }
  };
  const fConst: FormFn = (t, cx, cy, sc, dr) => {
    const hl = hlIdx, amt = hlAmt;
    locateGrid();
    for (let i = 0; i < N; i++) {
      const c = CC[i];
      const ang = CAng[i] + t * 0.09 * (c % 2 ? 1 : -1) * dr;
      let px: number, py: number, rad: number;
      if (attached) { px = gridX + CARD[c * 3]; py = gridY + CARD[c * 3 + 1]; rad = CARD[c * 3 + 2]; }
      else { px = cx + CL[c][0] * sc; py = cy + CL[c][1] * sc; rad = 0.18 * sc; }
      tX[i] = px + Math.cos(ang) * CR[i] * rad;
      tY[i] = py + Math.sin(ang) * CR[i] * rad * 0.9;
      const core = 1 - CR[i];
      let a = 0.42 + 0.4 * core + 0.18 * Math.sin(t * 2 * dr + r3[i] * TAU);
      let s = 0.8 + 0.3 * core;
      if (amt > 0.001 && hl >= 0) {
        if (c === hl) { a *= 1 + 2.2 * amt; s *= 1 + 0.7 * amt; }
        else { a *= 1 - 0.55 * amt; }
      }
      tA[i] = a; tS[i] = s;
      tH[i] = (c / (NC - 1)) * 0.98;
    }
  };
  const fTriad: FormFn = (t, cx, cy, sc, dr) => {
    for (let i = 0; i < N; i++) {
      const k = i % 3, T = TRI[k];
      let x: number, y: number, z: number, h: number;
      if (r1[i] < 0.07) {
        const rr = 0.1 * Math.cbrt(r2[i]), th = r3[i] * TAU, ph = Math.acos(2 * r4[i] - 1);
        x = Math.sin(ph) * Math.cos(th) * rr; y = Math.sin(ph) * Math.sin(th) * rr; z = Math.cos(ph) * rr;
        h = 0.5 + (r2[i] - 0.5) * 0.9;
      } else {
        const a = r2[i] * TAU + t * 0.24 * (k === 1 ? -1 : 1) * dr;
        const rr = 0.6 + (r3[i] - 0.5) * 0.03;
        const lx = Math.cos(a) * rr, ly = Math.sin(a) * rr;
        const cxk = Math.cos(T.tx), sxk = Math.sin(T.tx);
        const y1 = ly * cxk, z1 = ly * sxk;
        const ay = T.ty + t * 0.14 * dr, cyk = Math.cos(ay), syk = Math.sin(ay);
        x = lx * cyk + z1 * syk + T.c[0]; z = -lx * syk + z1 * cyk; y = y1 + T.c[1];
        h = T.h0 + (T.h1 - T.h0) * (0.5 + 0.5 * Math.sin(a));
      }
      const f = (3 / (3 - z)) * sc, d = Math.max(0, Math.min(1, (z + 0.8) / 1.6));
      tX[i] = cx + x * f; tY[i] = cy + y * f;
      tA[i] = 0.2 + 0.8 * d; tS[i] = 0.65 + 0.55 * d; tH[i] = h;
    }
  };
  const GROT = { rot: 0, ct: NaN, st: 0 };
  const fGlobe: FormFn = (t, cx, cy, sc, dr) => {
    const rot = t * 0.11, tilt = 0.36, ct = Math.cos(tilt), st = Math.sin(tilt);
    GROT.rot = rot; GROT.ct = ct; GROT.st = st;
    for (let i = 0; i < N; i++) {
      const lat = GLat[i], lon = GLon[i] + rot, type = GT[i];
      const rad = type === 2 ? 1.06 + r2[i] * 0.06 : 1;
      const cl = Math.cos(lat);
      const x = cl * Math.sin(lon) * rad, y = -Math.sin(lat) * rad, z = cl * Math.cos(lon) * rad;
      const y2 = y * ct - z * st, z2 = y * st + z * ct;
      const f = (3 / (3 - z2)) * sc;
      tX[i] = cx + x * f; tY[i] = cy + y2 * f;
      const d = (z2 + 1) * 0.5;
      if (type === 1) { tA[i] = (0.25 + 0.95 * d) * (0.75 + 0.25 * Math.sin(t * 2.2 * dr + GN[i])); tS[i] = 1.0 + 0.6 * d; }
      else if (type === 0) { tA[i] = 0.06 + 0.6 * d * d; tS[i] = 0.6 + 0.4 * d; }
      else { tA[i] = 0.05 + 0.22 * d; tS[i] = 0.55; }
      tH[i] = 0.5 + 0.47 * Math.sin(GLon[i]) * cl;
    }
  };
  const fPath: FormFn = (t, cx, cy, sc, dr) => {
    for (let i = 0; i < N; i++) {
      if (r1[i] < 0.3) {
        const n = i % 4, ring = Math.floor(r2[i] * 3), rr = 0.07 + ring * 0.055;
        const a = r3[i] * TAU + t * (0.35 + ring * 0.1) * (ring % 2 ? -1 : 1) * dr;
        tX[i] = cx + (PNX[n] + Math.cos(a) * rr) * sc;
        tY[i] = cy + Math.sin(a) * rr * sc;
        tA[i] = 0.9 - ring * 0.2; tS[i] = 0.95 - ring * 0.1; tH[i] = (n / 3) * 0.98;
      } else {
        const fr = (r2[i] + t * 0.05 * dr) % 1, x = -1.7 + fr * 3.4;
        let near = 0;
        for (let n = 0; n < 4; n++) { const dd = Math.abs(x - PNX[n]); if (dd < 0.3) near = Math.max(near, 1 - dd / 0.3); }
        const spread = 0.12 * (1 - near * 0.85);
        tX[i] = cx + x * sc;
        tY[i] = cy + (Math.sin(x * 2.4 - t * 1.1 * dr) * 0.07 * (1 - near) + (r3[i] - 0.5) * spread) * sc;
        tA[i] = 0.55 * Math.sin(Math.PI * fr); tS[i] = 0.7; tH[i] = fr * 0.98;
      }
    }
  };
  const FN: FormFn[] = [fSphere, fWave, fReceipt, fRings, fConst, fTriad, fGlobe, fPath, fSphere];

  /* ---------- hairlines ---------- */
  const LW = new Float32Array(9);
  function project(lat: number, lon: number, rad: number, cx: number, cy: number, sc: number): [number, number, number] {
    const cl = Math.cos(lat), l = lon + GROT.rot;
    const x = cl * Math.sin(l) * rad, y = -Math.sin(lat) * rad, z = cl * Math.cos(l) * rad;
    const y2 = y * GROT.ct - z * GROT.st, z2 = y * GROT.st + z * GROT.ct;
    const f = (3 / (3 - z2)) * sc;
    return [cx + x * f, cy + y2 * f, z2];
  }
  function drawLines(c: CanvasRenderingContext2D, P: Palette, k0: number) {
    c.lineWidth = 1;
    if (LW[4] > 0.01) {
      const [cx, cy, sc] = anchor(4);
      const at = (k: number): [number, number] =>
        attached ? [gridX + CARD[k * 3], gridY + CARD[k * 3 + 1]] : [cx + CL[k][0] * sc, cy + CL[k][1] * sc];
      for (const [a, b] of EDGES) {
        const lit = hlIdx >= 0 && (a === hlIdx || b === hlIdx);
        const k = lit ? hlAmt : 0;
        c.globalAlpha = k0 * LW[4] * dim * (P.lineA + 0.5 * k);
        c.strokeStyle = lit ? rgb(P.colorAt((hlIdx / (NC - 1)) * 0.98), 1) : rgb(P.line, 1);
        const pa = at(a), pb = at(b);
        c.beginPath();
        c.moveTo(pa[0], pa[1]);
        c.lineTo(pb[0], pb[1]);
        c.stroke();
      }
    }
    if (LW[6] > 0.01 && !Number.isNaN(GROT.ct)) {
      const [cx, cy, sc] = anchor(6);
      for (const [a, b] of ARCS) {
        const A = NODES[a], B = NODES[b];
        const va = [Math.cos(A[0]) * Math.sin(A[1]), -Math.sin(A[0]), Math.cos(A[0]) * Math.cos(A[1])];
        const vb = [Math.cos(B[0]) * Math.sin(B[1]), -Math.sin(B[0]), Math.cos(B[0]) * Math.cos(B[1])];
        c.strokeStyle = rgb(P.colorAt(((a * 7 + b * 3) % 10) / 10), 1);
        let prev: [number, number, number] | null = null;
        for (let s = 0; s <= 28; s++) {
          const u = s / 28;
          let x = va[0] + (vb[0] - va[0]) * u, y = va[1] + (vb[1] - va[1]) * u, z = va[2] + (vb[2] - va[2]) * u;
          const len = Math.hypot(x, y, z) || 1, lift = 1 + 0.12 * Math.sin(Math.PI * u);
          x = (x / len) * lift; y = (y / len) * lift; z = (z / len) * lift;
          const lat = Math.asin(-y / lift), lon = Math.atan2(x, z);
          const p = project(lat, lon, lift, cx, cy, sc);
          if (prev) {
            const dz = (p[2] + prev[2]) * 0.5;
            if (dz > -0.25) {
              c.globalAlpha = k0 * LW[6] * dim * P.arcA * Math.min(1, (dz + 0.25) * 1.6) * Math.sin(Math.PI * u + 0.2);
              c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); c.stroke();
            }
          }
          prev = p;
        }
      }
    }
    if (LW[7] > 0.01) {
      const [cx, cy, sc] = anchor(7);
      const g = c.createLinearGradient(cx - 1.6 * sc, 0, cx + 1.6 * sc, 0);
      const S = P.stops;
      g.addColorStop(0, rgb(S[0], 0)); g.addColorStop(0.15, rgb(S[0], 1)); g.addColorStop(0.5, rgb(S[1], 1)); g.addColorStop(0.8, rgb(S[2], 1)); g.addColorStop(1, rgb(S[3], 0));
      c.strokeStyle = g; c.globalAlpha = k0 * LW[7] * dim * P.pathA;
      c.beginPath(); c.moveTo(cx - 1.6 * sc, cy); c.lineTo(cx + 1.6 * sc, cy); c.stroke();
    }
  }

  /* ---------- state + loop ---------- */
  let cur = 0, morphT0 = 0, morphDur = 1200, raf = 0, last = 0;
  let mx = -9999, my = -9999, pointerOn = false;
  const STATIC_T = 9.3;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    measureCards();
    if (reduced) renderStatic(); else kick();
  }

  function layer(c: CanvasRenderingContext2D, P: Palette, k0: number) {
    c.globalCompositeOperation = P.blend;
    drawLines(c, P, k0);
    const base = (SMALL ? 6.2 : 7.4) * P.size, am = P.alpha * k0 * dim, SPR = P.spr;
    for (let i = 0; i < N; i++) {
      const a0 = pA[i]; if (a0 < 0.015) continue;
      const x = pX[i] + oX[i], y = pY[i] + oY[i];
      if (x < -12 || x > W + 12 || y < -12 || y > H + 12) continue;
      const s = base * pS[i];
      let hb = (pH[i] * (NB - 1) + 0.5) | 0; hb = hb < 0 ? 0 : hb >= NB ? NB - 1 : hb;
      const a = a0 * am;
      c.globalAlpha = a > 1 ? 1 : a;
      c.drawImage(SPR[hb], x - s * 0.5, y - s * 0.5, s, s);
    }
  }
  function draw() {
    const c = ctx!;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.clearRect(0, 0, W, H);
    if (PREV) {
      const u = Math.min(1, (performance.now() - palT0) / PAL_FADE), k = u * u * (3 - 2 * u);
      if (u >= 1) { PREV = null; layer(c, PAL, 1); }
      else { layer(c, PREV, 1 - k); layer(c, PAL, k); }
    } else layer(c, PAL, 1);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }

  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    const t = now / 1000;
    const D = RING_MOODS[dpTarget];
    dp.speed += (D.speed - dp.speed) * 0.04; dp.h0 += (D.h0 - dp.h0) * 0.05; dp.h1 += (D.h1 - dp.h1) * 0.05; dp.gain += (D.gain - dp.gain) * 0.05;
    ringClock = (ringClock + dt * dp.speed) % 1;
    if (hlTarget >= 0) { hlIdx = hlTarget; hlAmt += (1 - hlAmt) * 0.12; }
    else { hlAmt += (0 - hlAmt) * 0.1; if (hlAmt < 0.005) { hlAmt = 0; hlIdx = -1; } }
    for (let k = 0; k < LW.length; k++) LW[k] += ((k === cur ? 1 : 0) - LW[k]) * 0.06;
    dim += (FDIM[cur] - dim) * 0.05;

    const [cx, cy, sc] = anchor(cur);
    FN[cur](t, cx, cy, sc, 1);

    const el = now - morphT0, morphing = el < morphDur + 10;
    const stag = morphDur * 0.25, span = morphDur - stag;
    const R2 = 120 * 120;
    for (let i = 0; i < N; i++) {
      if (morphing) {
        let u = (el - r1[i] * stag) / span; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const e = ease(u);
        pX[i] = fX[i] + (tX[i] - fX[i]) * e; pY[i] = fY[i] + (tY[i] - fY[i]) * e;
        pH[i] = fH[i] + (tH[i] - fH[i]) * e; pA[i] = fA[i] + (tA[i] - fA[i]) * e; pS[i] = fS[i] + (tS[i] - fS[i]) * e;
        const lift = Math.sin(Math.PI * u) * (r4[i] - 0.5) * 60;
        pX[i] += lift; pY[i] += lift * 0.4;
      } else {
        pX[i] = tX[i]; pY[i] = tY[i]; pH[i] = tH[i]; pA[i] = tA[i]; pS[i] = tS[i];
      }
      // no repulsion over the vertical cards: the cursor sits on the cluster it is lighting
      if (pointerOn && cur !== 4) {
        const dx = pX[i] + oX[i] - mx, dy = pY[i] + oY[i] - my, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) { const d = Math.sqrt(d2), f = (1 - d / 120) * 2.6; oX[i] += (dx / d) * f; oY[i] += (dy / d) * f; }
      }
      oX[i] *= 0.9; oY[i] *= 0.9;
    }
    draw();
    if (!document.hidden && !reduced) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !disposed && !document.hidden && !reduced) { last = 0; raf = requestAnimationFrame(frame); } }

  function renderStatic() {
    const D = RING_MOODS[dpTarget]; Object.assign(dp, D);
    ringClock = 0.18 + dpTarget * 0.07;
    hlIdx = hlTarget; hlAmt = hlTarget >= 0 ? 1 : 0;
    for (let k = 0; k < LW.length; k++) LW[k] = k === cur ? 1 : 0;
    dim = FDIM[cur];
    const [cx, cy, sc] = anchor(cur);
    FN[cur](STATIC_T, cx, cy, sc, 0);
    pX.set(tX); pY.set(tY); pH.set(tH); pA.set(tA); pS.set(tS); oX.fill(0); oY.fill(0);
    draw();
  }

  function setFormation(k: number, dur?: number) {
    if (k === cur && !dur) return;
    cur = k;
    if (reduced) { renderStatic(); return; }
    for (let i = 0; i < N; i++) { fX[i] = pX[i] + oX[i]; fY[i] = pY[i] + oY[i]; fH[i] = pH[i]; fA[i] = pA[i]; fS[i] = pS[i]; oX[i] = 0; oY[i] = 0; }
    morphT0 = performance.now(); morphDur = dur || 1200;
    kick();
  }

  /* ---------- listeners ---------- */
  let resizeT: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 120); };
  // the constellation follows the cards: keep it in place while scrolling under reduced motion
  let scrollRaf = 0;
  const onScroll = () => {
    if (!reduced || cur !== 4 || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; renderStatic(); });
  };
  const gridRO = grid && "ResizeObserver" in window ? new ResizeObserver(() => { measureCards(); if (reduced && cur === 4) renderStatic(); }) : null;
  gridRO?.observe(grid!);
  const onVis = () => { if (!document.hidden) kick(); };
  const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; pointerOn = true; };
  const onLeave = () => { pointerOn = false; };
  const onMQ = () => {
    reduced = mq.matches;
    if (reduced) { if (raf) cancelAnimationFrame(raf); raf = 0; renderStatic(); }
    else kick();
  };
  const onTheme = () => {
    const next = readPalette();
    if (reduced || document.hidden) { PAL = next; PREV = null; if (reduced) renderStatic(); }
    else { PREV = PAL; PAL = next; palT0 = performance.now(); kick(); }
  };
  const offHome = onHome(() => {
    let dirty = false;
    if (homeState.dp !== dpTarget) { dpTarget = Math.max(0, Math.min(3, homeState.dp)); dirty = true; }
    if (homeState.hl !== hlTarget) { hlTarget = homeState.hl; dirty = true; }
    if (homeState.form !== cur) setFormation(homeState.form);
    else if (dirty) { if (reduced) renderStatic(); else kick(); }
  });

  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onMove, { passive: true });
  document.addEventListener("pointerleave", onLeave);
  window.addEventListener("blur", onLeave);
  mq.addEventListener("change", onMQ);
  document.addEventListener("lumoras:themechange", onTheme);

  /* ---------- boot: drifting dust that gathers into the current chapter's formation ---------- */
  resize();
  for (let i = 0; i < N; i++) {
    pX[i] = r3[i] * W; pY[i] = r4[i] * H; pH[i] = r2[i]; pA[i] = 0.05 + r1[i] * 0.2; pS[i] = 0.6;
  }
  cur = -1;
  if (reduced) { cur = homeState.form; renderStatic(); }
  else setFormation(homeState.form, 2200);

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(resizeT);
    offHome();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    gridRO?.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onMove);
    document.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onLeave);
    mq.removeEventListener("change", onMQ);
    document.removeEventListener("lumoras:themechange", onTheme);
  };
}
