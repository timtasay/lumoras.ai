"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const RM = "(prefers-reduced-motion: reduce)";

function subscribeRM(cb: () => void) {
  const mq = window.matchMedia(RM);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True when the user asked for reduced motion (false during SSR). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeRM, () => window.matchMedia(RM).matches, () => false);
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia(RM).matches;

/** Ease-out cubic: fast start, gentle landing (entering motion, count-up). */
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animates a number from 0 to `to` once, on mount (and whenever `to` or
 * `replay` changes). Reduced motion: the final value immediately.
 */
export function useCountUp(to: number, duration = 1100, replay = 0): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      const id = requestAnimationFrame(() => setV(to));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / duration);
      setV(to * easeOut(u));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, replay]);
  return v;
}

/** Runs a View Transition when supported and motion is allowed; otherwise applies the update directly. */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === "function" && !prefersReducedMotion()) doc.startViewTransition(update);
  else update();
}
