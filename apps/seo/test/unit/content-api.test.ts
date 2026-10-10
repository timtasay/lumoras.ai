/**
 * "Lumoras Growth serves it" (docs/content-api.md): the post the endpoint
 * serves, checked against the sites' post rules before anything is stored;
 * the publisher contacts nothing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContentApiPublisher, POST_MOTIFS, postsFeedUrl, readContentApiConfig, servedPost } from "../../lib/publishers/content-api.ts";
import { PublishError, type PublishableArticle } from "../../lib/publishers/types.ts";
import { connectionInput } from "../../lib/validation.ts";
import { SONORCH_GIT } from "../../lib/publishers/presets.ts";

const article = (over: Partial<PublishableArticle> = {}): PublishableArticle => ({
  id: "0b6c7a3e-0000-4000-8000-000000000003",
  slug: "salon-deposit-policy",
  title: "How to write a salon deposit policy clients accept",
  description: "Deposits stop no-shows only if clients accept them. What to charge and when to refund.",
  bodyMd: "Deposits work when they are small and clear.\n\n## What to charge\n\nTwenty-five dollars <b>or</b> {x}.\n\n```txt\n# not a heading\n```",
  date: "2026-10-14",
  keyword: "salon deposit policy",
  secondaryKeywords: [],
  tags: [],
  cluster: "Front desk",
  readingMinutes: 4,
  words: 700,
  cover: { kind: "card", chips: ["Deposit · $25", "Refund · 48h notice"] },
  author: { kind: "person", name: "Tran", role: "", type: "Person" },
  path: "/insights/salon-deposit-policy",
  url: "https://sonorch.ai/insights/salon-deposit-policy",
  sources: [],
  version: 1,
  updated: "2026-10-16",
  ...over,
});
const cfg = { livePath: "/insights/{{slug}}", authorKeys: SONORCH_GIT.authorKeys };

describe("servedPost: the post as the site will show it", () => {
  it("has the contract's fields in order, the author key, the motif, and the Markdown body as written", () => {
    const p = servedPost(article(), cfg);
    assert.deepEqual(Object.keys(p), ["slug", "title", "description", "publishedAt", "author", "readingMinutes", "cover", "body"]);
    assert.equal(p.author, "tran");
    assert.deepEqual(p.cover, { motif: "card", chips: ["Deposit · $25", "Refund · 48h notice"] });
    assert.equal(p.publishedAt, "2026-10-14");
    assert.match(p.body, /<b>or<\/b> \{x\}/, "plain Markdown: the site renders it with raw HTML off, so nothing is escaped");
  });
  it("updatedAt only on a refresh, and only after publishedAt", () => {
    assert.equal(servedPost(article(), cfg).updatedAt, undefined);
    assert.equal(servedPost(article(), cfg, { refresh: true }).updatedAt, "2026-10-16");
    assert.equal(servedPost(article({ updated: "2026-10-14" }), cfg, { refresh: true }).updatedAt, undefined);
    assert.equal(servedPost(article({ updated: "2026-10-01" }), cfg, { refresh: true }).updatedAt, undefined);
  });
  it("refuses every rule it breaks, all at once", () => {
    const bad = article({
      slug: "Bad Slug",
      title: " padded ",
      description: "two\nlines",
      date: "2026-02-30",
      readingMinutes: 0,
      cover: { kind: "rocket", chips: ["a", "b", "c", "this chip is far too long for the cover"] },
      bodyMd: "# A headline\n\nText.",
      author: { kind: "person", name: "Demo author", role: "", type: "Person" },
    });
    assert.throws(
      () => servedPost(bad, cfg),
      (e: unknown) => {
        const m = (e as Error).message;
        return (
          e instanceof PublishError &&
          /slug "Bad Slug"/.test(m) &&
          /title has leading or trailing spaces/.test(m) &&
          /description has a line break/.test(m) &&
          /date "2026-02-30" is not a real/.test(m) &&
          /reading time/.test(m) &&
          /cover "rocket" is not one of calendar/.test(m) &&
          /1 to 3 chips, not 4/.test(m) &&
          /over 26 characters/.test(m) &&
          /level-1 heading/.test(m) &&
          /No author key for "Demo author"/.test(m)
        );
      },
    );
  });
  it("a # inside a code block is not a heading", () => {
    assert.doesNotThrow(() => servedPost(article(), cfg));
  });
  it("the motifs are the sites' eight", () => {
    assert.deepEqual([...POST_MOTIFS], SONORCH_GIT.seoRules?.coverKinds);
  });
});

describe("ContentApiPublisher", () => {
  it("publish returns the snapshot and contacts nothing; Test lists author keys and where the site reads", async () => {
    const p = new ContentApiPublisher(cfg, postsFeedUrl("https://growth.lumoras.ai/", "a".repeat(64)));
    const r = await p.publish(article());
    assert.equal(r.status, "published");
    assert.equal(r.mode, "api");
    assert.equal(r.remoteId, "salon-deposit-policy");
    assert.equal(r.liveUrl, "https://sonorch.ai/insights/salon-deposit-policy");
    assert.deepEqual(r.payload, servedPost(article(), cfg) as unknown as Record<string, unknown>);
    const v = await p.validate();
    assert.equal(v.ok, true);
    assert.match(v.checks[1].detail, /^https:\/\/growth\.lumoras\.ai\/api\/feeds\/a{64}\/posts\.json/);
    const none = await new ContentApiPublisher({ livePath: "/insights/{{slug}}", authorKeys: {} }).validate();
    assert.equal(none.ok, false);
    await assert.rejects(new ContentApiPublisher({ livePath: "/x/{{slug}}", authorKeys: {} }).publish(article()), /No author key for "Tran"/);
  });
  it("the connection form: author keys as lines, a default live path, no credential", () => {
    const c = connectionInput.parse({ kind: "content_api", label: "Lumoras Growth", authorKeys: "Tran = tran\nTim = tim" });
    assert.deepEqual(c, { kind: "content_api", label: "Lumoras Growth", livePath: "/insights/{{slug}}", authorKeys: { Tran: "tran", Tim: "tim" } });
    assert.deepEqual(readContentApiConfig({ authorKeys: { A: "a", B: 2 } }), { livePath: "/insights/{{slug}}", authorKeys: { A: "a" } });
  });
});
