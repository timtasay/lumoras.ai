/**
 * Owner decisions of 10 October 2026, on a real PostgreSQL with the app role:
 *
 *   1. Organization bylines: authors.kind is person | organization (default
 *      person), the database refuses any other kind and an organization with
 *      a title; a person publishes as schema.org Person, an organization as
 *      Organization, through the real webhook publisher.
 *   3. Hosted OpenSEO through the ONE metered path, against a local fake of
 *      the hosted service (API key required, whoami credits, per-call
 *      credits): the key is sent, the credits OpenSEO reports are what the
 *      ledger charges (labelled), the site's project is used, and the cache
 *      and the reserve still hold (a refused or cached call never reaches
 *      OpenSEO).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { createAuthor, getSiteSettings, listAuthors } from "../../lib/data/sites.ts";
import { listLedger, setBudget } from "../../lib/data/research.ts";
import { BudgetRefusedError, forgetBalances, meteredCall, type MeterContext } from "../../lib/metering/metered.ts";
import { OpenSeoProvider } from "../../lib/providers/openseo.ts";
import type { Market } from "../../lib/providers/types.ts";
import { lintArticle } from "../../lib/content/lint.ts";
import { articleJsonLd, toByline } from "../../lib/publishers/byline.ts";
import { WebhookPublisher } from "../../lib/publishers/webhook.ts";
import type { PublishableArticle } from "../../lib/publishers/types.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { FAKE_HOSTED_CHARGES, startFakeOpenSeo } from "../helpers/fake-openseo.ts";
import { startFakeWebhook } from "../helpers/fake-webhook.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

const US: Market = { locationCode: 2840, languageCode: "en", label: "United States" };
const KEY = "oseo_integration_key_0123";
const HOOK_SECRET = "owner-decisions-webhook-secret-0123456789";

describe("owner decisions (10 October 2026)", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let A: TestWorkspace;
  const ctx = (): MeterContext => ({ workspaceId: A.ws, actorId: A.user, siteId: A.site });
  const asA = <T>(fn: Parameters<typeof withWorkspace<T>>[2]) => withWorkspace(pool, ctx(), fn);

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    pool.on("error", () => {});
    A = await makeWorkspace(pool, "decisions", "decisions.example");
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  // ------------------------------------------------------------------ 1. bylines
  it("authors.kind: person by default, organization allowed, anything else refused; an organization carries no title", async () => {
    const [person, org] = await asA(async (tx) => [
      await createAuthor(tx, A.ws, A.site, { name: "Ada Real", role: "Head of support", bio: "", avatarUrl: null }),
      await createAuthor(tx, A.ws, A.site, { kind: "organization", name: "Decisions team", role: "", bio: "The team.", avatarUrl: null }),
    ]);
    assert.equal(person.kind, "person", "existing and new authors default to person");
    assert.equal(org.kind, "organization");
    // the database itself refuses a third kind and a titled organization (not just the form)
    await assert.rejects(
      asA((tx) => tx.exec("INSERT INTO authors (workspace_id, site_id, kind, name) VALUES ($1, $2, 'robot', 'Generated author')", [A.ws, A.site])),
      (e: unknown) => (e as { code?: string }).code === "23514",
      "a kind other than person/organization was stored",
    );
    await assert.rejects(
      asA((tx) => tx.exec("UPDATE authors SET role = 'Chief Content Officer' WHERE id = $1", [org.id])),
      (e: unknown) => (e as { constraint?: string }).constraint === "authors_organization_has_no_title",
      "an organization byline was given a job title",
    );
    // the kind is audited like every other author change
    const audit = await adminQuery<{ n: string }>("SELECT count(*) n FROM audit_log WHERE entity_type = 'authors' AND after->>'kind' = 'organization'", [], db.name);
    assert.equal(Number(audit[0].n), 1);
  });

  it("lint rule 10 accepts both kinds of configured byline", async () => {
    const authors = await asA((tx) => listAuthors(tx, A.site));
    for (const a of authors) {
      const r = lintArticle({
        itemId: "x",
        title: "t",
        description: "d",
        bodyMd: "",
        slug: "t",
        primaryKeyword: "k",
        authorId: a.id,
        cover: {},
        publishDate: "2026-10-13",
        rules: (await import("../../lib/validation.ts")).DEFAULT_SEO_RULES,
        bannedWords: [],
        siteDomain: A.domain,
        authors,
        routes: [],
        pages: [],
        linkChecks: new Map(),
        existingTargets: [],
      } as Parameters<typeof lintArticle>[0]).find((x) => x.rule === "author")!;
      assert.equal(r.status, "pass", `${a.kind} byline: ${r.detail}`);
    }
  });

  it("a person publishes as schema.org Person, an organization as Organization (real webhook publisher → fake receiver)", async () => {
    const hook = await startFakeWebhook(HOOK_SECRET, { hostName: "hooks.test" });
    try {
      const site = await asA((tx) => getSiteSettings(tx, A.site));
      const authors = await asA((tx) => listAuthors(tx, A.site));
      const article = (author: (typeof authors)[number]): PublishableArticle => ({
        id: "00000000-0000-4000-8000-000000000001",
        slug: "a-clear-policy",
        title: "A clear policy",
        description: "d",
        bodyMd: "Answer first.\n\n## Why\n\nBecause.",
        date: "2026-10-13",
        keyword: "clear policy",
        secondaryKeywords: [],
        tags: [],
        cluster: "",
        readingMinutes: 1,
        words: 4,
        cover: { kind: "checklist", chips: [] },
        author: toByline(author),
        path: "/blog/a-clear-policy",
        url: `https://${site.domain}/blog/a-clear-policy`,
        sources: [],
        version: 1,
        updated: "2026-10-13",
      });
      const pub = new WebhookPublisher({ endpoint: `${hook.origin}/hook` }, HOOK_SECRET, { domain: site.domain }, { policy: { testResolve: new Map([["hooks.test", "127.0.0.1"]]) } });
      for (const a of authors) await pub.publish(article(a));
      const got = hook.deliveries.map((d) => (d.json as { article: { author: { kind: string; type: string; role: string }; structuredData: { author: Record<string, unknown> } } }).article);
      assert.ok(hook.deliveries.every((d) => d.verdict.ok), "signed deliveries");
      const person = got.find((g) => g.author.kind === "person")!;
      const org = got.find((g) => g.author.kind === "organization")!;
      assert.deepEqual(person.structuredData.author, { "@type": "Person", name: "Ada Real", jobTitle: "Head of support" });
      assert.equal(person.author.type, "Person");
      assert.deepEqual(org.structuredData.author, { "@type": "Organization", name: "Decisions team", url: "https://decisions.example/" });
      assert.equal(org.author.type, "Organization");
      assert.equal(org.author.role, "", "an organization byline never carries a title");
      assert.equal(articleJsonLd(article(authors[1]), site)["@type"], "BlogPosting");
    } finally {
      await hook.close();
    }
  });

  // ------------------------------------------------------------------ 3. hosted OpenSEO
  it("hosted OpenSEO through the metered path: key sent, reported credits charged and labelled, the site's project used", async () => {
    const mcp = await startFakeOpenSeo({ hosted: { apiKey: KEY, credits: 5_000 } });
    try {
      const provider = new OpenSeoProvider({ url: mcp.url, mode: "hosted", token: KEY });
      await asA(async (tx) => {
        await setBudget(tx, A.ws, "seo_credits", 10_000_000, 1_000_000);
        await tx.exec("UPDATE sites SET openseo_project_id = 'proj-decisions' WHERE id = $1", [A.site]);
      });
      const op = { op: "serp" as const, params: { keyword: "salon pos", market: US, depth: 20 } };
      const r = await meteredCall({ db: pool, provider }, ctx(), op);
      assert.equal(r.status, "ok");
      assert.equal(r.costMicros, FAKE_HOSTED_CHARGES.get_serp_results * 1000, "the credits OpenSEO reported (5 = $0.005)");
      const call = mcp.calls.find((c) => c.name === "get_serp_results")!;
      assert.equal(call.headers.authorization, `Bearer ${KEY}`);
      assert.equal(call.args!.projectId, "proj-decisions", "the site's OpenSEO project");
      assert.ok(!mcp.calls.some((c) => c.name === "list_projects" || c.name === "create_project"), "no project was listed or created");
      const [l] = await asA((tx) => listLedger(tx, { limit: 5 }));
      assert.equal(l.provider, "openseo");
      assert.equal(Number(l.cost_micros), 5_000);
      assert.match(l.detail ?? "", /^provider-reported: OpenSEO charged 5 credits/);

      // the cache still holds: the repeat is free and never reaches OpenSEO
      const before = mcp.calls.length;
      const again = await meteredCall({ db: pool, provider }, ctx(), op);
      assert.equal(again.status, "cached");
      assert.equal(again.costMicros, 0);
      assert.equal(mcp.calls.length, before, "a cached call reached OpenSEO");

      // the reserve still holds: below it, the call is refused before OpenSEO is asked
      await asA((tx) => setBudget(tx, A.ws, "seo_credits", 1_000_000, 999_000));
      forgetBalances(provider);
      const n = mcp.calls.filter((c) => c.name === "research_keywords").length;
      await assert.rejects(meteredCall({ db: pool, provider }, ctx(), { op: "keywordIdeas", params: { seed: "salon pos", market: US, limit: 150 } }), BudgetRefusedError);
      assert.equal(mcp.calls.filter((c) => c.name === "research_keywords").length, n, "a refused call reached OpenSEO");
    } finally {
      await mcp.close();
    }
  });

  it("hosted OpenSEO without per-call credits: the estimate (list × 1.28) is charged and the ledger says so", async () => {
    const mcp = await startFakeOpenSeo({ hosted: { apiKey: KEY, credits: 5_000, reportCredits: false } });
    try {
      const provider = new OpenSeoProvider({ url: mcp.url, mode: "hosted", token: KEY });
      await asA((tx) => setBudget(tx, A.ws, "seo_credits", 10_000_000, 1_000_000));
      const r = await meteredCall({ db: pool, provider }, ctx(), { op: "domainOverview", params: { domain: "decisions.example", market: US } });
      assert.equal(r.costMicros, r.estimateMicros);
      const [l] = await asA((tx) => listLedger(tx, { limit: 1 }));
      assert.match(l.detail ?? "", /^estimate: OpenSEO did not report this call's credits/);
    } finally {
      await mcp.close();
    }
  });
});
