/** WCAG 2.2 relative luminance and contrast, for live token checks in /design and the e2e suite. */
export type RGBA = [number, number, number, number];

export function parseCssColor(s: string): RGBA | null {
  const m = /rgba?\(([^)]+)\)/i.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  const h = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16), 1];
  return null;
}

/** Flattens a translucent colour over an opaque background. */
export function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

export function luminance([r, g, b]: RGBA): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Resolves a custom property to rgba through a probe element's computed colour. */
export function tokenColor(name: string, probe: HTMLElement): RGBA | null {
  probe.style.color = `var(${name})`;
  return parseCssColor(getComputedStyle(probe).color);
}
