"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ActionFeedback } from "@/components/forms/FormBits";
import { Icon, type IconName } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Fields";
import { Badge, StatusLight, type LightState } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import { chooseGooglePropertyAction, connectGoogleAction, disconnectGoogleAction, googlePropertiesAction, testGoogleAction } from "@/app/(app)/w/[slug]/google-actions";
import { idle, type ActionState } from "@/lib/actions-state";

export type GoogleCard = {
  property: string;
  propertyLabel: string;
  status: "untested" | "ok" | "warn" | "error";
  detail: string | null;
  lastTested: string | null;
  connectedBy: string;
  connectedAt: string;
};
type Kind = "search_console" | "ga4";

const META: Record<Kind, { title: string; icon: IconName; text: string; scope: string }> = {
  search_console: {
    title: "Google Search Console",
    icon: "search",
    text: "Clicks, impressions and position by page and query; striking-distance queries (positions 4 to 20); pages Google shows but nobody clicks.",
    scope: "webmasters.readonly",
  },
  ga4: {
    title: "Google Analytics 4",
    icon: "trend",
    text: "Organic landing pages and key events, plus measurement health: a broken tag reads exactly like zero traffic.",
    scope: "analytics.readonly",
  },
};
const LIGHT: Record<GoogleCard["status"], [LightState, string]> = {
  untested: ["idle", "Not tested yet"],
  ok: ["ok", "Working"],
  warn: ["warn", "Needs attention"],
  error: ["error", "Failing"],
};

function Card({ slug, siteId, kind, card, canEdit, configured, next }: { slug: string; siteId: string; kind: Kind; card: GoogleCard | null; canEdit: boolean; configured: boolean; next: "connections" | "onboarding" }) {
  const m = META[kind];
  const router = useRouter();
  const toast = useToast();
  const [connectState, setConnectState] = useState<ActionState>(idle);
  const [connecting, startConnect] = useTransition();
  const connect = () =>
    startConnect(async () => {
      const r = await connectGoogleAction(slug, siteId, kind, next);
      const url = r.ok && typeof r.data?.url === "string" ? r.data.url : null;
      // a plain browser navigation to Google's consent screen (never fetched by the router)
      if (url && /^https?:\/\//.test(url)) window.location.assign(url);
      else setConnectState(r);
    });
  const [busy, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [choosing, setChoosing] = useState(false);
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const [picked, setPicked] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const needsProperty = !!card && (!card.property || choosing);

  useEffect(() => {
    if (!needsProperty || !canEdit || options) return;
    let live = true;
    googlePropertiesAction(slug, siteId, kind).then((r) => {
      if (!live) return;
      if (r.ok) {
        setOptions(r.options);
        setPicked(r.suggested ?? card?.property ?? r.options[0]?.value ?? "");
      } else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [needsProperty, canEdit, options, slug, siteId, kind, card?.property]);

  const done = (r: { ok: boolean; message?: string; error?: string }) => {
    toast.push(r.ok ? { tone: "ok", title: r.message ?? "Done." } : { tone: "danger", title: r.error ?? "That did not work." });
    router.refresh();
  };
  const state = !configured ? "unconfigured" : !card ? "disconnected" : "connected";
  const [light, lightText] = card ? LIGHT[card.status] : (["idle", "Not connected"] as [LightState, string]);

  return (
    <section className="panel gconn" data-kind={kind} data-state={state} aria-labelledby={`g-${kind}`}>
      <div className="gconn-head">
        <span className="feat-ico" aria-hidden="true">
          <Icon name={m.icon} />
        </span>
        <div>
          <h3 id={`g-${kind}`}>{m.title}</h3>
          <p>{m.text}</p>
        </div>
      </div>
      <div className="gconn-body">
        {state === "unconfigured" ? (
          <>
            <StatusLight state="idle">Not configured on this server</StatusLight>
            <p className="gconn-detail">
              Lumoras staff add a Google OAuth client (<span className="mono">GOOGLE_OAUTH_CLIENT_ID</span> and <span className="mono">GOOGLE_OAUTH_CLIENT_SECRET</span>) before anyone can connect. Nothing to do here until then.
            </p>
            <div className="gconn-acts">
              <Button variant="secondary" size="sm" icon="google" disabled>
                Connect with Google
              </Button>
            </div>
          </>
        ) : state === "disconnected" ? (
          <>
            <StatusLight state="idle">Not connected</StatusLight>
            <p className="gconn-detail">Connect with the Google account that can see this site&apos;s {kind === "ga4" ? "GA4 property" : "Search Console property"}. Read-only: we can never change anything there, and the Indexing API is never used.</p>
            {canEdit ? (
              <div>
                <ActionFeedback state={connectState} />
                <div className="gconn-acts">
                  <Button variant="primary" size="sm" icon="google" loading={connecting} onClick={connect}>
                    Connect {kind === "ga4" ? "GA4" : "Search Console"}
                  </Button>
                  <span className="gconn-scope">scope: {m.scope}</span>
                </div>
              </div>
            ) : (
              <p className="muted small">Editors and owners connect it.</p>
            )}
          </>
        ) : (
          <>
            <StatusLight state={testing ? "live" : light}>{testing ? "Testing…" : lightText}</StatusLight>
            {card!.detail ? <p className="gconn-detail">{card!.detail}</p> : null}
            <p className="muted small">
              {card!.property ? (
                <>
                  Property <span className="mono">{card!.propertyLabel || card!.property}</span> ·{" "}
                </>
              ) : null}
              Connected by {card!.connectedBy || "a member"}
              {card!.lastTested ? ` · tested ${new Date(card!.lastTested).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
            </p>
            {canEdit && needsProperty ? (
              <div className="gconn-prop">
                {loadError ? (
                  <p className="form-alert" role="alert">
                    <Icon name="alert" />
                    {loadError}
                  </p>
                ) : !options ? (
                  <p className="muted small">Reading the properties this Google account can see…</p>
                ) : options.length ? (
                  <>
                    <SelectField label={kind === "ga4" ? "GA4 property" : "Search Console property"} value={picked} onChange={(e) => setPicked(e.target.value)} options={options} />
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy}
                      onClick={() =>
                        start(async () => {
                          const r = await chooseGooglePropertyAction(slug, siteId, kind, picked);
                          setChoosing(false);
                          setOptions(null);
                          done(r);
                        })
                      }
                    >
                      Use this property
                    </Button>
                  </>
                ) : (
                  <p className="gconn-detail">This Google account cannot see any {kind === "ga4" ? "GA4 property" : "verified Search Console property"}. Disconnect and connect with the account that can.</p>
                )}
              </div>
            ) : null}
            {canEdit ? (
              <div className="gconn-acts">
                {card!.property && !choosing ? (
                  <>
                    <Button size="sm" variant="secondary" icon="pulse" loading={testing} onClick={() => startTest(async () => done(await testGoogleAction(slug, siteId, kind)))}>
                      Test
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
                      Change property
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="ghost" icon="trash" disabled={busy || testing} onClick={() => start(async () => done(await disconnectGoogleAction(slug, siteId, kind)))}>
                  Disconnect
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/** Search Console and GA4, per site, with the client's own Google account. */
export function GoogleConnections({
  slug,
  siteId,
  cards,
  canEdit,
  configured,
  next = "connections",
  flash,
}: {
  slug: string;
  siteId: string;
  cards: Partial<Record<Kind, GoogleCard>>;
  canEdit: boolean;
  configured: boolean;
  next?: "connections" | "onboarding";
  flash?: { ok: boolean; text: string } | null;
}) {
  return (
    <div className="stack-lg">
      {flash ? (
        <p className={flash.ok ? "ro-note" : "form-alert"} role={flash.ok ? "status" : "alert"}>
          <Icon name={flash.ok ? "check" : "alert"} />
          {flash.text}
        </p>
      ) : null}
      <div className="gconns">
        {(["search_console", "ga4"] as const).map((k) => (
          <Card key={k} slug={slug} siteId={siteId} kind={k} card={cards[k] ?? null} canEdit={canEdit} configured={configured} next={next} />
        ))}
      </div>
      <p className="muted small">
        <Badge icon="lock">Refresh tokens encrypted · AES-256-GCM</Badge> Only read-only scopes are requested. Disconnecting revokes access at Google.
      </p>
    </div>
  );
}
