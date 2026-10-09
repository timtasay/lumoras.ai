import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { SiteCard } from "@/components/sites/SiteCard";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Status";
import { readWorkspace } from "@/lib/actions";
import { can, ROLE_LABEL } from "@/lib/auth/permissions";
import { pool } from "@/lib/db/pool";
import { listSiteSettings, listSites } from "@/lib/data/sites";
import { listReviewQueue } from "@/lib/data/content";
import { siteRunway } from "@/lib/content/planner";
import { RunwayBanner, type RunwayAlert } from "@/components/content/RunwayBanner";
import { getWorkspaceRow, listMembers } from "@/lib/data/workspaces";
import { STEPS, stepIndex } from "@/lib/onboarding";
import { relativeTime } from "@/lib/ui/time";

export const metadata: Metadata = { title: "Overview" };

export default async function WorkspaceOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const now = new Date();
  const { a, sites, ws, runways, review } = await readWorkspace(slug, async (tx, a) => {
    const settings = await listSiteSettings(tx);
    const runways = new Map<string, { days: number; level: "ok" | "low" | "empty"; threshold: number; reason: string; active: boolean }>();
    for (const s of settings) {
      if (!s.schedule_active) continue;
      const r = (await siteRunway(tx, s, now)).runway;
      runways.set(s.id, { days: r.days, level: r.level, threshold: s.runway_threshold_days, reason: r.reason, active: s.schedule_active });
    }
    return { a, sites: await listSites(tx), ws: await getWorkspaceRow(tx), runways, review: (await listReviewQueue(tx)).filter((i) => i.status === "awaiting_review").length };
  });
  const alerts: RunwayAlert[] = sites.flatMap((s) => {
    const r = runways.get(s.id);
    return r && r.level !== "ok" ? [{ siteId: s.id, domain: s.domain, level: r.level, days: r.days, threshold: r.threshold, reason: r.reason }] : [];
  });
  const members = await listMembers(pool(), a.workspace.id);
  const canAdd = can(a.role, "site:create");
  const routes = sites.reduce((n, s) => n + s.routes, 0);
  const authors = sites.reduce((n, s) => n + s.authors, 0);
  const onboarding = ws.status === "onboarding" && canAdd;

  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>Workspace</b> · {ROLE_LABEL[a.role]}
          </p>
          <h1>{a.workspace.name}</h1>
        </div>
        {canAdd ? (
          <Link href={`/w/${slug}/sites/new`} className={buttonClass("secondary")}>
            <Icon name="plus" /> Add a site
          </Link>
        ) : null}
      </header>

      {onboarding ? (
        <div className="banner" role="status">
          <Icon name="flow" />
          <p>
            <strong>Setup is not finished.</strong> Next step: {STEPS[stepIndex(ws.onboarding_step)]?.label.toLowerCase()}.
          </p>
          <Link href={`/w/${slug}/onboarding/${ws.onboarding_step}`} className={buttonClass("primary", "sm")}>
            Resume setup
          </Link>
        </div>
      ) : null}

      <RunwayBanner slug={slug} alerts={alerts} />

      <RevealGroup className="kpi-grid">
        {[
          <KpiTile key="s" label="Sites" value={sites.length} note={sites.length === 1 ? "1 website" : `${sites.length} websites`} />,
          <KpiTile key="r" label="Routes in inventory" value={routes} format="compact" note="From each site's sitemaps" />,
          <KpiTile key="a" label="Authors" value={authors} note={authors ? "Real people only" : "Nothing is written without one"} tone={authors ? undefined : "amber"} />,
          <KpiTile key="q" label="Awaiting review" value={review} note={review ? "Open the review queue" : "Nothing waiting"} tone={review ? "amber" : undefined} />,
          <KpiTile key="m" label="Members" value={members.length} note={`${members.filter((m) => m.role === "owner").length} owner${members.filter((m) => m.role === "owner").length === 1 ? "" : "s"}`} />,
        ]}
      </RevealGroup>

      <section className="sec" aria-labelledby="sites-h">
        <div className="sec-head">
          <h2 id="sites-h">Sites</h2>
          <p className="muted">Runway: how many days ahead every slot will go out (written, in review, or writable by the pipeline).</p>
        </div>
        {sites.length ? (
          <RevealGroup className="site-grid" as="ul">
            {[
              ...sites.map((s) => (
                <SiteCard
                  key={s.id}
                  href={`/w/${slug}/sites/${s.id}`}
                  site={{
                    id: s.id,
                    domain: s.domain,
                    name: s.name,
                    industry: s.industry,
                    routes: s.routes,
                    authors: s.authors,
                    brandFilled: s.brand_filled,
                    lastCrawl: s.last_crawl_at ? relativeTime(s.last_crawl_at) : null,
                    crawlStatus: s.last_crawl_status,
                    failingConnections: s.failing_connections,
                    runway: runways.get(s.id) ?? null,
                  }}
                />
              )),
              ...(canAdd
                ? [
                    <Link key="add" href={`/w/${slug}/sites/new`} className="site-card site-add">
                      <span className="feat-ico" aria-hidden="true">
                        <Icon name="plus" />
                      </span>
                      <span>Add a site</span>
                      <span className="muted small">Another website or brand of {a.workspace.name}</span>
                    </Link>,
                  ]
                : []),
            ]}
          </RevealGroup>
        ) : (
          <EmptyState
            icon="globe"
            title="No sites yet"
            text={canAdd ? "Add the first website. We scan its sitemap, read its key pages and pre-fill a brand profile you can correct." : "An editor or owner adds the first site. You will see it here."}
            primary={
              canAdd ? (
                <Link href={`/w/${slug}/sites/new`} className={buttonClass("primary")}>
                  <Icon name="plus" /> Add your first site
                </Link>
              ) : (
                <Badge>Waiting for an editor</Badge>
              )
            }
          />
        )}
      </section>
    </div>
  );
}
