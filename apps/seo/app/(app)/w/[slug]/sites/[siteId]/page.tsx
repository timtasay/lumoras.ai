import type { Metadata } from "next";
import { RoutesTable } from "@/components/sites/RoutesTable";
import { ScanVisual, DomainOverviewLocked } from "@/components/scan/ScanVisual";
import { Badge } from "@/components/ui/Status";
import { can } from "@/lib/auth/permissions";
import { countRoutes, latestCrawl, listRoutes } from "@/lib/data/crawl";
import { loadSite } from "@/lib/site-page";
import { DomainOverviewPanel } from "@/components/research/DomainOverview";
import { Opportunities } from "@/components/google/Opportunities";
import { latestResult } from "@/lib/data/research";
import { googleDeps } from "@/lib/google/app";
import { ga4Insights, gscInsights, listGoogleConnections, type Ga4Insights, type GscInsights } from "@/lib/google/service";
import { providerInfo } from "@/lib/providers/registry";
import type { DomainOverview } from "@/lib/providers/types";
import { dateTimeLabel } from "@/lib/ui/time";

export const metadata: Metadata = { title: "Site" };

export default async function SiteOverview({ params, searchParams }: { params: Promise<{ slug: string; siteId: string }>; searchParams: Promise<{ crawl?: string }> }) {
  const { slug, siteId } = await params;
  const sp = await searchParams;
  const { site, a, routes, total, crawl, overview, google } = await loadSite(slug, siteId, async (tx, s) => ({
    routes: await listRoutes(tx, s.id, { limit: 500 }),
    total: await countRoutes(tx, s.id),
    crawl: await latestCrawl(tx, s.id),
    overview: await latestResult<DomainOverview>(tx, s.id, "domainOverview", s.domain),
    google: await listGoogleConnections(tx, s.id),
  }));
  const canRun = can(a.role, "crawl:run");
  const info = providerInfo();
  const gdeps = googleDeps();
  let gsc: GscInsights | null = null, ga4: Ga4Insights | null = null, gError: string | null = null;
  if (gdeps && google.search_console) {
    try {
      [gsc, ga4] = await Promise.all([gscInsights(gdeps, a.ctx, site.id), google.ga4 ? ga4Insights(gdeps, a.ctx, site.id).catch(() => null) : null]);
    } catch (e) {
      gError = `Search Console could not be read: ${e instanceof Error ? e.message.slice(0, 160) : "error"}. Check the connection.`;
    }
  }
  return (
    <div className="stack-lg">
      <section aria-labelledby="scan-h" className="panel pad">
        <div className="sec-head">
          <h2 id="scan-h">Route inventory</h2>
          <p className="muted small">
            {crawl ? (
              <>
                Last scan {dateTimeLabel(crawl.started_at)} · {crawl.sitemaps} sitemap{crawl.sitemaps === 1 ? "" : "s"} · {crawl.urls.toLocaleString("en-US")} URLs{" "}
                {crawl.status !== "ok" ? <Badge tone={crawl.status === "failed" ? "danger" : "amber"}>{crawl.status}</Badge> : null}
              </>
            ) : (
              "Not scanned yet."
            )}{" "}
            The worker refreshes the sitemaps daily.
          </p>
        </div>
        <ScanVisual slug={slug} siteId={site.id} domain={site.domain} canRun={canRun} autoStart={sp.crawl === "1" && !crawl} />
        {crawl && crawl.problems.length ? (
          <details className="problems">
            <summary>
              {crawl.problems.length} problem{crawl.problems.length === 1 ? "" : "s"} in the last scan
            </summary>
            <ul className="mono small">
              {crawl.problems.map((p, i) => (
                <li key={i}>
                  <span className="muted">{p.url}</span> {p.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <section aria-labelledby="routes-h">
        <div className="sec-head">
          <h2 id="routes-h">
            Routes <span className="tab-n">{total.toLocaleString("en-US")}</span>
          </h2>
          <p className="muted small">Internal links in every article are checked against this list as of the publish date.</p>
        </div>
        <RoutesTable rows={routes.map((r) => ({ url: r.url, path: r.path, lastmod: r.lastmod ? r.lastmod.toISOString().slice(0, 10) : null, seen: r.last_seen_at.toISOString().slice(0, 10) }))} total={total} />
      </section>
      <section aria-labelledby="opp-h">
        <div className="sec-head">
          <h2 id="opp-h">Search opportunities</h2>
          <p className="muted small">From the site&apos;s own Search Console, last 28 days. Free.</p>
        </div>
        <Opportunities base={`/w/${slug}/sites/${site.id}`} gsc={gsc} ga4={ga4} gscState={!gdeps ? "unconfigured" : google.search_console ? "connected" : "none"} error={gError} />
      </section>
      {info.name === "none" ? (
        <DomainOverviewLocked domain={site.domain} />
      ) : (
        <DomainOverviewPanel
          slug={slug}
          siteId={site.id}
          domain={site.domain}
          demo={info.demo}
          canRun={can(a.role, "research:run")}
          last={overview ? { data: overview.result, at: overview.created_at.toISOString(), costMicros: overview.cost_micros } : null}
        />
      )}
    </div>
  );
}
