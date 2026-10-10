import Link from "next/link";
import { ViewTransition } from "react";
import { Icon } from "@/components/Icons";
import { StatusLight, type LightState } from "@/components/ui/Status";
import { Sparkline } from "@/components/charts/Sparkline";
import { formatNumber } from "@/lib/ui/format";

export type SiteCardData = {
  id: string;
  domain: string;
  name: string;
  industry: string;
  routes: number;
  authors: number;
  brandFilled: number;
  lastCrawl: string | null;
  crawlStatus: "ok" | "partial" | "failed" | null;
  failingConnections: number;
  /** Null when the site has no active schedule. */
  runway?: { days: number; level: "ok" | "low" | "empty"; threshold: number } | null;
  /** Phase 4: organic clicks from Search Console (28 days, the 28 before, 12 weekly sums); null when not connected. */
  search?: { clicks: number; clicksPrev: number; weekly: number[] } | null;
};

const CRAWL: Record<string, [LightState, string]> = {
  ok: ["ok", "Inventory current"],
  partial: ["warn", "Last scan had problems"],
  failed: ["error", "Last scan failed"],
  none: ["idle", "Not scanned yet"],
};

/**
 * A site at a glance. The card and the site page header share a view
 * transition name, so the card morphs into the page (React <ViewTransition>;
 * instant under reduced motion or without browser support).
 */
export function SiteCard({ site, href }: { site: SiteCardData; href?: string }) {
  const [light, text] = site.failingConnections ? (["error", `${site.failingConnections} connection failing`] as [LightState, string]) : CRAWL[site.crawlStatus ?? "none"];
  const body = (
    <>
      <header>
        <ViewTransition name={`site-mark-${site.id}`} share="morph" default="none">
          <span className="site-fav" aria-hidden="true">
            {site.domain[0]?.toUpperCase()}
          </span>
        </ViewTransition>
        <div className="site-id">
          <ViewTransition name={`site-title-${site.id}`} share="morph" default="none">
            <h3>{site.domain}</h3>
          </ViewTransition>
          <p className="muted small">{[site.name, site.industry].filter(Boolean).join(" · ")}</p>
        </div>
        {href ? <Icon name="arrow" className="site-go" /> : null}
      </header>
      <dl className="site-stats">
        <div>
          <dt className="label">Routes</dt>
          <dd>{site.routes.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="label">Authors</dt>
          <dd data-state={site.authors ? undefined : "warn"}>{site.authors}</dd>
        </div>
        <div>
          <dt className="label">Brand profile</dt>
          <dd>
            <span className="meter" role="meter" aria-label="Brand profile completeness" aria-valuemin={0} aria-valuemax={5} aria-valuenow={site.brandFilled}>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} data-on={i < site.brandFilled ? "" : undefined} />
              ))}
            </span>
          </dd>
        </div>
        <div>
          <dt className="label">Last scan</dt>
          <dd className="small">{site.lastCrawl ?? "Never"}</dd>
        </div>
      </dl>
      {site.search ? (
        <div className="site-clicks">
          <span className="label">Clicks, 28 days</span>
          <span className="sc-val">
            {formatNumber(site.search.clicks, "compact")}
            {site.search.clicksPrev ? (
              <span className="sc-delta" data-good={site.search.clicks >= site.search.clicksPrev ? "good" : "bad"}>
                {site.search.clicks >= site.search.clicksPrev ? "+" : "−"}
                {Math.abs(Math.round(((site.search.clicks - site.search.clicksPrev) / site.search.clicksPrev) * 100))}%
              </span>
            ) : null}
          </span>
          <Sparkline data={site.search.weekly} label={`${site.domain} organic clicks, last 12 weeks`} width={88} height={26} />
        </div>
      ) : null}
      {site.runway ? (
        <div className="site-runway" data-level={site.runway.level}>
          <span className="label">Runway</span>
          <span className="sr-track" aria-hidden="true">
            <span style={{ ["--w" as string]: `${Math.min(100, Math.round((site.runway.days / Math.max(site.runway.threshold * 2, 1)) * 100))}%` }} />
          </span>
          <span className="small">
            {site.runway.days} day{site.runway.days === 1 ? "" : "s"}
            <span className="sr-only">{site.runway.level === "ok" ? ", healthy" : site.runway.level === "low" ? `, below the ${site.runway.threshold}-day threshold` : ", nothing ready"}</span>
          </span>
        </div>
      ) : null}
      <StatusLight state={light}>{text}</StatusLight>
    </>
  );
  return href ? (
    <Link href={href} className="panel site-card site-link" aria-label={`${site.domain}: open site`}>
      {body}
    </Link>
  ) : (
    <article className="panel site-card">{body}</article>
  );
}
