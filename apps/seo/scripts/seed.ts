/**
 * Development seed (two demo workspaces): pnpm --filter seo seed
 *
 * Env: DATABASE_URL (the app role), optional ENCRYPTION_KEY(S) for the demo
 * connections' sealed secrets, optional OUTBOUND_TEST_HOSTS=github.test,webhook.test
 * when the dev fakes (scripts/fakes.ts) run. Without github.test there, lumoras.ai's
 * Git connection points at the real repository with no token ("token needed"). Refuses next to a real deployment (an https
 * BETTER_AUTH_URL) because it creates a platform admin (staff@lumoras.example).
 * Sign in as any seeded user with a magic link: in development the link is
 * printed in the web server's log.
 */
import pg from "pg";
import { readKeyring } from "../lib/crypto/secrets.ts";
import { createLogger, redactUrl } from "../lib/log.ts";
import { seed, SEED_USERS } from "../lib/seed.ts";
import { DEV_FAKE_GITHUB, DEV_FAKE_WEBHOOK } from "../lib/seed-content.ts";
import { googleEndpoints } from "../lib/google/oauth.ts";

const log = createLogger("seed");

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.error("DATABASE_URL is required");
    return 1;
  }
  if ((process.env.BETTER_AUTH_URL ?? "").startsWith("https://") && !process.argv.includes("--yes-this-is-not-production")) {
    log.error("refusing to seed demo users next to an https BETTER_AUTH_URL (a real deployment)");
    return 1;
  }
  let keyring = null;
  try {
    keyring = readKeyring();
  } catch {
    log.warn("no ENCRYPTION_KEY(S): skipping the demo webhook connection");
  }
  const db = new pg.Pool({ connectionString: url, max: 2 });
  try {
    // with the dev fakes running (pnpm --filter seo fakes), the demo article is published as a PR on the fake GitHub
    const hosts = (process.env.OUTBOUND_TEST_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    const policy = hosts.length ? { testResolve: new Map(hosts.map((h) => [h, "127.0.0.1"] as [string, string])) } : {};
    const reachable = hosts.includes("github.test") && (await fetch(`http://127.0.0.1:${new URL(DEV_FAKE_GITHUB.apiBase).port}/`).then(() => true, () => false));
    // with the dev fake Google running (GOOGLE_API_TEST_ORIGIN, loopback only), sonorch.ai's Search Console and GA4 are connected to it and synced
    const origin = process.env.GOOGLE_API_TEST_ORIGIN?.trim() || "";
    const googleUp = /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && (await fetch(`${origin}/webmasters/v3/sites`).then(() => true, () => false));
    const google = googleUp
      ? {
          endpoints: googleEndpoints(origin),
          client: { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "" },
          issue: async (kind: "search_console" | "ga4") => {
            const scope = kind === "ga4" ? "https://www.googleapis.com/auth/analytics.readonly" : "https://www.googleapis.com/auth/webmasters.readonly";
            const r = await fetch(`${origin}/__fake/refresh-token`, { method: "POST", body: JSON.stringify({ scope }) });
            return ((await r.json()) as { refresh_token: string }).refresh_token;
          },
        }
      : null;
    if (!googleUp) log.info("no fake Google running: Search Console and GA4 stay disconnected in the demo (start pnpm --filter seo fakes and set GOOGLE_API_TEST_ORIGIN)");
    const r = await seed(db, {
      keyring,
      // env-gated: only with OUTBOUND_TEST_HOSTS=github.test does lumoras.ai's connection point at the fake GitHub;
      // otherwise it points at the real timtasay/lumoras.ai with no token ("token needed")
      content: { github: hosts.includes("github.test") ? { ...DEV_FAKE_GITHUB, reachable } : undefined, webhook: hosts.includes("webhook.test") ? DEV_FAKE_WEBHOOK : undefined, policy },
      measure: { google },
    });
    log.info("seeded", { db: redactUrl(url), workspaces: Object.keys(r.workspaces), users: SEED_USERS.map((u) => `${u.email}${u.admin ? " (platform admin)" : ""}`) });
    return 0;
  } catch (e) {
    log.error("seed failed", { err: e instanceof Error ? e : new Error(String(e)) });
    return 1;
  } finally {
    await db.end();
  }
}

main().then((c) => {
  process.exitCode = c;
});
