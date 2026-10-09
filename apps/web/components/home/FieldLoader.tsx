"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ParticleField = dynamic(() => import("./ParticleField"), { ssr: false });

/**
 * Loads the particle field only after the page has painted and the browser
 * is idle, so the headline stays the LCP element and the main thread is free.
 */
export function FieldLoader() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      if (cancelled) return;
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => !cancelled && setOn(true), { timeout: 1500 });
      else t = setTimeout(() => !cancelled && setOn(true), 200);
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", go);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      clearTimeout(t);
    };
  }, []);
  return on ? <ParticleField /> : null;
}
