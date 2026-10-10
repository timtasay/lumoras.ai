import type { Metadata } from "next";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge, StatusLight } from "@/components/ui/Status";
import { AreaChart } from "@/components/charts/AreaChart";
import { RunNow } from "@/components/measure/RunNow";
import { HealthPanel, PanelHead, SearchConsoleState } from "@/components/measure/States";
import { TrafficCharts } from "@/components/measure/TrafficCharts";
import { can } from "@/lib/auth/permissions";
import { googleConfigured } from "@/lib/google/app";
import { ga4Summary, gscKpis, gscSeries, indexStatus, searchConnections, strikingFromStore, topPages, topQueries, zeroClickFromStore, type TopRow } from "@/lib/measure/dashboard";
import { day } from "@/lib/ui/format";
import { relativeTime } from "@/lib/ui/time";
import { loadSite } from "@/lib/site-page";

export const metadata: Metadata = { title: "Search" };

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

const VERDICT: Record<string, { label: string; tone: "ion" | "amber" | "danger" | "neutral" }> = {
  PASS: { label: "Indexed", tone: "ion" },
  NEUTRAL: { label: "Not indexed", tone: "amber" },
  PARTIAL: { label: "Partly", tone: "amber" },
  FAIL: { label: "Error", tone: "danger" },
  ERROR: { label: "Not inspected", tone: "neutral" },
};

function TopTable({ label, rows, first }: { label: string; rows: TopRow[]; first: string }) {
  return (
    <div className="tbl-frame" role="region" aria-label={`${label} table`} tabIndex={0}>
      <table className="tbl tbl-tight">
        <caption className="sr-only">{label}, last 28 days</caption>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col" className="n">
              Clicks
            </th>
            <th scope="col" className="n">
              Impressions
            </th>
            <th scope="col" className="n hide-phone">
              CTR
            </th>
            <th scope="col" className="n">
              Position
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <span className="q">{first === "Page" ? pathOf(r.key) : r.key}</span>
              </th>
              <td className="n">{r.clicks.toLocaleString("en-US")}</td>
              <td className="n">{r.impressions.toLocaleString("en-US")}</td>
              <td className="n hide-phone">{(r.ctr * 100).toFixed(1)}%</td>
              <td className="n">{r.position.toFixed(1)}</td>
            </tr>
          ))}
          {rows.length ? null : (
            <tr>
              <td colSpan={5} className="muted">
                Nothing yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function SearchPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const now = new Date();
  const d = await loadSite(slug, siteId, async (tx, s) => ({
    conns: await searchConnections(tx, s.id, googleConfigured()),
    kpis: await gscKpis(tx, s.id, now),
    series: await gscSeries(tx, s.id, now, 90),
    queries: await topQueries(tx, s.id, now),
    pages: await topPages(tx, s.id, now),
    striking: await strikingFromStore(tx, s.id, now, 20),
    zero: await zeroClickFromStore(tx, s.id, now),
    idx: await indexStatus(tx, s.id),
    ga4: await ga4Summary(tx, s.id),
  }));
  const { site, a } = d;
  const base = `/w/${slug}/sites/${site.id}`;
  const canManage = can(a.role, "connection:manage");
  const canRun = can(a.role, "measure:run");
  const k = d.kpis;
  const gscOk = k.hasData;
  const sync = d.conns.gsc.sync;

  return (
    <div className="stack-lg">
      <section aria-labelledby="gsc-h" className="stack-lg">
        <div className="mhead">
          <div>
            <h2 id="gsc-h" className="sub-h">
              Search Console
            </h2>
            <p className="muted small">
              {d.conns.gsc.property ? `${d.conns.gsc.property} · ` : ""}
              {sync?.last_success_at ? `synced ${relativeTime(sync.last_success_at, now)}` : "not synced yet"}
              {sync?.final_through ? ` · final through ${sync.final_through}` : ""}
              {sync && !sync.backfilled_at && sync.backfill_cursor ? ` · backfilling (${sync.backfill_cursor} of 16 months)` : ""}
            </p>
          </div>
          {canRun && d.conns.gsc.property ? <RunNow slug={slug} siteId={site.id} kind="gsc" label="Sync now" note="Free (read-only)." /> : null}
        </div>
        {!gscOk ? <SearchConsoleState state={d.conns.gsc.state === "ok" ? "syncing" : d.conns.gsc.state} base={base} canManage={canManage} detail={d.conns.gsc.detail} /> : null}
        {gscOk ? (
          <>
            {d.conns.gsc.state === "error" ? <SearchConsoleState state="error" base={base} canManage={canManage} detail={d.conns.gsc.detail} /> : null}
            <RevealGroup className="kpi-grid">
              {[
                <KpiTile key="c" label="Clicks" value={k.clicks} format="compact" delta={k.clicksDelta ?? undefined} trend={k.weeklyClicks} />,
                <KpiTile key="i" label="Impressions" value={k.impressions} format="compact" delta={k.impressionsDelta ?? undefined} />,
                <KpiTile key="r" label="Click-through rate" value={k.ctr * 100} format="dec1" suffix="%" note="Clicks ÷ impressions, 28 days" />,
                <KpiTile key="p" label="Average position" value={k.position} format="dec1" delta={k.positionDelta ?? undefined} goodWhen="down" />,
              ]}
            </RevealGroup>
            <TrafficCharts days={d.series.days} />
            <div className="split-2">
              <section aria-labelledby="tq-h" className="stack-sm">
                <PanelHead id="tq-h" title="Top queries" sub="Last 28 days. Anonymised queries are in the totals but never listed." />
                <TopTable label="Top queries" rows={d.queries} first="Query" />
              </section>
              <section aria-labelledby="tp-h" className="stack-sm">
                <PanelHead id="tp-h" title="Top pages" sub="Last 28 days." />
                <TopTable label="Top pages" rows={d.pages} first="Page" />
              </section>
            </div>
            <div className="split-2">
              <section aria-labelledby="sd2-h" className="stack-sm">
                <PanelHead id="sd2-h" title="Striking distance" sub="Positions 4 to 20: a push away from page one. The pipeline's opportunity scan reads these first." />
                <div className="tbl-frame" role="region" aria-label="Striking-distance queries" tabIndex={0}>
                  <table className="tbl tbl-tight">
                    <thead>
                      <tr>
                        <th scope="col">Query and page</th>
                        <th scope="col" className="n">
                          Position
                        </th>
                        <th scope="col" className="n">
                          Impressions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.striking.map((s) => (
                        <tr key={`${s.query}|${s.page}`}>
                          <th scope="row">
                            <span className="q">{s.query}</span>
                            <span className="pg">{pathOf(s.page)}</span>
                          </th>
                          <td className="n">
                            <span className="pos">{s.position.toFixed(1)}</span>
                          </td>
                          <td className="n">{s.impressions.toLocaleString("en-US")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section aria-labelledby="zc-h" className="stack-sm">
                <PanelHead id="zc-h" title="Impressions, no clicks" sub="Pages Google shows that nobody clicks: candidates for a better title and description." />
                <ul className="zero-list">
                  {d.zero.map((z) => (
                    <li key={z.page}>
                      <span className="pg">{pathOf(z.page)}</span>
                      <span className="muted small">
                        {z.impressions.toLocaleString("en-US")} impressions at {z.position.toFixed(1)}
                      </span>
                    </li>
                  ))}
                  {d.zero.length ? null : <li className="muted small">Every page with impressions gets clicks.</li>}
                </ul>
              </section>
            </div>
          </>
        ) : null}
      </section>

      <section aria-labelledby="idx-h" className="stack-sm">
        <PanelHead
          id="idx-h"
          title="Index status"
          sub={`Google's own answer for each published article and key page (URL Inspection, read-only: it never asks Google to crawl). ${d.idx.published ? `${d.idx.publishedIndexed} of ${d.idx.published} published articles indexed.` : ""}`}
        />
        {d.idx.rows.length ? (
          <div className="tbl-frame" role="region" aria-label="Index status of each URL" tabIndex={0}>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="hide-phone">
                    Google says
                  </th>
                  <th scope="col" className="hide-phone">
                    Last crawl
                  </th>
                  <th scope="col">Checked</th>
                </tr>
              </thead>
              <tbody>
                {d.idx.rows.map((r) => {
                  const v = VERDICT[r.verdict] ?? { label: r.verdict, tone: "neutral" as const };
                  return (
                    <tr key={r.url}>
                      <th scope="row">
                        <span className="q">{r.title ?? pathOf(r.url)}</span>
                        <span className="pg">
                          {r.source === "published" ? "Article" : r.source === "key_page" ? "Key page" : "Top search page"} · {pathOf(r.url)}
                        </span>
                      </th>
                      <td>
                        <Badge tone={v.tone}>{v.label}</Badge>
                      </td>
                      <td className="hide-phone">{r.error ?? (r.coverage_state || "–")}</td>
                      <td className="hide-phone">{r.last_crawl_time ? relativeTime(r.last_crawl_time, now) : "Never"}</td>
                      <td>{relativeTime(r.inspected_at, now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">{d.conns.gsc.property ? "Nothing inspected yet: new articles are inspected the day they go live, up to the site's daily cap." : "Index status comes from Search Console's URL Inspection once it is connected."}</p>
        )}
      </section>

      <section aria-labelledby="ga4-h" id="ga4" className="stack-lg">
        <div className="mhead">
          <div>
            <h2 id="ga4-h" className="sub-h">
              Google Analytics 4
            </h2>
            <p className="muted small">
              {d.conns.ga4.property ? `${d.conns.ga4.property} · ` : ""}
              {d.conns.ga4.sync?.last_success_at ? `synced ${relativeTime(d.conns.ga4.sync.last_success_at, now)}` : "not synced yet"} · organic search sessions, landing pages and key events
            </p>
          </div>
          {canRun && d.conns.ga4.property ? <RunNow slug={slug} siteId={site.id} kind="ga4" label="Sync now" note="Free (read-only)." /> : null}
        </div>
        {d.ga4.health ? <HealthPanel health={d.ga4.health} base={base} /> : null}
        {d.conns.ga4.state !== "ok" && !d.ga4.hasData ? <SearchConsoleState what="GA4" state={d.conns.ga4.state} base={base} canManage={canManage} detail={d.conns.ga4.detail} /> : null}
        {d.ga4.hasData ? (
          <>
            <RevealGroup className="kpi-grid">
              {[
                <KpiTile key="o" label="Organic sessions" value={d.ga4.organic} format="compact" delta={d.ga4.organicDelta ?? undefined} />,
                <KpiTile key="k" label="Organic key events" value={d.ga4.organicKeyEvents} note={d.ga4.organic ? `${((d.ga4.organicKeyEvents / Math.max(1, d.ga4.organic)) * 100).toFixed(1)}% of organic sessions` : undefined} />,
                <KpiTile key="s" label="All sessions" value={d.ga4.sessions} format="compact" note="Every channel, 28 days" />,
                <KpiTile key="ks" label="All key events" value={d.ga4.keyEvents} note="Every channel, 28 days" />,
              ]}
            </RevealGroup>
            {d.ga4.daily.length > 1 ? (
              <AreaChart title="Organic sessions" summary={`${d.ga4.organic.toLocaleString("en-US")} sessions from Google Search in the last 28 days, by GA4.`} dates={d.ga4.daily.map((x) => day(x.day))} values={d.ga4.daily.map((x) => x.organic)} seriesLabel="organic sessions" height={200} />
            ) : null}
            <div className="split-2">
              <div className="tbl-frame" role="region" aria-label="Organic landing pages" tabIndex={0}>
                <table className="tbl tbl-tight">
                  <caption className="sr-only">Organic landing pages, last 28 days</caption>
                  <thead>
                    <tr>
                      <th scope="col">Landing page</th>
                      <th scope="col" className="n">
                        Sessions
                      </th>
                      <th scope="col" className="n">
                        Key events
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ga4.landing.map((l) => (
                      <tr key={l.page}>
                        <th scope="row">
                          <span className="q">{l.page}</span>
                        </th>
                        <td className="n">{l.sessions.toLocaleString("en-US")}</td>
                        <td className="n">{l.keyEvents.toLocaleString("en-US")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel pad">
                <p className="label">Organic key events</p>
                {d.ga4.events.length ? (
                  <ul className="ev-list">
                    {d.ga4.events.map((e) => (
                      <li key={e.name}>
                        <span className="mono">{e.name}</span>
                        <strong>{e.keyEvents.toLocaleString("en-US")}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No key events from organic search in the last 28 days.</p>
                )}
                <StatusLight state={d.ga4.health?.state === "ok" ? "ok" : d.ga4.health?.state === "warn" ? "warn" : "error"}>{d.ga4.health?.state === "ok" ? "Tag reporting" : "Check the tag before trusting these numbers"}</StatusLight>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
