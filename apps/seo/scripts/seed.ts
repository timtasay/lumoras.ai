/**
 * Development seed (two demo workspaces): pnpm --filter seo seed
 *
 * Env: DATABASE_URL (the app role), optional ENCRYPTION_KEY(S) for the demo
 * webhook's sealed secret. Refuses next to a real deployment (an https
 * BETTER_AUTH_URL) because it creates a platform admin (staff@lumoras.example).
 * Sign in as any seeded user with a magic link: in development the link is
 * printed in the web server's log.
 */
import pg from "pg";
import { readKeyring } from "../lib/crypto/secrets.ts";
import { createLogger, redactUrl } from "../lib/log.ts";
import { seed, SEED_USERS } from "../lib/seed.ts";

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
    const r = await seed(db, { keyring });
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
