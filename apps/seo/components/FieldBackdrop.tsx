"use client";

import { useEffect, useRef } from "react";
import { startField } from "@lumoras/ui-field";

/**
 * The Spectrum particle field (shared with lumoras.ai through @lumoras/ui-field)
 * as a backdrop for sign-in and onboarding. It starts after the page is idle,
 * pauses when the tab is hidden or the canvas is off screen, and draws one
 * still frame under reduced motion.
 */
export function FieldBackdrop({ form = 8, className }: { form?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const go = () => {
      if (!cancelled) stop = startField(canvas, { form, pauseOffscreen: true, localPointer: true });
    };
    const id = w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 800 }) : window.setTimeout(go, 120);
    return () => {
      cancelled = true;
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else clearTimeout(id);
      stop?.();
    };
  }, [form]);
  return <canvas ref={ref} className={className ? `field ${className}` : "field"} aria-hidden="true" />;
}
