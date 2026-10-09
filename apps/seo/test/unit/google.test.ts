/**
 * Google OAuth for Search Console and GA4: PKCE and state validation, token
 * exchange against a local fake Google (never the real one), and the pure
 * reads (striking distance, zero-click pages, measurement health, property
 * suggestion).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readKeyring } from "../../lib/crypto/secrets.ts";
import { createAuthRequest, exchangeCode, googleEndpoints, GoogleAuthError, pkceChallenge, refreshAccessToken, revokeToken, SCOPES, verifyCallback, OAUTH_TTL_MS } from "../../lib/google/oauth.ts";
import { measurementHealth, strikingDistance, suggestGa4Property, suggestGscProperty, zeroClickPages } from "../../lib/google/analysis.ts";
import { FAKE_GOOGLE_CLIENT, startFakeGoogle } from "../helpers/fake-google.ts";

const ring = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64") });
const otherRing = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64") });
const base = { clientId: FAKE_GOOGLE_CLIENT.clientId, redirectUri: "http://127.0.0.1:3107/api/google/callback", ring, workspaceId: "w", slug: "lumoras", siteId: "s", userId: "u1" };

describe("Google OAuth: PKCE and state", () => {
  it("asks for one read-only scope, offline access, consent, S256 PKCE and a random state", () => {
    const a = createAuthRequest({ ...base, endpoints: googleEndpoints(null), kind: "search_console" });
    const u = new URL(a.url);
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    const p = u.searchParams;
    assert.equal(p.get("scope"), "https://www.googleapis.com/auth/webmasters.readonly");
    assert.equal(p.get("access_type"), "offline");
    assert.equal(p.get("prompt"), "consent");
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.equal(p.get("code_challenge"), pkceChallenge(a.state.verifier));
    assert.ok(a.state.verifier.length >= 43 && a.state.verifier.length <= 128);
    assert.equal(p.get("state"), a.state.state);
    assert.ok(!a.url.includes(a.state.verifier), "the verifier never travels in the URL");
    assert.ok(!a.cookie.includes(a.state.state) && !a.cookie.includes(a.state.verifier), "the cookie is sealed, not readable");
    assert.equal(createAuthRequest({ ...base, endpoints: googleEndpoints(null), kind: "ga4" }).state.state !== a.state.state, true);
    assert.equal(new URL(createAuthRequest({ ...base, endpoints: googleEndpoints(null), kind: "ga4" }).url).searchParams.get("scope"), SCOPES.ga4);
    for (const s of Object.values(SCOPES)) assert.match(s, /\.readonly$/);
  });

  it("accepts only the matching state, from the same user, within ten minutes, with an authentic cookie", () => {
    const now = Date.now();
    const a = createAuthRequest({ ...base, endpoints: googleEndpoints(null), kind: "search_console", now });
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    const ok = verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state, code: "4/abc" }), userId: "u1", ring, now: now + 1000 });
    assert.ok(ok.ok && ok.code === "4/abc" && ok.flow.verifier === a.state.verifier);
    const fail = (r: ReturnType<typeof verifyCallback>) => (r.ok ? "ok" : r.reason);
    assert.equal(fail(verifyCallback({ cookie: undefined, query: q({ state: a.state.state, code: "x" }), userId: "u1", ring })), "missing");
    const flipped = a.cookie.slice(0, -2) + (a.cookie.endsWith("A") ? "B" : "A") + a.cookie.slice(-1);
    assert.equal(fail(verifyCallback({ cookie: flipped, query: q({ state: a.state.state, code: "x" }), userId: "u1", ring })), "tampered");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state, code: "x" }), userId: "u1", ring: otherRing })), "tampered", "a cookie sealed under another key");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state, code: "x" }), userId: "u1", ring, now: now + OAUTH_TTL_MS + 1 })), "expired");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: "attacker-state", code: "x" }), userId: "u1", ring })), "state_mismatch", "a callback with a forged state was accepted");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ code: "x" }), userId: "u1", ring })), "state_mismatch", "no state at all");
    const other = createAuthRequest({ ...base, endpoints: googleEndpoints(null), kind: "search_console" });
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: other.state.state, code: "x" }), userId: "u1", ring })), "state_mismatch", "another flow's state");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state, code: "x" }), userId: "u2", ring })), "wrong_user");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state, code: "x" }), userId: null, ring })), "wrong_user");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state, error: "access_denied" }), userId: "u1", ring })), "denied");
    assert.equal(fail(verifyCallback({ cookie: a.cookie, query: q({ state: a.state.state }), userId: "u1", ring })), "no_code");
  });
});

describe("Google OAuth: token exchange against a fake Google", () => {
  let g: Awaited<ReturnType<typeof startFakeGoogle>>;
  before(async () => (g = await startFakeGoogle()));
  after(() => g.close());

  async function consent(kind: "search_console" | "ga4") {
    const endpoints = googleEndpoints(g.origin);
    const a = createAuthRequest({ ...base, endpoints, kind });
    const res = await fetch(a.url, { redirect: "manual" });
    const back = new URL(res.headers.get("location")!);
    return { a, endpoints, back };
  }

  it("exchanges the code with the verifier and gets a refresh token and the read-only scope", async () => {
    const { a, endpoints, back } = await consent("search_console");
    assert.equal(back.searchParams.get("state"), a.state.state);
    const t = await exchangeCode({ code: back.searchParams.get("code")!, verifier: a.state.verifier, redirectUri: base.redirectUri, client: FAKE_GOOGLE_CLIENT, endpoints, kind: "search_console" });
    assert.ok(t.refreshToken?.startsWith("1//fake-refresh-"));
    assert.deepEqual(t.scope, [SCOPES.search_console]);
    const r = await refreshAccessToken({ refreshToken: t.refreshToken!, client: FAKE_GOOGLE_CLIENT, endpoints });
    assert.ok(r.accessToken.startsWith("ya29.fake-"));
    assert.ok(await revokeToken({ token: t.refreshToken!, endpoints }));
    await assert.rejects(refreshAccessToken({ refreshToken: t.refreshToken!, client: FAKE_GOOGLE_CLIENT, endpoints }), (e: unknown) => e instanceof GoogleAuthError && e.code === "invalid_grant");
  });

  it("a code is useless without the right verifier, and works once", async () => {
    const { endpoints, back } = await consent("search_console");
    const code = back.searchParams.get("code")!;
    await assert.rejects(exchangeCode({ code, verifier: "x".repeat(64), redirectUri: base.redirectUri, client: FAKE_GOOGLE_CLIENT, endpoints, kind: "search_console" }), /invalid_grant/);
    await assert.rejects(exchangeCode({ code, verifier: "x".repeat(64), redirectUri: base.redirectUri, client: FAKE_GOOGLE_CLIENT, endpoints, kind: "search_console" }), /invalid_grant/, "single use");
  });

  it("refuses a grant without our scope or without a refresh token", async () => {
    g.state.grantedScopeOverride = "openid";
    let c = await consent("ga4");
    await assert.rejects(exchangeCode({ code: c.back.searchParams.get("code")!, verifier: c.a.state.verifier, redirectUri: base.redirectUri, client: FAKE_GOOGLE_CLIENT, endpoints: c.endpoints, kind: "ga4" }), /did not grant/);
    g.state.grantedScopeOverride = null;
    g.state.omitRefreshToken = true;
    c = await consent("ga4");
    await assert.rejects(exchangeCode({ code: c.back.searchParams.get("code")!, verifier: c.a.state.verifier, redirectUri: base.redirectUri, client: FAKE_GOOGLE_CLIENT, endpoints: c.endpoints, kind: "ga4" }), /refresh token/);
    g.state.omitRefreshToken = false;
  });
});

describe("Search Console and GA4 reads", () => {
  const row = (q: string, position: number, impressions: number, clicks = 0) => ({ keys: [q, `https://x.example/${q}`], position, impressions, clicks, ctr: clicks / impressions });

  it("striking distance is positions 4–20 with enough impressions, most impressions first", () => {
    const r = strikingDistance([row("a", 3.9, 999), row("b", 4, 50), row("c", 20, 70), row("d", 20.1, 900), row("e", 12, 5), row("f", 9.44, 300)]);
    assert.deepEqual(r.map((x) => [x.query, x.position]), [["f", 9.4], ["c", 20], ["b", 4]]);
  });

  it("finds pages with impressions and no clicks", () => {
    const r = zeroClickPages([
      { keys: ["/a"], clicks: 0, impressions: 400, ctr: 0, position: 12 },
      { keys: ["/b"], clicks: 3, impressions: 900, ctr: 0, position: 4 },
      { keys: ["/c"], clicks: 0, impressions: 10, ctr: 0, position: 30 },
    ]);
    assert.deepEqual(r.map((x) => x.page), ["/a"]);
  });

  it("measurement health: no data is an error, trailing zeros a warning", () => {
    const today = new Date("2026-10-09T12:00:00Z");
    const day = (n: number) => new Date(Date.UTC(2026, 9, 9 - n)).toISOString().slice(0, 10).replace(/-/g, "");
    assert.equal(measurementHealth([], today).state, "error");
    const steady = Array.from({ length: 14 }, (_, i) => ({ date: day(i + 1), sessions: 40 }));
    assert.equal(measurementHealth(steady, today).state, "ok");
    const broke = steady.map((d, i) => ({ ...d, sessions: i < 3 ? 0 : 40 }));
    const h = measurementHealth(broke, today);
    assert.equal(h.state, "warn");
    assert.equal(h.lastDataDay, "2026-10-05");
    assert.equal(measurementHealth(steady.map((d, i) => ({ ...d, sessions: i === 0 ? 0 : 40 })), today).state, "ok", "one quiet day is not a broken tag");
  });

  it("suggests the property that belongs to the site", () => {
    const gsc = [
      { siteUrl: "https://www.sonorch.ai/", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:sonorch.ai", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:seasonx.ai", permissionLevel: "siteUnverifiedUser" },
    ];
    assert.equal(suggestGscProperty(gsc, "sonorch.ai"), "sc-domain:sonorch.ai");
    assert.equal(suggestGscProperty(gsc, "seasonx.ai"), null, "unverified properties are not offered");
    const ga = [{ property: "properties/1", displayName: "sonorch.ai - GA4", account: "A" }, { property: "properties/2", displayName: "Lumoras", account: "A" }];
    assert.equal(suggestGa4Property(ga, "sonorch.ai", "Sonorch"), "properties/1");
    assert.equal(suggestGa4Property(ga, "lumoras.ai", "Lumoras"), "properties/2");
    assert.equal(suggestGa4Property(ga, "x.example", "X"), null);
    assert.equal(suggestGa4Property([ga[0]], "x.example", "X"), "properties/1", "the only property");
  });
});
