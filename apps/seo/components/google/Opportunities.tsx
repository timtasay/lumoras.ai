import Link from "next/link";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { StatusLight } from "@/components/ui/Status";
import type { Ga4Insights, GscInsights } from "@/lib/google/service";

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

/**
 * Search opportunities from the site's own Search Console: queries ranking
 * 4–20 (a push away from page one) and pages Google shows that nobody
 * clicks. Data from Google is untrusted and only ever rendered as text.
 */
export function Opportunities({ base, gsc, ga4, gscState, error }: { base: string; gsc: GscInsights | null; ga4: Ga4Insights | null; gscState: "none" | "unconfigured" | "connected"; error: string | null }) {
  if (gscState !== "connected") {
    return (
      <div className="rp-idle">
        <Icon name="search" />
        <p>{gscState === "unconfigured" ? "Search Console is not configured on this server yet." : "Connect Search Console to see striking-distance queries (positions 4 to 20) and pages that get impressions but no clicks. It is free and read-only."}</p>
        {gscState === "none" ? (
          <Link href={`${base}/connections`} className={buttonClass("secondary", "sm")}>
            <Icon name="plug" /> Connect Search Console
          </Link>
        ) : null}
      </div>
    );
  }
  if (error || !gsc) {
    return (
      <p className="ro-note">
        <Icon name="alert" />
        {error ?? "Search Console is connected but not set up yet: choose its property under Connections."}
      </p>
    );
  }
  return (
    <div className="opps">
      <div className="tbl-frame" role="region" aria-label="Striking-distance queries" tabIndex={0}>
        <table className="tbl">
          <caption className="sr-only">Queries ranking in positions 4 to 20, {gsc.range.start} to {gsc.range.end}</caption>
          <thead>
            <tr>
              <th scope="col">Query and page</th>
              <th scope="col" className="n">
                Position
              </th>
              <th scope="col" className="n">
                Impressions
              </th>
              <th scope="col" className="n hide-phone">
                Clicks
              </th>
            </tr>
          </thead>
          <tbody>
            {gsc.striking.length ? (
              gsc.striking.slice(0, 10).map((s) => (
                <tr key={`${s.query}|${s.page}`}>
                  <th scope="row">
                    <span className="q">{s.query}</span>
                    <br />
                    <span className="pg">{pathOf(s.page)}</span>
                  </th>
                  <td className="n">
                    <span className="pos">{s.position.toFixed(1)}</span>
                  </td>
                  <td className="n">{s.impressions.toLocaleString("en-US")}</td>
                  <td className="n hide-phone">{s.clicks.toLocaleString("en-US")}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="muted">
                  No queries in positions 4 to 20 with enough impressions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="stack-lg">
        <div className="panel pad">
          <p className="label">Impressions, no clicks</p>
          {gsc.zeroClick.length ? (
            <ul className="opp-list">
              {gsc.zeroClick.slice(0, 6).map((z) => (
                <li key={z.page}>
                  <span className="pg">{pathOf(z.page)}</span> · {z.impressions.toLocaleString("en-US")} impressions at {z.position.toFixed(1)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Every page with impressions gets clicks.</p>
          )}
        </div>
        {ga4 ? (
          <div className="panel pad">
            <p className="label">GA4 measurement health</p>
            <StatusLight state={ga4.health.state}>{ga4.health.state === "ok" ? "Tag reporting" : ga4.health.state === "warn" ? "Sessions stopped" : "No data"}</StatusLight>
            <p className="muted small">{ga4.health.detail}</p>
            {ga4.landingPages.length ? (
              <p className="muted small">
                Top organic landing page: <span className="pg">{ga4.landingPages[0].page}</span> ({ga4.landingPages[0].sessions.toLocaleString("en-US")} sessions)
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
