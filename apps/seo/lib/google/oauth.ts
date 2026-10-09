/**
 * Google OAuth 2.0 for Search Console and GA4, per site, with the client's
 * own Google account (build prompt section 4). Authorization-code flow with
 * PKCE (S256) and a state parameter, read-only scopes only, offline access so
 * we get a refresh token. Docs read 9 October 2026 (docs/external-apis.md):
 * developers.google.com/identity/protocols/oauth2/web-server (updated
 * 2026-09-14) and the native-app guide for the PKCE parameters.
 *
 * The flow's secrets (state and code_verifier) live in ONE short-lived
 * cookie, sealed with AES-256-GCM under the app's keyring (AAD
 * "google-oauth-state"), HttpOnly, SameSite=Lax, scoped to /api/google and
 * ten minutes long. The callback accepts a code only when:
 *   - the cookie is present, authentic and unexpired,
 *   - the state in the URL equals the state in the cookie (constant time),
 *   - the signed-in user is the one who started the flow,
 * and the code is exchanged with the verifier, so a stolen code alone is
 * useless. We never use the Indexing API (it is only for job postings and
 * livestreams).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, SecretDecryptError, type Keyring } from "../crypto/secrets.ts";

export const GOOGLE_KINDS = ["search_console", "ga4"] as const;
export type GoogleKind = (typeof GOOGLE_KINDS)[number];

export const SCOPES: Record<GoogleKind, string> = {
  search_console: "https://www.googleapis.com/auth/webmasters.readonly",
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
};

export const OAUTH_COOKIE = "lumoras-growth.google-oauth";
export const OAUTH_COOKIE_PATH = "/api/google";
export const OAUTH_TTL_MS = 10 * 60 * 1000;
const AAD = "google-oauth-state";

export type GoogleEndpoints = { auth: string; token: string; revoke: string; gsc: string; admin: string; data: string; inspect: string };

/** Google's endpoints, or every one of them on a local fake (tests only). */
export function googleEndpoints(testOrigin: string | null): GoogleEndpoints {
  if (testOrigin) {
    return { auth: `${testOrigin}/o/oauth2/v2/auth`, token: `${testOrigin}/token`, revoke: `${testOrigin}/revoke`, gsc: `${testOrigin}/webmasters/v3`, admin: `${testOrigin}/admin/v1beta`, data: `${testOrigin}/data/v1beta`, inspect: `${testOrigin}/v1/urlInspection/index:inspect` };
  }
  return {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    gsc: "https://www.googleapis.com/webmasters/v3",
    admin: "https://analyticsadmin.googleapis.com/v1beta",
    data: "https://analyticsdata.googleapis.com/v1beta",
    inspect: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
  };
}

export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export type FlowState = { v: 1; state: string; verifier: string; workspaceId: string; slug: string; siteId: string; kind: GoogleKind; userId: string; next: "connections" | "onboarding"; exp: number };

/** Starts a flow: the URL to send the browser to, and the sealed cookie value to set. */
export function createAuthRequest(o: {
  clientId: string;
  redirectUri: string;
  endpoints: GoogleEndpoints;
  ring: Keyring;
  workspaceId: string;
  slug: string;
  siteId: string;
  kind: GoogleKind;
  userId: string;
  next?: FlowState["next"];
  now?: number;
}): { url: string; cookie: string; state: FlowState } {
  const state: FlowState = {
    v: 1,
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"), // 64 characters (43–128 allowed)
    workspaceId: o.workspaceId,
    slug: o.slug,
    siteId: o.siteId,
    kind: o.kind,
    userId: o.userId,
    next: o.next ?? "connections",
    exp: (o.now ?? Date.now()) + OAUTH_TTL_MS,
  };
  const u = new URL(o.endpoints.auth);
  u.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: SCOPES[o.kind],
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: state.state,
    code_challenge: pkceChallenge(state.verifier),
    code_challenge_method: "S256",
  }).toString();
  return { url: u.toString(), cookie: encryptSecret(JSON.stringify(state), AAD, o.ring).ciphertext, state };
}

export type CallbackFailure = "missing" | "tampered" | "expired" | "state_mismatch" | "wrong_user" | "denied" | "no_code";
export const CALLBACK_TEXT: Record<CallbackFailure, string> = {
  missing: "The connection attempt expired or was started in another browser. Start again from the Connections tab.",
  tampered: "The connection attempt could not be verified. Start again.",
  expired: "The connection attempt took longer than ten minutes. Start again.",
  state_mismatch: "The answer from Google did not match this connection attempt, so it was ignored. Start again.",
  wrong_user: "This connection was started by a different person. Sign in as them, or start again.",
  denied: "Google access was not granted. Nothing was connected.",
  no_code: "Google did not return an authorization code. Start again.",
};

/** Every reason the callback can send back to the Connections tab, for people. */
export const CONNECT_RESULT_TEXT: Record<string, string> = {
  ...CALLBACK_TEXT,
  exchange: "Google did not complete the connection. Try again, and allow read-only access when Google asks.",
  failed: "The connection could not be saved. Try again in a moment.",
};

const sameString = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Validates the callback against the sealed cookie. Never throws for bad input. */
export function verifyCallback(o: {
  cookie: string | undefined;
  query: URLSearchParams;
  userId: string | null;
  ring: Keyring;
  now?: number;
}): { ok: true; flow: FlowState; code: string } | { ok: false; reason: CallbackFailure; flow: FlowState | null } {
  if (!o.cookie) return { ok: false, reason: "missing", flow: null };
  let flow: FlowState;
  try {
    flow = JSON.parse(decryptSecret(o.cookie, AAD, o.ring)) as FlowState;
    if (flow.v !== 1 || typeof flow.state !== "string" || typeof flow.verifier !== "string") throw new SecretDecryptError("shape");
  } catch {
    return { ok: false, reason: "tampered", flow: null };
  }
  if ((o.now ?? Date.now()) > flow.exp) return { ok: false, reason: "expired", flow };
  const state = o.query.get("state") ?? "";
  if (!sameString(state, flow.state)) return { ok: false, reason: "state_mismatch", flow };
  if (!o.userId || o.userId !== flow.userId) return { ok: false, reason: "wrong_user", flow };
  if (o.query.get("error")) return { ok: false, reason: "denied", flow };
  const code = o.query.get("code");
  if (!code || code.length > 2048) return { ok: false, reason: "no_code", flow };
  return { ok: true, flow, code };
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: number; scope: string[] };

async function tokenCall(endpoints: GoogleEndpoints, body: Record<string, string>, f: typeof fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch (e) {
    throw new GoogleAuthError(`Google token endpoint unreachable (${e instanceof Error ? e.name : "network"})`);
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GoogleAuthError(`Google refused the token request: ${String(j.error ?? res.status)}`, typeof j.error === "string" ? j.error : null);
  return j;
}

function tokens(j: Record<string, unknown>, now: number): TokenSet {
  if (typeof j.access_token !== "string") throw new GoogleAuthError("Google returned no access token");
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    expiresAt: now + Math.max(60, Number(j.expires_in) || 3600) * 1000,
    scope: typeof j.scope === "string" ? j.scope.split(" ").filter(Boolean) : [],
  };
}

/** Exchanges the code (with the PKCE verifier); refuses a grant without our scope or without a refresh token. */
export async function exchangeCode(o: { code: string; verifier: string; redirectUri: string; client: { clientId: string; clientSecret: string }; endpoints: GoogleEndpoints; kind: GoogleKind; fetch?: typeof fetch; now?: number }): Promise<TokenSet> {
  const j = await tokenCall(o.endpoints, { grant_type: "authorization_code", code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, client_id: o.client.clientId, client_secret: o.client.clientSecret }, o.fetch ?? fetch);
  const t = tokens(j, o.now ?? Date.now());
  if (!t.scope.includes(SCOPES[o.kind])) throw new GoogleAuthError(`Google did not grant ${SCOPES[o.kind]}. Tick the permission on Google's consent screen and connect again.`);
  if (!t.refreshToken) throw new GoogleAuthError("Google did not return a refresh token. Remove Lumoras Growth from the Google account's third-party access and connect again.");
  return t;
}

export async function refreshAccessToken(o: { refreshToken: string; client: { clientId: string; clientSecret: string }; endpoints: GoogleEndpoints; fetch?: typeof fetch; now?: number }): Promise<TokenSet> {
  const j = await tokenCall(o.endpoints, { grant_type: "refresh_token", refresh_token: o.refreshToken, client_id: o.client.clientId, client_secret: o.client.clientSecret }, o.fetch ?? fetch);
  return tokens(j, o.now ?? Date.now());
}

/** Revokes a token at Google. Best effort: a token Google already forgot is fine. */
export async function revokeToken(o: { token: string; endpoints: GoogleEndpoints; fetch?: typeof fetch }): Promise<boolean> {
  try {
    const res = await (o.fetch ?? fetch)(o.endpoints.revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: o.token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}
