import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EnvError, isDesignRouteEnabled, readMigrateEnv, readWorkerEnv } from "../../lib/env.ts";
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
