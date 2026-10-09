import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EnvError, isDesignRouteEnabled, readMigrateEnv, readWebEnv, readWorkerEnv } from "../../lib/env.ts";
import { redactUrl } from "../../lib/log.ts";

const OWNER = "postgres://seo_owner:o-secret@db:5432/seo";
const APP = "postgres://seo_app:a-secret@db:5432/seo";

describe("readMigrateEnv", () => {
  it("uses the owner role URL", () => {
    assert.equal(readMigrateEnv({ DATABASE_URL_OWNER: OWNER, DATABASE_URL: APP }).ownerUrl, OWNER);
  });
  it("requires DATABASE_URL_OWNER", () => {
    assert.throws(() => readMigrateEnv({ DATABASE_URL: APP }), (e: unknown) => e instanceof EnvError && /DATABASE_URL_OWNER is required/.test(e.message));
  });
  it("refuses to migrate as the app role", () => {
    assert.throws(
      () => readMigrateEnv({ DATABASE_URL_OWNER: APP, DATABASE_URL: APP.replace("db:", "db2:") }),
      (e: unknown) => e instanceof EnvError && /same role \("seo_app"\)/.test(e.message),
    );
  });
  it("rejects non-postgres URLs and bad log levels, reporting every problem", () => {
    assert.throws(
      () => readMigrateEnv({ DATABASE_URL_OWNER: "mysql://x@y/z", LOG_LEVEL: "loud" }),
      (e: unknown) => e instanceof EnvError && e.problems.length === 2,
    );
  });
});

describe("readWorkerEnv", () => {
  it("requires DATABASE_URL", () => {
    assert.throws(() => readWorkerEnv({}), EnvError);
  });
  it("defaults the heartbeat and validates overrides", () => {
    assert.equal(readWorkerEnv({ DATABASE_URL: APP }).heartbeatMs, 300_000);
    assert.equal(readWorkerEnv({ DATABASE_URL: APP, WORKER_HEARTBEAT_MS: "5000" }).heartbeatMs, 5000);
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, WORKER_HEARTBEAT_MS: "10" }), EnvError);
  });
});

describe("isDesignRouteEnabled", () => {
  it("is on outside production", () => {
    assert.equal(isDesignRouteEnabled({ NODE_ENV: "development" }), true);
    assert.equal(isDesignRouteEnabled({ NODE_ENV: "test" }), true);
  });
  it("is off in production unless ENABLE_DESIGN_ROUTE=1", () => {
    assert.equal(isDesignRouteEnabled({ NODE_ENV: "production" }), false);
    assert.equal(isDesignRouteEnabled({ NODE_ENV: "production", ENABLE_DESIGN_ROUTE: "true" }), false);
    assert.equal(isDesignRouteEnabled({ NODE_ENV: "production", ENABLE_DESIGN_ROUTE: "1" }), true);
  });
});

describe("redactUrl", () => {
  it("hides the password", () => {
    assert.equal(redactUrl(OWNER), "postgres://seo_owner:***@db:5432/seo");
  });
});

describe("readWebEnv", () => {
  const PROD = {
    NODE_ENV: "production",
    DATABASE_URL: APP,
    BETTER_AUTH_URL: "https://growth.lumoras.ai",
    BETTER_AUTH_SECRET: "s".repeat(40),
    RESEND_API_KEY: "re_x",
    EMAIL_FROM: "growth@lumoras.ai",
  };
  it("accepts a complete production configuration; Google stays off without its keys", () => {
    const e = readWebEnv(PROD);
    assert.equal(e.baseUrl, "https://growth.lumoras.ai");
    assert.equal(e.secure, true);
    assert.equal(e.google, null);
    assert.equal(e.email?.from, "growth@lumoras.ai");
  });
  it("requires the auth URL, a long secret and email in production", () => {
    assert.throws(
      () => readWebEnv({ NODE_ENV: "production", DATABASE_URL: APP }),
      (e: unknown) => e instanceof EnvError && e.problems.some((p) => p.includes("BETTER_AUTH_URL")) && e.problems.some((p) => p.includes("BETTER_AUTH_SECRET")) && e.problems.some((p) => p.includes("RESEND_API_KEY")),
    );
    assert.throws(() => readWebEnv({ ...PROD, BETTER_AUTH_SECRET: "short" }), /at least 32/);
    assert.throws(() => readWebEnv({ ...PROD, BETTER_AUTH_URL: "http://growth.lumoras.ai" }), /must use https/);
  });
  it("Google needs both halves", () => {
    assert.throws(() => readWebEnv({ ...PROD, GOOGLE_CLIENT_ID: "id" }), /must be set together/);
    assert.deepEqual(readWebEnv({ ...PROD, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec" }).google, { clientId: "id", clientSecret: "sec" });
  });
  it("test-only knobs are refused next to a real https origin", () => {
    for (const [k, v] of [["EMAIL_OUTBOX_DIR", "/tmp/x"], ["CRAWLER_TEST_ORIGINS", "a.test=http://127.0.0.1:4000"], ["RATE_LIMIT_SCALE", "50"]]) {
      assert.throws(() => readWebEnv({ ...PROD, [k]: v }), new RegExp(`${k} is for tests only`), k);
    }
  });
  it("allows the test knobs on a loopback origin (e2e against the production build)", () => {
    const e = readWebEnv({
      NODE_ENV: "production",
      DATABASE_URL: APP,
      BETTER_AUTH_URL: "http://127.0.0.1:3107",
      BETTER_AUTH_SECRET: "s".repeat(40),
      EMAIL_OUTBOX_DIR: "/tmp/outbox",
      CRAWLER_TEST_ORIGINS: "northwind-dental.test=http://127.0.0.1:4555",
      RATE_LIMIT_SCALE: "50",
    });
    assert.equal(e.secure, false);
    assert.deepEqual([...e.crawlerTestOrigins], [["northwind-dental.test", { address: "127.0.0.1", origin: "http://northwind-dental.test:4555" }]]);
    assert.throws(() => readWebEnv({ ...PROD, BETTER_AUTH_URL: "http://127.0.0.1:3107", RESEND_API_KEY: "", EMAIL_FROM: "", CRAWLER_TEST_ORIGINS: "evil.com=http://10.0.0.1:80" }), /must look like/);
  });
  it("defaults to localhost in development", () => {
    const e = readWebEnv({ NODE_ENV: "development", DATABASE_URL: APP });
    assert.equal(e.baseUrl, "http://localhost:3007");
    assert.equal(e.email, null);
  });
});
