import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return ["btn", `btn-${variant}`, `btn-${size}`, extra].filter(Boolean).join(" ");
}

/**
 * Buttons: primary (one per view, ion), secondary, ghost, danger; sm/md/lg.
 * `loading` keeps the width (the label stays in place, hidden) and announces
 * itself through aria-busy, so nothing shifts while work is in flight.
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconRight,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading ? "" : undefined}
      {...rest}
    >
      <span className="btn-label">
        {icon ? <Icon name={icon} /> : null}
        {children}
        {iconRight ? <Icon name={iconRight} className="btn-ico-r" /> : null}
      </span>
      {loading ? (
        <span className="btn-spin" aria-hidden="true">
          <span />
        </span>
      ) : null}
      {loading ? <span className="sr-only"> (working)</span> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={className ? `icon-btn ${className}` : "icon-btn"} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
