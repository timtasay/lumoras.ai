"use client";

import { useEffect, useRef } from "react";
import { startField, type FieldSource } from "@lumoras/ui-field";
import { homeState, onHome } from "@/lib/home-bus";

/** The homepage follows the home bus: section formation, daypart, highlighted vertical. */
const homeSource: FieldSource = { get: () => homeState, subscribe: onHome };

export default function ParticleField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return startField(ref.current, { source: homeSource, grid: document.getElementById("vgrid") });
  }, []);
  return <canvas id="field" ref={ref} aria-hidden="true" />;
}
