import { Icon } from "@/components/Icons";
import { MOVEMENT_LABEL, movementSpoken, movementText, type Movement } from "@/lib/measure/movement";

/**
 * Rank movement badge: an arrow and the places gained or lost. Up is ion
 * (positive movement), down is flare (a warning), entries and drop-outs
 * say so in words. Never colour alone: the arrow and the sign carry it, and
 * screen readers hear "up 5 places".
 */
export function MoveBadge({ m }: { m: Movement }) {
  const dir = m.kind === "up" || m.kind === "entered" ? "up" : m.kind === "down" || m.kind === "lost" ? "down" : "flat";
  return (
    <span className="move" data-dir={dir} data-kind={m.kind} title={MOVEMENT_LABEL[m.kind]}>
      {dir !== "flat" ? <Icon name={dir} /> : null}
      <span aria-hidden="true">{movementText(m)}</span>
      <span className="sr-only">{movementSpoken(m)}</span>
    </span>
  );
}

/** Position pill: "#7", or "–" when not in the tracked depth. */
export function PosPill({ p }: { p: number | null }) {
  return p === null ? (
    <span className="pos" data-off="">
      <span aria-hidden="true">–</span>
      <span className="sr-only">not ranking</span>
    </span>
  ) : (
    <span className="pos">#{p}</span>
  );
}
