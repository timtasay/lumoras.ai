import { Skeleton } from "@/components/ui/Skeleton";

/**
 * While a site's dashboard, rankings, search, audit or backlinks tab loads:
 * shimmer placeholders in the shape of what is coming (KPI tiles, a chart,
 * panels), never a blank panel or a spinner alone. Announced once.
 */
export default function Loading() {
  return (
    <div className="stack-lg dash-skel" role="status" aria-live="polite">
      <span className="sr-only">Loading the site&apos;s numbers</span>
      <div className="kpi-grid kpi-7" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="kpi skel-kpi">
            <Skeleton w="55%" h={11} />
            <Skeleton w="45%" h={26} r={8} />
            <Skeleton w="70%" h={10} />
          </div>
        ))}
      </div>
      <div className="traffic" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="chart">
            <Skeleton w="30%" h={14} />
            <Skeleton w="60%" h={10} />
            <Skeleton h={180} r={12} />
          </div>
        ))}
      </div>
      <div className="dash-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel pad mpanel">
            <Skeleton w="40%" h={14} />
            <div className="skel-stack">
              <Skeleton w="92%" h={10} />
              <Skeleton w="80%" h={10} />
              <Skeleton w="86%" h={10} />
              <Skeleton w="64%" h={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
