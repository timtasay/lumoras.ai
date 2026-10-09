/**
 * Playwright's web server: a fresh database (real init script + migrations),
 * the demo seed, a fake client site serving robots.txt and sitemaps, then the
 * PRODUCTION build (`next start`) with test-only settings:
 *   EMAIL_OUTBOX_DIR       magic links and invitations land as JSON files (no email leaves)
 *   CRAWLER_TEST_ORIGINS   northwind-dental.test → the fake site on 127.0.0.1
 *   RATE_LIMIT_SCALE       the suite signs in many times from one IP
 * Everything is torn down on exit. Needs TEST_DATABASE_URL (throwaway server).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { readKeyring } from "../lib/crypto/secrets.ts";
import { seed } from "../lib/seed.ts";
import { createTestDatabase, dropAll, skipReason } from "../test/helpers/db.ts";
import { startFakeSite } from "../test/helpers/fake-site.ts";
import { E2E } from "./config.ts";

async function main() {
  if (skipReason) {
    console.error(`e2e needs a throwaway PostgreSQL: ${skipReason}`);
    process.exit(1);
  }
  await rm(E2E.outbox, { recursive: true, force: true });
  await mkdir(E2E.outbox, { recursive: true });
  const db = await createTestDatabase();
  const encryptionKey = randomBytes(32).toString("base64");
  const pool = new pg.Pool({ connectionString: db.appUrl, max: 2 });
  await seed(pool, { keyring: readKeyring({ ENCRYPTION_KEY: encryptionKey }) });
  await pool.end();
  const site = await startFakeSite(E2E.fakeDomain);
  await writeFile(E2E.stateFile, JSON.stringify({ adminUrl: db.adminUrl, appUrl: db.appUrl, fakeSitePort: site.port }, null, 2));

  const next = spawn(path.resolve("node_modules/.bin/next"), ["start", "-p", String(E2E.port), "-H", "127.0.0.1"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: db.appUrl,
      BETTER_AUTH_URL: E2E.baseUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
      ENCRYPTION_KEY: encryptionKey,
      EMAIL_OUTBOX_DIR: E2E.outbox,
      CRAWLER_TEST_ORIGINS: `${E2E.fakeDomain}=http://127.0.0.1:${site.port}`,
      RATE_LIMIT_SCALE: "50",
      ENABLE_DESIGN_ROUTE: "1",
      LOG_LEVEL: "warn",
      // never let a developer's real credentials into the suite
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      RESEND_API_KEY: "",
    },
  });
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    next.kill("SIGTERM");
    await site.close().catch(() => {});
    await dropAll().catch(() => {});
    await rm(E2E.stateFile, { force: true });
    process.exit(code);
  };
  next.on("exit", (c) => void stop(c ?? 0));
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
