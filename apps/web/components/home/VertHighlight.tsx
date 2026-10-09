"use client";

import { useEffect } from "react";
import { setHome } from "@/lib/home-bus";

/**
 * Wires the server-rendered vertical cards to the particle field: hovering
 * (mouse) or focusing inside card k lights constellation cluster k.
 * Renders nothing.
 */
export function VertHighlight() {
  useEffect(() => {
    const grid = document.getElementById("vgrid");
    if (!grid) return;
    let hover = -1, focus = -1;
    const sync = () => setHome({ hl: hover >= 0 ? hover : focus });
    const cardOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(".vcard") : null);
    const idx = (el: HTMLElement | null) => (el ? Number(el.dataset.k) : -1);
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const k = idx(cardOf(e.target));
      if (k !== hover) { hover = k; sync(); }
    };
    const onLeave = () => { hover = -1; sync(); };
    const onIn = (e: FocusEvent) => { focus = idx(cardOf(e.target)); sync(); };
    const onOut = (e: FocusEvent) => {
      if (!grid.contains(e.relatedTarget as Node | null)) { focus = -1; sync(); }
    };
    grid.addEventListener("pointerover", onOver);
    grid.addEventListener("pointerleave", onLeave);
    grid.addEventListener("focusin", onIn);
    grid.addEventListener("focusout", onOut);
    return () => {
      grid.removeEventListener("pointerover", onOver);
      grid.removeEventListener("pointerleave", onLeave);
      grid.removeEventListener("focusin", onIn);
      grid.removeEventListener("focusout", onOut);
      setHome({ hl: -1 });
    };
  }, []);
  return null;
}
