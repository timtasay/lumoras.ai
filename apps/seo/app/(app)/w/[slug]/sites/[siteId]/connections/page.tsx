import type { Metadata } from "next";
import { ConnectionsPanel } from "@/components/forms/ConnectionsPanel";
import { GoogleConnections } from "@/components/google/GoogleConnections";
import { ProviderStatus } from "@/components/google/ProviderStatus";
import { can } from "@/lib/auth/permissions";
import { listConnections } from "@/lib/data/connections";
import { googleConfigured } from "@/lib/google/app";
import { CONNECT_RESULT_TEXT } from "@/lib/google/oauth";
import { listGoogleConnections } from "@/lib/google/service";
import { provider, providerInfo } from "@/lib/providers/registry";
import { loadSite } from "@/lib/site-page";
import { dateLabel } from "@/lib/ui/time";
import { createConnectionAction, deleteConnectionAction } from "../../../actions";
import { googleCards } from "@/lib/google/view";

export const metadata: Metadata = { title: "Connections" };

export default async function ConnectionsPage({ params, searchParams }: { params: Promise<{ slug: string; siteId: string }>; searchParams: Promise<{ google?: string; reason?: string; kind?: string }> }) {
  const { slug, siteId } = await params;
  const sp = await searchParams;
  const { site, a, conns, google } = await loadSite(slug, siteId, async (tx, s) => ({ conns: await listConnections(tx, s.id), google: await listGoogleConnections(tx, s.id) }));
  const flash = sp.google === "connected" ? { ok: true, text: `${sp.kind === "ga4" ? "Google Analytics 4" : "Search Console"} is connected.` } : sp.google === "error" ? { ok: false, text: CONNECT_RESULT_TEXT[sp.reason ?? ""] ?? CONNECT_RESULT_TEXT.failed } : null;
  let balance: number | null = null, note: string | null = null;
  if (a.viewer.isPlatformAdmin) {
    const p = provider();
    if (p) {
      const b = await p.balance().catch((e: unknown) => ({ micros: null, note: `Balance unavailable: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` }));
      balance = b.micros;
      note = b.note ?? null;
    }
  }
  return (
    <div className="stack-lg">
      <section aria-labelledby="g-h">
        <div className="sec-head">
          <h2 id="g-h">Search Console and Analytics</h2>
          <p className="muted small">Free, first-party data from Google, read with the client&apos;s own account.</p>
        </div>
        <GoogleConnections slug={slug} siteId={site.id} cards={googleCards(google)} canEdit={can(a.role, "connection:manage")} configured={googleConfigured()} flash={flash} />
      </section>
      <section aria-labelledby="pub-h">
        <div className="sec-head">
          <h2 id="pub-h">Publishing and other connections</h2>
        </div>
        <ConnectionsPanel
          // only the safe view crosses to the browser: no ciphertext, no secret
          connections={conns.map((c) => ({ id: c.id, kind: c.kind, label: c.label, config: c.config, has_secret: c.has_secret, key_version: c.key_version, status: c.status, status_detail: c.status_detail, created: dateLabel(c.created_at) }))}
          canEdit={can(a.role, "connection:manage")}
          create={createConnectionAction.bind(null, slug, site.id)}
          remove={deleteConnectionAction.bind(null, slug, site.id)}
        />
      </section>
      {a.viewer.isPlatformAdmin ? <ProviderStatus info={providerInfo()} balance={balance} note={note} /> : null}
    </div>
  );
}
