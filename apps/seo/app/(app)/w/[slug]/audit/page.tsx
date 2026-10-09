import type { Metadata } from "next";
import Link from "next/link";
import { AuditList } from "@/components/audit/AuditList";
import { readWorkspace } from "@/lib/actions";
import { listAudit } from "@/lib/data/workspaces";

export const metadata: Metadata = { title: "Audit log" };

const FILTERS: [string, string][] = [
  ["", "Everything"],
  ["sites", "Sites"],
  ["brand_profiles", "Brand profiles"],
  ["authors", "Authors"],
  ["connections", "Connections"],
  ["site_routes", "Routes"],
  ["auth_member", "Members"],
  ["auth_invitation", "Invitations"],
  ["auth_user", "Impersonation"],
];

export default async function AuditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; entity?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const before = sp.before && /^\d{1,18}$/.test(sp.before) ? sp.before : null;
  const entity = FILTERS.some(([k]) => k && k === sp.entity) ? sp.entity! : null;
  const { a, rows } = await readWorkspace(slug, async (tx, a) => ({ a, rows: await listAudit(tx, { before, limit: 50, entity }) }), "audit:read");
  const q = (b: string | null, e: string | null) => {
    const p = new URLSearchParams();
    if (b) p.set("before", b);
    if (e) p.set("entity", e);
    const s = p.toString();
    return `/w/${slug}/audit${s ? `?${s}` : ""}`;
  };
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>{a.workspace.name}</b> · audit log
          </p>
          <h1>Audit log</h1>
          <p className="lede">Every change in this workspace, written in the same database transaction as the change itself. Nobody can edit or delete it, including staff.</p>
        </div>
      </header>
      <nav className="chips" aria-label="Filter the audit log">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={q(null, k || null)} className="chip" aria-current={(entity ?? "") === k ? "true" : undefined}>
            <span className="chip-dot" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <AuditList rows={rows} olderHref={rows.length === 50 ? q(rows.at(-1)!.id, entity) : null} />
    </div>
  );
}
