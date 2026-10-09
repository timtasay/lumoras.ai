import type { Metadata } from "next";
import { AuditList } from "@/components/audit/AuditList";
import { requirePlatformAdmin } from "@/lib/auth/app";
import { pool } from "@/lib/db/pool";
import { isUuid, withActor } from "@/lib/db/tenant";
import { platformAudit } from "@/lib/data/workspaces";

export const metadata: Metadata = { title: "Platform audit" };

export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ before?: string; workspace?: string }> }) {
  const v = await requirePlatformAdmin();
  const sp = await searchParams;
  const before = sp.before && /^\d{1,18}$/.test(sp.before) ? sp.before : null;
  const workspaceId = isUuid(sp.workspace) ? sp.workspace : null;
  const rows = await withActor(pool(), { actorId: v.user.id, requestId: v.requestId }, (tx) => platformAudit(tx, { workspaceId, before, limit: 50 }));
  const older = rows.length === 50 ? `/agency/audit?${new URLSearchParams({ ...(workspaceId ? { workspace: workspaceId } : {}), before: rows.at(-1)!.id })}` : null;
  return (
    <div className="page">
      <header className="pg-head">
        <div>
          <p className="eyebrow">
            <b>Lumoras staff</b> · platform audit
          </p>
          <h1>Platform audit log</h1>
          <p className="lede">
            Every workspace&apos;s trail plus platform events: staff reads across workspaces, impersonations and sign-ups. Reading this page is itself recorded (platform.audit.read).
          </p>
        </div>
      </header>
      <AuditList rows={rows} showWorkspace olderHref={older} />
    </div>
  );
}
