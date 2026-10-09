"use client";

import {
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "@/components/Icons";

type FieldShell = { label: string; hint?: string; error?: string; className?: string };

function Shell({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={className ? `fld ${className}` : "fld"}>
      <label className="fld-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="fld-err" id={`${id}-err`}>
          <Icon name="alert" />
          {error}
        </p>
      ) : hint ? (
        <p className="fld-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined);

export function TextField({ label, hint, error, className, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <input id={id} className="inp" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Shell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  options,
  ...rest
}: FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} className="inp sel" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function TextareaField({ label, hint, error, className, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} className={className}>
      <textarea id={id} className="inp area" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Shell>
  );
}

export function Checkbox({ label, hint, ...rest }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="chkbox">
      <input id={id} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} {...rest} />
      <span className="chkbox-box" aria-hidden="true">
        <Icon name="check" />
      </span>
      <label htmlFor={id}>
        <span className="chkbox-label">{label}</span>
        {hint ? (
          <span className="chkbox-hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}

/** On/off switch (role="switch"). Label on the left, as settings rows read. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="sw-row">
      <div className="sw-text">
        <span className="sw-label" id={`${id}-l`}>
          {label}
        </span>
        {hint ? (
          <span className="sw-hint" id={`${id}-h`}>
            {hint}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className="sw"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="sw-knob" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Segmented control: a radiogroup with roving tabindex and arrow keys. The
 * pill slides with transform only.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (j: number) => {
    const k = (j + options.length) % options.length;
    onChange(options[k].value);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[k]?.focus();
  };
  return (
    <div
      ref={ref}
      className={`seg seg-${size}`}
      role="radiogroup"
      aria-label={label}
      style={{ ["--n" as string]: options.length, ["--i" as string]: i }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") move(i + 1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(i - 1);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(options.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      <span className="seg-pill" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="seg-btn"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
