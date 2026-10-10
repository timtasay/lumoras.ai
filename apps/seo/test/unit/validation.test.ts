import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorInput, brandInput, connectionInput, DEFAULT_SEO_RULES, normalizeDomain, siteInput, slugify, fieldErrors } from "../../lib/validation.ts";

describe("normalizeDomain", () => {
  it("accepts what people paste and returns the bare host", () => {
    assert.equal(normalizeDomain("https://www.Sonorch.ai/pricing?x=1"), "sonorch.ai");
    assert.equal(normalizeDomain("seasonx.ai"), "seasonx.ai");
    assert.equal(normalizeDomain("  lumoras.ai.  "), "lumoras.ai");
    assert.equal(normalizeDomain("http://shop.example.co.uk:8080/"), "shop.example.co.uk");
    assert.equal(normalizeDomain("bücher.example"), "xn--bcher-kva.example");
  });
  it("refuses IPs, single labels, internal names and junk", () => {
    for (const bad of ["127.0.0.1", "http://[::1]/", "localhost", "intranet", "printer.local", "db.internal", "nas.lan", "a b.com", "", "x".repeat(400), "-bad-.com", "1.1.1.1"]) {
      assert.equal(normalizeDomain(bad), null, bad);
    }
  });
  it("slugify", () => {
    assert.equal(slugify("Northwind Dental, Inc."), "northwind-dental-inc");
    assert.equal(slugify("Café Ünïcode"), "cafe-unicode");
  });
});

describe("schemas", () => {
  it("site: normalises the domain and validates the time zone", () => {
    const s = siteInput.parse({ domain: "https://www.northwind-dental.test/", name: "Northwind", timezone: "America/Los_Angeles" });
    assert.equal(s.domain, "northwind-dental.test");
    assert.equal(s.country, "US");
    const bad = siteInput.safeParse({ domain: "localhost", name: "", timezone: "Mars/Olympus" });
    assert.ok(!bad.success);
    assert.deepEqual(Object.keys(fieldErrors(bad.error)).sort(), ["domain", "name", "timezone"]);
  });
  it("brand: list fields from lines, competitors as domains, seo rule ranges", () => {
    const b = brandInput.parse({
      sells: "Cleanings\nInvisalign\nCleanings\n",
      doesNotSell: "",
      competitors: "https://www.rival.example/\nrival.example",
      productFacts: "",
      forbiddenClaims: "",
      voiceRules: "No emoji",
      seoRules: { ...DEFAULT_SEO_RULES },
      bannedWords: "Revolutionary, seamless\nseamless",
      exampleArticles: "https://northwind.example/blog/a",
    });
    assert.deepEqual(b.sells, ["Cleanings", "Invisalign"]);
    assert.deepEqual(b.competitors, ["rival.example"]);
    assert.deepEqual(b.bannedWords, ["revolutionary", "seamless"]);
    const bad = brandInput.safeParse({ competitors: "not a domain", seoRules: { ...DEFAULT_SEO_RULES, descriptionMin: 200, descriptionMax: 150 }, exampleArticles: "javascript:alert(1)" });
    assert.ok(!bad.success);
    const keys = Object.keys(fieldErrors(bad.error));
    assert.ok(keys.includes("competitors") && keys.includes("seoRules.descriptionMin") && keys.includes("exampleArticles.0"), keys.join());
  });
  it("authors: real-person fields only, https avatars", () => {
    assert.deepEqual(authorInput.parse({ name: " Dr. Ana Ruiz ", role: "Dentist", bio: "", avatarUrl: "" }), { kind: "person", name: "Dr. Ana Ruiz", role: "Dentist", bio: "", avatarUrl: null });
    assert.ok(!authorInput.safeParse({ name: "x", avatarUrl: "http://insecure.example/a.png" }).success);
    assert.ok(!authorInput.safeParse({ name: "" }).success);
  });
  it("authors: an organization byline (owner decision, 10 October 2026) has no title; other kinds are refused", () => {
    assert.deepEqual(authorInput.parse({ kind: "organization", name: "Lumoras team", bio: "The team." }), { kind: "organization", name: "Lumoras team", role: "", bio: "The team.", avatarUrl: null });
    const titled = authorInput.safeParse({ kind: "organization", name: "Lumoras team", role: "Head of content" });
    assert.ok(!titled.success);
    assert.match(fieldErrors(titled.error).role, /no job title or credentials/);
    assert.ok(!authorInput.safeParse({ kind: "robot", name: "x" }).success);
  });
  it("connections: secrets are required and endpoints must be https", () => {
    assert.ok(connectionInput.safeParse({ kind: "webhook", label: "Hook", endpoint: "https://a.example/hook", secret: "s".repeat(16) }).success);
    assert.ok(!connectionInput.safeParse({ kind: "webhook", label: "Hook", endpoint: "http://a.example/hook", secret: "s".repeat(16) }).success);
    // a Git connection may be saved before its token exists ("token needed"); a pasted token must be whole
    assert.ok(connectionInput.safeParse({ kind: "git", label: "Repo", repository: "https://github.com/x/y", secret: "" }).success);
    assert.ok(!connectionInput.safeParse({ kind: "git", label: "Repo", repository: "https://github.com/x/y", secret: "short" }).success);
    assert.ok(!connectionInput.safeParse({ kind: "webhook", label: "Hook", endpoint: "https://a.example/hook", secret: "" }).success);
    assert.ok(!connectionInput.safeParse({ kind: "git", label: "Repo", repository: "https://github.com/x/y", branch: "../main" }).success, "no .. in a branch name");
    assert.equal((connectionInput.parse({ kind: "git", label: "Repo", repository: "https://github.com/timtasay/lumoras.ai", branch: "dev" }) as { branch: string }).branch, "dev");
  });
});
