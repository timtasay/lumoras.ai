import { ViewTransition } from "react";
import { SiteTabs } from "@/components/sites/SiteTabs";
import { Badge } from "@/components/ui/Status";
import { loadSite } from "@/lib/site-page";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const { site } = await loadSite(slug, siteId, async () => ({}));
  return (
    <div className="page">
      <header className="site-head">
        <ViewTransition name={`site-mark-${site.id}`} share="morph" default="none">
          <span className="site-fav lg" aria-hidden="true">
            {site.domain[0]?.toUpperCase()}
          </span>
        </ViewTransition>
        <div className="site-id">
          <p className="eyebrow">
            <b>Site</b> · {site.name}
            {site.industry ? ` · ${site.industry}` : ""}
          </p>
          <ViewTransition name={`site-title-${site.id}`} share="morph" default="none">
            <h1>{site.domain}</h1>
          </ViewTransition>
        </div>
        <div className="site-head-meta">
          <Badge>{site.locale}</Badge>
          <Badge>{site.timezone.replace(/_/g, " ")}</Badge>
          {site.status !== "active" ? <Badge tone="amber">{site.status}</Badge> : null}
        </div>
      </header>
      <SiteTabs base={`/w/${slug}/sites/${site.id}`} />
      <div className="site-body">{children}</div>
    </div>
  );
}
