"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icons";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";

type Row = { url: string; path: string; lastmod: string | null; seen: string };

/** The route inventory: filter by path, sortable, scrolls in its own frame on phones. */
export function RoutesTable({ rows, total }: { rows: Row[]; total: number }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => (q ? rows.filter((r) => r.path.toLowerCase().includes(q.toLowerCase())) : rows), [q, rows]);
  if (!rows.length) {
    return <EmptyState icon="radar" title="No routes yet" text="Scan the sitemap to build the inventory. Sites without a sitemap need one before their links can be checked." primary={<span className="muted small">Use “Scan the sitemap” above.</span>} />;
  }
  const cols: Column<Row>[] = [
    { key: "path", header: "Path", sortValue: (r) => r.path, render: (r) => <span className="mono route-path">{r.path}</span> },
    { key: "lastmod", header: "Last modified", sortValue: (r) => r.lastmod ?? "", render: (r) => r.lastmod ?? <span className="muted">—</span>, hideOnPhone: true },
    { key: "seen", header: "Last seen", sortValue: (r) => r.seen, render: (r) => r.seen, hideOnPhone: true },
  ];
  return (
    <div className="routes">
      <label className="routes-filter">
        <Icon name="search" />
        <span className="sr-only">Filter routes by path</span>
        <input className="inp inp-sm" type="search" placeholder="Filter by path" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <DataTable caption="Routes found in the sitemaps" columns={cols} rows={shown.slice(0, 300)} rowKey={(r) => r.url} initialSort={{ key: "path", dir: "asc" }} />
      <p className="muted small">
        Showing {Math.min(shown.length, 300).toLocaleString("en-US")} of {total.toLocaleString("en-US")} routes.
      </p>
    </div>
  );
}
