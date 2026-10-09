"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Status";
import { formatMicros } from "@/lib/research/money";

export type LogItem = {
  id: string;
  at: string;
  operation: string;
  label: string;
  subject: string;
  status: "ok" | "cached" | "refused" | "error";
  estimateMicros: number;
  costMicros: number;
  results: number;
  detail: string | null;
  actor: string;
  provider: string;
};

const STATUS: Record<LogItem["status"], [string, "ion" | "info" | "amber" | "danger"]> = {
  ok: ["Bought", "ion"],
  cached: ["Cache hit", "info"],
  refused: ["Refused", "amber"],
  error: ["Failed", "danger"],
};

/** Every lookup for this site: what was asked, what it cost, cache hits and refusals (rule 4). */
export function ResearchLogTable({ rows }: { rows: LogItem[] }) {
  if (!rows.length) {
    return <EmptyState icon="history" title="Nothing researched yet" text="Every seed, keyword and SERP fetched for this site is recorded here with its cost and date, so nothing is ever bought twice." primary={<a href="#research" className="btn btn-primary btn-md"><span className="btn-label">Research a seed</span></a>} />;
  }
  const spent = rows.filter((r) => r.status === "ok" || r.status === "error").reduce((s, r) => s + r.costMicros, 0);
  const hits = rows.filter((r) => r.status === "cached").length;
  const cols: Column<LogItem>[] = [
    { key: "at", header: "When", sortValue: (r) => r.at, render: (r) => <span className="mono small">{new Date(r.at).toISOString().slice(0, 16).replace("T", " ")}</span> },
    { key: "op", header: "Lookup", sortValue: (r) => r.label, render: (r) => r.label },
    { key: "subject", header: "Seed, keyword or domain", sortValue: (r) => r.subject, render: (r) => <span className="kw">{r.subject}</span> },
    { key: "status", header: "Result", sortValue: (r) => r.status, render: (r) => <span title={r.detail ?? undefined}><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></span> },
    { key: "cost", header: "Cost", numeric: true, sortValue: (r) => r.costMicros, render: (r) => (r.status === "cached" ? <span className="muted">free</span> : r.status === "refused" ? <span className="muted">—</span> : formatMicros(r.costMicros)) },
    { key: "n", header: "Rows", numeric: true, sortValue: (r) => r.results, render: (r) => r.results.toLocaleString("en-US"), hideOnPhone: true },
    { key: "who", header: "By", sortValue: (r) => r.actor, render: (r) => <span className="muted small">{r.actor}</span>, hideOnPhone: true },
  ];
  return (
    <div className="stack-lg">
      <p className="muted small">
        {rows.length} lookup{rows.length === 1 ? "" : "s"} · {formatMicros(spent)} spent · {hits} cache hit{hits === 1 ? "" : "s"} (free)
      </p>
      <DataTable caption="Research log for this site" columns={cols} rows={rows} rowKey={(r) => r.id} initialSort={{ key: "at", dir: "desc" }} />
    </div>
  );
}
