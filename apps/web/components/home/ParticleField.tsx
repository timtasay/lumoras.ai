"use client";

import { useEffect, useRef } from "react";
import { startField } from "./field-engine";

export default function ParticleField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return startField(ref.current);
  }, []);
  return <canvas id="field" ref={ref} aria-hidden="true" />;
}
