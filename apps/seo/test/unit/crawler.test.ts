/**
 * The sitemap crawler against a local fake site, through the real SSRF guard
 * (the fake domain is pinned to loopback with the test-origins hook, exactly as
 * CRAWLER_TEST_ORIGINS does in e2e). Plus the parsers and the brand pre-fill.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { crawlSite, isSameSite, pickKeyPages, type CrawlEvent } from "../../lib/crawl/crawler.ts";
import { extractPageMeta, parseSitemap, sitemapsFromRobots } from "../../lib/crawl/parse.ts";
import { brandPrefill } from "../../lib/crawl/prefill.ts";
import { startFakeSite, type FakeSite } from "../helpers/fake-site.ts";

describe("parsers", () => {
  it("reads Sitemap: lines from robots.txt, case-insensitively, absolute http(s) only", () => {
    assert.deepEqual(
      sitemapsFromRobots("User-agent: *\nsitemap: https://a.example/s1.xml\nSITEMAP:https://a.example/s2.xml\nSitemap: /relative.xml\nSitemap: ftp://x/y\n"),
      ["https://a.example/s1.xml", "https://a.example/s2.xml"],
    );
  });
  it("parses urlsets with namespaces, CDATA, entities and lastmod", () => {
    const p = parseSitemap(`<?xml version="1.0"?><ns:urlset xmlns:ns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <ns:url><ns:loc> https://a.example/x?a=1&amp;b=2 </ns:loc><ns:lastmod>2026-10-01</ns:lastmod></ns:url>
      <ns:url><ns:loc><![CDATA[https://a.example/y]]></ns:loc><ns:lastmod>not a date</ns:lastmod></ns:url></ns:urlset>`);
    assert.equal(p.kind, "urlset");
    if (p.kind !== "urlset") return;
    assert.deepEqual(p.urls.map((u) => u.loc), ["https://a.example/x?a=1&b=2", "https://a.example/y"]);
    assert.equal(p.urls[0].lastmod?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(p.urls[1].lastmod, null);
  });
  it("parses sitemap indexes and caps entries", () => {
    const xml = `<sitemapindex>${Array.from({ length: 10 }, (_, i) => `<sitemap><loc>https://a.example/s${i}.xml</loc></sitemap>`).join("")}</sitemapindex>`;
    const p = parseSitemap(xml, 3);
    assert.deepEqual(p, { kind: "index", sitemaps: ["https://a.example/s0.xml", "https://a.example/s1.xml", "https://a.example/s2.xml"], truncated: true });
    assert.deepEqual(parseSitemap("<html>nope</html>"), { kind: "unknown" });
  });
  it("extracts title, description, og:site_name and h1 (attributes in any order, entities decoded)", () => {
    const m = extractPageMeta(`<html><head><title> Fish &amp; Chips
      | Harbour </title><meta content='Fresh "fish" daily.' name="Description"><meta property="og:site_name" content="Harbour"></head>
      <body><h1>Best <em>fish</em> in town</h1></body></html>`);
    assert.deepEqual(m, { title: "Fish & Chips | Harbour", description: 'Fresh "fish" daily.', siteName: "Harbour", h1: "Best fish in town" });
    assert.deepEqual(extractPageMeta("garbage"), { title: null, description: null, siteName: null, h1: null });
  });
  it("same-site means the domain or its www. twin over http(s)", () => {
    assert.ok(isSameSite(new URL("https://www.a.example/x"), "a.example"));
    assert.ok(isSameSite(new URL("https://a.example/x"), "www.a.example"));
    assert.ok(!isSameSite(new URL("https://b.example/x"), "a.example"));
    assert.ok(!isSameSite(new URL("https://a.example.evil.example/x"), "a.example"));
  });
  it("picks the homepage, then known pages, then the shallowest", () => {
    const r = ["/blog/a/b", "/pricing", "/", "/zzz", "/about"].map((path) => ({ url: `https://a.example${path}`, path }));
    assert.deepEqual(pickKeyPages(r, 4).map((x) => x.path), ["/", "/about", "/pricing", "/zzz"]);
  });
});

describe("crawlSite against a fake site", () => {
  let site: FakeSite;
  before(async () => {
    site = await startFakeSite("northwind-dental.test");
  });
  after(() => site.close());

  const opts = () => ({
    origin: site.origin,
    fetch: { policy: { testResolve: new Map([["northwind-dental.test", "127.0.0.1"]]) } },
  });

  it("follows robots.txt → index → plain and gzipped sitemaps, keeps only on-site URLs, reads key pages", async () => {
    const events: CrawlEvent[] = [];
    const r = await crawlSite("northwind-dental.test", { ...opts(), onEvent: (e) => events.push(e) });
    assert.equal(r.status, "ok", JSON.stringify(r.problems));
    assert.deepEqual(r.sitemaps, [`${site.origin}/sitemap_index.xml`, `${site.origin}/sitemap-pages.xml`, `${site.origin}/sitemap-blog.xml.gz`]);
    assert.deepEqual(
      r.routes.map((x) => x.path).sort(),
      ["/", "/about", "/blog/how-often-should-you-floss", "/pricing", "/services/cleanings", "/services/cleanings", "/services/invisalign"].sort(),
    );
    assert.ok(!r.routes.some((x) => x.url.includes("elsewhere.example")), "off-site URL kept");
    assert.equal(r.routes.find((x) => x.path === "/blog/how-often-should-you-floss")?.lastmod?.toISOString(), "2026-10-01T09:00:00.000Z");
    const home = r.pages.find((p) => p.path === "/");
    assert.equal(home?.title, "Northwind Dental · Family dentistry in Seattle");
    assert.ok(r.pages.length >= 4);
    assert.deepEqual(events.map((e) => e.type).filter((t, i, a) => a.indexOf(t) === i), ["start", "robots", "sitemap", "routes", "page", "done"]);
  });

  it("falls back to /sitemap.xml without robots.txt, and fails cleanly on an empty site", async () => {
    const r = await crawlSite("northwind-dental.test", { ...opts(), origin: `${site.origin}/nothing-here` });
    assert.equal(r.status, "failed");
    assert.ok(r.problems.some((p) => p.url.endsWith("/sitemap.xml") && /HTTP 404/.test(p.message)));
  });

  it("refuses a domain that resolves to a private address (no test pin)", async () => {
    const r = await crawlSite("northwind-dental.test", { origin: site.origin, fetch: { resolve: async () => [{ address: "10.0.0.8", family: 4 }] } });
    assert.equal(r.status, "failed");
    assert.match(r.problems[0].message, /10\.0\.0\.8 \(private network\)/);
  });

  it("pre-fills the brand profile from the homepage without inventing anything", async () => {
    const r = await crawlSite("northwind-dental.test", opts());
    const p = brandPrefill(r.pages);
    assert.equal(p.overview, "Family and cosmetic dentistry in Seattle: cleanings, fillings, crowns and Invisalign, with evening appointments and same-week emergency visits.");
    assert.equal(p.positioning, "Gentle dentistry for the whole family");
    assert.equal(p.siteName, "Northwind Dental");
    assert.ok(p.keyPages.every((k) => k.url.startsWith(site.origin)));
  });
});
