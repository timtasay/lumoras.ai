/**
 * Runs before every page request:
 *   - a fresh CSP nonce per request (lib/security/csp.ts), on the response and
 *     on the request headers, where Next.js picks it up for its own scripts and
 *     the root layout reads it for the pre-paint theme script;
 *   - an x-request-id that ties the request's audit rows together;
 *   - an optimistic redirect to /sign-in when there is no session cookie at all.
 *     It does not validate anything: every page and action checks the session
 *     itself (lib/auth/app.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { buildCsp, newNonce } from "./lib/security/csp";

const PUBLIC = [/^\/sign-in(\/|$)/, /^\/accept-invitation\//, /^\/design(\/|$)/, /^\/api\//];

export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    secure: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
  });
  const path = request.nextUrl.pathname;
  if (!PUBLIC.some((re) => re.test(path)) && !getSessionCookie(request, { cookiePrefix: "lumoras-growth" })) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const res = NextResponse.redirect(url);
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", crypto.randomUUID());
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
