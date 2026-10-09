/**
 * CSRF guard for our own route handlers that change state (the crawl stream).
 * Server actions get Next.js's built-in check (Origin must match Host); Better
 * Auth's routes get Better Auth's (Origin must be a trusted origin). Here:
 *   - the request must carry an Origin header equal to the app's origin, and
 *   - when the browser sends Sec-Fetch-Site, it must be "same-origin".
 * Together with SameSite=Lax session cookies and a JSON content type (which a
 * cross-site form cannot send without a CORS preflight), a forged cross-site
 * request is refused before it reaches any data.
 */
export function crossOriginReason(req: Request, appOrigin: string): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return "missing Origin header";
  if (origin !== appOrigin) return `Origin ${origin} is not ${appOrigin}`;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return `Sec-Fetch-Site is ${site}`;
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return "content type must be application/json";
  return null;
}
