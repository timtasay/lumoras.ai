import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Badge } from "@/components/ui/Status";
import type { AuditRow } from "@/lib/data/workspaces";
import { dateTimeLabel } from "@/lib/ui/time";

const HIDE = new Set(["created_at", "updated_at", "workspace_id"]);

function changes(row: AuditRow): { key: string; before: unknown; after: unknown }[] {
  const b = row.before ?? {}, a = row.after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !HIDE.has(k));
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, before: row.before ? b[k] : undefined, after: row.after ? a[k] : undefined }));
}

const show = (v: unknown) => (v === undefined ? "" : v === null ? "null" : typeof v === "string" ? v : JSON.stringify(v));
const clip = (s: string) => (s.length > 160 ? s.slice(0, 159) + "…" : s);

const OP_TONE: Record<string, "ion" | "info" | "amber" | "danger" | "neutral"> = { insert: "ion", update: "info", delete: "danger" };

/** The audit trail: who, what, when, before and after; impersonated actions name both people. */
export function AuditList({ rows, showWorkspace = false, olderHref }: { rows: AuditRow[]; showWorkspace?: boolean; olderHref?: string | null }) {
  if (!rows.length) return <p className="muted">No entries yet.</p>;
  return (
    <>
      <ol className="audit">
        {rows.map((r) => {
          const op = r.before && r.after ? "update" : r.after ? "insert" : r.before ? "delete" : "event";
          const diff = changes(r);
          return (
            <li key={r.id} className="audit-row" data-impersonated={r.impersonator_id ? "" : undefined}>
              <div className="audit-when mono">{dateTimeLabel(new Date(r.at))}</div>
              <div className="audit-what">
                <p className="audit-line">
                  <Badge tone={r.action.startsWith("impersonation") ? "amber" : (OP_TONE[op] ?? "neutral")}>{r.action}</Badge>
                  <span className="audit-entity mono">
                    {r.entity_type}
                    {r.entity_id ? <span className="muted"> {r.entity_id.slice(0, 8)}</span> : null}
                  </span>
                  {showWorkspace && r.workspace_name ? <span className="audit-ws">{r.workspace_name}</span> : null}
                </p>
                <div className="audit-sub">
                <p className="audit-who">
                  {r.actor_email ?? (r.actor_id?.startsWith("system:") ? r.actor_id : r.actor_id ? "a deleted user" : "system")}
                  {r.impersonator_id ? (
                    <span className="audit-imp">
                      <Icon name="eye" /> impersonated by {r.impersonator_email ?? "a platform admin"}
                    </span>
                  ) : null}
                </p>
                {diff.length || r.details ? (
                  <details className="audit-diff">
                    <summary>{diff.length ? `${diff.length} field${diff.length === 1 ? "" : "s"}` : "details"}</summary>
                    {diff.length ? (
                      <table className="diff">
                        <thead>
                          <tr>
                            <th scope="col">Field</th>
                            <th scope="col">Before</th>
                            <th scope="col">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff.map((d) => (
                            <tr key={d.key}>
                              <th scope="row" className="mono">
                                {d.key}
                              </th>
                              <td className="diff-old">{clip(show(d.before))}</td>
                              <td className="diff-new">{clip(show(d.after))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    {r.details ? <pre className="mono small diff-details">{JSON.stringify(r.details, null, 2)}</pre> : null}
                  </details>
                ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {olderHref ? (
        <Link href={olderHref} className="btn btn-secondary btn-sm older">
          <span className="btn-label">Older entries</span>
        </Link>
      ) : null}
    </>
  );
}
