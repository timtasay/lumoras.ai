/**
 * Chart math shared by the hand-written SVG charts (components/charts):
 * scales, ticks, paths and the data transforms that feed them. Pure, no
 * React, so it is unit-tested directly.
 */
export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number] };

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain, [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** "Nice" tick values (1, 2, 2.5, 5 × 10^n steps) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Ticks for an all-zero or empty series still need a visible axis: [0, 1]. */
export const valueTicks = (values: number[], count = 4) => {
  const max = Math.max(0, ...values);
  return max > 0 ? niceTicks(0, max, count) : [0, 1];
};

/** Polyline path through points; null values break the line. */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = "", pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Column with a 4px rounded data end and a square baseline (or nothing for a zero-height column). */
export function columnPath(x: number, y: number, w: number, base: number, r = 4): string {
  const h = base - y;
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${base}Z`;
}

/** A column hanging below the baseline (negative values: lost links), rounded at its data end. */
export function columnDownPath(x: number, base: number, w: number, y: number, r = 4): string {
  const h = y - base;
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${base}V${y - rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y - rr}V${base}Z`;
}

/** Horizontal bar from the left edge, rounded at its data end. */
export function barRightPath(x0: number, y: number, len: number, h: number, r = 4): string {
  if (len <= 0) return "";
  const rr = Math.min(r, h / 2, len);
  return `M${x0},${y}H${x0 + len - rr}Q${x0 + len},${y} ${x0 + len},${y + rr}V${y + h - rr}Q${x0 + len},${y + h} ${x0 + len - rr},${y + h}H${x0}Z`;
}

/** Inverted rank axis: position 1 at the top. Ticks every 10 up to 50, then every 25. */
export function rankTicks(maxPos: number): number[] {
  const step = maxPos <= 50 ? 10 : 25;
  const out = [1];
  for (let t = step; t <= maxPos; t += step) out.push(t);
  return out;
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every calendar day from `start` to `end` (YYYY-MM-DD, inclusive) with the
 * value for that day, or 0 where there is none: Search Console omits days
 * without data, and a chart must not draw straight across a gap as if the
 * days in between had happened.
 */
export function fillDays<T extends { day: string }>(rows: T[], start: string, end: string, pick: (r: T) => number): { day: string; value: number }[] {
  const by = new Map(rows.map((r) => [r.day, pick(r)]));
  const out: { day: string; value: number }[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) {
    const day = isoDay(new Date(t));
    out.push({ day, value: by.get(day) ?? 0 });
  }
  return out;
}

/** Sums daily values into consecutive buckets of `size` days ending on the last day (oldest bucket first). */
export function bucketSums(values: number[], size = 7): number[] {
  const out: number[] = [];
  for (let end = values.length; end > 0; end -= size) out.unshift(values.slice(Math.max(0, end - size), end).reduce((a, b) => a + b, 0));
  return out;
}

/** Which tick indices to label along a time axis of `n` points at a given width (first, last and evenly between). */
export function timeTickIndices(n: number, width: number): number[] {
  if (n <= 1) return [0];
  const parts = width < 520 ? 2 : 4;
  return [...new Set(Array.from({ length: parts + 1 }, (_, k) => Math.round((k / parts) * (n - 1))))];
}
