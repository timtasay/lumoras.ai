/**
 * Playwright's web server: a fresh database (real init script + migrations),
 * the demo seed, a fake client site serving robots.txt and sitemaps, then the
 * PRODUCTION build (`next start`) with test-only settings:
 *   EMAIL_OUTBOX_DIR       magic links and invitations land as JSON files (no email leaves)
 *   CRAWLER_TEST_ORIGINS   northwind-dental.test → the fake site on 127.0.0.1
 *   RATE_LIMIT_SCALE       the suite signs in many times from one IP
 *   SEO_PROVIDER=fake      research answers from fixtures (no network, no real money)
 *   GOOGLE_API_TEST_ORIGIN Search Console / GA4 OAuth and APIs point at a local fake Google (realistic
 *                          Search Analytics, URL Inspection and GA4 data; the seed syncs sonorch.ai from it)
 *   LLM_PROVIDER=fake      articles are written by FakeLlm (no model call, no real money)
 *   OUTBOUND_TEST_HOSTS    github.test and webhook.test → the local fake GitHub and webhook receiver
 *   OUTBOUND_FETCH         recorded: fact-check sources come from recorded pages
 * plus the WORKER (pg-boss), with FAKE_LLM_LATENCY_MS so a run is slow enough
 * to watch live. Everything is torn down on exit. Needs TEST_DATABASE_URL (throwaway server).
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
import { FAKE_GOOGLE_CLIENT, startFakeGoogle } from "../test/helpers/fake-google.ts";
import { startFakeGit } from "../test/helpers/fake-git.ts";
import { startFakeWebhook } from "../test/helpers/fake-webhook.ts";
import { googleEndpoints } from "../lib/google/oauth.ts";
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
  const github = await startFakeGit({ provider: "github", hostName: "github.test", repos: [{ owner: "lumoras", repo: "lumoras.ai", files: { "apps/web/content/insights/no-show-policy.md": "---\ntitle: No-show policy\n---\n" } }] });
  const hookSecret = randomBytes(24).toString("hex");
  const webhook = await startFakeWebhook(hookSecret, { hostName: "webhook.test" });
  const policy = { testResolve: new Map([["github.test", "127.0.0.1"], ["webhook.test", "127.0.0.1"]]) };
  // the fake Google first: the seed connects sonorch.ai's Search Console and GA4 (and Northwind's broken GA4) to it and syncs them
  const google = await startFakeGoogle();
  await seed(pool, {
    keyring: readKeyring({ ENCRYPTION_KEY: encryptionKey }),
    content: { github: { apiBase: github.apiBase, token: github.token, reachable: true }, webhook: { endpoint: `${webhook.origin}/hook`, secret: hookSecret }, policy, mail: async () => {} },
    measure: { google: { endpoints: googleEndpoints(google.origin), client: FAKE_GOOGLE_CLIENT, issue: async (kind) => google.issueRefreshToken(kind) } },
  });
  await pool.end();
  const site = await startFakeSite(E2E.fakeDomain);
  await writeFile(E2E.stateFile, JSON.stringify({ adminUrl: db.adminUrl, appUrl: db.appUrl, fakeSitePort: site.port, fakeGoogle: google.origin, github: github.apiBase, webhook: webhook.origin, webhookSecret: hookSecret }, null, 2));

  const env: NodeJS.ProcessEnv = {
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
    DATAFORSEO_LOGIN: "",
    DATAFORSEO_PASSWORD: "",
    OPENSEO_MCP_URL: "",
    OPENSEO_MCP_TOKEN: "",
    // research from fixtures; Google OAuth and APIs at the local fake
    SEO_PROVIDER: "fake",
    GOOGLE_OAUTH_CLIENT_ID: FAKE_GOOGLE_CLIENT.clientId,
    GOOGLE_OAUTH_CLIENT_SECRET: FAKE_GOOGLE_CLIENT.clientSecret,
    GOOGLE_API_TEST_ORIGIN: google.origin,
    // articles by FakeLlm; publishing to the local fakes; recorded source pages
    LLM_PROVIDER: "fake",
    ANTHROPIC_API_KEY: "",
    OUTBOUND_TEST_HOSTS: "github.test,webhook.test",
    OUTBOUND_FETCH: "recorded",
  };
  const next = spawn(path.resolve("node_modules/.bin/next"), ["start", "-p", String(E2E.port), "-H", "127.0.0.1"], { stdio: "inherit", env });
  const worker = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], { stdio: "inherit", env: { ...env, FAKE_LLM_LATENCY_MS: "450", WORKER_CONCURRENCY: "4", WORKER_HEARTBEAT_MS: "600000", GOOGLE_PACE_MS: "0" } });
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    next.kill("SIGTERM");
    worker.kill("SIGTERM");
    await new Promise((r) => (worker.exitCode !== null ? r(null) : worker.once("exit", r)));
    await github.close().catch(() => {});
    await webhook.close().catch(() => {});
    await site.close().catch(() => {});
    await google.close().catch(() => {});
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
