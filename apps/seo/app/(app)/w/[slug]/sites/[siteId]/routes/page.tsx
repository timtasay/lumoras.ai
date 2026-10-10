import type { Metadata } from "next";
import { RoutesTable } from "@/components/sites/RoutesTable";
import { ScanVisual, DomainOverviewLocked } from "@/components/scan/ScanVisual";
import { Badge } from "@/components/ui/Status";
import { can } from "@/lib/auth/permissions";
import { countRoutes, latestCrawl, listRoutes } from "@/lib/data/crawl";
import { loadSite } from "@/lib/site-page";
import { DomainOverviewPanel } from "@/components/research/DomainOverview";
import { latestResult } from "@/lib/data/research";
import { providerInfo } from "@/lib/providers/registry";
import type { DomainOverview } from "@/lib/providers/types";
import { dateTimeLabel } from "@/lib/ui/time";

export const metadata: Metadata = { title: "Routes" };

export default async function SiteRoutes({ params, searchParams }: { params: Promise<{ slug: string; siteId: string }>; searchParams: Promise<{ crawl?: string }> }) {
  const { slug, siteId } = await params;
  const sp = await searchParams;
  const { site, a, routes, total, crawl, overview } = await loadSite(slug, siteId, async (tx, s) => ({
    routes: await listRoutes(tx, s.id, { limit: 500 }),
    total: await countRoutes(tx, s.id),
    crawl: await latestCrawl(tx, s.id),
    overview: await latestResult<DomainOverview>(tx, s.id, "domainOverview", s.domain),
  }));
  const canRun = can(a.role, "crawl:run");
  const info = providerInfo();
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
