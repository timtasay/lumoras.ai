import { Badge, StatusLight } from "@/components/ui/Status";
import type { ProviderInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";

/** For Lumoras staff: which SEO data provider answers, and its account balance. Never a credential. */
export function ProviderStatus({ info, balance, note }: { info: ProviderInfo; balance: number | null; note: string | null }) {
  return (
    <section className="panel provider-status" aria-labelledby="prov-h">
      <div className="sec-head">
        <h2 id="prov-h">SEO data provider</h2>
        <Badge tone="info" icon="shield">
          Lumoras staff only
        </Badge>
      </div>
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>
            <StatusLight state={info.name === "none" ? "warn" : "ok"}>{info.label}</StatusLight>
          </dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd className="mono small">{info.endpoint ?? (info.name === "fake" ? "fixtures (no network)" : "—")}</dd>
        </div>
        <div>
          <dt>Account balance</dt>
          <dd>{balance === null ? <span className="muted">{note ?? "The provider does not report one"}</span> : formatMicros(balance)}</dd>
        </div>
      </dl>
      <p className="muted small">Chosen with SEO_PROVIDER (owner decision #3, docs/provider-decision.md). Credentials stay on the server.</p>
    </section>
  );
}
