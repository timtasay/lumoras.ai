/**
 * "Never the Indexing API" (build prompt section 4), as two guards:
 *   1. at run time: every Google request passes assertGoogleUrl() (an
 *      allowlist of endpoints); an Indexing API address is refused before
 *      fetch is ever called;
 *   2. in the source: no file the app ships (lib, app, components, worker,
 *      scripts, proxy) names an Indexing API address, method or scope.
 * Red run: add `const x = "https://indexing.googleapis.com/v3/urlNotifications:publish"`
 * to lib/google/api.ts and this suite fails naming the file and line.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { assertGoogleUrl, FORBIDDEN_GOOGLE, GOOGLE_ALLOWLIST, GoogleEndpointRefused } from "../../lib/google/allowlist.ts";
import { googleEndpoints } from "../../lib/google/oauth.ts";
import { gscInspectUrl, gscSearchAnalytics, ga4RunReport } from "../../lib/google/api.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const INDEXING = [/indexing\.googleapis\.com/i, /urlNotifications/i, /auth\/indexing\b/i];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|mjs|js|sql|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("never the Indexing API", () => {
  it("every production Google endpoint is on the allowlist", () => {
    const e = googleEndpoints(null);
    for (const [name, url] of Object.entries(e)) {
      if (name === "test") continue;
      const u = assertGoogleUrl(name === "gsc" ? `${url}/sites` : name === "admin" ? `${url}/accountSummaries` : name === "data" ? `${url}/properties/123:runReport` : (url as string));
      assert.equal(u.protocol, "https:", name);
    }
    assert.ok(GOOGLE_ALLOWLIST.every((a) => !INDEXING.some((r) => r.test(a.host) || r.test(String(a.path)))), "the allowlist names the Indexing API");
  });

  it("an Indexing API address, method or scope is refused, in production and on a test origin", () => {
    const bad = [
      "https://indexing.googleapis.com/v3/urlNotifications:publish",
      "https://indexing.googleapis.com/v3/urlNotifications/metadata?url=https%3A%2F%2Fsonorch.ai%2F",
      "https://www.googleapis.com/webmasters/v3/urlNotifications:publish",
      "https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Findexing",
      "https://example.com/token",
      "http://oauth2.googleapis.com/token",
    ];
    for (const u of bad) assert.throws(() => assertGoogleUrl(u), GoogleEndpointRefused, u);
    assert.throws(() => assertGoogleUrl("http://127.0.0.1:4573/v3/urlNotifications:publish", "http://127.0.0.1:4573"), GoogleEndpointRefused);
    assert.ok(assertGoogleUrl("http://127.0.0.1:4573/v1/urlInspection/index:inspect", "http://127.0.0.1:4573"));
    assert.ok(FORBIDDEN_GOOGLE.length >= 3);
  });

  it("the client refuses before fetch is called", async () => {
    let called = 0;
    const f = (async () => {
      called++;
      return new Response("{}");
    }) as typeof fetch;
    const e = { ...googleEndpoints(null), inspect: "https://indexing.googleapis.com/v3/urlNotifications:publish", gsc: "https://indexing.googleapis.com/v3" };
    await assert.rejects(gscInspectUrl(e, "t", "sc-domain:x.example", "https://x.example/", f), GoogleEndpointRefused);
    await assert.rejects(gscSearchAnalytics(e, "t", "sc-domain:x.example", { startDate: "2026-10-01", endDate: "2026-10-02", dimensions: ["date"] }, f), GoogleEndpointRefused);
    await assert.rejects(ga4RunReport({ ...e, data: "https://indexing.googleapis.com/v3" }, "t", "properties/1", { dimensions: ["date"], metrics: ["sessions"], startDate: "2026-10-01", endDate: "2026-10-02" }, f), GoogleEndpointRefused);
    assert.equal(called, 0, "a refused URL reached fetch");
  });

  it("no shipped source file names the Indexing API", () => {
    const roots = ["lib", "app", "components", "worker", "scripts", "migrations", "proxy.ts"].map((d) => path.join(ROOT, d));
    const hits: string[] = [];
    for (const r of roots) {
      for (const file of statSync(r).isDirectory() ? files(r) : [r]) {
        if (file.endsWith(path.join("lib", "google", "allowlist.ts"))) continue; // names it only to refuse it
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (INDEXING.some((x) => x.test(line))) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
    }
    assert.deepEqual(hits, [], `the Indexing API appears in the source:\n${hits.join("\n")}`);
  });
});
