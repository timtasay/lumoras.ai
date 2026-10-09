"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { setHome } from "@/lib/home-bus";

const ParticleField = dynamic(() => import("./ParticleField"), { ssr: false });

/**
 * The Spectrum particle field behind the homepage.
 * - Observes the homepage sections ([data-form], plus the footer) and writes the
 *   active formation to the home bus from the first paint, so the field boots
 *   straight into the right shape.
 * - Loads the canvas only after `load` and an idle callback, so the headline
 *   stays the LCP element and the main thread is free.
 */
export function FieldLoader() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-form]"));
    const foot = document.querySelector<HTMLElement>("footer");
    if (foot) els.push(foot);
    if (!("IntersectionObserver" in window) || els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const el = en.target as HTMLElement;
          setHome({ form: el.dataset.form ? Number(el.dataset.form) : 8 });
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    els.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    let t: ReturnType<typeof setTimeout> | undefined;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const go = () => {
      if (cancelled) return;
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => !cancelled && setOn(true), { timeout: 1500 });
      else t = setTimeout(() => !cancelled && setOn(true), 200);
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", go);
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      clearTimeout(t);
    };
  }, []);

  return on ? <ParticleField /> : null;
}
