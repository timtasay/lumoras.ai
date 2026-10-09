"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/Icons";

/**
 * Modal on the native <dialog> (focus is trapped and restored by the browser,
 * Esc closes). Enters with ease-out, leaves with ease-in, then closes.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      delete d.dataset.closing;
      d.showModal();
    } else if (!open && d.open) {
      d.dataset.closing = "";
      const done = () => {
        delete d.dataset.closing;
        d.close();
      };
      const anims = d.getAnimations();
      if (anims.length) Promise.all(anims.map((a) => a.finished)).then(done, done);
      else done();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className ? `modal modal-${size} ${className}` : `modal modal-${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-in">
        <header className="modal-head">
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="modal-desc">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </header>
        {children ? <div className="modal-body">{children}</div> : null}
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
