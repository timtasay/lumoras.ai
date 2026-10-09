import type { Metadata } from "next";
import Link from "next/link";
import { ContentCalendar, type CalendarEntry, type CalendarSite } from "@/components/content/ContentCalendar";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClass } from "@/components/ui/Button";
import { readWorkspace } from "@/lib/actions";
import { can } from "@/lib/auth/permissions";
import { listCalendar } from "@/lib/data/content";
import { listSiteSettings } from "@/lib/data/sites";
import { siteRunway } from "@/lib/content/planner";
import { describeSchedule, localParts, zonedToUtc } from "@/lib/content/schedule";
import { LABEL, TONE } from "@/lib/content/status";
import { isUuid } from "@/lib/db/tenant";
import { RunwayBanner, type RunwayAlert } from "@/components/content/RunwayBanner";
import { rescheduleAction, runNowAction, skipSlotAction } from "../content-actions";

export const metadata: Metadata = { title: "Content calendar" };

export default async function ContentPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ site?: string; view?: string; month?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const now = new Date();
  const data = await readWorkspace(slug, async (tx, a) => {
    const sites = await listSiteSettings(tx);
    const site = sites.find((s) => s.id === sp.site) ?? sites[0] ?? null;
    const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localParts(now, site?.timezone ?? "UTC").date.slice(0, 7);
    const tz = site?.timezone ?? "UTC";
    const from = zonedToUtc(`${month}-01`, "00:00", tz);
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const items = await listCalendar(tx, { siteId: site && isUuid(site.id) ? site.id : null, from: new Date(from.getTime() - 36 * 3_600_000), to: new Date(zonedToUtc(next, "00:00", tz).getTime() + 36 * 3_600_000) });
    const runways = new Map<string, Awaited<ReturnType<typeof siteRunway>>["runway"]>();
    for (const s of sites) runways.set(s.id, (await siteRunway(tx, s, now)).runway);
    return { sites, site, month, items, runways, role: a.role };
  });
  if (!data.site) {
    return (
      <div className="page">
        <header className="pg-head">
          <h1>Content calendar</h1>
        </header>
        <EmptyState icon="calendar" title="Add a site first" text="The calendar shows each site's scheduled articles and its runway." primary={<Link href={`/w/${slug}/sites/new`} className={buttonClass("primary")}><span className="btn-label">Add a site</span></Link>} />
      </div>
    );
  }
  const tzOf = new Map(data.sites.map((s) => [s.id, s.timezone]));
  const sites: CalendarSite[] = data.sites.map((s) => {
    const r = data.runways.get(s.id)!;
    return {
      id: s.id,
      domain: s.domain,
      today: localParts(now, s.timezone).date,
      allowBackdating: s.allow_backdating,
      schedule: s.schedule_active ? `Publishes ${describeSchedule({ days: s.schedule_days, time: s.schedule_time, timezone: s.timezone })}; written ${s.lead_days} day${s.lead_days === 1 ? "" : "s"} ahead (${s.generation_mode}).` : "The schedule is off: no new slots are laid out.",
      runway: { days: r.days, level: r.level, coveredUntil: r.coveredUntil, gapAt: r.gapAt, reason: r.reason, threshold: s.runway_threshold_days },
    };
  });
  const entries: CalendarEntry[] = data.items
    .map((i) => {
      const l = localParts(i.slot_at, tzOf.get(i.site_id) ?? "UTC");
      const blocked = i.unverifiable_claims > 0 ? `${i.unverifiable_claims} unverifiable claim(s) block publishing` : i.lint_passed === false ? "Lint has failing rules" : i.status === "failed" ? (i.status_detail ?? "Failed") : null;
      return { id: i.id, siteId: i.site_id, domain: i.domain, date: l.date, time: l.time, status: i.status, statusLabel: LABEL[i.status], tone: TONE[i.status], title: i.title, keyword: i.primary_keyword, runId: i.current_run_id, written: !!i.title, blocked };
    })
    .filter((e) => e.date.startsWith(data.month));
  const view = sp.view === "list" ? "list" : "month";
  const alerts: RunwayAlert[] = data.sites.flatMap((s) => {
    const r = data.runways.get(s.id)!;
    return s.schedule_active && r.level !== "ok" ? [{ siteId: s.id, domain: s.domain, level: r.level, days: r.days, threshold: s.runway_threshold_days, reason: r.reason }] : [];
  });
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>Content</b> · rolling generation
          </p>
          <h1>Content calendar</h1>
          <p className="lede muted">Each slot is written a few days before it goes out, so the topic reacts to the latest data. Drag an article to move it.</p>
        </div>
      </header>
      <RunwayBanner slug={slug} alerts={alerts} here />
      <ContentCalendar
        key={`${data.site.id}:${data.month}:${view}`}
        slug={slug}
        month={data.month}
        view={view}
        site={sites.find((s) => s.id === data.site!.id) ?? null}
        sites={sites}
        entries={entries}
        canSchedule={can(data.role, "content:schedule")}
        canRun={can(data.role, "pipeline:run")}
        reschedule={rescheduleAction.bind(null, slug)}
        runNow={runNowAction.bind(null, slug)}
        skip={skipSlotAction.bind(null, slug)}
      />
    </div>
  );
}
