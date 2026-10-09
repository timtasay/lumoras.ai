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
            values={{ ...data.brand!, prefilled_at: data.brand!.prefilled_at?.toISOString() ?? null, seo_rules: data.brand!.seo_rules as unknown as Record<string, number> }}
          />
        </OnboardingFrame>
      );
    case "authors":
      return (
        <OnboardingFrame {...frame} wide title="Who signs the articles?" lede="Bylines are published as real people. Add the people who will put their name to the content, with their real role.">
          <AuthorsEditor
            authors={data.authors.map((x) => ({ id: x.id, name: x.name, role: x.role, bio: x.bio, avatar_url: x.avatar_url, is_demo: x.is_demo }))}
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
    case "publishing":
      return (
        <OnboardingFrame {...frame} title="Choose how articles get published" lede="One connector per site, tested before the first article is due.">
          <LaterStep
            slug={slug}
            from="publishing"
            phase={3}
            cards={[
              { icon: "flow", title: "Git, file per post", text: "GitHub or Gitea. Opens a pull request (default) or commits to a branch, with your frontmatter template." },
              { icon: "doc", title: "WordPress", text: "REST API with an application password: posts, categories, featured image, Yoast or Rank Math fields." },
              { icon: "send", title: "Webhook and feed", text: "Signed JSON to your endpoint, plus a JSON and RSS feed any custom site can pull." },
            ]}
            note={
              <>
                You can already store a connector&apos;s credentials (encrypted) under the site&apos;s Connections tab; the live test arrives with the publisher.
              </>
            }
          />
        </OnboardingFrame>
      );
    case "schedule":
      return (
        <OnboardingFrame {...frame} title="Set a schedule and a budget" lede="Rolling generation: each article is written a few days before its slot, so it reacts to the latest data.">
          <LaterStep
            slug={slug}
            from="schedule"
            phase={3}
            preview
            cards={[
              { icon: "calendar", title: "Schedule", text: "Tuesday and Friday at 09:00 site time · written 3 days ahead · runway alert below 10 days. No back-dating." },
              { icon: "db", title: "Budget and reserve", available: true, text: "A monthly ceiling for paid SEO data and a reserve that is never spent. Owners set it under Budget and usage; every paid call is priced first." },
            ]}
            note="Approval required is the default review mode. Autopilot stays off until someone turns it on and reads what it means."
          />
        </OnboardingFrame>
      );
    case "done": {
      const t = new Date();
      const today = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
      const b = data.brand!;
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
                <span>{data.authors.length ? `${data.authors.length} real byline${data.authors.length === 1 ? "" : "s"}.` : "None yet: add one before Phase 3 writes anything."}</span>
              </li>
              <li>
                <StatusLight state={Object.keys(data.google).length === 2 ? "ok" : Object.keys(data.google).length ? "warn" : "idle"}>Search Console & GA4</StatusLight>
                <span>{Object.keys(data.google).length ? `${Object.keys(data.google).length} of 2 connected.` : "Not connected yet: connect them under the site's Connections tab."}</span>
              </li>
              {STEPS.filter((s) => s.later).map((s) => (
                <li key={s.key}>
                  <StatusLight state="idle">{s.label}</StatusLight>
                  <span>Arrives in Phase {s.later}.</span>
                </li>
              ))}
            </ul>
            <div className="done-cal">
              <p className="label">The first calendar</p>
              <CalendarMini year={today.getUTCFullYear()} month={today.getUTCMonth()} today={today} items={[]} runwayDays={0} threshold={10} />
              <p className="muted small">Nothing is scheduled yet, so the runway reads empty. It fills once a schedule exists (Phase 3).</p>
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
