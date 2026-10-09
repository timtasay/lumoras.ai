/** Google wiring for the web process: client credentials, endpoints and the redirect URI from the environment. */
import { keyring, webEnv } from "../config.ts";
import { pool } from "../db/pool.ts";
import { googleEndpoints } from "./oauth.ts";
import type { GoogleDeps } from "./service.ts";

/** Null when GOOGLE_OAUTH_CLIENT_ID/SECRET are not set: the screens show "not configured". */
export function googleDeps(): GoogleDeps | null {
  const env = webEnv();
  if (!env.googleOAuth) return null;
  return { db: pool(), ring: keyring(), endpoints: googleEndpoints(env.googleApiTestOrigin), client: env.googleOAuth };
}

export const googleRedirectUri = () => `${webEnv().baseUrl}/api/google/callback`;
export const googleConfigured = () => !!webEnv().googleOAuth;
