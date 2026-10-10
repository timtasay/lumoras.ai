/**
 * The owner's acceptance command, `pnpm --filter seo gsc:sync -- --site <id>`,
 * run as a real process with the worker's environment against a local fake
 * Google: it syncs Search Console (16-month backfill), GA4 and URL inspection
 * for a connected site and prints the last 28 days and the dashboard link.
 * The real run needs the owner's Google OAuth client and sonorch.ai's
 * property (docs/phase-4-summary.md, runbook); this proves the command.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { readKeyring } from "../../lib/crypto/secrets.ts";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { saveGrantWithProperty } from "../../lib/google/service.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { FAKE_GOOGLE_CLIENT, startFakeGoogle } from "../helpers/fake-google.ts";
import { makeWorkspace } from "../helpers/workspace.ts";

const run = promisify(execFile);
const KEY = Buffer.alloc(32, 6).toString("base64");

describe("gsc:sync (the acceptance command)", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let g: Awaited<ReturnType<typeof startFakeGoogle>>;
  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 3 });
    pool.on("error", () => {});
    g = await startFakeGoogle();
  });
  after(async () => {
    await pool?.end();
    await g?.close();
    await dropAll();
  });

  it("syncs a connected site from the command line and prints the 28-day totals and the dashboard link", async () => {
    const w = await makeWorkspace(pool, "cli-ws", "sonorch.ai");
    await withWorkspace(pool, { workspaceId: w.ws, actorId: w.user }, (tx) => saveGrantWithProperty(tx, readKeyring({ ENCRYPTION_KEY: KEY }), w.ws, w.site, "search_console", g.issueRefreshToken("search_console"), "sc-domain:sonorch.ai", "test"));
    const env = {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      DATABASE_URL: db.appUrl,
      ENCRYPTION_KEY: KEY,
      GOOGLE_OAUTH_CLIENT_ID: FAKE_GOOGLE_CLIENT.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: FAKE_GOOGLE_CLIENT.clientSecret,
      GOOGLE_API_TEST_ORIGIN: g.origin,
      GOOGLE_PACE_MS: "0",
      LOG_LEVEL: "info",
    };
    const cwd = path.resolve(import.meta.dirname, "../..");
    const out = await run(process.execPath, ["--import", "tsx", "scripts/gsc-sync.ts", "--", "--site", w.site, "--inspect"], { cwd, env: env as unknown as NodeJS.ProcessEnv, timeout: 120_000 });
    const lines = out.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const last = lines.find((l) => l.msg === "last 28 days")!;
    assert.ok(last, out.stdout.slice(-800));
    assert.ok(Number(last.clicks) > 0 && Number(last.impressions) > 0);
    assert.match(String(last.dashboard), new RegExp(`/w/cli-ws/sites/${w.site}$`));
    const [st] = await adminQuery<{ backfilled_at: Date | null }>("SELECT backfilled_at FROM search_sync_state WHERE site_id = $1", [w.site], db.name);
    assert.ok(st.backfilled_at, "the 16-month backfill did not finish");
    const [r] = await adminQuery<{ trigger: string; status: string; created_by: string }>("SELECT trigger, status, created_by FROM measurement_runs WHERE site_id = $1 AND kind = 'gsc'", [w.site], db.name);
    assert.deepEqual(r, { trigger: "cli", status: "succeeded", created_by: "system:cli" });
    assert.ok(!out.stdout.includes("fake-refresh") && !out.stdout.includes(new URL(db.appUrl).password), "a secret was printed");
    // a bad site id is refused with usage text and exit code 2
    await assert.rejects(run(process.execPath, ["--import", "tsx", "scripts/gsc-sync.ts", "--site", "nope"], { cwd, env: env as unknown as NodeJS.ProcessEnv }), (e: { code?: number }) => e.code === 2);
  });
});
