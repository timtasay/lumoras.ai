"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A disclosure popover: a button that opens a panel below it. Escape and a
 * click outside close it and return focus to the button; opening moves focus
 * to the first focusable item. Enters ease-out, transform and opacity only.
 */
export function Popover({
  label,
  button,
  children,
  align = "start",
  className,
  buttonClassName,
  onOpen,
}: {
  /** Accessible name of the trigger. */
  label: string;
  button: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  className?: string;
  buttonClassName?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const panel = root.current?.querySelector<HTMLElement>(".pop-panel");
    panel?.querySelector<HTMLElement>("a, button:not(:disabled), input, [tabindex='0']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={root} className={className ? `pop ${className}` : "pop"}>
      <button
        ref={btn}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
      >
        {button}
      </button>
      <div id={id} className="pop-panel" data-align={align} hidden={!open}>
        {typeof children === "function" ? children(close) : children}
      </div>
    </div>
  );
}
