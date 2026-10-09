"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, Chip } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { keywordBulkAction } from "@/app/(app)/w/[slug]/research-actions";
import { KdCell } from "./ResearchPanel";

export type KeywordItem = {
  id: string;
  keyword: string;
  volume: number | null;
  kd: number | null;
  cpcMicros: number | null;
  intent: string | null;
  cluster: string;
  status: "idea" | "targeted" | "published" | "ranking";
  fit: "offered" | "not_offered" | "unknown";
  metricsAt: string | null;
};

const STATUSES = ["idea", "targeted", "published", "ranking"] as const;
const STATUS_TONE = { idea: "neutral", targeted: "info", published: "ion", ranking: "ion" } as const;
type SortKey = "keyword" | "volume" | "kd" | "cpc";

/**
 * Saved keywords: filter by status, intent and cluster, search, sort, and
 * change many at once. Viewers see the same table without selection.
 */
export function KeywordsTable({ slug, siteId, rows, canEdit }: { slug: string; siteId: string; rows: KeywordItem[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const capId = useId();
  const [status, setStatus] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [cluster, setCluster] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "volume", dir: "desc" });
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("targeted");
  const [bulkCluster, setBulkCluster] = useState("");
  const [busy, start] = useTransition();

  const intents = useMemo(() => [...new Set(rows.map((r) => r.intent).filter(Boolean))] as string[], [rows]);
  const clusters = useMemo(() => [...new Set(rows.map((r) => r.cluster).filter(Boolean))].sort(), [rows]);
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])), [rows]);
  const shown = useMemo(() => {
    const val = (r: KeywordItem) => (sort.key === "keyword" ? r.keyword : sort.key === "volume" ? (r.volume ?? -1) : sort.key === "kd" ? (r.kd ?? -1) : (r.cpcMicros ?? -1));
    return rows
      .filter((r) => (!status || r.status === status) && (!intent || r.intent === intent) && (!cluster || r.cluster === cluster) && (!q || r.keyword.includes(q.toLowerCase().trim())))
      .sort((a, b) => {
        const x = val(a), y = val(b);
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.dir === "asc" ? c : -c;
      });
  }, [rows, status, intent, cluster, q, sort]);

  if (!rows.length) {
    return (
      <EmptyState
        icon="key"
        title="No saved keywords yet"
        text="Research a seed above, then save the targets worth writing about. Each one keeps its volume, difficulty, CPC and intent, and moves from idea to targeted to published to ranking."
        primary={<a href="#research" className="btn btn-primary btn-md"><span className="btn-label"><Icon name="search" /> Research a seed</span></a>}
      />
    );
  }

  const th = (key: SortKey, label: string, numeric = false, phone = true) => {
    const active = sort.key === key;
    return (
      <th scope="col" className={[numeric ? "n" : "", phone ? "" : "hide-phone"].join(" ").trim() || undefined} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="th-sort" data-active={active ? "" : undefined} onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }))}>
          {label}
          <Icon name={active ? (sort.dir === "asc" ? "up" : "down") : "sort"} />
        </button>
      </th>
    );
  };
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const bulk = (change: { status?: string; cluster?: string; remove?: boolean }) =>
    start(async () => {
      const res = await keywordBulkAction(slug, siteId, [...picked], change);
      toast.push(res.ok ? { tone: "ok", title: res.message ?? "Done." } : { tone: "danger", title: res.error ?? "Could not change them." });
      if (res.ok) {
        setPicked(new Set());
        router.refresh();
      }
    });

  return (
    <div>
      <div className="kt-toolbar">
        <div className="kt-filters">
          <div className="chips" role="group" aria-label="Filter by status">
            <Chip pressed={status === null} onToggle={() => setStatus(null)} count={rows.length}>
              All
            </Chip>
            {STATUSES.map((s) => (
              <Chip key={s} pressed={status === s} onToggle={() => setStatus(status === s ? null : s)} count={counts[s]}>
                {s[0].toUpperCase() + s.slice(1)}
              </Chip>
            ))}
          </div>
          {intents.length ? (
            <select className="inp sel inp-sm" aria-label="Filter by intent" value={intent} onChange={(e) => setIntent(e.target.value)}>
              <option value="">Any intent</option>
              {intents.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          ) : null}
          {clusters.length ? (
            <select className="inp sel inp-sm" aria-label="Filter by cluster" value={cluster} onChange={(e) => setCluster(e.target.value)}>
              <option value="">Any cluster</option>
              {clusters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <label className="kt-search">
          <Icon name="search" />
          <span className="sr-only">Search saved keywords</span>
          <input className="inp inp-sm" type="search" placeholder="Search keywords" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="tbl-frame" role="region" aria-labelledby={capId} tabIndex={0}>
        <table className="tbl kt">
          <caption className="sr-only" id={capId}>
            Saved keywords, {shown.length} shown
          </caption>
          <thead>
            <tr>
              {canEdit ? (
                <th scope="col" className="sel">
                  <input type="checkbox" aria-label="Select every keyword shown" checked={allShownPicked} onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} />
                </th>
              ) : null}
              {th("keyword", "Keyword")}
              {th("volume", "Volume", true)}
              {th("kd", "KD", true)}
              {th("cpc", "CPC", true, false)}
              <th scope="col" className="hide-phone">
                Intent
              </th>
              <th scope="col" className="hide-phone">
                Cluster
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} aria-selected={picked.has(r.id) ? true : undefined}>
                {canEdit ? (
                  <td className="sel">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.keyword}`}
                      checked={picked.has(r.id)}
                      onChange={() => setPicked((p) => (p.has(r.id) ? new Set([...p].filter((x) => x !== r.id)) : new Set([...p, r.id])))}
                    />
                  </td>
                ) : null}
                <th scope="row" className="kw">
                  {r.keyword}
                  {r.fit === "not_offered" ? <span className="why">Matches “does not sell” in the brand profile</span> : null}
                </th>
                <td className="n">{r.volume?.toLocaleString("en-US") ?? "—"}</td>
                <td className="n">
                  <KdCell kd={r.kd} />
                </td>
                <td className="n hide-phone">{r.cpcMicros === null ? "—" : `$${(r.cpcMicros / 1e6).toFixed(2)}`}</td>
                <td className="hide-phone">{r.intent ?? <span className="muted">—</span>}</td>
                <td className="hide-phone">{r.cluster || <span className="muted">—</span>}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 ? <p className="muted small" style={{ marginTop: 10 }}>No keywords match these filters.</p> : null}
      {canEdit && picked.size ? (
        <div className="bulkbar" role="region" aria-label="Change the selected keywords">
          <span className="bulkbar-n">{picked.size} selected</span>
          <select className="inp sel inp-sm" aria-label="New status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => bulk({ status: bulkStatus })}>
            Set status
          </Button>
          <input className="inp inp-sm" aria-label="Cluster name" placeholder="Cluster" maxLength={80} value={bulkCluster} onChange={(e) => setBulkCluster(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => bulk({ cluster: bulkCluster })}>
            Set cluster
          </Button>
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => bulk({ remove: true })}>
            Remove
          </Button>
        </div>
      ) : null}
    </div>
  );
}
