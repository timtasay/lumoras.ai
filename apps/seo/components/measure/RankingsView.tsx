"use client";

import { useMemo, useState } from "react";
import { RankChart } from "@/components/charts/RankChart";
import { Segmented } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Status";
import { alignSeries, byMovement, rankAxisMax, type KeywordTrend } from "@/lib/measure/movement";
import { MoveBadge, PosPill } from "./MoveBadge";

const NONE = "__none__";

export type TrendView = Omit<KeywordTrend, "checkedAt" | "history"> & { checkedAt: string; history: { at: string; position: number | null }[] };

const FEATURE_LABEL: Record<string, string> = {
  featured_snippet: "Featured snippet",
  people_also_ask: "People also ask",
  local_pack: "Local pack",
  video: "Video",
  images: "Images",
  top_stories: "Top stories",
  paid: "Ads",
};

/**
 * Rankings: position over time per keyword (inverted axis, #1 at the top),
 * filterable by cluster and by where the keyword came from (a published
 * article's target, or a saved keyword), with movement badges. Up to four
 * keywords are drawn at once; their colours are fixed by their place in the
 * chart's selection, so a keyword keeps its colour while the filters change.
 */
export function RankingsView({ trends, clusters }: { trends: TrendView[]; clusters: string[] }) {
  const all = useMemo(
    () => trends.map((t) => ({ ...t, checkedAt: new Date(t.checkedAt), history: t.history.map((h) => ({ at: new Date(h.at), position: h.position })) })) as KeywordTrend[],
    [trends],
  );
  const [cluster, setCluster] = useState<string>("");
  const [source, setSource] = useState<"all" | "published" | "saved">("all");
  const shown = useMemo(() => all.filter((t) => (!cluster || (cluster === NONE ? !t.cluster : t.cluster === cluster)) && (source === "all" || t.source === source)).sort(byMovement), [all, cluster, source]);
  const [picked, setPicked] = useState<string[]>(() => [...all].sort((a, b) => (a.source === b.source ? 0 : a.source === "published" ? -1 : 1) || byMovement(a, b)).slice(0, 4).map((t) => t.keyword));
  // what the chart draws: the picked keywords that pass the filters (or the first four that do)
  const drawn = useMemo(() => {
    const visible = picked.filter((k) => shown.some((t) => t.keyword === k));
    return visible.length ? visible : shown.slice(0, 4).map((t) => t.keyword);
  }, [picked, shown]);
  const series = alignSeries(all, drawn);
  const maxPos = rankAxisMax(series.series.flatMap((s) => s.positions));
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p.filter((x) => drawn.includes(x)), k].slice(-4)));

  return (
    <div className="rankings">
      <div className="rk-filters" role="group" aria-label="Filter keywords">
        <label className="fld rk-cluster">
          <span className="fld-label">Cluster</span>
          <select className="inp sel inp-sm" value={cluster} onChange={(e) => setCluster(e.target.value)} aria-label="Cluster">
            <option value="">All clusters</option>
            {clusters.filter(Boolean).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {clusters.includes("") ? <option value={NONE}>No cluster</option> : null}
          </select>
        </label>
        <Segmented
          label="Keyword source"
          size="sm"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: `All ${all.length}` },
            { value: "published", label: `Published ${all.filter((t) => t.source === "published").length}` },
            { value: "saved", label: `Saved ${all.filter((t) => t.source === "saved").length}` },
          ]}
        />
        <p className="muted small rk-count" aria-live="polite">
          {shown.length} keyword{shown.length === 1 ? "" : "s"} shown
        </p>
      </div>

      {series.dates.length ? (
        <RankChart
          key={drawn.join("|")}
          title="Position over time"
          summary={drawn.length ? `Google position by check for ${drawn.join(", ")} (#1 is best; a gap means not in the top results).` : "No keyword selected."}
          dates={series.dates}
          series={series.series}
          maxPos={maxPos}
        />
      ) : null}

      <div className="tbl-frame" role="region" aria-label="Tracked keywords" tabIndex={0}>
        <table className="tbl rk-tbl">
          <caption className="sr-only">Tracked keywords with their latest position and movement since the previous check</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">In the chart</span>
              </th>
              <th scope="col">Keyword</th>
              <th scope="col" className="n">
                Position
              </th>
              <th scope="col">Movement</th>
              <th scope="col" className="n hide-phone">
                Best
              </th>
              <th scope="col" className="hide-phone">
                Cluster
              </th>
              <th scope="col" className="hide-phone">
                SERP features
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const on = drawn.includes(t.keyword);
              return (
                <tr key={t.keyword} data-on={on ? "" : undefined}>
                  <td className="rk-pick">
                    <input type="checkbox" checked={on} onChange={() => toggle(t.keyword)} aria-label={`Show ${t.keyword} in the chart`} />
                  </td>
                  <th scope="row">
                    <span className="q">{t.keyword}</span> <Badge tone={t.source === "published" ? "ion" : "neutral"}>{t.source === "published" ? "Published" : "Saved"}</Badge>
                    {t.url ? <span className="pg">{(() => { try { return new URL(t.url).pathname; } catch { return t.url; } })()}</span> : null}
                  </th>
                  <td className="n">
                    <PosPill p={t.current} />
                  </td>
                  <td>
                    <MoveBadge m={t.movement} />
                  </td>
                  <td className="n hide-phone">{t.best === null ? "–" : `#${t.best}`}</td>
                  <td className="hide-phone">{t.cluster || <span className="muted">None</span>}</td>
                  <td className="hide-phone">
                    <span className="feats">
                      {t.serpFeatures.length ? t.serpFeatures.map((f) => <span key={f} className="serp-feat">{FEATURE_LABEL[f] ?? f.replace(/_/g, " ")}</span>) : <span className="muted">None</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length ? null : (
              <tr>
                <td colSpan={7} className="muted">
                  No keywords match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
