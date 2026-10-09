import type { CSSProperties } from "react";

/** Shimmer placeholder. The sheen is a translated pseudo-element: no repaint of the box itself. */
export function Skeleton({ w = "100%", h = 12, r, className }: { w?: number | string; h?: number | string; r?: number; className?: string }) {
  return (
    <span
      className={className ? `skel ${className}` : "skel"}
      style={{ width: w, height: h, borderRadius: r } as CSSProperties}
      aria-hidden="true"
    />
  );
}

/** A loading card in the shape of the real one, announced once to screen readers. */
export function SkeletonCard({ label = "Loading" }: { label?: string }) {
  return (
    <div className="panel skel-card" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skel-row">
        <Skeleton w={36} h={36} r={10} />
        <div className="skel-stack">
          <Skeleton w="55%" h={12} />
          <Skeleton w="35%" h={10} />
        </div>
      </div>
      <Skeleton h={64} r={12} />
      <div className="skel-stack">
        <Skeleton w="92%" h={10} />
        <Skeleton w="78%" h={10} />
        <Skeleton w="64%" h={10} />
      </div>
    </div>
  );
}
