import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { BarChart } from "@/components/charts/BarChart";
import { HBarChart } from "@/components/charts/HBarChart";
import { NewLostChart } from "@/components/charts/NewLostChart";
import { RunNow } from "@/components/measure/RunNow";
import { can } from "@/lib/auth/permissions";
import { getSiteSettings } from "@/lib/data/sites";
import { CADENCE_LABEL } from "@/lib/measure/cadence";
import { backlinkHistory } from "@/lib/measure/dashboard";
import { recentRuns } from "@/lib/measure/runs";
import { providerInfo } from "@/lib/providers/registry";
import { relativeTime } from "@/lib/ui/time";
import { loadSite } from "@/lib/site-page";

export const metadata: Metadata = { title: "Backlinks" };

/** "Q4 2026": snapshots are quarterly by default (and never two in one quarter on the default cadence). */
const qLabel = (d: Date) => `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;

export default async function BacklinksPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const now = new Date();
  const { site, a, settings, rows, runs, competitors } = await loadSite(slug, siteId, async (tx, s) => ({
    settings: await getSiteSettings(tx, s.id),
    rows: await backlinkHistory(tx, s.id),
    runs: await recentRuns(tx, s.id, "backlinks", 3),
    competitors: (await tx.maybe<{ competitors: string[] }>("SELECT competitors FROM brand_profiles WHERE site_id = $1", [s.id]))?.competitors ?? [],
  }));
  const info = providerInfo();
  const canRun = can(a.role, "measure:run");
  const own = rows.filter((r) => !r.is_competitor);
  const latest = own[own.length - 1];
  const prev = own.length > 1 ? own[own.length - 2] : null;
  const latestRun = latest ? rows.filter((r) => r.captured_at.getTime() === latest.captured_at.getTime()) : [];
  const last = runs[0];
  const base = `/w/${slug}/sites/${site.id}`;
  const pct = (cur: number | null, p: number | null) => (cur !== null && p ? Math.round(((cur - p) / p) * 1000) / 10 : undefined);

  return (
    <div className="stack-lg">
      <div className="mhead">
        <div>
          <h2 className="sub-h">Backlinks</h2>
          <p className="muted small">
            The site and its competitors · {CADENCE_LABEL[settings.backlinks_cadence].toLowerCase()}
            {latest ? ` · last snapshot ${relativeTime(latest.captured_at, now)}` : ""} · monitoring only (link prospecting and outreach drafts arrive in Phase 5)
          </p>
        </div>
        {canRun && info.name !== "none" && latest ? <RunNow slug={slug} siteId={site.id} kind="backlinks" label="Snapshot now" note="Priced first; repeats within 30 days come from the cache, free." /> : null}
      </div>
      {last && (last.status === "refused" || last.status === "failed") ? (
        <div className="banner" role="status">
          <Icon name="alert" />
          <p>
            <strong>The last snapshot was {last.status}.</strong> {last.detail}
          </p>
        </div>
      ) : null}

      {latest ? (
        <>
          <RevealGroup className="kpi-grid">
            {[
              <KpiTile key="rd" label="Referring domains" value={latest.referring_domains ?? 0} delta={pct(latest.referring_domains, prev?.referring_domains ?? null)} deltaLabel="vs the previous snapshot" note={prev ? undefined : "Baseline"} />,
              <KpiTile key="bl" label="Backlinks" value={latest.backlinks ?? 0} format="compact" delta={pct(latest.backlinks, prev?.backlinks ?? null)} deltaLabel="vs the previous snapshot" note={prev ? undefined : "Baseline"} />,
              <KpiTile key="n" label="New referring domains" value={latest.new_referring_domains ?? 0} note={latest.new_referring_domains === null ? "Counted from the next snapshot" : `Lost: ${latest.lost_referring_domains ?? 0}`} />,
              <KpiTile key="b" label="Broken backlinks" value={latest.broken_backlinks ?? 0} tone={(latest.broken_backlinks ?? 0) > 10 ? "amber" : undefined} note="Links to pages that fail" />,
            ]}
          </RevealGroup>
          <div className="bl-grid">
            <BarChart title="Referring domains over time" summary={`${own.length} snapshot${own.length === 1 ? "" : "s"} of ${site.domain}.`} bars={own.map((r) => ({ label: qLabel(r.captured_at), value: r.referring_domains ?? 0 }))} seriesLabel="referring domains" categoryLabel="Snapshot" />
            <NewLostChart title="New and lost referring domains" summary="Against the previous snapshot of the same profile." periods={own.map((r) => ({ label: qLabel(r.captured_at), added: r.new_referring_domains, lost: r.lost_referring_domains }))} unit="referring domains" />
          </div>
          {latestRun.length > 1 ? (
            <HBarChart
              title="Against the competitors"
              summary={`Referring domains at the latest snapshot: ${site.domain} and ${latestRun.length - 1} competitor${latestRun.length === 2 ? "" : "s"} from the brand profile.`}
              rows={[...latestRun].sort((x, y) => (y.referring_domains ?? 0) - (x.referring_domains ?? 0)).map((r) => ({ label: r.domain, value: r.referring_domains, highlight: !r.is_competitor, note: r.is_competitor ? undefined : "this site" }))}
              unit="referring domains"
            />
          ) : (
            <p className="muted small">
              Add competitors to the brand profile to compare against them.{" "}
              <Link className="tlink" href={`${base}/brand`}>
                Brand profile
              </Link>
            </p>
          )}
          <div className="tbl-frame" role="region" aria-label="Backlink snapshots" tabIndex={0}>
            <table className="tbl">
              <caption className="sr-only">Every backlinks snapshot, the site and its competitors</caption>
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">Snapshot</th>
                  <th scope="col" className="n">
                    Referring domains
                  </th>
                  <th scope="col" className="n">
                    Backlinks
                  </th>
                  <th scope="col" className="n">
                    New / lost
                  </th>
                  <th scope="col" className="n">
                    Rank
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={`${r.domain}|${r.captured_at.toISOString()}`}>
                    <th scope="row">
                      {r.domain} {r.is_competitor ? <span className="muted small">competitor</span> : null}
                    </th>
                    <td>{qLabel(r.captured_at)}</td>
                    <td className="n">{r.referring_domains?.toLocaleString("en-US") ?? "–"}</td>
                    <td className="n">{r.backlinks?.toLocaleString("en-US") ?? "–"}</td>
                    <td className="n">{r.new_referring_domains === null ? "–" : `+${r.new_referring_domains} / −${r.lost_referring_domains ?? 0}`}</td>
                    <td className="n">{r.domain_rank ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState
          icon="link"
          title={info.name === "none" ? "Backlinks are not configured yet" : "No backlinks baseline yet"}
          text={info.name === "none" ? "The baseline is taken through the SEO data provider as soon as Lumoras staff switch it on: the site and its competitors, then every quarter." : `A baseline of ${site.domain}${competitors.length ? ` and ${Math.min(5, competitors.length)} competitor${competitors.length === 1 ? "" : "s"}` : ""}: referring domains, backlinks and broken links, then quarterly, with new and lost domains counted each time.`}
          primary={
            canRun && info.name !== "none" ? (
              <RunNow slug={slug} siteId={site.id} kind="backlinks" label="Take the baseline" variant="primary" note="Priced first, within the budget." />
            ) : (
              <Link href={`${base}/brand`} className={buttonClass("primary")}>
                <Icon name="sparkle" /> Add competitors to compare
              </Link>
            )
          }
        />
      )}
    </div>
  );
}
