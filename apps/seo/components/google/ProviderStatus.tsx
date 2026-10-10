import { Icon } from "@/components/Icons";
import { Badge, StatusLight } from "@/components/ui/Status";
import type { ProviderInfo } from "@/lib/providers/registry";
import { formatMicros } from "@/lib/research/money";

/** For Lumoras staff: which SEO data provider answers, its account balance and, for hosted OpenSEO, the terms that bound its use. Never a credential. */
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
        {info.name === "openseo" ? (
          <div>
            <dt>Project</dt>
            <dd className="small">{info.defaultProject ? <span className="mono">{info.defaultProject}</span> : "Per site (site settings), else one per domain"}</dd>
          </div>
        ) : null}
        <div>
          <dt>Account balance</dt>
          <dd>
            {balance === null ? (
              <span className="muted">{note ?? "The provider does not report one"}</span>
            ) : (
              <>
                {formatMicros(balance)}
                {note ? <span className="muted small prov-note"> · {note}</span> : null}
              </>
            )}
          </dd>
        </div>
      </dl>
      {info.termsNote ? (
        <div className="banner prov-terms" role="note">
          <Icon name="alert" />
          <p>
            <strong>Terms.</strong> {info.termsNote}
          </p>
        </div>
      ) : null}
      <p className="muted small">
        Chosen with SEO_PROVIDER{info.name === "openseo" ? " and OPENSEO_MODE" : ""} (owner decision #3, docs/provider-decision.md). Credentials stay on the server.
      </p>
    </section>
  );
}
