import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge, StatusLight } from "@/components/ui/Status";
import { MoveBadge, PosPill } from "@/components/measure/MoveBadge";
import { RunNow } from "@/components/measure/RunNow";
import { HealthPanel, PanelHead, SearchConsoleState } from "@/components/measure/States";
import { TrafficCharts } from "@/components/measure/TrafficCharts";
import { can } from "@/lib/auth/permissions";
import { siteRunway } from "@/lib/content/planner";
import { LABEL as STATUS_LABEL, TONE as STATUS_TONE } from "@/lib/content/status";
import { localParts } from "@/lib/content/schedule";
import { getSiteSettings } from "@/lib/data/sites";
import { googleConfigured, googleDeps } from "@/lib/google/app";
import { gscInsights } from "@/lib/google/service";
import type { StrikingQuery } from "@/lib/google/analysis";
import { describeIssue } from "@/lib/measure/audit-groups";
import { CADENCE_LABEL, nextDueAt } from "@/lib/measure/cadence";
import { articlesLive, creditsThisMonth, ga4Summary, gscKpis, gscSeries, indexStatus, lastRuns, latestAudit, nextUp, rankTrends, searchConnections, strikingFromStore } from "@/lib/measure/dashboard";
import { byMovement, movementSummary } from "@/lib/measure/movement";
import { recentRuns, RUN_LABEL, type RunKind } from "@/lib/measure/runs";
import { providerInfo } from "@/lib/providers/registry";
import { relativeTime } from "@/lib/ui/time";
import { loadSite } from "@/lib/site-page";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Site dashboard" };

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

export default async function SiteDashboard({ params, searchParams }: { params: Promise<{ slug: string; siteId: string }>; searchParams: Promise<{ crawl?: string }> }) {
  const { slug, siteId } = await params;
  if ((await searchParams).crawl === "1") redirect(`/w/${slug}/sites/${siteId}/routes?crawl=1`);
  const now = new Date();
  const base = `/w/${slug}/sites/${siteId}`;
  const configured = googleConfigured();
  const d = await loadSite(slug, siteId, async (tx, s) => {
    const settings = await getSiteSettings(tx, s.id);
    const runs: Partial<Record<RunKind, Awaited<ReturnType<typeof recentRuns>>>> = {};
    for (const k of ["rank", "audit", "backlinks"] as RunKind[]) runs[k] = await recentRuns(tx, s.id, k, 6);
    return {
      settings,
      conns: await searchConnections(tx, s.id, configured),
      kpis: await gscKpis(tx, s.id, now),
      series: await gscSeries(tx, s.id, now, 90),
      striking: await strikingFromStore(tx, s.id, now, 8),
      trends: await rankTrends(tx, s.id),
      audit: await latestAudit(tx, s.id),
      next: await nextUp(tx, s.id, now),
      idx: await indexStatus(tx, s.id),
      seen: (await tx.one<{ n: number }>("SELECT count(DISTINCT page)::int AS n FROM gsc_page_daily WHERE site_id = $1 AND day > current_date - 30 AND impressions > 0", [s.id])).n,
      live: await articlesLive(tx, s.id),
      credits: await creditsThisMonth(tx, s.id, now),
      last: await lastRuns(tx, s.id),
      runs,
      runway: settings.schedule_active ? (await siteRunway(tx, settings, now)).runway : null,
      ga4: await ga4Summary(tx, s.id),
    };
  });
  const { site, a } = d;
  const canRun = can(a.role, "measure:run");
  const canManage = can(a.role, "connection:manage");
  const info = providerInfo();
  const tz = d.settings.timezone;

  // the first sync may still be running: read striking distance live (free) until the stored rows exist
  let striking: StrikingQuery[] = d.striking;
  let strikingLive = false;
  const gdeps = googleDeps();
  if (!striking.length && gdeps && (d.conns.gsc.state === "syncing" || d.conns.gsc.state === "ok")) {
    const live = await gscInsights(gdeps, a.ctx, site.id).catch(() => null);
    if (live?.striking.length) {
      striking = live.striking.slice(0, 8);
      strikingLive = true;
    }
  }

  const k = d.kpis;
  const gscOk = d.conns.gsc.state === "ok" || (k.hasData && d.conns.gsc.state !== "none");
  const trends = [...d.trends].sort(byMovement);
  const sum = movementSummary(d.trends);
  const health = d.ga4.health;
  const indexed = d.idx.inspected ? { value: d.idx.indexed, note: `${d.idx.indexed} of ${d.idx.inspected} inspected URLs` } : { value: d.seen, note: d.seen ? "Pages seen in Google Search (28 days)" : "Not inspected yet" };
  const usd = (m: number) => m / 1_000_000;
  const tile = (n: number) => (k.hasData ? n : 0);

  return (
    <div className="stack-lg dash">
      {health && health.state !== "ok" ? <HealthPanel health={health} base={base} compact /> : null}
      {!gscOk ? <SearchConsoleState state={d.conns.gsc.state} base={base} canManage={canManage} detail={d.conns.gsc.detail} /> : null}

      <section aria-labelledby="kpi-h">
        <h2 id="kpi-h" className="sr-only">
          Key numbers
        </h2>
        <RevealGroup className="kpi-grid kpi-7">
          {[
            <KpiTile key="c" label="Organic clicks" missing={!k.hasData} value={tile(k.clicks)} format="compact" delta={k.hasData && k.clicksDelta !== null ? k.clicksDelta : undefined} trend={k.hasData ? k.weeklyClicks : undefined} note={k.hasData ? "Last 28 days" : "Connect Search Console"} />,
            <KpiTile key="i" label="Impressions" missing={!k.hasData} value={tile(k.impressions)} format="compact" delta={k.hasData && k.impressionsDelta !== null ? k.impressionsDelta : undefined} note={k.hasData ? "Last 28 days" : "Connect Search Console"} />,
            <KpiTile key="p" label="Average position" missing={!k.hasData} value={tile(k.position)} format="dec1" delta={k.hasData && k.positionDelta !== null ? k.positionDelta : undefined} goodWhen="down" note={k.hasData ? "Weighted by impressions" : "Connect Search Console"} />,
            <KpiTile key="x" label="Indexed pages" value={indexed.value} missing={!d.idx.inspected && !k.hasData} note={indexed.note} />,
            <KpiTile key="l" label="Articles live" value={d.live} note={d.live ? "Published by the pipeline" : "Nothing published yet"} />,
            <KpiTile key="r" label="Runway" value={d.runway?.days ?? 0} suffix=" days" tone={d.runway && d.runway.level !== "ok" ? "amber" : undefined} note={d.runway ? (d.runway.level === "ok" ? "Content scheduled ahead" : d.runway.level === "low" ? `Below the ${d.settings.runway_threshold_days}-day threshold` : "Nothing ready") : "No schedule yet"} />,
            <KpiTile key="m" label="Credits this month" value={usd(d.credits.siteMicros)} format="usd" note={d.credits.ceiling ? `Workspace: $${usd(d.credits.workspaceMicros).toFixed(2)} of $${usd(d.credits.ceiling).toFixed(2)}` : "No SEO data budget set"} />,
          ]}
        </RevealGroup>
      </section>

      {gscOk ? (
        <section aria-labelledby="traffic-h" className="dash-traffic">
          <PanelHead id="traffic-h" title="Search traffic, last 90 days" sub={<>From Search Console ({d.conns.gsc.property}). Google&apos;s newest days are provisional for two to three days.</>} link={{ href: `${base}/search`, label: "Search details" }} />
          <TrafficCharts days={d.series.days} />
        </section>
      ) : null}

      <div className="dash-grid">
        <section className="panel pad mpanel" aria-labelledby="next-h">
          <PanelHead id="next-h" title="Next up" sub="The next three slots and their state." link={{ href: `/w/${slug}/content?site=${site.id}`, label: "Calendar" }} />
          {d.next.length ? (
            <ol className="next-up">
              {d.next.map((n) => {
                const l = localParts(n.slot_at, tz);
                return (
                  <li key={n.id}>
                    <time dateTime={n.slot_at.toISOString()} className="nu-date">
                      <span>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz }).format(n.slot_at)}</span>
                      <strong>{l.day}</strong>
                      <span>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: tz }).format(n.slot_at)}</span>
                    </time>
                    <div className="nu-body">
                      <Link href={`/w/${slug}/content/${n.id}`} className="nu-title">
                        {n.title || n.primary_keyword || "Empty slot: the topic is chosen when it is written"}
                      </Link>
                      <span className="muted small">{l.time} site time</span>
                    </div>
                    <Badge tone={STATUS_TONE[n.status as keyof typeof STATUS_TONE] ?? "neutral"}>{STATUS_LABEL[n.status as keyof typeof STATUS_LABEL] ?? n.status}</Badge>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="mp-empty">
              <p>No upcoming slots. Turn the schedule on to keep the queue from running dry.</p>
              <Link href={`${base}/settings#schedule`} className="tlink">
                Set the schedule <Icon name="arrow" />
              </Link>
            </div>
          )}
        </section>

        <section className="panel pad mpanel" aria-labelledby="sd-h">
          <PanelHead id="sd-h" title="Striking distance" sub={<>Queries at positions 4 to 20, last 28 days{strikingLive ? " (read live; the first sync is still running)" : ""}.</>} link={{ href: `${base}/search`, label: "All queries" }} />
          {striking.length ? (
            <div className="tbl-frame flat" role="region" aria-label="Striking-distance queries" tabIndex={0}>
              <table className="tbl tbl-tight">
                <caption className="sr-only">Queries ranking in positions 4 to 20, most impressions first</caption>
                <thead>
                  <tr>
                    <th scope="col">Query and page</th>
                    <th scope="col" className="n">
                      Position
                    </th>
                    <th scope="col" className="n hide-phone">
                      Impressions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {striking.map((s) => (
                    <tr key={`${s.query}|${s.page}`}>
                      <th scope="row">
                        <span className="q">{s.query}</span>
                        <span className="pg">{pathOf(s.page)}</span>
                      </th>
                      <td className="n">
                        <span className="pos">{s.position.toFixed(1)}</span>
                      </td>
                      <td className="n hide-phone">{s.impressions.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mp-empty">
              <p>{gscOk ? "No queries in positions 4 to 20 with enough impressions yet." : "Striking-distance queries come from Search Console."}</p>
            </div>
          )}
        </section>

        <section className="panel pad mpanel" aria-labelledby="rm-h">
          <PanelHead
            id="rm-h"
            title="Rank movements"
            sub={d.trends.length ? `${sum.up} up · ${sum.down} down${sum.entered ? ` · ${sum.entered} entered` : ""}${sum.lost ? ` · ${sum.lost} dropped out` : ""} · ${sum.ranking} of ${sum.tracked} ranking` : "Every published target keyword is tracked automatically."}
            link={{ href: `${base}/rankings`, label: "Rankings" }}
          />
          {trends.length ? (
            <ul className="moves" aria-label="Recent rank movements">
              {trends.slice(0, 7).map((t) => (
                <li key={t.keyword}>
                  <span className="mv-kw">
                    {t.keyword}
                    {t.source === "published" ? <Badge tone="ion">Published</Badge> : null}
                  </span>
                  <PosPill p={t.current} />
                  <MoveBadge m={t.movement} />
                </li>
              ))}
            </ul>
          ) : (
            <RankEmpty last={d.last.rank} provider={info.name} base={base} slug={slug} />
          )}
        </section>

        <section className="panel pad mpanel" aria-labelledby="ai-h">
          <PanelHead
            id="ai-h"
            title="Open audit issues"
            sub={d.audit.audit ? `${d.audit.issues.reduce((n, i) => n + i.count, 0).toLocaleString("en-US")} issues on ${d.audit.audit.pages_crawled} pages · ${relativeTime(d.audit.audit.finished_at ?? d.audit.audit.started_at, now)}` : "A monthly crawl for broken links, titles, descriptions and more."}
            link={{ href: `${base}/audit`, label: "Audit" }}
          />
          {d.audit.issues.length ? (
            <ul className="issues-mini">
              {d.audit.issues.slice(0, 5).map((i) => (
                <li key={i.id}>
                  <span className="sev" data-sev={i.severity}>
                    {i.severity}
                  </span>
                  <span className="im-title">{describeIssue(i.issue_type, i.count, i.title).title}</span>
                  {i.task_id ? <Badge tone={i.task_status === "done" ? "ion" : "info"}>{i.task_status === "in_progress" ? "In progress" : i.task_status === "done" ? "Done" : "Task open"}</Badge> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mp-empty">
              <p>{d.audit.audit ? "The last audit found nothing to fix." : d.last.audit?.status === "refused" ? d.last.audit.detail : info.name === "none" ? "Audits start when an SEO data provider is configured." : "No audit yet."}</p>
              {canRun && !d.audit.audit && info.name !== "none" ? <RunNow slug={slug} siteId={site.id} kind="audit" label="Run the first audit" note="Priced first; within the budget." /> : null}
            </div>
          )}
        </section>
      </div>

      <section className="panel pad" aria-labelledby="ms-h">
        <PanelHead id="ms-h" title="Measurement" sub="What runs on its own, when it last ran, and when it runs next. Paid checks are priced first and refused below the budget's reserve." link={can(a.role, "site:update") ? { href: `${base}/settings#measurement`, label: "Cadences" } : undefined} />
        <ul className="mstatus">
          {(["gsc", "ga4", "inspect", "rank", "audit", "backlinks"] as RunKind[]).map((kind) => {
            const r = d.last[kind];
            const cadence = kind === "rank" ? d.settings.rank_cadence : kind === "audit" ? d.settings.audit_cadence : kind === "backlinks" ? d.settings.backlinks_cadence : d.settings.search_sync ? "daily" : "off";
            const paid = kind === "rank" || kind === "audit" || kind === "backlinks";
            const next = paid && info.name !== "none" ? nextDueAt(cadence, now, tz, d.runs[kind] ?? []) : null;
            const unlinked = !paid && !(kind === "ga4" ? d.conns.ga4.property : d.conns.gsc.property);
            const state = !r ? "idle" : r.status === "succeeded" ? "ok" : r.status === "running" || r.status === "waiting" ? "live" : r.status === "skipped" ? "idle" : r.status === "refused" ? "warn" : "error";
            return (
              <li key={kind}>
                <div className="ms-head">
                  <strong>{RUN_LABEL[kind]}</strong>
                  <span className="muted small">{CADENCE_LABEL[cadence]}</span>
                </div>
                <StatusLight state={state}>{!r ? (unlinked ? (kind === "ga4" ? "GA4 not connected" : "Search Console not connected") : "Not run yet") : `${r.status === "succeeded" ? "Done" : r.status === "waiting" ? "Waiting for the provider" : r.status[0].toUpperCase() + r.status.slice(1)} · ${relativeTime(r.finished_at ?? r.started_at, now)}`}</StatusLight>
                {r?.detail && r.status !== "succeeded" ? <p className="ms-detail">{r.detail}</p> : null}
                {next ? <p className="muted small">Next: {next.getTime() <= now.getTime() + 60_000 ? "at the next hourly check" : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(next)}</p> : null}
                {canRun && (paid ? info.name !== "none" && cadence !== "off" : kind === "gsc" ? d.conns.gsc.property : kind === "ga4" ? d.conns.ga4.property : d.conns.gsc.property) ? (
                  <RunNow slug={slug} siteId={site.id} kind={kind} label={kind === "gsc" || kind === "ga4" ? "Sync now" : kind === "inspect" ? "Inspect now" : "Run now"} variant="ghost" />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function RankEmpty({ last, provider, base, slug }: { last: { status: string; detail: string | null } | undefined; provider: string; base: string; slug: string }) {
  if (provider === "none") {
    return (
      <div className="mp-empty">
        <p>Rank tracking starts when an SEO data provider is configured (Lumoras staff). Keywords are ready to go.</p>
        <Link href={`${base}/keywords`} className="tlink">
          Saved keywords <Icon name="arrow" />
        </Link>
      </div>
    );
  }
  if (last?.status === "refused") {
    return (
      <div className="mp-empty" data-tone="warn">
        <p>{last.detail}</p>
        <Link href={`/w/${slug}/settings/budget`} className="tlink">
          Budget and usage <Icon name="arrow" />
        </Link>
      </div>
    );
  }
  return (
    <div className="mp-empty">
      <p>Nothing tracked yet. Published articles&apos; keywords are added automatically; mark saved keywords as targeted to track them too.</p>
      <Link href={`${base}/keywords`} className="tlink">
        Choose keywords <Icon name="arrow" />
      </Link>
    </div>
  );
}
