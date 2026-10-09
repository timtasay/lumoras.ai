"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

type Mode = "light" | "dark" | "auto";
const KEY = "lumoras-theme";
const ORDER: Mode[] = ["light", "dark", "auto"];
const LABELS: Record<Mode, { label: string; title: string; icon: "sun" | "moon" | "auto" }> = {
  light: { label: "Light", title: "Light theme", icon: "sun" },
  dark: { label: "Dark", title: "Dark theme", icon: "moon" },
  auto: { label: "Auto", title: "Auto: match system", icon: "auto" },
};

/** Inline script for <head>: applies the saved choice before first paint. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

function readMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return "auto";
}

const mqDark = () => window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (m: Mode): "light" | "dark" => (m === "auto" ? (mqDark().matches ? "dark" : "light") : m);

function writeAttr(m: Mode) {
  const root = document.documentElement;
  if (m === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", m);
}

type VTDocument = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> };
};

export function ThemeControl() {
  const [mode, setMode] = useState<Mode>("auto");
  const [ready, setReady] = useState(false);
  const segRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Mode>("auto");
  const resolvedRef = useRef<"light" | "dark">("dark");

  const announce = useCallback(() => {
    const r = resolve(modeRef.current);
    if (r === resolvedRef.current) return;
    resolvedRef.current = r;
    document.dispatchEvent(new CustomEvent("lumoras:themechange", { detail: { mode: modeRef.current, resolved: r } }));
  }, []);

  useEffect(() => {
    const m = readMode();
    modeRef.current = m;
    resolvedRef.current = resolve(m);
    setMode(m);
    writeAttr(m);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    const mq = mqDark();
    const onScheme = () => {
      if (modeRef.current === "auto") announce();
    };
    mq.addEventListener("change", onScheme);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const v: Mode = e.newValue === "light" || e.newValue === "dark" ? e.newValue : "auto";
      if (v === modeRef.current) return;
      modeRef.current = v;
      setMode(v);
      writeAttr(v);
      announce();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelAnimationFrame(id);
      mq.removeEventListener("change", onScheme);
      window.removeEventListener("storage", onStorage);
    };
  }, [announce]);

  const choose = useCallback(
    (next: Mode, origin: HTMLElement | null) => {
      const prev = modeRef.current;
      if (next === prev) return;
      const seg = segRef.current;
      if (seg) {
        const a = ORDER.indexOf(prev), b = ORDER.indexOf(next);
        // leading edge moves first, trailing edge follows: the pill stretches, then settles
        seg.style.setProperty("--dl", b > a ? ".07s" : "0s");
        seg.style.setProperty("--dr", b > a ? "0s" : ".07s");
      }
      modeRef.current = next;
      setMode(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {}
      const changes = resolve(next) !== resolvedRef.current;
      const doc = document as VTDocument;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (changes && typeof doc.startViewTransition === "function" && !reduce) {
        const rect = origin ? origin.getBoundingClientRect() : { left: innerWidth / 2, top: 0, width: 0, height: 0 };
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        const vt = doc.startViewTransition(() => {
          writeAttr(next);
          announce();
        });
        vt.ready
          .then(() => {
            document.documentElement.animate(
              { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
              { duration: 600, easing: "cubic-bezier(.2,.7,.1,1)", pseudoElement: "::view-transition-new(root)" },
            );
          })
          .catch(() => {});
      } else {
        writeAttr(next);
        announce();
      }
    },
    [announce],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = ORDER.indexOf(modeRef.current);
    let j = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % 3;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i + 2) % 3;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = 2;
    if (j < 0) return;
    e.preventDefault();
    const btn = segRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${ORDER[j]}"]`) ?? null;
    choose(ORDER[j], btn);
    btn?.focus();
  };

  return (
    <div
      ref={segRef}
      className={ready ? "theme-seg ready" : "theme-seg"}
      role="radiogroup"
      aria-label="Color theme"
      data-mode={mode}
      onKeyDown={onKeyDown}
    >
      <span className="ts-pill" aria-hidden="true" />
      {ORDER.map((m) => (
        <button
          key={m}
          className="ts-btn"
          type="button"
          role="radio"
          aria-checked={mode === m}
          tabIndex={mode === m ? 0 : -1}
          data-mode={m}
          title={LABELS[m].title}
          onClick={(e) => choose(m, e.currentTarget)}
        >
          <Icon name={LABELS[m].icon} />
          <span className="sr-only">{LABELS[m].label}</span>
        </button>
      ))}
    </div>
  );
}
