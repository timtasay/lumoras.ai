/**
 * Every publisher's output format (section 8) against local fakes, never the
 * real services:
 *   - frontmatter: lumoras.ai's content-spec template (art.kind, art.chips),
 *     values written as quoted YAML so an article cannot inject keys;
 *   - Git file-per-post on a fake GitHub and a fake Gitea: PR mode (branch,
 *     file, pull request, idempotent retry), commit mode, update, unpublish,
 *     status after merge, the Test button, a bad token;
 *   - the signed webhook: HMAC-SHA256 over "<timestamp>.<raw body>", a
 *     five-minute replay window, constant-time compare; the receiver rejects
 *     a stale, tampered or unsigned delivery;
 *   - the JSON Feed and RSS renderers.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import matter from "gray-matter";
import { joinPath, LUMORAS_INSIGHTS_TEMPLATE, DEFAULT_TEMPLATE, renderFilename, renderFrontmatter, renderPostFile, unknownPlaceholders, yamlValue } from "../../lib/publishers/frontmatter.ts";
import { apiBaseFor, GitPublisher, GITHUB_API_VERSION, parseRepository, readGitConfig, type GitConfig } from "../../lib/publishers/git.ts";
import { signWebhook, verifyWebhook, WebhookPublisher, REPLAY_WINDOW_SEC } from "../../lib/publishers/webhook.ts";
import { jsonFeed, rssFeed, xmlEscape } from "../../lib/publishers/feed.ts";
import { PublishError, type PublishableArticle } from "../../lib/publishers/types.ts";
import { articleJsonLd, authorJsonLd, toByline } from "../../lib/publishers/byline.ts";
import { prBody } from "../../lib/publishers/git.ts";
import { webhookPayload } from "../../lib/publishers/webhook.ts";
import { missingCredentialValidation, tokenInstructions } from "../../lib/publishers/registry.ts";
import { LUMORAS_GIT } from "../../lib/publishers/lumoras.ts";
import { startFakeGit, type FakeGit } from "../helpers/fake-git.ts";
import { startFakeWebhook, type FakeWebhook } from "../helpers/fake-webhook.ts";

const POLICY = { policy: { testResolve: new Map([["github.test", "127.0.0.1"], ["gitea.test", "127.0.0.1"], ["webhook.test", "127.0.0.1"]]) } };

const article = (over: Partial<PublishableArticle> = {}): PublishableArticle => ({
  id: "0b6c7a3e-0000-4000-8000-000000000001",
  slug: "ai-receptionist-for-small-business",
  title: 'AI Receptionist for Small Business: What "It" Handles',
  description: "What an AI receptionist handles: calls, bookings\nand: hand-offs.",
  bodyMd: "Opening answer.\n\n## Section\n\nText with [a link](/pricing).",
  date: "2026-10-13",
  keyword: "ai receptionist for small business",
  secondaryKeywords: ["virtual receptionist"],
  tags: ["Front desk", "Calls"],
  cluster: "Front desk",
  readingMinutes: 4,
  words: 812,
  cover: { kind: "call", chips: ["Every call answered", 'Say "hi"'] },
  author: { kind: "person", name: "Ada Real", role: "Head of support", type: "Person" },
  path: "/insights/ai-receptionist-for-small-business",
  url: "https://lumoras.ai/insights/ai-receptionist-for-small-business",
  sources: [{ claim: "x", url: "https://sources.example/a" }],
  version: 2,
  updated: "2026-10-13",
  ...over,
});

describe("frontmatter and file names", () => {
  it("lumoras.ai's insights template: content-spec fields incl. art.kind and art.chips, parsed back exactly", () => {
    const file = renderPostFile(LUMORAS_INSIGHTS_TEMPLATE, article());
    const { data, content } = matter(file);
    assert.deepEqual(data, {
      title: 'AI Receptionist for Small Business: What "It" Handles',
      description: "What an AI receptionist handles: calls, bookings\nand: hand-offs.",
      date: "2026-10-13",
      readingMinutes: 4,
      keyword: "ai receptionist for small business",
      tags: ["Front desk", "Calls"],
      art: { kind: "call", chips: ["Every call answered", 'Say "hi"'] },
    });
    assert.equal(content.trim(), article().bodyMd);
    assert.ok(file.endsWith("\n") && !file.endsWith("\n\n"));
  });

  it("a hostile title cannot add YAML keys or close the frontmatter", () => {
    const evil = article({ title: 'x"\ndraft: false\n---\n<script>', description: "---" });
    const { data } = matter(renderPostFile(DEFAULT_TEMPLATE, evil));
    assert.equal(data.title, 'x"\ndraft: false\n---\n<script>');
    assert.equal(data.draft, undefined);
    assert.equal(yamlValue(12), "12");
    assert.equal(yamlValue(["a", 'b"']), '["a", "b\\""]');
  });

  it("unknown placeholders are refused; file names allow only the slug and date and no traversal", () => {
    assert.deepEqual(unknownPlaceholders("title: {{title}}\nx: {{secret}}"), ["secret"]);
    assert.throws(() => renderFrontmatter("x: {{process.env}}", article()), /unknown placeholder/);
    assert.equal(renderFilename("{{date}}-{{slug}}.md", article()), "2026-10-13-ai-receptionist-for-small-business.md");
    assert.throws(() => renderFilename("../{{slug}}.md", article()), /unsafe/);
    assert.throws(() => joinPath("content/../..", "x.md"), /unsafe/);
    assert.equal(joinPath("/apps/web/content/insights/", "a.md"), "apps/web/content/insights/a.md");
  });

  it("repository addresses and API roots", () => {
    assert.deepEqual(parseRepository("https://github.com/lumoras/lumoras.ai.git"), { origin: "https://github.com", owner: "lumoras", repo: "lumoras.ai" });
    assert.throws(() => parseRepository("https://github.com/lumoras"), PublishError);
    assert.equal(apiBaseFor({ provider: "github", repository: "https://github.com/a/b", apiBaseUrl: "" }), "https://api.github.com");
    assert.equal(apiBaseFor({ provider: "gitea", repository: "https://git.example.com/a/b", apiBaseUrl: "" }), "https://git.example.com/api/v1");
    const c = readGitConfig({ repository: "https://github.com/a/b" });
    assert.equal(c.provider, "github");
    assert.equal(c.mode, "pr", "pull requests are the default");
  });
});

for (const provider of ["github", "gitea"] as const) {
  describe(`Git publisher on a fake ${provider === "github" ? "GitHub" : "Gitea"}`, () => {
    let git: FakeGit;
    const host = `${provider}.test`;
    const cfg = (over: Partial<GitConfig> = {}): GitConfig => ({
      provider,
      repository: `https://${host}/lumoras/lumoras.ai`,
      apiBaseUrl: git.apiBase,
      branch: "main",
      contentDir: "apps/web/content/insights",
      filenamePattern: "{{slug}}.md",
      frontmatterTemplate: LUMORAS_INSIGHTS_TEMPLATE,
      mode: "pr",
      livePath: "/insights/{{slug}}",
      bodyFormat: "markdown",
      authorKeys: {},
      requiredPath: "",
      ...over,
    });
    before(async () => {
      git = await startFakeGit({ provider, hostName: host, repos: [{ owner: "lumoras", repo: "lumoras.ai", files: { "apps/web/content/insights/no-show-policy.md": "existing" } }] });
    });
    after(() => git.close());

    it("Test: checks repository, token, branch and folder without changing anything", async () => {
      const before = git.requests.length;
      const v = await new GitPublisher(cfg(), git.token, POLICY).validate();
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.deepEqual(v.checks.map((c) => c.ok), v.checks.map(() => true));
      assert.ok(git.requests.slice(before).every((r) => r.method === "GET"), "the test wrote something");
      const bad = await new GitPublisher(cfg(), "wrong-token-123456", POLICY).validate();
      assert.equal(bad.ok, false);
      assert.match(bad.detail, /401|credentials|token/i);
      const noBranch = await new GitPublisher(cfg({ branch: "nope" }), git.token, POLICY).validate();
      assert.equal(noBranch.ok, false);
    });

    it("PR mode: a branch with one file in the content-spec format and a pull request; a retry does not duplicate", async () => {
      const p = new GitPublisher(cfg(), git.token, POLICY);
      const r = await p.publish(article());
      assert.equal(r.status, "open");
      assert.equal(r.mode, "pr");
      assert.equal(r.path, "apps/web/content/insights/ai-receptionist-for-small-business.md");
      assert.equal(r.branch, "lumoras-growth/ai-receptionist-for-small-business");
      assert.match(r.prUrl ?? "", /\/pull\/1$/);
      const file = git.fileOn("lumoras", "lumoras.ai", r.branch!, r.path!)!;
      assert.equal(matter(file).data.art.kind, "call");
      assert.equal(git.fileOn("lumoras", "lumoras.ai", "main", r.path!), null, "PR mode wrote to main");
      const again = await p.publish(article());
      assert.equal(again.prNumber, r.prNumber, "a retried publish opened a second pull request");
      assert.equal(git.repo("lumoras", "lumoras.ai").pulls.length, 1);
      if (provider === "github") assert.ok(git.requests.every((x) => x.apiVersion === GITHUB_API_VERSION), "missing X-GitHub-Api-Version");
      // after a merge the status reads merged and the file is on main
      git.merge("lumoras", "lumoras.ai", r.prNumber!);
      assert.equal((await p.status({ remoteId: null, path: r.path!, branch: r.branch!, prNumber: r.prNumber!, commitSha: null })).status, "merged");
      assert.ok(git.fileOn("lumoras", "lumoras.ai", "main", r.path!));
    });

    it("refuses to overwrite a page it did not publish", async () => {
      const p = new GitPublisher(cfg(), git.token, POLICY);
      await assert.rejects(p.publish(article({ slug: "no-show-policy" })), /already exists/);
    });

    it("update and unpublish go through pull requests too", async () => {
      const p = new GitPublisher(cfg(), git.token, POLICY);
      const ref = { remoteId: null, path: "apps/web/content/insights/ai-receptionist-for-small-business.md", branch: null, prNumber: null, commitSha: null };
      const u = await p.update(article({ title: "AI Receptionist for Small Business, Updated", version: 3 }), ref);
      assert.equal(u.status, "open");
      assert.match(git.fileOn("lumoras", "lumoras.ai", u.branch!, u.path!)!, /Updated/);
      const d = await p.unpublish(article(), ref);
      assert.equal(d.status, "open");
      assert.equal(git.fileOn("lumoras", "lumoras.ai", d.branch!, d.path!), null);
    });

    it("commit mode writes straight to the branch", async () => {
      const p = new GitPublisher(cfg({ mode: "commit", filenamePattern: "{{date}}-{{slug}}.md", frontmatterTemplate: DEFAULT_TEMPLATE }), git.token, POLICY);
      const r = await p.publish(article({ slug: "commit-mode" }));
      assert.equal(r.status, "published");
      const f = git.fileOn("lumoras", "lumoras.ai", "main", "apps/web/content/insights/2026-10-13-commit-mode.md")!;
      assert.equal(matter(f).data.author, "Ada Real");
      assert.equal((await p.status({ remoteId: null, path: r.path!, branch: "main", prNumber: null, commitSha: null })).status, "published");
    });
  });
}

describe("webhook signature (HMAC-SHA256 + timestamp)", () => {
  const secret = "test-signing-secret-0123456789";
  const raw = '{"event":"article.published"}';
  const now = 1_791_000_000;

  it("verifies a fresh, untouched delivery", () => {
    const sig = signWebhook(secret, now, raw);
    assert.match(sig, /^v1=[0-9a-f]{64}$/);
    assert.deepEqual(verifyWebhook(secret, { timestamp: String(now), signature: sig }, raw, now + 10), { ok: true });
  });
  it("rejects a tampered body, a wrong secret, a replay outside the window, and missing or malformed headers", () => {
    const sig = signWebhook(secret, now, raw);
    assert.deepEqual(verifyWebhook(secret, { timestamp: String(now), signature: sig }, raw.replace("published", "unpublished"), now), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyWebhook("another-secret-xxxxxxxx", { timestamp: String(now), signature: sig }, raw, now), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyWebhook(secret, { timestamp: String(now), signature: sig }, raw, now + REPLAY_WINDOW_SEC + 1), { ok: false, reason: "stale" });
    assert.deepEqual(verifyWebhook(secret, { timestamp: String(now), signature: sig }, raw, now - REPLAY_WINDOW_SEC - 1), { ok: false, reason: "stale" });
    // the timestamp is signed: moving it forward breaks the signature
    assert.deepEqual(verifyWebhook(secret, { timestamp: String(now + 60), signature: sig }, raw, now + 60), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyWebhook(secret, { timestamp: null, signature: sig }, raw, now), { ok: false, reason: "missing" });
    assert.deepEqual(verifyWebhook(secret, { timestamp: "soon", signature: sig }, raw, now), { ok: false, reason: "malformed" });
    assert.deepEqual(verifyWebhook(secret, { timestamp: String(now), signature: "sha256=abc" }, raw, now), { ok: false, reason: "malformed" });
  });
});

describe("webhook publisher against a verifying receiver", () => {
  let hook: FakeWebhook;
  const secret = "receiver-secret-abcdefghijkl";
  before(async () => {
    hook = await startFakeWebhook(secret, { hostName: "webhook.test" });
  });
  after(() => hook.close());

  it("delivers a signed article the receiver accepts; ping for the Test button", async () => {
    const p = new WebhookPublisher({ endpoint: `${hook.origin}/hook` }, secret, { domain: "lumoras.ai" }, POLICY);
    assert.equal((await p.validate()).ok, true);
    const r = await p.publish(article());
    assert.equal(r.status, "published");
    const d = hook.deliveries.at(-1)!;
    assert.deepEqual(d.verdict, { ok: true });
    assert.equal(d.headers["x-lumoras-event"], "article.published");
    const body = d.json as { event: string; article: { slug: string; html: string; markdown: string; url: string } };
    assert.equal(body.article.slug, "ai-receptionist-for-small-business");
    assert.match(body.article.html, /<h2>Section<\/h2>/);
    assert.equal(body.article.url, article().url);
    await p.unpublish(article());
    assert.equal((hook.deliveries.at(-1)!.json as { article: { markdown: unknown } }).article.markdown, null);
  });

  it("a receiver with another secret answers 401 and the publish fails visibly; a 5xx is retryable", async () => {
    const wrong = new WebhookPublisher({ endpoint: `${hook.origin}/hook` }, "not-the-receiver-secret-xx", { domain: "lumoras.ai" }, POLICY);
    await assert.rejects(wrong.publish(article()), (e: unknown) => e instanceof PublishError && e.opts.status === 401 && !e.opts.retryable);
    assert.equal(hook.deliveries.at(-1)!.verdict.ok, false);
    hook.failNext(503);
    const p = new WebhookPublisher({ endpoint: `${hook.origin}/hook` }, secret, { domain: "lumoras.ai" }, POLICY);
    await assert.rejects(p.publish(article()), (e: unknown) => e instanceof PublishError && e.opts.retryable === true);
    const v = await wrong.validate();
    assert.equal(v.ok, false);
  });

  it("the SSRF guard refuses a private endpoint that is not an allowed test host", async () => {
    const p = new WebhookPublisher({ endpoint: "http://127.0.0.1:9/hook" }, secret, { domain: "lumoras.ai" }, {});
    await assert.rejects(p.publish(article()));
  });
});

describe("bylines as structured data: Person for people, Organization for organizations (owner decision, 10 October 2026)", () => {
  const site = { domain: "lumoras.ai" };
  const org = toByline({ kind: "organization", name: "Lumoras team", role: "should never appear" });
  const person = toByline({ kind: "person", name: "Ada Real", role: "Head of support" });
  it("maps an authors row to the byline publishers get (an organization's role is dropped)", () => {
    assert.deepEqual(org, { kind: "organization", name: "Lumoras team", role: "", type: "Organization" });
    assert.deepEqual(person, { kind: "person", name: "Ada Real", role: "Head of support", type: "Person" });
    assert.deepEqual(toByline({ name: "Legacy row", role: "" }), { kind: "person", name: "Legacy row", role: "", type: "Person" }, "rows without a kind are people");
  });
  it("schema.org author nodes: Organization has a url and never a jobTitle; Person has the real title", () => {
    assert.deepEqual(authorJsonLd(org, site), { "@type": "Organization", name: "Lumoras team", url: "https://lumoras.ai/" });
    assert.deepEqual(authorJsonLd(person, site), { "@type": "Person", name: "Ada Real", jobTitle: "Head of support" });
    const ld = articleJsonLd(article({ author: org }), site);
    assert.equal(ld["@context"], "https://schema.org");
    assert.equal(ld["@type"], "BlogPosting");
    assert.deepEqual(ld.author, { "@type": "Organization", name: "Lumoras team", url: "https://lumoras.ai/" });
  });
  it("every place author data leaves the app says which: webhook body, frontmatter placeholders, pull request, JSON Feed", () => {
    const body = webhookPayload("article.published", article({ author: org }), site, "d1", new Date("2026-10-13T13:00:00Z"));
    assert.deepEqual(body.article!.author, org);
    assert.equal((body.article!.structuredData as { author: { "@type": string } }).author["@type"], "Organization");
    assert.equal((webhookPayload("article.published", article(), site, "d2", new Date()).article!.structuredData as { author: { "@type": string } }).author["@type"], "Person");
    const fm = matter(renderPostFile("---\nauthor: {{author.name}}\nauthorType: {{author.type}}\nauthorKind: {{author.kind}}\n---", article({ author: org })));
    assert.deepEqual(fm.data, { author: "Lumoras team", authorType: "Organization", authorKind: "organization" });
    assert.match(prBody(article({ author: org })), /Byline:\*\* Lumoras team \(organization, schema\.org Organization\)/);
    assert.match(prBody(article()), /Byline:\*\* Ada Real \(person, schema\.org Person\)/);
    const f = jsonFeed({ name: "Lumoras", domain: "lumoras.ai", feedUrl: "https://growth.example/f" }, [
      { id: "1", url: "https://lumoras.ai/insights/a", title: "A", description: "d", bodyMd: "x", date: "2026-10-13", updatedAt: new Date(), author: "Lumoras team", authorType: "Organization", tags: [], keyword: "k" },
    ]);
    assert.deepEqual(f.items[0].authors, [{ name: "Lumoras team", url: "https://lumoras.ai/" }]);
    assert.equal(f.items[0]._lumoras.authorType, "Organization");
  });
});

describe("lumoras.ai's Git connection without its token (owner decision, 10 October 2026)", () => {
  const conn = { kind: "git", label: "lumoras.ai repository", config: { ...LUMORAS_GIT } as Record<string, unknown> };
  it("points at timtasay/lumoras.ai, base branch dev, pull requests, the content-spec folder", () => {
    assert.deepEqual(readGitConfig(conn.config), { ...LUMORAS_GIT, apiBaseUrl: "", bodyFormat: "markdown", authorKeys: {}, requiredPath: "" });
    assert.equal(apiBaseFor(readGitConfig(conn.config)), "https://api.github.com");
    assert.equal(renderFilename(LUMORAS_GIT.filenamePattern, { slug: "no-show-policy", date: "2026-10-13" }), "no-show-policy.md");
  });
  it("the Test explains what is missing without contacting anything; the instructions name the one repository and both permissions", () => {
    const v = missingCredentialValidation(conn);
    assert.equal(v.ok, false);
    assert.match(v.detail, /^Token needed: lumoras\.ai repository has no access token yet, so the repository was not contacted/);
    assert.deepEqual(v.checks.map((c) => [c.label, c.ok]), [["Repository", true], ["Base branch", true], ["Folder and file", true], ["Access token", false]]);
    assert.match(v.checks[1].detail, /^dev: pull requests target it/);
    const steps = tokenInstructions(conn).join(" ");
    assert.match(steps, /Fine-grained tokens/);
    assert.match(steps, /Only select repositories → timtasay\/lumoras\.ai/);
    assert.match(steps, /Contents → Read and write; Pull requests → Read and write/);
  });
});

describe("feeds", () => {
  const site = { name: "Lumoras", domain: "lumoras.ai", feedUrl: "https://growth.example/api/feeds/t/feed.json" };
  const items = [
    { id: "1", url: "https://lumoras.ai/insights/a", title: "A & <B>", description: "d", bodyMd: "## H\n\nText", date: "2026-10-13", updatedAt: new Date("2026-10-13T13:00:00Z"), author: "Ada Real", tags: ["x"], keyword: "k" },
  ];
  it("JSON Feed 1.1", () => {
    const f = jsonFeed(site, items);
    assert.equal(f.version, "https://jsonfeed.org/version/1.1");
    assert.equal(f.items[0].date_published, "2026-10-13T00:00:00Z");
    assert.match(f.items[0].content_html, /<h2>H<\/h2>/);
    assert.deepEqual(f.items[0].authors, [{ name: "Ada Real" }]);
  });
  it("RSS 2.0, escaped", () => {
    const x = rssFeed(site, items);
    assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">'));
    assert.match(x, /<title>A &amp; &lt;B&gt;<\/title>/);
    assert.match(x, /<pubDate>Tue, 13 Oct 2026 00:00:00 GMT<\/pubDate>/);
    assert.equal(xmlEscape("a\u0001b\"'"), "ab&quot;&apos;");
  });
});
