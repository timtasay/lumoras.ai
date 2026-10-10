import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge, StatusLight } from "@/components/ui/Status";
import type { ConnState } from "@/lib/measure/dashboard";
import type { MeasurementHealth } from "@/lib/measure/health";

/**
 * The designed states of the measurement screens: not configured on this
 * server, not connected, no property, first sync running, failing. Each one
 * says what is missing and why it matters, with the next action as the
 * primary button (or, for people who cannot take it, who can).
 */
export function SearchConsoleState({ state, base, canManage, detail, what = "Search Console" }: { state: ConnState; base: string; canManage: boolean; detail?: string | null; what?: "Search Console" | "GA4" }) {
  const connections = `${base}/connections`;
  const action = (label: string) =>
    canManage ? (
      <Link href={connections} className={buttonClass("primary")}>
        <Icon name="plug" /> {label}
      </Link>
    ) : (
      <Badge>An editor or owner connects it</Badge>
    );
  const gsc = what === "Search Console";
  switch (state) {
    case "unconfigured":
      return (
        <EmptyState
          icon="google"
          title={`${what} is not set up on this server yet`}
          text={`${gsc ? "Clicks, impressions, positions and index status" : "Sessions, landing pages and key events"} come from the site's own Google account, read-only and free. Lumoras staff first create the Google OAuth client for this app; then every site connects in one step.`}
          primary={
            <Link href={connections} className={buttonClass("primary")}>
              <Icon name="info" /> See what is needed
            </Link>
          }
        />
      );
    case "none":
      return (
        <EmptyState
          icon="google"
          title={`Connect ${what}`}
          text={gsc ? "Read-only access to this site's Search Console fills the dashboard: 16 months of clicks and impressions, striking-distance queries (positions 4 to 20), pages with impressions but no clicks, and whether new articles are indexed. It is free." : "Read-only access to this site's GA4 property adds organic sessions, landing pages and key events, and checks the tag: a broken tag reads exactly like zero traffic."}
          primary={action(`Connect ${what}`)}
        />
      );
    case "no_property":
      return <EmptyState icon="google" title={`Choose the ${what} property`} text={detail ?? "The Google account is connected; pick which property belongs to this site."} primary={action("Choose the property")} />;
    case "syncing":
      return (
        <div className="panel pad sync-wait" role="status" aria-live="polite">
          <StatusLight state="live">{gsc ? "First sync running: 16 months of Search Console data" : "First GA4 sync running"}</StatusLight>
          <p className="muted small">{detail ?? "This takes a minute or two. The dashboard fills in as the days arrive."}</p>
          <div className="skel-stack" aria-hidden="true">
            <Skeleton h={14} w="40%" />
            <Skeleton h={140} r={12} />
          </div>
        </div>
      );
    case "error":
      return (
        <EmptyState
          icon="alert"
          title={`${what} is failing`}
          text={detail ?? "Google refused the last sync. The numbers below stop at the last good day until it is connected again."}
          primary={action(`Reconnect ${what}`)}
        />
      );
    default:
      return null;
  }
}

/** GA4 measurement health. An error is announced (role="alert"): numbers behind a broken tag read like zero traffic. */
export function HealthPanel({ health, base, compact = false }: { health: MeasurementHealth; base: string; compact?: boolean }) {
  const state = health.state;
  const light = state === "ok" ? "ok" : state === "warn" ? "warn" : "error";
  const label = state === "ok" ? "Tag reporting" : state === "warn" ? "Check the tag" : "Not measuring";
  return (
    <section className="health-panel panel" data-state={state} role={state === "error" ? "alert" : undefined} aria-labelledby="ga4-health-h">
      <header>
        <span className="health-ico" aria-hidden="true">
          <Icon name={state === "ok" ? "check" : "alert"} />
        </span>
        <div>
          <p className="label">GA4 measurement health</p>
          <h3 id="ga4-health-h">{health.headline}</h3>
        </div>
        <StatusLight state={light}>{label}</StatusLight>
      </header>
      {compact && health.signals.length ? <p className="health-first">{health.signals.find((x) => x.level !== "info")?.text ?? health.signals[0].text}</p> : null}
      {health.signals.length && !compact ? (
        <ul className="health-signals">
          {health.signals.map((s) => (
            <li key={s.code} data-level={s.level}>
              <Icon name={s.level === "info" ? "info" : "alert"} />
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {state !== "ok" ? (
        <footer>
          <Link href={`${base}/search#ga4`} className={buttonClass(compact ? "secondary" : "ghost", "sm")}>
            {compact ? "See the signals" : "GA4 details"} <Icon name="arrow" />
          </Link>
          <Link href={`${base}/connections`} className={buttonClass("ghost", "sm")}>
            <Icon name="plug" /> Check the GA4 connection
          </Link>
        </footer>
      ) : null}
    </section>
  );
}

/** A panel's heading row with an optional link out. */
export function PanelHead({ id, title, sub, link }: { id: string; title: string; sub?: ReactNode; link?: { href: string; label: string } }) {
  return (
    <div className="mp-head">
      <div>
        <h2 id={id} className="mp-title">
          {title}
        </h2>
        {sub ? <p className="mp-sub">{sub}</p> : null}
      </div>
      {link ? (
        <Link href={link.href} className="tlink mp-link">
          {link.label} <Icon name="arrow" />
        </Link>
      ) : null}
    </div>
  );
}
