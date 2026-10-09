import type { Metadata } from "next";
import { DeleteSite } from "@/components/sites/DeleteSite";
import { SiteForm } from "@/components/forms/SiteForm";
import { ReadOnlyNote } from "@/components/forms/FormBits";
import { can } from "@/lib/auth/permissions";
import { loadSite } from "@/lib/site-page";
import { timezones } from "@/lib/ui/timezones";
import { deleteSiteAction, updateSiteAction } from "../../../actions";

export const metadata: Metadata = { title: "Site settings" };

export default async function SiteSettingsPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const { site, a } = await loadSite(slug, siteId, async () => ({}));
  const canEdit = can(a.role, "site:update");
  return (
    <div className="stack-lg">
      <section className="panel pad" aria-labelledby="details-h">
        <h2 id="details-h" className="sub-h">
          Site details
        </h2>
        {canEdit ? null : <ReadOnlyNote>Your role can see these settings. Editors and owners change them.</ReadOnlyNote>}
        <SiteForm
          mode="edit"
          readOnly={!canEdit}
          action={updateSiteAction.bind(null, slug, site.id)}
          timezones={timezones()}
          defaults={{ name: site.name, industry: site.industry, locale: site.locale, country: site.country, serpLocation: site.serp_location, timezone: site.timezone }}
        />
      </section>
      <section className="panel pad later-settings" aria-labelledby="later-h">
        <h2 id="later-h" className="sub-h">
          Publishing rules
        </h2>
        <dl className="kv">
          <div>
            <dt>Schedule and lead days</dt>
            <dd>Phase 3 · default: written 3 days before each slot</dd>
          </div>
          <div>
            <dt>Review mode</dt>
            <dd>Phase 3 · default: approval required (autopilot off)</dd>
          </div>
          <div>
            <dt>Back-dating</dt>
            <dd>Phase 3 · default: off</dd>
          </div>
          <div>
            <dt>Runway threshold</dt>
            <dd>Phase 3 · default: 10 days</dd>
          </div>
        </dl>
      </section>
      {can(a.role, "site:delete") ? <DeleteSite domain={site.domain} action={deleteSiteAction.bind(null, slug, site.id)} /> : null}
    </div>
  );
}
