"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";

export type ToastTone = "ok" | "info" | "warn" | "danger";
export type ToastInput = {
  tone?: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  /** ms before it leaves on its own; 0 keeps it until dismissed. Default 5000. */
  duration?: number;
};
type ToastItem = ToastInput & { id: number; leaving?: boolean };

const ICON: Record<ToastTone, IconName> = { ok: "check", info: "info", warn: "alert", danger: "alert" };

const ToastCtx = createContext<{ push: (t: ToastInput) => number; dismiss: (id: number) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/**
 * Toasts: a polite live region, bottom-right (bottom, full width, on phones).
 * Enter with ease-out, leave with ease-in; the timer pauses while hovered or focused.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
  }, []);
  const push = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    return id;
  }, []);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <section className="toasts" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <ToastView key={t.id} t={t} onDismiss={() => dismiss(t.id)} onGone={() => remove(t.id)} />
        ))}
      </section>
    </ToastCtx.Provider>
  );
}

function ToastView({ t, onDismiss, onGone }: { t: ToastItem; onDismiss: () => void; onGone: () => void }) {
  const tone = t.tone ?? "info";
  const [paused, setPaused] = useState(false);
  const duration = t.duration ?? 5000;
  useEffect(() => {
    if (!duration || paused || t.leaving) return;
    const id = setTimeout(onDismiss, duration);
    return () => clearTimeout(id);
  }, [duration, paused, t.leaving, onDismiss]);

  return (
    <div
      className="toast"
      data-tone={tone}
      data-leaving={t.leaving ? "" : undefined}
      onAnimationEnd={(e) => {
        if (t.leaving && e.target === e.currentTarget) onGone();
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-ico" aria-hidden="true">
        <Icon name={ICON[tone]} />
      </span>
      <div className="toast-body">
        <p className="toast-title">{t.title}</p>
        {t.body ? <p className="toast-text">{t.body}</p> : null}
      </div>
      {t.action ? (
        <button
          type="button"
          className="toast-act"
          onClick={() => {
            t.action?.onClick();
            onDismiss();
          }}
        >
          {t.action.label}
        </button>
      ) : null}
      <button type="button" className="toast-x" onClick={onDismiss} aria-label="Dismiss notification">
        <Icon name="close" />
      </button>
    </div>
  );
}
