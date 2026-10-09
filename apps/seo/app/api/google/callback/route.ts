/**
 * GET /api/google/callback: where Google sends the browser back after the
 * Search Console / GA4 consent screen (lib/google/oauth.ts).
 *
 * Accepts the code only if the sealed flow cookie is present, authentic and
 * unexpired, the state matches it, the signed-in user started the flow and
 * may still manage connections in that workspace. Then exchanges the code
 * with the PKCE verifier, stores the refresh token encrypted, picks the
 * site's property when one obviously matches and runs the live test. The
 * cookie is single use: it is cleared on every outcome. Errors never echo
 * anything Google or the URL sent.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/app";
import { can } from "@/lib/auth/permissions";
import { keyring, log, webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { withWorkspace } from "@/lib/db/tenant";
import { membershipBySlug } from "@/lib/data/workspaces";
import { googleDeps, googleRedirectUri } from "@/lib/google/app";
import { exchangeCode, GoogleAuthError, OAUTH_COOKIE, OAUTH_COOKIE_PATH, verifyCallback, type FlowState } from "@/lib/google/oauth";
import { chooseProperty, listProperties, saveGoogleGrant, testConnection } from "@/lib/google/service";

export const dynamic = "force-dynamic";

function back(flow: FlowState | null, params: Record<string, string>): NextResponse {
  const base = webEnv().baseUrl;
  const path = !flow ? "/" : flow.next === "onboarding" ? `/w/${flow.slug}/onboarding/search` : `/w/${flow.slug}/sites/${flow.siteId}/connections`;
  const u = new URL(path, base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = NextResponse.redirect(u, 303);
  res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: "lax", secure: webEnv().secure });
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function GET(request: NextRequest) {
  const deps = googleDeps();
  const viewer = await getViewer();
  const v = verifyCallback({ cookie: request.cookies.get(OAUTH_COOKIE)?.value, query: request.nextUrl.searchParams, userId: viewer?.user.id ?? null, ring: keyring() });
  if (!v.ok) return back(v.flow, { google: "error", reason: v.reason });
  if (!deps || !viewer) return back(v.flow, { google: "error", reason: "missing" });
  const { flow, code } = v;
  // still a member with the right to manage connections in that workspace?
  const m = await membershipBySlug(pool(), viewer.user.id, flow.slug);
  if (!m || m.id !== flow.workspaceId || !can(m.role, "connection:manage")) return back(flow, { google: "error", reason: "wrong_user" });
  const ctx = { workspaceId: m.id, actorId: viewer.user.id, impersonatorId: viewer.impersonator?.id ?? null, requestId: viewer.requestId };
  try {
    const t = await exchangeCode({ code, verifier: flow.verifier, redirectUri: googleRedirectUri(), client: deps.client, endpoints: deps.endpoints, kind: flow.kind });
    await withWorkspace(pool(), ctx, async (tx) => {
      await tx.action("connection.google_connect");
      await saveGoogleGrant(tx, keyring(), m.id, flow.siteId, flow.kind, t, viewer.user.email);
    });
    // pick the obvious property and test it, so the light is green on arrival when it can be
    const site = await withWorkspace(pool(), ctx, (tx) => tx.one<{ id: string; domain: string; name: string }>("SELECT id, domain, name FROM sites WHERE id = $1", [flow.siteId]), { readOnly: true });
    const props = await listProperties(deps, ctx, site, flow.kind).catch(() => ({ options: [], suggested: null }));
    if (props.suggested) {
      await chooseProperty(deps, ctx, site, flow.kind, props.suggested);
      await testConnection(deps, ctx, site.id, flow.kind);
    }
    return back(flow, { google: "connected", kind: flow.kind });
  } catch (e) {
    log().warn("google connect failed", { kind: flow.kind, err: e instanceof Error ? e.message : String(e) });
    return back(flow, { google: "error", reason: e instanceof GoogleAuthError ? "exchange" : "failed" });
  }
}
