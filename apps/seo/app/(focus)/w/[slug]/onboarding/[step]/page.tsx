import { readSeoRules } from "@/lib/validation";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { ContinueButton, ScanStep, LaterStep } from "@/components/onboarding/Steps";
import { AuthorsEditor } from "@/components/forms/AuthorsEditor";
import { BrandForm } from "@/components/forms/BrandForm";
import { SiteForm } from "@/components/forms/SiteForm";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { CalendarMini } from "@/components/ui/CalendarMini";
import { StatusLight } from "@/components/ui/Status";
import { requireWorkspace } from "@/lib/auth/app";
import { can } from "@/lib/auth/permissions";
import { pool } from "@/lib/db/pool";
import { withWorkspace } from "@/lib/db/tenant";
import { countRoutes, latestCrawl } from "@/lib/data/crawl";
import { getBrand, getSite, listAuthors } from "@/lib/data/sites";
import { getWorkspaceRow, ONBOARDING_STEPS, type OnboardingStep } from "@/lib/data/workspaces";
import { STEPS, stepIndex } from "@/lib/onboarding";
import { timezones } from "@/lib/ui/timezones";
import { createSiteAction, deleteAuthorAction, saveAuthorAction, saveBrandAction } from "@/app/(app)/w/[slug]/actions";
import { GoogleConnections } from "@/components/google/GoogleConnections";
import { latestResult } from "@/lib/data/research";
import { googleConfigured } from "@/lib/google/app";
import { CONNECT_RESULT_TEXT } from "@/lib/google/oauth";
import { listGoogleConnections } from "@/lib/google/service";
import { googleCards } from "@/lib/google/view";
import { providerInfo } from "@/lib/providers/registry";
import type { DomainOverview } from "@/lib/providers/types";
import { ConnectionsPanel } from "@/components/forms/ConnectionsPanel";
import { ScheduleForm } from "@/components/content/ScheduleForm";
import { listConnections } from "@/lib/data/connections";
import { getSiteSettings } from "@/lib/data/sites";
import { listCalendar } from "@/lib/data/content";
import { siteRunway } from "@/lib/content/planner";
import { describeSchedule, localParts } from "@/lib/content/schedule";
import { describeConnection, loadPublishConnection } from "@/lib/publishers/registry";
import { presetsFor } from "@/lib/publishers/presets";
import { postsFeedUrl } from "@/lib/publishers/content-api";
import { webEnv } from "@/lib/config";
import { createConnectionAction, deleteConnectionAction } from "@/app/(app)/w/[slug]/actions";
import { saveScheduleAction, setPublishConnectionAction, testPublishConnectionAction } from "@/app/(app)/w/[slug]/publishing-actions";
import type { CalItem } from "@/components/ui/CalendarMini";


export const metadata: Metadata = { title: "Set up the workspace" };

export default async function OnboardingStepPage({ params, searchParams }: { params: Promise<{ slug: string; step: string }>; searchParams: Promise<{ google?: string; reason?: string; kind?: string }> }) {
  const { slug, step: raw } = await params;
  const sp = await searchParams;
  if (!(ONBOARDING_STEPS as readonly string[]).includes(raw)) notFound();
  const step = raw as OnboardingStep;
  const a = await requireWorkspace(slug);
  // onboarding changes the workspace: editors and owners only
  if (!can(a.role, "site:create")) redirect(`/w/${slug}`);

  const data = await withWorkspace(
    pool(),
    a.ctx,
    async (tx) => {
      const ws = await getWorkspaceRow(tx);
      const site = ws.onboarding_site_id ? await getSite(tx, ws.onboarding_site_id) : null;
      return {
        ws,
        site,
        brand: site && (step === "brand" || step === "done") ? await getBrand(tx, site.id) : null,
        authors: site && (step === "authors" || step === "done") ? await listAuthors(tx, site.id) : [],
        routes: site && step === "done" ? await countRoutes(tx, site.id) : 0,
        crawl: site && step === "done" ? await latestCrawl(tx, site.id) : null,
        google: site && (step === "search" || step === "done") ? await listGoogleConnections(tx, site.id) : {},
        overview: site && step === "scan" ? await latestResult<DomainOverview>(tx, site.id, "domainOverview", site.domain) : null,
        conns: site && step === "publishing" ? await listConnections(tx, site.id) : [],
        settings: site && (step === "publishing" || step === "schedule" || step === "done") ? await getSiteSettings(tx, site.id) : null,
      };
    },
    { readOnly: true },
  );
  const { ws, site } = data;
  // steps after "site" need the site being onboarded
  if (step !== "site" && !site) redirect(`/w/${slug}/onboarding/site`);
  // no jumping ahead of the furthest step reached
  if (stepIndex(step) > stepIndex(ws.onboarding_step)) redirect(`/w/${slug}/onboarding/${ws.onboarding_step}`);

  const frame = { step, reached: ws.onboarding_step, slug, workspaceName: a.workspace.name } as const;

  switch (step) {
    case "site":
      return (
        <OnboardingFrame {...frame} title="Add the first site" lede="One website or brand. A workspace can hold several; start with one.">
          {site ? (
            <div className="onb-note">
              <StatusLight state="ok">{site.domain} is added.</StatusLight>
              <Link href={`/w/${slug}/onboarding/scan`} className={buttonClass("primary")}>
                Continue to the scan <Icon name="arrow" />
              </Link>
            </div>
          ) : (
            <SiteForm mode="onboarding" action={createSiteAction.bind(null, slug, true)} timezones={timezones()} />
          )}
        </OnboardingFrame>
      );
    case "scan":
      return (
        <OnboardingFrame {...frame} wide title={`Scanning ${site!.domain}`} lede="We read robots.txt, every sitemap it lists and a handful of key pages. The routes become the site's inventory, used later to check every internal link.">
          <ScanStep
            slug={slug}
            siteId={site!.id}
            domain={site!.domain}
            alreadyScanned={!!site!.last_crawl_at}
            overview={{
              available: providerInfo().name !== "none" && can(a.role, "research:run"),
              demo: providerInfo().demo,
              last: data.overview ? { data: data.overview.result, at: data.overview.created_at.toISOString(), costMicros: data.overview.cost_micros } : null,
            }}
          />
        </OnboardingFrame>
      );
    case "brand":
      return (
        <OnboardingFrame {...frame} wide title="Check the brand profile" lede="What the business sells, what it does not, how it talks. We pre-filled what the site already says; you correct it.">
          <BrandForm
            action={saveBrandAction.bind(null, slug, site!.id, true)}
            readOnly={false}
            submitLabel="Save and continue"
            values={{ ...data.brand!, prefilled_at: data.brand!.prefilled_at?.toISOString() ?? null, seo_rules: readSeoRules(data.brand!.seo_rules) as unknown as Record<string, unknown> }}
          />
        </OnboardingFrame>
      );
    case "authors":
      return (
        <OnboardingFrame {...frame} wide title="Who signs the articles?" lede="Bylines are the real people who put their name to the content, with their real role, or your organization (like “Lumoras team”) when the team signs together.">
          <AuthorsEditor
            authors={data.authors.map((x) => ({ id: x.id, kind: x.kind, name: x.name, role: x.role, bio: x.bio, avatar_url: x.avatar_url, is_demo: x.is_demo }))}
            canEdit
            save={saveAuthorAction.bind(null, slug, site!.id)}
            remove={deleteAuthorAction.bind(null, slug)}
          />
          <div className="onb-foot">
            <p className="muted small">{data.authors.length ? `${data.authors.length} author${data.authors.length === 1 ? "" : "s"} ready.` : "You can add authors later in site settings."}</p>
            <ContinueButton slug={slug} from="authors" label={data.authors.length ? "Continue" : "Skip for now"} />
          </div>
        </OnboardingFrame>
      );
    case "search": {
      const connected = Object.keys(data.google).length;
      const flash = sp.google === "connected" ? { ok: true, text: `${sp.kind === "ga4" ? "Google Analytics 4" : "Search Console"} is connected.` } : sp.google === "error" ? { ok: false, text: CONNECT_RESULT_TEXT[sp.reason ?? ""] ?? CONNECT_RESULT_TEXT.failed } : null;
      return (
        <OnboardingFrame {...frame} wide title="Connect Search Console and GA4" lede="Free, first-party data from Google, read with the client's own account. Read-only scopes; never the Indexing API.">
          <GoogleConnections slug={slug} siteId={site!.id} cards={googleCards(data.google)} canEdit={can(a.role, "connection:manage")} configured={googleConfigured()} next="onboarding" flash={flash} />
          <div className="onb-foot">
            <p className="muted small">{connected ? `${connected} of 2 connected. You can change them later under the site's Connections tab.` : "You can connect them later under the site's Connections tab."}</p>
            <ContinueButton slug={slug} from="search" label={connected ? "Continue" : "Skip for now"} variant={connected ? "primary" : "secondary"} />
          </div>
        </OnboardingFrame>
      );
    }
    case "publishing": {
      const st = data.settings!;
      const chosen = data.conns.find((c) => c.id === st.publish_connection_id);
      return (
        <OnboardingFrame {...frame} wide title="Choose how articles get published" lede="One connector per site, tested before the first article is due. Lumoras Growth can serve articles to the site directly (no deploy per article), a Git connection opens a pull request with one file per post, and a webhook receives signed JSON.">
          <ConnectionsPanel
            connections={data.conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, config: c.config, has_secret: c.has_secret, key_version: c.key_version, status: c.status, status_detail: c.status_detail, created: "" }))}
            canEdit={can(a.role, "connection:manage")}
            create={createConnectionAction.bind(null, slug, site!.id)}
            remove={deleteConnectionAction.bind(null, slug, site!.id)}
            publishId={st.publish_connection_id}
            test={testPublishConnectionAction.bind(null, slug, site!.id)}
            choosePublish={setPublishConnectionAction.bind(null, slug, site!.id)}
            presets={presetsFor(site!.domain)}
            postsFeedUrl={postsFeedUrl(webEnv().baseUrl, st.feed_token)}
          />
          <div className="onb-foot">
            <p className="muted small">
              {chosen ? `${chosen.label} publishes this site${chosen.status === "ok" ? " and its test passed" : ": run its Test before the first slot"}.` : "Without a publishing connection, approved articles wait. You can choose one later under the site's Connections tab."}
            </p>
            <ContinueButton slug={slug} from="publishing" label={chosen ? "Continue" : "Skip for now"} variant={chosen ? "primary" : "secondary"} />
          </div>
        </OnboardingFrame>
      );
    }
    case "schedule": {
      const st = data.settings!;
      return (
        <OnboardingFrame {...frame} wide title="Set a schedule" lede="Rolling generation: each article is written a few days before its slot, so it reacts to the latest data. Approval is required unless you turn autopilot on.">
          <ScheduleForm
            action={saveScheduleAction.bind(null, slug, site!.id, true)}
            readOnly={false}
            submitLabel="Save and finish"
            defaults={{
              days: st.schedule_days,
              time: st.schedule_time,
              active: true,
              generationMode: st.generation_mode,
              leadDays: st.lead_days,
              batchSize: st.batch_size,
              horizonDays: st.horizon_days,
              runwayThreshold: st.runway_threshold_days,
              reviewMode: st.review_mode,
              allowBackdating: st.allow_backdating,
              timezone: st.timezone,
              autopilotSince: null,
            }}
          />
          <p className="muted small">
            <Icon name="db" className="inline-ico" /> Budget: AI writing and paid SEO data draw on the workspace budget, with a reserve that is never spent. Owners set it under{" "}
            <Link className="tlink" href={`/w/${slug}/settings/budget`}>
              Budget and usage
            </Link>
            .
          </p>
        </OnboardingFrame>
      );
    }
    case "done": {
      const t = new Date();
      const today = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
      const b = data.brand!;
      const st = data.settings!;
      const cal = await withWorkspace(pool(), a.ctx, async (tx) => ({ runway: (await siteRunway(tx, st, t)).runway, items: await listCalendar(tx, { siteId: st.id, from: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)), to: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)) }), publish: st.publish_connection_id ? await loadPublishConnection(tx, st.publish_connection_id).catch(() => null) : null }), { readOnly: true });
      const calItems: CalItem[] = cal.items.map((i) => ({ date: localParts(i.slot_at, st.timezone).date, title: i.title || "Planned slot", status: i.status === "published" ? "published" : i.status === "generating" || i.status === "planned" ? "generating" : "scheduled" }));
      const filled = [b.overview, b.positioning, b.audience].filter(Boolean).length + [b.sells, b.does_not_sell, b.voice_rules].filter((x) => x.length).length;
      return (
        <OnboardingFrame {...frame} wide title={`${a.workspace.name} is set up`} lede="Here is what is in place, and what arrives next.">
          <div className="done-grid">
            <ul className="done-list">
              <li>
                <StatusLight state="ok">Workspace</StatusLight>
                <span>{a.workspace.name}, sealed off from every other workspace.</span>
              </li>
              <li>
                <StatusLight state={data.crawl?.status === "ok" ? "ok" : data.crawl ? "warn" : "idle"}>Route inventory</StatusLight>
                <span>
                  {data.routes.toLocaleString("en-US")} routes on {site!.domain}
                  {data.crawl?.status === "partial" ? ", with problems to look at" : ""}.
                </span>
              </li>
              <li>
                <StatusLight state={filled >= 4 ? "ok" : "warn"}>Brand profile</StatusLight>
                <span>{filled} of 6 core fields filled.</span>
              </li>
              <li>
                <StatusLight state={data.authors.length ? "ok" : "warn"}>Authors</StatusLight>
                <span>{data.authors.length ? `${data.authors.length} real byline${data.authors.length === 1 ? "" : "s"}.` : "None yet: the pipeline does not write without a real byline."}</span>
              </li>
              <li>
                <StatusLight state={Object.keys(data.google).length === 2 ? "ok" : Object.keys(data.google).length ? "warn" : "idle"}>Search Console & GA4</StatusLight>
                <span>{Object.keys(data.google).length ? `${Object.keys(data.google).length} of 2 connected.` : "Not connected yet: connect them under the site's Connections tab."}</span>
              </li>
              <li>
                <StatusLight state={cal.publish ? (cal.publish.status === "ok" ? "ok" : "warn") : "idle"}>Publishing</StatusLight>
                <span>{cal.publish ? `${cal.publish.label}: ${describeConnection(cal.publish)}.` : "No connection yet: approved articles wait until one is chosen."}</span>
              </li>
              <li>
                <StatusLight state={st.schedule_active ? "ok" : "idle"}>Schedule</StatusLight>
                <span>{st.schedule_active ? `${describeSchedule({ days: st.schedule_days, time: st.schedule_time, timezone: st.timezone })}, written ${st.lead_days} days ahead. ${st.review_mode === "autopilot" ? "Autopilot is on." : "Approval required."}` : "Off: nothing is written until it is turned on."}</span>
              </li>
            </ul>
            <div className="done-cal">
              <p className="label">The first calendar</p>
              <CalendarMini year={today.getUTCFullYear()} month={today.getUTCMonth()} today={today} items={calItems} runwayDays={cal.runway.days} threshold={st.runway_threshold_days} />
              <p className="muted small">{cal.runway.reason}</p>
            </div>
          </div>
          <div className="form-acts">
            <Link href={`/w/${slug}`} className={buttonClass("primary", "lg")}>
              Open the workspace <Icon name="arrow" />
            </Link>
            <Link href={`/w/${slug}/settings`} className={buttonClass("ghost")}>
              Invite the team
            </Link>
          </div>
        </OnboardingFrame>
      );
    }
  }
}
