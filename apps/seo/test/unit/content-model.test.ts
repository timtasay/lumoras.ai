/**
 * The content model's pure parts: the status machine (nothing reaches
 * "published" without passing "approved" and "publishing"; a rejection is
 * final), the version diff, and the Phase 3 settings in the environment.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertTransition, canTransition, EDITABLE, HOLDS_HEAD_TERM, REVIEWABLE, STATUSES, TransitionError, TRANSITIONS } from "../../lib/content/status.ts";
import { diffLines, diffStats, hunks } from "../../lib/content/diff.ts";
import { EnvError, readWebEnv, readWorkerEnv } from "../../lib/env.ts";
import { scheduleInput } from "../../lib/validation.ts";

describe("status machine", () => {
  it("only 'publishing' leads to 'published', and only 'approved' (or a retry of a publication) leads to 'publishing'", () => {
    const into = (to: string) => STATUSES.filter((s) => (TRANSITIONS[s] as readonly string[]).includes(to)).sort();
    assert.deepEqual(into("published"), ["publishing"]);
    assert.deepEqual(into("publishing"), ["approved", "published", "unpublished"].sort());
    assert.deepEqual(into("approved"), ["awaiting_review", "generating", "publishing"].sort());
  });
  it("a rejection is final; a review only happens to an article awaiting review", () => {
    assert.deepEqual(TRANSITIONS.rejected, []);
    assert.throws(() => assertTransition("rejected", "planned"), TransitionError);
    assert.equal(canTransition("planned", "approved"), false, "an unwritten slot cannot be approved");
    assert.deepEqual([...REVIEWABLE], ["awaiting_review"]);
    assert.ok(!EDITABLE.includes("published") && !EDITABLE.includes("publishing"));
    assert.ok(HOLDS_HEAD_TERM.includes("approved") && !HOLDS_HEAD_TERM.includes("rejected"));
    assert.match(new TransitionError("rejected", "approved").message, /rejected cannot become scheduled/i);
  });
});

describe("version diff", () => {
  it("lines added and removed, with context hunks", () => {
    const a = ["one", "two", "three", "four", "five", "six", "seven"].join("\n");
    const b = ["one", "two", "THREE", "four", "five", "six", "seven", "eight"].join("\n");
    const d = diffLines(a, b);
    assert.deepEqual(diffStats(d), { added: 2, removed: 1 });
    const h = hunks(d, 1);
    assert.ok(h.some((x) => x.op === "gap"));
    assert.deepEqual(h.filter((x) => x.op === "add").map((x) => (x as { text: string }).text), ["THREE", "eight"]);
    assert.deepEqual(diffStats(diffLines("same", "same")), { added: 0, removed: 0 });
  });
});

describe("schedule settings", () => {
  const ok = { days: ["2", "5"], time: "09:00", active: "on", leadDays: "3", runwayThreshold: "10" };
  it("defaults: approval required, no back-dating, rolling, three days ahead", () => {
    const s = scheduleInput.parse({ days: ["2", "5"], time: "09:00" });
    assert.equal(s.reviewMode, "approval");
    assert.equal(s.allowBackdating, false);
    assert.equal(s.generationMode, "rolling");
    assert.equal(s.leadDays, 3);
    assert.equal(s.runwayThreshold, 10);
  });
  it("autopilot and back-dating need their acknowledgement", () => {
    assert.throws(() => scheduleInput.parse({ ...ok, reviewMode: "autopilot" }), /confirm you understand what autopilot does/);
    assert.equal(scheduleInput.parse({ ...ok, reviewMode: "autopilot", autopilotAck: "on" }).reviewMode, "autopilot");
    assert.throws(() => scheduleInput.parse({ ...ok, allowBackdating: "on" }), /back-dating/);
    assert.equal(scheduleInput.parse({ ...ok, allowBackdating: "on", backdatingAck: "on" }).allowBackdating, true);
    assert.throws(() => scheduleInput.parse({ ...ok, days: [] }), /at least one weekday/);
  });
});

describe("Phase 3 environment", () => {
  const APP = "postgres://seo_app:a-secret@db:5432/seo";
  const PROD = { NODE_ENV: "production", DATABASE_URL: APP, BETTER_AUTH_URL: "https://growth.example", BETTER_AUTH_SECRET: "x".repeat(40), ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.example" };
  it("the fake model in development, no model in production by default; models and prices from env", () => {
    const w = readWorkerEnv({ DATABASE_URL: APP });
    assert.equal(w.llm.provider, "fake");
    assert.equal(readWorkerEnv(PROD).llm.provider, "none", "production never writes with a fake model, and never calls a real one unless configured");
    assert.deepEqual(w.llm.models, { draft: "claude-sonnet-5-5", review: "claude-opus-5-5" });
    assert.equal(w.outbound.fetchMode, "recorded", "development serves recorded pages");
    const a = readWorkerEnv({ DATABASE_URL: APP, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test", LLM_MODEL_DRAFT: "claude-sonnet-5", LLM_PRICES_JSON: '{"claude-sonnet-5": {"input": 3, "output": 15}}' });
    assert.equal(a.llm.models.draft, "claude-sonnet-5");
    assert.equal(a.llm.prices["claude-sonnet-5"].input, 3_000_000);
  });
  it("refuses: anthropic without a key, a bad model id, bad prices, the fake model or recorded pages or test hosts next to https", () => {
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, LLM_PROVIDER: "anthropic" }), (e: unknown) => e instanceof EnvError && /ANTHROPIC_API_KEY is required/.test(e.message));
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, LLM_MODEL_REVIEW: "gpt-9" }), /must be a Claude model id/);
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, LLM_PRICES_JSON: "{" }), /LLM_PRICES_JSON is not valid JSON/);
    assert.throws(() => readWorkerEnv({ ...PROD, LLM_PROVIDER: "fake" }), /LLM_PROVIDER=fake/);
    assert.throws(() => readWorkerEnv({ ...PROD, OUTBOUND_FETCH: "recorded" }), /OUTBOUND_FETCH=recorded/);
    assert.throws(() => readWorkerEnv({ ...PROD, OUTBOUND_TEST_HOSTS: "github.test" }), /OUTBOUND_TEST_HOSTS/);
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, OUTBOUND_TEST_HOSTS: "github.com" }), /must be a host name ending in \.test/);
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, WORKER_CONCURRENCY: "99" }), /WORKER_CONCURRENCY/);
    assert.equal(readWorkerEnv({ ...PROD }).outbound.fetchMode, "live", "production fetches live pages");
  });
  it("the web app reads the same model settings", () => {
    const w = readWebEnv({ DATABASE_URL: APP, LLM_PROVIDER: "fake", OUTBOUND_TEST_HOSTS: "github.test,webhook.test" });
    assert.equal(w.llm.provider, "fake");
    assert.deepEqual(w.outbound.testHosts, ["github.test", "webhook.test"]);
  });
});
