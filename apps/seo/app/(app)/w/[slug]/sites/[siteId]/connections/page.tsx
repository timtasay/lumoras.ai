import type { Metadata } from "next";
import { ConnectionsPanel } from "@/components/forms/ConnectionsPanel";
import { can } from "@/lib/auth/permissions";
import { listConnections } from "@/lib/data/connections";
import { loadSite } from "@/lib/site-page";
import { dateLabel } from "@/lib/ui/time";
import { createConnectionAction, deleteConnectionAction } from "../../../actions";

export const metadata: Metadata = { title: "Connections" };

export default async function ConnectionsPage({ params }: { params: Promise<{ slug: string; siteId: string }> }) {
  const { slug, siteId } = await params;
  const { site, a, conns } = await loadSite(slug, siteId, async (tx, s) => ({ conns: await listConnections(tx, s.id) }));
  return (
    <ConnectionsPanel
      // only the safe view crosses to the browser: no ciphertext, no secret
      connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, config: c.config, has_secret: c.has_secret, key_version: c.key_version, status: c.status, status_detail: c.status_detail, created: dateLabel(c.created_at) }))}
      canEdit={can(a.role, "connection:manage")}
      create={createConnectionAction.bind(null, slug, site.id)}
      remove={deleteConnectionAction.bind(null, slug, site.id)}
    />
  );
}
