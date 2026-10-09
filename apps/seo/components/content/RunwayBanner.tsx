import Link from "next/link";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";

export type RunwayAlert = { siteId: string; domain: string; level: "low" | "empty"; days: number; threshold: number; reason: string };

/**
 * The in-app runway alert (dashboard and calendar): one line per site whose
 * runway is below its threshold (amber) or empty (red). The same condition
 * emails owners and editors (lib/content/planner.ts checkRunway()).
 */
export function RunwayBanner({ slug, alerts, here = false }: { slug: string; alerts: RunwayAlert[]; here?: boolean }) {
  if (!alerts.length) return null;
  const worst = alerts.some((a) => a.level === "empty") ? "empty" : "low";
  return (
    <div className="runway-banner" data-level={worst} role="status" aria-live="polite">
      <Icon name="alert" />
      <div className="rb-text">
        {alerts.map((a) => (
          <p key={a.siteId}>
            <strong>
              {a.domain}: {a.level === "empty" ? "nothing is ready to publish" : `${a.days} day${a.days === 1 ? "" : "s"} of runway`}
            </strong>{" "}
            <span className="rb-why">
              {a.level === "low" ? `(alert below ${a.threshold}). ` : ""}
              {a.reason}
            </span>
          </p>
        ))}
      </div>
      {here ? null : (
        <Link href={`/w/${slug}/content?site=${alerts[0].siteId}`} className={buttonClass("secondary", "sm")}>
          <span className="btn-label">Open the calendar</span>
        </Link>
      )}
    </div>
  );
}
