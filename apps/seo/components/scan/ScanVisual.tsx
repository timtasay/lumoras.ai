"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/ui/Button";
import { StatusLight } from "@/components/ui/Status";
import { useCountUp } from "@/lib/ui/motion";

type Ev =
  | { type: "start"; domain: string }
  | { type: "robots"; found: boolean; sitemaps: number }
  | { type: "sitemap"; url: string; kind: string; entries: number }
  | { type: "problem"; url: string; message: string }
  | { type: "routes"; total: number }
  | { type: "page"; url: string; title: string | null }
  | { type: "done"; status: string; sitemaps: number; routes: number; problems: number }
  | { type: "stored"; status: "ok" | "partial" | "failed"; routes: number; added: number; sitemaps: number; pages: number; problems: { url: string; message: string }[] }
  | { type: "error"; message: string };

export type ScanResult = Extract<Ev, { type: "stored" }>;
type Line = { id: number; tone: "info" | "ok" | "warn"; text: string };
type Blip = { id: string; x: number; y: number; key: boolean };

const short = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname === "/" ? x.host : x.pathname;
  } catch {
    return u;
  }
};

/** Stable pseudo-random point on the radar for a URL: angle from a hash, ring from its depth. */
function blip(u: string, key: boolean): Blip {
  let h = 2166136261;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u.charCodeAt(i), 16777619);
  let depth = 1;
  try {
    depth = new URL(u).pathname.split("/").filter(Boolean).length;
  } catch {}
  const a = ((h >>> 0) % 3600) / 10;
  const r = 14 + Math.min(depth, 3) * 11 + (((h >>> 12) % 70) / 10);
  return { id: u, x: 50 + r * Math.cos((a * Math.PI) / 180), y: 50 + r * Math.sin((a * Math.PI) / 180), key };
}

/**
 * The onboarding scan: streams the crawl (POST …/crawl, NDJSON) and shows it
 * as a radar sweep, a live tally and a log. The sweep turns only while the
 * crawl is live; reduced motion gets a still radar and plain counters.
 */
export function ScanVisual({
  slug,
  siteId,
  domain,
  autoStart = false,
  canRun = true,
  onFinished,
}: {
  slug: string;
  siteId: string;
  domain: string;
  autoStart?: boolean;
  canRun?: boolean;
  onFinished?: (r: ScanResult) => void;
}) {
  const [state, setState] = useState<"idle" | "running" | "ok" | "partial" | "failed">("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [routes, setRoutes] = useState(0);
  const [sitemaps, setSitemaps] = useState(0);
  const [pages, setPages] = useState(0);
  const [blips, setBlips] = useState<Blip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const n = useRef(0);
  const shownRoutes = useCountUp(routes, 500, routes);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);

  const log = (tone: Line["tone"], text: string) => setLines((ls) => [...ls.slice(-7), { id: ++n.current, tone, text }]);

  const run = useCallback(async () => {
    setState("running");
    setError(null);
    setLines([]);
    setBlips([]);
    setRoutes(0);
    setSitemaps(0);
    setPages(0);
    let res: Response;
    try {
      res = await fetch(`/api/w/${slug}/sites/${siteId}/crawl`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      setState("failed");
      setError("Could not reach the server.");
      return;
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setState("failed");
      setError(body.error ?? `The crawl could not start (HTTP ${res.status}).`);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!raw.trim()) continue;
        const e = JSON.parse(raw) as Ev;
        switch (e.type) {
          case "start":
            log("info", `Scanning ${e.domain}`);
            break;
          case "robots":
            log(e.found ? "ok" : "info", e.found ? `robots.txt lists ${e.sitemaps} sitemap${e.sitemaps === 1 ? "" : "s"}` : "No robots.txt sitemap line: trying /sitemap.xml");
            break;
          case "sitemap":
            setSitemaps((s) => s + 1);
            log("ok", e.kind === "index" ? `${short(e.url)}: index of ${e.entries} sitemaps` : `${short(e.url)}: ${e.entries.toLocaleString("en-US")} URLs`);
            break;
          case "routes":
            setRoutes(e.total);
            break;
          case "page":
            setPages((p) => p + 1);
            setBlips((b) => [...b.slice(-30), blip(e.url, true)]);
            log("info", `Read ${short(e.url)}${e.title ? `: ${e.title}` : ""}`);
            break;
          case "problem":
            log("warn", `${short(e.url)}: ${e.message}`);
            break;
          case "stored":
            setRoutes(e.routes);
            setState(e.status);
            finished.current?.(e);
            break;
          case "error":
            setState("failed");
            setError(e.message);
            break;
        }
      }
    }
  }, [slug, siteId]);

  // one blip per discovered route (up to 60), at stable positions; key pages are added as they are read
  const routeBlips = useMemo(() => Array.from({ length: Math.min(60, routes) }, (_, k) => blip(`https://${domain}/r/${k}/${k % 7}`, false)), [routes, domain]);
  const allBlips = useMemo(() => [...routeBlips, ...blips], [routeBlips, blips]);

  useEffect(() => {
    if (autoStart && canRun && !started.current) {
      started.current = true;
      // start after the first paint so the radar is visible when the stream begins
      const id = requestAnimationFrame(() => void run());
      return () => cancelAnimationFrame(id);
    }
  }, [autoStart, canRun, run]);

  const light = state === "running" ? "live" : state === "ok" ? "ok" : state === "partial" ? "warn" : state === "failed" ? "error" : "idle";
  const lightText =
    state === "running" ? "Scanning" : state === "ok" ? "Scan complete" : state === "partial" ? "Scan complete, with problems" : state === "failed" ? "Scan failed" : "Not scanned yet";

  return (
    <div className="scan" data-state={state}>
      <div className="scan-radar" aria-hidden="true">
        <svg viewBox="0 0 100 100" className="scan-svg">
          <circle cx="50" cy="50" r="47" className="scan-ring" />
          <circle cx="50" cy="50" r="36" className="scan-ring" />
          <circle cx="50" cy="50" r="25" className="scan-ring" />
          <circle cx="50" cy="50" r="14" className="scan-ring" />
          <path d="M50 3v94M3 50h94" className="scan-axis" />
          {allBlips.map((b, i) => (
            <circle key={b.id} cx={b.x} cy={b.y} r={b.key ? 1.9 : 1.1} className={b.key ? "scan-blip key" : "scan-blip"} style={{ "--i": i % 12 } as CSSProperties} />
          ))}
        </svg>
        <span className="scan-sweep" />
        <span className="scan-core">
          <Icon name="globe" />
        </span>
      </div>
      <div className="scan-side">
        <div className="scan-head">
          <StatusLight state={light}>{lightText}</StatusLight>
          <p className="scan-domain mono">{domain}</p>
        </div>
        <dl className="scan-tally">
          <div>
            <dt className="label">Sitemaps</dt>
            <dd>{sitemaps}</dd>
          </div>
          <div>
            <dt className="label">Routes</dt>
            <dd>
              <span aria-hidden="true">{Math.round(shownRoutes).toLocaleString("en-US")}</span>
              <span className="sr-only">{routes}</span>
            </dd>
          </div>
          <div>
            <dt className="label">Key pages read</dt>
            <dd>{pages}</dd>
          </div>
        </dl>
        <ol className="scan-log mono" aria-live="polite" aria-label="Scan progress">
          {lines.length ? (
            lines.map((l) => (
              <li key={l.id} data-tone={l.tone}>
                {l.text}
              </li>
            ))
          ) : (
            <li data-tone="info">{canRun ? "Ready. The scan reads robots.txt, the sitemaps and a few key pages." : "Only editors and owners can run a scan."}</li>
          )}
        </ol>
        {error ? (
          <p className="form-alert" role="alert">
            {error}
          </p>
        ) : null}
        {canRun && state !== "running" ? (
          <Button variant={state === "idle" ? "primary" : "secondary"} size="sm" icon={state === "idle" ? "radar" : "refresh"} onClick={() => void run()}>
            {state === "idle" ? "Scan the sitemap" : "Scan again"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Domain overview (paid SEO data, Phase 2): a designed locked state. */
export function DomainOverviewLocked({ domain }: { domain: string }) {
  const tiles = ["Organic traffic", "Ranking keywords", "Referring domains", "Top competitor"];
  return (
    <section className="locked panel" aria-labelledby="dov-h">
      <div className="locked-tiles" aria-hidden="true">
        {tiles.map((t) => (
          <div key={t} className="locked-tile">
            <span className="label">{t}</span>
            <span className="locked-bar" />
            <span className="locked-bar short" />
          </div>
        ))}
      </div>
      <div className="locked-cover">
        <span className="locked-ico" aria-hidden="true">
          <Icon name="lock" />
        </span>
        <h3 id="dov-h">Domain overview for {domain}</h3>
        <p>Available once an SEO data provider is connected (owner decision #3). Traffic, ranking keywords, backlinks and competitors are paid lookups, priced first and charged to the workspace&apos;s budget.</p>
      </div>
    </section>
  );
}
