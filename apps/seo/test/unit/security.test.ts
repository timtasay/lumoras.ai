/** Content Security Policy and the CSRF origin check for our own route handlers. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, newNonce } from "../../lib/security/csp.ts";
import { crossOriginReason } from "../../lib/security/origin.ts";

describe("buildCsp", () => {
  it("is strict in production: nonce-only scripts, no eval, no inline script, no framing", () => {
    const csp = buildCsp({ nonce: "abc123", dev: false, secure: true });
    const d = Object.fromEntries(csp.split("; ").map((x) => [x.split(" ")[0], x.split(" ").slice(1).join(" ")]));
    assert.equal(d["script-src"], "'self' 'nonce-abc123' 'strict-dynamic'");
    assert.ok(!csp.includes("unsafe-eval"));
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
    assert.equal(d["object-src"], "'none'");
    assert.equal(d["frame-ancestors"], "'none'");
    assert.equal(d["base-uri"], "'none'");
    assert.ok("upgrade-insecure-requests" in d);
  });
  it("allows eval only in development (React needs it), and no upgrade on plain http", () => {
    assert.match(buildCsp({ nonce: "n", dev: true, secure: false }), /'unsafe-eval'/);
    assert.ok(!buildCsp({ nonce: "n", dev: false, secure: false }).includes("upgrade-insecure-requests"));
  });
  it("nonces are 128-bit and fresh", () => {
    const a = newNonce(), b = newNonce();
    assert.notEqual(a, b);
    assert.equal(Buffer.from(a, "base64").length, 16);
  });
});

describe("crossOriginReason", () => {
  const APP = "https://growth.lumoras.ai";
  const req = (h: Record<string, string>) => new Request(`${APP}/api/x`, { method: "POST", headers: h });
  it("accepts a same-origin JSON request", () => {
    assert.equal(crossOriginReason(req({ origin: APP, "sec-fetch-site": "same-origin", "content-type": "application/json" }), APP), null);
  });
  it("refuses missing or foreign origins, cross-site fetch metadata and form posts", () => {
    assert.match(crossOriginReason(req({ "content-type": "application/json" }), APP)!, /missing Origin/);
    assert.match(crossOriginReason(req({ origin: "https://evil.example", "content-type": "application/json" }), APP)!, /evil/);
    assert.match(crossOriginReason(req({ origin: APP, "sec-fetch-site": "cross-site", "content-type": "application/json" }), APP)!, /cross-site/);
    assert.match(crossOriginReason(req({ origin: APP, "content-type": "application/x-www-form-urlencoded" }), APP)!, /json/);
  });
});
