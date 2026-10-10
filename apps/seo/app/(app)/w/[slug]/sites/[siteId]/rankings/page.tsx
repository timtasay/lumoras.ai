import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/Kpi";
import { RevealGroup } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Status";
import { RankingsView } from "@/components/measure/RankingsView";
import { RunNow } from "@/components/measure/RunNow";
import { can } from "@/lib/auth/permissions";
import { getSiteSettings } from "@/lib/data/sites";
import { CADENCE_LABEL, nextDueAt } from "@/lib/measure/cadence";
import { rankTrends } from "@/lib/measure/dashboard";
import { movementSummary } from "@/lib/measure/movement";
import { trackedKeywords } from "@/lib/measure/rank";
import { recentRuns } from "@/lib/measure/runs";
import { dataForSeoPrice } from "@/lib/providers/operations";
import { providerInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";
import { marketFor } from "@/lib/research/market";
import { relativeTime } from "@/lib/ui/time";
import { loadSite } from "@/lib/site-page";

export const metadata: Metadata = { title: "Rankings" };

export default async function RankingsPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const now = new Date();
  const { site, a, settings, trends, runs, tracked } = await loadSite(slug, siteId, async (tx, s) => {
    const settings = await getSiteSettings(tx, s.id);
    return { settings, trends: await rankTrends(tx, s.id), runs: await recentRuns(tx, s.id, "rank", 8), tracked: await trackedKeywords(tx, s.id, settings.rank_max_keywords) };
  });
  const base = `/w/${slug}/sites/${site.id}`;
  const info = providerInfo();
  const sum = movementSummary(trends);
  const last = runs[0];
  const next = info.name !== "none" ? nextDueAt(settings.rank_cadence, now, settings.timezone, runs) : null;
  const market = marketFor(settings);
  // the list price of the next check (the worker prices it again with the provider before running it)
  const price = tracked.length ? dataForSeoPrice({ op: "rankTracker.run", params: { trackerId: "-", domain: site.domain, market, keywords: tracked.map((t) => t.keyword), depth: settings.rank_depth } }) : null;
  const clusters = [...new Set(trends.map((t) => t.cluster))].sort();
  const canRun = can(a.role, "measure:run");

  return (
    <div className="stack-lg">
      <div className="mhead">
        <div>
          <h2 className="sub-h">Rankings</h2>
          <p className="muted small">
            {tracked.length} keyword{tracked.length === 1 ? "" : "s"} tracked ({tracked.filter((t) => t.source === "published").length} from published articles) · {market.label} · {settings.rank_device} · top {settings.rank_depth} · {CADENCE_LABEL[settings.rank_cadence].toLowerCase()}
            {last ? ` · last check ${relativeTime(last.finished_at ?? last.started_at, now)}` : ""}
            {next ? ` · next ${new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: settings.timezone }).format(next)}` : ""}
          </p>
        </div>
        {canRun && info.name !== "none" && tracked.length ? <RunNow slug={slug} siteId={site.id} kind="rank" label="Check now" note={price ? `About ${formatMicros(price.micros)} (list price), priced again before it runs.` : undefined} /> : null}
      </div>

      {last && (last.status === "refused" || last.status === "failed") ? (
        <div className="banner" role="status">
          <Icon name="alert" />
          <p>
            <strong>The last rank check was {last.status}.</strong> {last.detail}
          </p>
          {last.status === "refused" ? (
            <Link href={`/w/${slug}/settings/budget`} className={buttonClass("secondary", "sm")}>
              Budget and usage
            </Link>
          ) : null}
        </div>
      ) : null}

      {trends.length ? (
        <>
          <RevealGroup className="kpi-grid">
            {[
              <KpiTile key="t" label="Ranking" value={sum.ranking} note={`of ${sum.tracked} tracked keywords`} />,
              <KpiTile key="10" label="On page one" value={sum.top10} note="Positions 1 to 10" />,
              <KpiTile key="u" label="Moved up" value={sum.up + sum.entered} note={sum.entered ? `${sum.entered} entered the top ${settings.rank_depth}` : "Since the previous check"} />,
              <KpiTile key="d" label="Moved down" value={sum.down + sum.lost} tone={sum.down + sum.lost > sum.up + sum.entered ? "amber" : undefined} note={sum.lost ? `${sum.lost} dropped out` : "Since the previous check"} />,
            ]}
          </RevealGroup>
          <RankingsView trends={trends.map((t) => ({ ...t, checkedAt: t.checkedAt.toISOString(), history: t.history.map((h) => ({ at: h.at.toISOString(), position: h.position })) }))} clusters={clusters} />
        </>
      ) : info.name === "none" ? (
        <EmptyState
          icon="trend"
          title="Rank tracking is not configured yet"
          text="Positions come from the SEO data provider, which Lumoras staff switch on. Every published article's keyword is already queued, so tracking starts the day it is configured."
          primary={
            <Link href={`${base}/keywords`} className={buttonClass("primary")}>
              <Icon name="key" /> Choose keywords to track
            </Link>
          }
        />
      ) : (
        <EmptyState
          icon="trend"
          title={tracked.length ? "No rank check yet" : "Nothing to track yet"}
          text={tracked.length ? `${tracked.length} keywords are ready. The first check runs at the next hourly tick, priced first and within the budget.` : "Published articles' target keywords are tracked automatically. Mark saved keywords as targeted to track them before then."}
          primary={
            tracked.length && canRun ? (
              <RunNow slug={slug} siteId={site.id} kind="rank" label="Run the first check" variant="primary" icon="play" />
            ) : (
              <Link href={`${base}/keywords`} className={buttonClass("primary")}>
                <Icon name="key" /> Choose keywords to track
              </Link>
            )
          }
          secondary={last?.status === "skipped" ? <Badge>{last.detail ?? "Skipped"}</Badge> : undefined}
        />
      )}
    </div>
  );
}
