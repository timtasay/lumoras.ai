"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  THEME_EVENT,
  THEME_KEY,
  THEME_ORDER as ORDER,
  dispatchThemeChange,
  getServerThemeMode,
  getThemeMode,
  persistThemeMode,
  resolveMode,
  revealThemeChange,
  setThemeModeState,
  subscribeThemeMode,
  systemDarkQuery,
  writeThemeAttr,
  type ThemeChangeDetail,
  type ThemeMode as Mode,
} from "./theme";

export type ThemeIconName = "sun" | "moon" | "auto";

const LABELS: Record<Mode, { label: string; title: string; icon: ThemeIconName }> = {
  light: { label: "Light", title: "Light theme", icon: "sun" },
  dark: { label: "Dark", title: "Dark theme", icon: "moon" },
  auto: { label: "Auto", title: "Auto: match system", icon: "auto" },
};

/**
 * Light · Dark · Auto segmented control (a radiogroup with roving tabindex).
 * Styles: "@lumoras/ui-tokens/theme-control.css". Each app passes its own icon
 * renderer so the control uses the app's icon sprite.
 */
export function ThemeControl({ renderIcon }: { renderIcon: (name: ThemeIconName) => ReactNode }) {
  const mode = useSyncExternalStore(subscribeThemeMode, getThemeMode, getServerThemeMode);
  const [ready, setReady] = useState(false);
  const segRef = useRef<HTMLDivElement>(null);
  const resolvedRef = useRef<"light" | "dark" | null>(null);

  const announce = useCallback(() => {
    const r = resolveMode(getThemeMode());
    if (r === resolvedRef.current) return;
    resolvedRef.current = r;
    dispatchThemeChange({ mode: getThemeMode(), resolved: r });
  }, []);

  useEffect(() => {
    const m = getThemeMode();
    resolvedRef.current = resolveMode(m);
    writeThemeAttr(m);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    const mq = systemDarkQuery();
    const onScheme = () => {
      if (getThemeMode() === "auto") announce();
    };
    mq.addEventListener("change", onScheme);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const v: Mode = e.newValue === "light" || e.newValue === "dark" ? e.newValue : "auto";
      if (v === getThemeMode()) return;
      setThemeModeState(v);
      writeThemeAttr(v);
      announce();
    };
    window.addEventListener("storage", onStorage);
    // another control (a command palette, say) changed the theme: stay in step
    const onTheme = (e: Event) => {
      const d = (e as CustomEvent<ThemeChangeDetail>).detail;
      if (d) resolvedRef.current = d.resolved;
    };
    document.addEventListener(THEME_EVENT, onTheme);
    return () => {
      cancelAnimationFrame(id);
      mq.removeEventListener("change", onScheme);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener(THEME_EVENT, onTheme);
    };
  }, [announce]);

  const choose = useCallback(
    (next: Mode, origin: HTMLElement | null) => {
      const prev = getThemeMode();
      if (next === prev) return;
      const seg = segRef.current;
      if (seg) {
        const a = ORDER.indexOf(prev), b = ORDER.indexOf(next);
        // leading edge moves first, trailing edge follows: the pill stretches, then settles
        seg.style.setProperty("--dl", b > a ? ".07s" : "0s");
        seg.style.setProperty("--dr", b > a ? "0s" : ".07s");
      }
      setThemeModeState(next);
      persistThemeMode(next);
      const changes = resolveMode(next) !== resolvedRef.current;
      revealThemeChange(changes, origin, () => {
        writeThemeAttr(next);
        announce();
      });
    },
    [announce],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = ORDER.indexOf(getThemeMode());
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
          {renderIcon(LABELS[m].icon)}
          <span className="sr-only">{LABELS[m].label}</span>
        </button>
      ))}
    </div>
  );
}
