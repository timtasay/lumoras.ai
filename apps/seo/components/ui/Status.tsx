import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icons";

export type Tone = "neutral" | "ion" | "info" | "warn" | "amber" | "danger";

/** Small static label: state of a record (Draft, Scheduled, Live…). */
export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className="badge" data-tone={tone}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

/** Toggleable filter chip (aria-pressed). */
export function Chip({
  pressed,
  onToggle,
  children,
  count,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>
      <span className="chip-dot" aria-hidden="true" />
      {children}
      {count !== undefined ? <span className="chip-n">{count}</span> : null}
    </button>
  );
}

export type LightState = "live" | "ok" | "idle" | "warn" | "error";

/**
 * Status light. Only "live" pulses (something is running right now); every
 * other state is still. The text label is always present: never colour alone.
 */
export function StatusLight({ state, children }: { state: LightState; children: ReactNode }) {
  return (
    <span className="light" data-state={state}>
      <span className="light-dot" aria-hidden="true" />
      <span className="light-label">{children}</span>
    </span>
  );
}
