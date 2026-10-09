"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Tabs (WAI-ARIA tabs pattern, automatic activation). The indicator moves
 * with transform only: translateX to the tab, scaleX to its width.
 */
export function Tabs({
  label,
  tabs,
  initial = 0,
}: {
  label: string;
  tabs: { id: string; label: string; content: ReactNode; count?: number }[];
  initial?: number;
}) {
  const [i, setI] = useState(initial);
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current, bar = barRef.current;
    if (!list || !bar) return;
    const place = () => {
      const tab = list.querySelectorAll<HTMLElement>("[role=tab]")[i];
      if (!tab) return;
      bar.style.transform = `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth / 100})`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [i]);

  const go = (j: number) => {
    const k = (j + tabs.length) % tabs.length;
    setI(k);
    listRef.current?.querySelectorAll<HTMLElement>("[role=tab]")[k]?.focus();
  };

  return (
    <div className="tabs">
      <div
        ref={listRef}
        className="tab-list"
        role="tablist"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(i + 1);
          else if (e.key === "ArrowLeft") go(i - 1);
          else if (e.key === "Home") go(0);
          else if (e.key === "End") go(tabs.length - 1);
          else return;
          e.preventDefault();
        }}
      >
        {tabs.map((t, k) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-controls={`${base}-p-${t.id}`}
            aria-selected={k === i}
            tabIndex={k === i ? 0 : -1}
            className="tab"
            onClick={() => setI(k)}
          >
            {t.label}
            {t.count !== undefined ? <span className="tab-n">{t.count}</span> : null}
          </button>
        ))}
        <span ref={barRef} className="tab-bar" aria-hidden="true" />
      </div>
      {tabs.map((t, k) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-p-${t.id}`}
          aria-labelledby={`${base}-t-${t.id}`}
          hidden={k !== i}
          tabIndex={0}
          className="tab-panel"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
