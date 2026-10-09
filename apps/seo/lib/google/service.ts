/**
 * Search Console and GA4 connections per site: storage, access tokens,
 * property selection, the live test, disconnect, and the Phase 2 reads.
 *
 * The refresh token is the only stored secret: sealed with AES-256-GCM in
 * connections.credentials_ciphertext, bound to the workspace and row (AAD),
 * never selected by anything that renders, redacted in the audit log. Access
 * tokens live in this process's memory only, until they expire. No
 * transaction is held open while Google answers.
 */
import type pg from "pg";
import { connectionAad, decryptSecret, encryptSecret, type Keyring } from "../crypto/secrets.ts";
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { measurementHealth, strikingDistance, suggestGa4Property, suggestGscProperty, zeroClickPages, type Ga4Property, type GscSite, type Health, type StrikingQuery, type ZeroClickPage } from "./analysis.ts";
import { ga4RunReport, GoogleApiError, gscSearchAnalytics, listGa4Properties, listGscSites } from "./api.ts";
import { GoogleAuthError, refreshAccessToken, revokeToken, SCOPES, type GoogleEndpoints, type GoogleKind, type TokenSet } from "./oauth.ts";

export type GoogleDeps = {
  db: pg.Pool;
  ring: Keyring;
  endpoints: GoogleEndpoints;
  client: { clientId: string; clientSecret: string };
  fetch?: typeof fetch;
  now?: () => Date;
};

export const KIND_LABEL: Record<GoogleKind, string> = { search_console: "Google Search Console", ga4: "Google Analytics 4" };

export type GoogleConnection = {
  id: string;
  kind: GoogleKind;
  property: string;
  propertyLabel: string;
  connectedBy: string;
  connectedAt: string;
  status: "untested" | "ok" | "warn" | "error";
  status_detail: string | null;
  last_tested_at: Date | null;
  key_version: number | null;
};

type Row = { id: string; kind: GoogleKind; config: Record<string, string>; status: GoogleConnection["status"]; status_detail: string | null; last_tested_at: Date | null; key_version: number | null };
const view = (r: Row): GoogleConnection => ({
  id: r.id,
  kind: r.kind,
  property: r.config.property ?? "",
  propertyLabel: r.config.propertyLabel ?? "",
  connectedBy: r.config.connectedBy ?? "",
  connectedAt: r.config.connectedAt ?? "",
  status: r.status,
  status_detail: r.status_detail,
  last_tested_at: r.last_tested_at,
  key_version: r.key_version,
});

export async function listGoogleConnections(tx: Tx, siteId: string): Promise<Partial<Record<GoogleKind, GoogleConnection>>> {
  const rows = await tx.many<Row>(
    "SELECT id, kind, config, status, status_detail, last_tested_at, key_version FROM connections WHERE site_id = $1 AND kind IN ('search_console', 'ga4')",
    [siteId],
  );
  return Object.fromEntries(rows.map((r) => [r.kind, view(r)]));
}

/** Stores (or replaces) the grant for a site and kind. The refresh token is sealed; nothing else is secret. */
export async function saveGoogleGrant(tx: Tx, ring: Keyring, workspaceId: string, siteId: string, kind: GoogleKind, t: TokenSet, connectedBy: string, now = new Date()): Promise<string> {
  if (!t.refreshToken) throw new GoogleAuthError("no refresh token to store");
  const existing = await tx.maybe<{ id: string }>("SELECT id FROM connections WHERE site_id = $1 AND kind = $2", [siteId, kind]);
  const id = existing?.id ?? (await tx.one<{ id: string }>("SELECT gen_random_uuid() AS id")).id;
  const sealed = encryptSecret(JSON.stringify({ refreshToken: t.refreshToken, scope: t.scope, grantedAt: now.toISOString() }), connectionAad(workspaceId, id), ring);
  const config = { property: "", propertyLabel: "", scope: SCOPES[kind], connectedBy, connectedAt: now.toISOString() };
  if (existing) {
    await tx.exec(
      "UPDATE connections SET config = $2::jsonb, credentials_ciphertext = $3, key_version = $4, status = 'warn', status_detail = 'Connected. Choose the property for this site.', last_tested_at = NULL WHERE id = $1",
      [id, JSON.stringify(config), sealed.ciphertext, sealed.keyVersion],
    );
  } else {
    await tx.exec(
      `INSERT INTO connections (id, workspace_id, site_id, kind, label, config, credentials_ciphertext, key_version, status, status_detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'warn', 'Connected. Choose the property for this site.')`,
      [id, workspaceId, siteId, kind, KIND_LABEL[kind], JSON.stringify(config), sealed.ciphertext, sealed.keyVersion],
    );
  }
  return id;
}

async function readRefreshToken(tx: Tx, ring: Keyring, workspaceId: string, id: string): Promise<string> {
  const r = await tx.one<{ c: string | null }>("SELECT credentials_ciphertext AS c FROM connections WHERE id = $1", [id], "connection");
  if (!r.c) throw new GoogleAuthError("this connection has no stored grant");
  return (JSON.parse(decryptSecret(r.c, connectionAad(workspaceId, id), ring)) as { refreshToken: string }).refreshToken;
}

export async function setStatus(tx: Tx, id: string, status: GoogleConnection["status"], detail: string): Promise<void> {
  await tx.exec("UPDATE connections SET status = $2, status_detail = $3, last_tested_at = now() WHERE id = $1", [id, status, detail.slice(0, 500)]);
}

// access tokens, in memory only, per connection and key version
const access = new Map<string, { token: string; exp: number }>();
/** Tests: forget cached access tokens and reads. */
export function forgetGoogleCaches() {
  access.clear();
  reads.clear();
}

/** Runs fn with a fresh access token; an expired or revoked grant marks the connection failing. */
async function withAccessToken<T>(deps: GoogleDeps, ctx: TenantContext, conn: GoogleConnection, fn: (token: string) => Promise<T>): Promise<T> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const k = `${conn.id}:${conn.key_version}`;
  const hit = access.get(k);
  let token = hit && hit.exp - 60_000 > now ? hit.token : null;
  if (!token) {
    const refresh = await withWorkspace(deps.db, ctx, (tx) => readRefreshToken(tx, deps.ring, ctx.workspaceId, conn.id), { readOnly: true });
    try {
      const t = await refreshAccessToken({ refreshToken: refresh, client: deps.client, endpoints: deps.endpoints, fetch: deps.fetch, now });
      access.set(k, { token: t.accessToken, exp: t.expiresAt });
      token = t.accessToken;
    } catch (e) {
      if (e instanceof GoogleAuthError && e.code === "invalid_grant") {
        await withWorkspace(deps.db, ctx, async (tx) => {
          await tx.action("connection.google_revoked");
          await setStatus(tx, conn.id, "error", "Google no longer accepts this grant (revoked, expired or the password changed). Connect again.");
        });
      }
      throw e;
    }
  }
  return fn(token);
}

async function getConn(deps: GoogleDeps, ctx: TenantContext, siteId: string, kind: GoogleKind): Promise<GoogleConnection | null> {
  return (await withWorkspace(deps.db, ctx, (tx) => listGoogleConnections(tx, siteId), { readOnly: true }))[kind] ?? null;
}

export type PropertyOption = { value: string; label: string };

/** Properties the connected Google account can read, and the one we would pick for this site. */
export async function listProperties(deps: GoogleDeps, ctx: TenantContext, site: { id: string; domain: string; name: string }, kind: GoogleKind): Promise<{ options: PropertyOption[]; suggested: string | null }> {
  const conn = await getConn(deps, ctx, site.id, kind);
  if (!conn) return { options: [], suggested: null };
  return withAccessToken(deps, ctx, conn, async (token) => {
    if (kind === "search_console") {
      const sites: GscSite[] = (await listGscSites(deps.endpoints, token, deps.fetch)).filter((x) => x.permissionLevel !== "siteUnverifiedUser");
      return { options: sites.map((s) => ({ value: s.siteUrl, label: `${s.siteUrl.replace(/^sc-domain:/, "Domain: ")} · ${s.permissionLevel.replace(/^site/, "")}` })), suggested: suggestGscProperty(sites, site.domain) };
    }
    const props: Ga4Property[] = await listGa4Properties(deps.endpoints, token, deps.fetch);
    return { options: props.map((p) => ({ value: p.property, label: `${p.displayName} · ${p.account} (${p.property.replace("properties/", "")})` })), suggested: suggestGa4Property(props, site.domain, site.name) };
  });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));

/** The live test behind the "Test" button: a minimal read; writes the status light. */
export async function testConnection(deps: GoogleDeps, ctx: TenantContext, siteId: string, kind: GoogleKind): Promise<{ status: GoogleConnection["status"]; detail: string }> {
  const conn = await getConn(deps, ctx, siteId, kind);
  if (!conn) return { status: "error", detail: "Not connected." };
  let out: { status: GoogleConnection["status"]; detail: string };
  if (!conn.property) out = { status: "warn", detail: "Connected. Choose the property for this site." };
  else {
    const now = (deps.now ?? (() => new Date()))();
    try {
      out = await withAccessToken(deps, ctx, conn, async (token) => {
        if (kind === "search_console") {
          const rows = await gscSearchAnalytics(deps.endpoints, token, conn.property, { startDate: iso(daysBefore(now, 30)), endDate: iso(daysBefore(now, 2)), dimensions: ["date"], rowLimit: 31 }, deps.fetch);
          const clicks = rows.reduce((s, r) => s + r.clicks, 0), imp = rows.reduce((s, r) => s + r.impressions, 0);
          return { status: "ok" as const, detail: `Reading ${conn.property}: ${clicks.toLocaleString("en-US")} clicks and ${imp.toLocaleString("en-US")} impressions in the last 28 days.` };
        }
        const days = await ga4RunReport(deps.endpoints, token, conn.property, { dimensions: ["date"], metrics: ["sessions"], startDate: iso(daysBefore(now, 14)), endDate: iso(daysBefore(now, 1)) }, deps.fetch);
        const h = measurementHealth(days.map((d) => ({ date: String(d.date), sessions: Number(d.sessions) })), now);
        return { status: h.state, detail: h.detail };
      });
    } catch (e) {
      out = { status: "error", detail: e instanceof GoogleApiError || e instanceof GoogleAuthError ? e.message : "The test failed unexpectedly." };
    }
  }
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("connection.test");
    await setStatus(tx, conn.id, out.status, out.detail);
  });
  return out;
}

export async function chooseProperty(deps: GoogleDeps, ctx: TenantContext, site: { id: string; domain: string; name: string }, kind: GoogleKind, property: string): Promise<void> {
  const { options } = await listProperties(deps, ctx, site, kind);
  const opt = options.find((o) => o.value === property);
  if (!opt) throw new GoogleApiError("That property is not available to the connected Google account.", 400);
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("connection.google_property");
    await tx.exec(
      "UPDATE connections SET config = config || jsonb_build_object('property', $3::text, 'propertyLabel', $4::text), status = 'untested', status_detail = 'Property chosen. Run the test.' WHERE site_id = $1 AND kind = $2",
      [site.id, kind, property, opt.label],
    );
  });
}

/** Revokes the grant at Google (best effort), then deletes the connection. */
export async function disconnect(deps: GoogleDeps, ctx: TenantContext, siteId: string, kind: GoogleKind): Promise<{ revoked: boolean }> {
  const conn = await getConn(deps, ctx, siteId, kind);
  if (!conn) return { revoked: false };
  const refresh = await withWorkspace(deps.db, ctx, (tx) => readRefreshToken(tx, deps.ring, ctx.workspaceId, conn.id).catch(() => null), { readOnly: true });
  const revoked = refresh ? await revokeToken({ token: refresh, endpoints: deps.endpoints, fetch: deps.fetch }) : false;
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("connection.google_disconnect");
    await tx.exec("DELETE FROM connections WHERE id = $1", [conn.id]);
  });
  for (const k of access.keys()) if (k.startsWith(`${conn.id}:`)) access.delete(k);
  return { revoked };
}

// reads, cached in memory for ten minutes per connection and property
const reads = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, now: number, fn: () => Promise<T>): Promise<T> {
  const hit = reads.get(key);
  if (hit && now - hit.at < 10 * 60_000) return hit.data as T;
  const data = await fn();
  reads.set(key, { at: now, data });
  return data;
}

export type GscInsights = { property: string; range: { start: string; end: string }; striking: StrikingQuery[]; zeroClick: ZeroClickPage[] };

/** Striking-distance queries (positions 4–20) and pages with impressions but no clicks, last 28 days. Null when not connected or not set up. */
export async function gscInsights(deps: GoogleDeps, ctx: TenantContext, siteId: string): Promise<GscInsights | null> {
  const conn = await getConn(deps, ctx, siteId, "search_console");
  if (!conn?.property || conn.status === "error") return null;
  const now = (deps.now ?? (() => new Date()))();
  const range = { start: iso(daysBefore(now, 30)), end: iso(daysBefore(now, 2)) };
  return cached(`gsc:${conn.id}:${conn.property}:${range.end}`, now.getTime(), () =>
    withAccessToken(deps, ctx, conn, async (token) => {
      const [byQuery, byPage] = await Promise.all([
        gscSearchAnalytics(deps.endpoints, token, conn.property, { startDate: range.start, endDate: range.end, dimensions: ["query", "page"], rowLimit: 5000 }, deps.fetch),
        gscSearchAnalytics(deps.endpoints, token, conn.property, { startDate: range.start, endDate: range.end, dimensions: ["page"], rowLimit: 5000 }, deps.fetch),
      ]);
      return { property: conn.property, range, striking: strikingDistance(byQuery), zeroClick: zeroClickPages(byPage) };
    }),
  );
}

export type Ga4Insights = { property: string; range: { start: string; end: string }; landingPages: { page: string; sessions: number; keyEvents: number }[]; health: Health };

/** Organic landing pages (last 28 days) and measurement health (last 14 days). */
export async function ga4Insights(deps: GoogleDeps, ctx: TenantContext, siteId: string): Promise<Ga4Insights | null> {
  const conn = await getConn(deps, ctx, siteId, "ga4");
  if (!conn?.property || conn.status === "error") return null;
  const now = (deps.now ?? (() => new Date()))();
  const range = { start: iso(daysBefore(now, 28)), end: iso(daysBefore(now, 1)) };
  return cached(`ga4:${conn.id}:${conn.property}:${range.end}`, now.getTime(), () =>
    withAccessToken(deps, ctx, conn, async (token) => {
      const [pages, days] = await Promise.all([
        ga4RunReport(deps.endpoints, token, conn.property, { dimensions: ["landingPage"], metrics: ["sessions", "keyEvents"], startDate: range.start, endDate: range.end, filter: { field: "sessionDefaultChannelGroup", value: "Organic Search" }, orderByMetric: "sessions", limit: 25 }, deps.fetch),
        ga4RunReport(deps.endpoints, token, conn.property, { dimensions: ["date"], metrics: ["sessions"], startDate: iso(daysBefore(now, 14)), endDate: range.end }, deps.fetch),
      ]);
      return {
        property: conn.property,
        range,
        landingPages: pages.map((p) => ({ page: String(p.landingPage).slice(0, 500), sessions: Number(p.sessions), keyEvents: Number(p.keyEvents) })),
        health: measurementHealth(days.map((d) => ({ date: String(d.date), sessions: Number(d.sessions) })), now),
      };
    }),
  );
}
