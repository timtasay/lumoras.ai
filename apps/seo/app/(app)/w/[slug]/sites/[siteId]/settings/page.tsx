import type { Metadata } from "next";
import { DeleteSite } from "@/components/sites/DeleteSite";
import { SiteForm } from "@/components/forms/SiteForm";
import { ReadOnlyNote } from "@/components/forms/FormBits";
import { can } from "@/lib/auth/permissions";
import { loadSite } from "@/lib/site-page";
import { timezones } from "@/lib/ui/timezones";
import { deleteSiteAction, updateSiteAction } from "../../../actions";
import { saveScheduleAction, setFeedAction } from "../../../publishing-actions";
import { ScheduleForm } from "@/components/content/ScheduleForm";
import { FeedPanel } from "@/components/content/FeedPanel";
import { getSiteSettings } from "@/lib/data/sites";
import { describeConnection, loadPublishConnection } from "@/lib/publishers/registry";
import { webEnv } from "@/lib/config";
import { localParts } from "@/lib/content/schedule";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { MeasureSettingsForm } from "@/components/measure/MeasureSettingsForm";
import { saveMeasureSettingsAction } from "../../../measure-actions";
import { trackedKeywords } from "@/lib/measure/rank";
import { dataForSeoPrice } from "@/lib/providers/operations";
import { formatMicros } from "@/lib/research/money";
import { marketFor } from "@/lib/research/market";

export const metadata: Metadata = { title: "Site settings" };

export default async function SiteSettingsPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const { site, a, settings, publish, tracked } = await loadSite(slug, siteId, async (tx, s) => {
    const settings = await getSiteSettings(tx, s.id);
    const publish = settings.publish_connection_id ? await loadPublishConnection(tx, settings.publish_connection_id).catch(() => null) : null;
    return { settings, publish, tracked: await trackedKeywords(tx, s.id, settings.rank_max_keywords) };
  });
  const rankPrice = tracked.length ? formatMicros(dataForSeoPrice({ op: "rankTracker.run", params: { trackerId: "-", domain: site.domain, market: marketFor(settings), keywords: tracked.map((t) => t.keyword), depth: settings.rank_depth } }).micros) : null;
  const base = webEnv().baseUrl;
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
          defaults={{ name: site.name, industry: site.industry, locale: site.locale, country: site.country, serpLocation: site.serp_location, timezone: site.timezone, researchMaxAgeDays: site.research_max_age_days }}
        />
      </section>
      <section className="panel pad" aria-labelledby="sched-h" id="schedule">
        <h2 id="sched-h" className="sub-h">
          Schedule and publishing rules
        </h2>
        <ScheduleForm
          action={saveScheduleAction.bind(null, slug, site.id, false)}
          readOnly={!canEdit}
          defaults={{
            days: settings.schedule_days,
            time: settings.schedule_time,
            active: settings.schedule_active,
            generationMode: settings.generation_mode,
            leadDays: settings.lead_days,
            batchSize: settings.batch_size,
            horizonDays: settings.horizon_days,
            runwayThreshold: settings.runway_threshold_days,
            reviewMode: settings.review_mode,
            allowBackdating: settings.allow_backdating,
            timezone: settings.timezone,
            autopilotSince: settings.autopilot_acknowledged_at ? localParts(settings.autopilot_acknowledged_at, settings.timezone).date : null,
          }}
        />
      </section>
      <section className="panel pad" aria-labelledby="pubto-h">
        <h2 id="pubto-h" className="sub-h">
          Where articles publish
        </h2>
        {publish ? (
          <p>
            <Icon name="send" className="inline-ico" /> <strong>{publish.label}</strong> · <span className="muted">{describeConnection(publish)}</span>
          </p>
        ) : (
          <p className="muted">No publishing connection yet: approved articles wait until one is chosen.</p>
        )}
        <p className="small">
          <Link className="tlink" href={`/w/${slug}/sites/${site.id}/connections`}>
            Set up and test connections
          </Link>
        </p>
        <FeedPanel enabled={settings.feed_enabled} canEdit={canEdit} jsonUrl={`${base}/api/feeds/${settings.feed_token}/feed.json`} rssUrl={`${base}/api/feeds/${settings.feed_token}/rss.xml`} toggle={setFeedAction.bind(null, slug, site.id)} />
      </section>
      <section className="panel pad" aria-labelledby="measure-h" id="measurement">
        <h2 id="measure-h" className="sub-h">
          Measurement
        </h2>
        <MeasureSettingsForm
          action={saveMeasureSettingsAction.bind(null, slug, site.id)}
          readOnly={!canEdit}
          estimate={rankPrice}
          defaults={{
            rankCadence: settings.rank_cadence,
            rankDevice: settings.rank_device,
            rankDepth: settings.rank_depth,
            rankMaxKeywords: settings.rank_max_keywords,
            auditCadence: settings.audit_cadence,
            auditMaxPages: settings.audit_max_pages,
            backlinksCadence: settings.backlinks_cadence,
            searchSync: settings.search_sync,
            inspectDailyCap: settings.inspect_daily_cap,
          }}
        />
      </section>
      {can(a.role, "site:delete") ? <DeleteSite domain={site.domain} action={deleteSiteAction.bind(null, slug, site.id)} /> : null}
    </div>
  );
}
