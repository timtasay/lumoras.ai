"use server";
/**
 * Search Console and GA4 connection actions (editors and owners). Connecting
 * starts Google's OAuth flow: the PKCE verifier and state go into a sealed,
 * HttpOnly, SameSite=Lax cookie scoped to /api/google for ten minutes
 * (lib/google/oauth.ts), then the browser is sent to Google. Next.js checks
 * the Origin of every server action (CSRF).
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { readWorkspace, toActionError, type ActionState } from "@/lib/actions";
import { requireWorkspace } from "@/lib/auth/app";
import { assertCan } from "@/lib/auth/permissions";
import { keyring, webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { isUuid, NotFoundError } from "@/lib/db/tenant";
import { getSite } from "@/lib/data/sites";
import { googleDeps, googleRedirectUri } from "@/lib/google/app";
import { GoogleApiError } from "@/lib/google/api";
import { createAuthRequest, GOOGLE_KINDS, GoogleAuthError, OAUTH_COOKIE, OAUTH_COOKIE_PATH, OAUTH_TTL_MS, type GoogleKind } from "@/lib/google/oauth";
import { chooseProperty, disconnect, listProperties, testConnection, type PropertyOption } from "@/lib/google/service";
import { hit, LIMITS } from "@/lib/rate-limit";
import { queueFirstSync } from "@/lib/measure/web";

const kindOf = (k: string): GoogleKind => {
  if (!(GOOGLE_KINDS as readonly string[]).includes(k)) throw new NotFoundError("connection");
  return k as GoogleKind;
};

async function scope(slug: string, siteId: string, limit: typeof LIMITS.googleConnectPerSite | typeof LIMITS.googleTestPerSite) {
  if (!isUuid(siteId)) throw new NotFoundError("site");
  const a = await requireWorkspace(slug);
  assertCan(a.role, "connection:manage");
  const deps = googleDeps();
  if (!deps) throw Object.assign(new Error("Search Console and GA4 are not configured on this server yet (GOOGLE_OAUTH_CLIENT_ID)."), { statusCode: 400, body: { message: "Search Console and GA4 are not configured on this server yet." } });
  const site = await readWorkspace(slug, (tx) => getSite(tx, siteId));
  await hit(pool(), limit, siteId, webEnv().rateLimitScale);
  return { a, deps, site };
}

const googleError = (e: unknown): ActionState =>
  e instanceof GoogleApiError || e instanceof GoogleAuthError ? { ok: false, error: e.message, at: Date.now() } : toActionError(e);

/**
 * Starts the OAuth flow for one site and kind: sets the sealed flow cookie and
 * returns Google's consent URL, which the browser then opens with a plain
 * navigation (a server-action redirect to another origin would make the
 * client router try to fetch Google's page as an RSC payload first).
 */
export async function connectGoogleAction(slug: string, siteId: string, kind: string, next: "connections" | "onboarding"): Promise<ActionState> {
  try {
    const k = kindOf(kind);
    const { a, deps, site } = await scope(slug, siteId, LIMITS.googleConnectPerSite);
    const req = createAuthRequest({ clientId: deps.client.clientId, redirectUri: googleRedirectUri(), endpoints: deps.endpoints, ring: keyring(), workspaceId: a.workspace.id, slug, siteId: site.id, kind: k, userId: a.viewer.user.id, next });
    (await cookies()).set(OAUTH_COOKIE, req.cookie, { httpOnly: true, sameSite: "lax", secure: webEnv().secure, path: OAUTH_COOKIE_PATH, maxAge: OAUTH_TTL_MS / 1000 });
    return { ok: true, at: Date.now(), data: { url: req.url } };
  } catch (e) {
    return googleError(e);
  }
}

export async function googlePropertiesAction(slug: string, siteId: string, kind: string): Promise<{ ok: true; options: PropertyOption[]; suggested: string | null } | { ok: false; error: string }> {
  try {
    const k = kindOf(kind);
    const { a, deps, site } = await scope(slug, siteId, LIMITS.googleTestPerSite);
    return { ok: true, ...(await listProperties(deps, a.ctx, site, k)) };
  } catch (e) {
    return { ok: false, error: googleError(e).error ?? "Could not list properties." };
  }
}

export async function chooseGooglePropertyAction(slug: string, siteId: string, kind: string, property: string): Promise<ActionState> {
  try {
    const k = kindOf(kind);
    if (typeof property !== "string" || property.length > 300) throw new Error("bad property");
    const { a, deps, site } = await scope(slug, siteId, LIMITS.googleTestPerSite);
    await chooseProperty(deps, a.ctx, site, k, property);
    const t = await testConnection(deps, a.ctx, site.id, k);
    await queueFirstSync(a.workspace.id, site.id, k);
    revalidatePath(`/w/${slug}/sites/${siteId}`, "layout");
    return { ok: t.status === "ok", message: t.status === "ok" ? `Property saved. ${t.detail}` : undefined, error: t.status === "ok" ? undefined : t.detail, at: Date.now() };
  } catch (e) {
    return googleError(e);
  }
}

export async function testGoogleAction(slug: string, siteId: string, kind: string): Promise<ActionState> {
  try {
    const k = kindOf(kind);
    const { a, deps, site } = await scope(slug, siteId, LIMITS.googleTestPerSite);
    const t = await testConnection(deps, a.ctx, site.id, k);
    revalidatePath(`/w/${slug}/sites/${siteId}`, "layout");
    return { ok: t.status === "ok", message: t.status === "ok" ? t.detail : undefined, error: t.status === "ok" ? undefined : t.detail, at: Date.now(), data: { status: t.status } };
  } catch (e) {
    return googleError(e);
  }
}

export async function disconnectGoogleAction(slug: string, siteId: string, kind: string): Promise<ActionState> {
  try {
    const k = kindOf(kind);
    const { a, deps, site } = await scope(slug, siteId, LIMITS.googleTestPerSite);
    const r = await disconnect(deps, a.ctx, site.id, k);
    revalidatePath(`/w/${slug}/sites/${siteId}`, "layout");
    return { ok: true, message: r.revoked ? "Disconnected, and access revoked at Google." : "Disconnected. Google did not confirm the revocation; remove access in the Google account too.", at: Date.now() };
  } catch (e) {
    return googleError(e);
  }
}
