/**
 * The Lumoras sites' Git formats (docs/site-formats/*.md, owner decision #2):
 *   - sonorch.ai's preset renders exactly the frontmatter its build validates
 *     (fields, order, author key, cover motif), as MDX-safe text;
 *   - escapeMdxBody: "<", "{", "}" escaped outside code, code left alone,
 *     autolinks rewritten, HTML comments dropped;
 *   - author keys: parsed from "Name = key" lines, unmapped bylines refused
 *     with what to add;
 *   - the format check: on a fake Gitea, nothing publishes until the site's
 *     format file is on the base branch, and Test says why.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { escapeMdxBody, renderPostFile } from "../../lib/publishers/frontmatter.ts";
import { formatAuthorKeys, parseAuthorKeys } from "../../lib/publishers/author-keys.ts";
import { GitPublisher, readGitConfig, type GitConfig } from "../../lib/publishers/git.ts";
import { presetConnection, presetsFor, SEASONX_GIT, SITE_PRESETS, SONORCH_GIT } from "../../lib/publishers/presets.ts";
import { PublishError, type PublishableArticle } from "../../lib/publishers/types.ts";
import { connectionInput } from "../../lib/validation.ts";
import { startFakeGit, type FakeGit } from "../helpers/fake-git.ts";

const POLICY = { policy: { testResolve: new Map([["gitea.test", "127.0.0.1"]]) } };

const article = (over: Partial<PublishableArticle> = {}): PublishableArticle => ({
  id: "0b6c7a3e-0000-4000-8000-000000000002",
  slug: "walk-ins-and-appointments",
  title: 'Walk-ins: "yes", without wrecking the book',
  description: "Walk-ins fill a slow Tuesday and wreck a busy Saturday. How to fit them in.",
  bodyMd: "Keep walk-ins under <20 minutes and {name} the waitlist.\n\n## Use `a<b` in code\n\n```txt\n{literal}\n```\n\nSee <https://sonorch.ai/pricing>.",
  date: "2026-10-14",
  keyword: "salon walk ins",
  secondaryKeywords: [],
  tags: ["Front desk"],
  cluster: "Front desk",
  readingMinutes: 3,
  words: 640,
  cover: { kind: "calendar", chips: ["Walk-in · 20 min wait", "3:00 PM · booked"] },
  author: { kind: "person", name: "Tran", role: "Salon owner", type: "Person" },
  path: "/insights/walk-ins-and-appointments",
  url: "https://sonorch.ai/insights/walk-ins-and-appointments",
  sources: [],
  version: 1,
  updated: "2026-10-10",
  ...over,
});

const opts = { bodyFormat: SONORCH_GIT.bodyFormat, authorKeys: SONORCH_GIT.authorKeys };

describe("sonorch.ai preset", () => {
  it("renders the site's frontmatter: its fields in its order, the author key, the cover motif, no updatedAt", () => {
    const file = renderPostFile(SONORCH_GIT.template, article(), opts);
    const { data, content } = matter(file);
    assert.deepEqual(Object.keys(data), ["slug", "title", "description", "publishedAt", "author", "readingMinutes", "cover"]);
    assert.deepEqual(data, {
      slug: "walk-ins-and-appointments",
      title: 'Walk-ins: "yes", without wrecking the book',
      description: "Walk-ins fill a slow Tuesday and wreck a busy Saturday. How to fit them in.",
      publishedAt: "2026-10-14",
      author: "tran",
      readingMinutes: 3,
      cover: { motif: "calendar", chips: ["Walk-in · 20 min wait", "3:00 PM · booked"] },
    });
    assert.ok(file.startsWith("---\n"), "nothing may come before the opening ---");
    assert.ok(file.endsWith("\n") && !file.endsWith("\n\n"));
    assert.match(content, /under \\<20 minutes and \\\{name\\\} the waitlist/);
    assert.match(content, /`a<b`/, "inline code must stay literal");
    assert.match(content, /```txt\n\{literal\}\n```/, "fenced code must stay literal");
    assert.match(content, /\[https:\/\/sonorch\.ai\/pricing\]\(https:\/\/sonorch\.ai\/pricing\)/);
  });

  it("is the slug-named .mdx file in src/content/posts, as a pull request into dev on Gitea", () => {
    assert.equal(SONORCH_GIT.provider, "gitea");
    assert.equal(SONORCH_GIT.branch, "dev");
    const cfg = readGitConfig(connectionInput.parse(presetConnection(SONORCH_GIT, "sonorch.ai")) as unknown as Record<string, unknown>);
    const p = new GitPublisher(cfg, "t", POLICY);
    assert.equal(p.pathFor(article()), "src/content/posts/walk-ins-and-appointments.mdx");
    assert.equal(cfg.mode, "pr");
    assert.deepEqual(cfg.authorKeys, { Tim: "tim", Tran: "tran", Alex: "alex", Jayden: "jayden" });
  });

  it("each site sees its own preset first; the cover rules match the site's build", () => {
    assert.equal(presetsFor("sonorch.ai")[0].key, "sonorch");
    assert.equal(presetsFor("lumoras.ai")[0].key, "lumoras");
    assert.equal(presetsFor("example.com")[0].key, "generic");
    assert.equal(presetsFor("sonorch.ai").length, SITE_PRESETS.length);
    assert.deepEqual(SONORCH_GIT.seoRules?.coverKinds, ["calendar", "phone", "receipt", "card", "chart", "clock", "people", "list"]);
    assert.equal(SONORCH_GIT.seoRules?.coverChipMax, 26);
  });
});

describe("seasonx.ai preset", () => {
  it("the same post format as sonorch.ai, in lumoras/seasonx.ai, into dev, waiting for its validator", () => {
    assert.equal(SEASONX_GIT.repository, "https://gitea.timdatinh.com/lumoras/seasonx.ai");
    assert.equal(SEASONX_GIT.provider, "gitea");
    assert.equal(SEASONX_GIT.branch, "dev");
    assert.equal(SEASONX_GIT.requiredPath, "src/content/postFrontmatter.ts");
    assert.equal(SEASONX_GIT.contentDir, "src/content/posts");
    assert.equal(SEASONX_GIT.filenamePattern, "{{slug}}.mdx");
    assert.equal(SEASONX_GIT.bodyFormat, "mdx");
    assert.equal(presetsFor("seasonx.ai")[0].key, "seasonx");
    const { data } = matter(renderPostFile(SEASONX_GIT.template, article({ author: { kind: "person", name: "Alex", role: "", type: "Person" }, cover: { kind: "people", chips: ["Party of 8 · Sat 7:30"] } }), { bodyFormat: "mdx", authorKeys: SEASONX_GIT.authorKeys }));
    assert.deepEqual(Object.keys(data), ["slug", "title", "description", "publishedAt", "author", "readingMinutes", "cover"]);
    assert.equal(data.author, "alex");
    assert.deepEqual(data.cover, { motif: "people", chips: ["Party of 8 · Sat 7:30"] });
  });
});

describe("escapeMdxBody", () => {
  it("escapes <, { and } in prose and leaves code, quotes and existing escapes alone", () => {
    assert.equal(escapeMdxBody("a<b<c {x} }"), "a\\<b\\<c \\{x\\} \\}");
    assert.equal(escapeMdxBody("Keep `x<y {z}` and ``a ` b<c``, not 1<2."), "Keep `x<y {z}` and ``a ` b<c``, not 1\\<2.");
    assert.equal(escapeMdxBody("~~~\n{raw}\n~~~\n{after}"), "~~~\n{raw}\n~~~\n\\{after\\}");
    assert.equal(escapeMdxBody("Already \\{done\\} and \\<."), "Already \\{done\\} and \\<.");
    assert.equal(escapeMdxBody("> quoted {x} > fine"), "> quoted \\{x\\} > fine");
  });
  it("drops HTML comments and turns autolinks into links", () => {
    assert.equal(escapeMdxBody("a <!-- note --> b"), "a  b");
    assert.equal(escapeMdxBody("a <!-- open\nacross lines --> b"), "a  b");
    assert.equal(escapeMdxBody("<https://example.com/x>"), "[https://example.com/x](https://example.com/x)");
  });
  it("a Markdown site's body is never escaped", () => {
    const md = renderPostFile("---\ntitle: {{title}}\n---", article({ bodyMd: "a<b {c}" }));
    assert.match(md, /\n\na<b \{c\}\n$/);
  });
});

describe("author keys", () => {
  it("parses Name = key lines and formats them back", () => {
    const r = parseAuthorKeys("Tran = tran\n\n  Jayden Le=jayden  \n");
    assert.deepEqual(r, { keys: { Tran: "tran", "Jayden Le": "jayden" } });
    assert.equal(formatAuthorKeys({ Tran: "tran", Tim: "tim" }), "Tran = tran\nTim = tim");
  });
  it("refuses malformed and duplicate lines", () => {
    assert.match((parseAuthorKeys("Tran tran") as { error: string }).error, /Line 1/);
    assert.match((parseAuthorKeys("Tran = tran\nTran = t2") as { error: string }).error, /twice/);
    assert.match((parseAuthorKeys("Tran = has space") as { error: string }).error, /Line 1/);
    const bad = connectionInput.safeParse({ ...presetConnection(SONORCH_GIT, "x"), authorKeys: "nope" });
    assert.equal(bad.success, false);
  });
  it("an unmapped or missing byline is refused, saying what to add", () => {
    assert.throws(() => renderPostFile(SONORCH_GIT.template, article({ author: { kind: "person", name: "Demo author for sonorch.ai", role: "", type: "Person" } }), opts), (e: unknown) => e instanceof PublishError && /Demo author for sonorch\.ai = <key>/.test(e.message) && /Tim, Tran/.test(e.message));
    assert.throws(() => renderPostFile(SONORCH_GIT.template, article({ author: null }), opts), /no byline/);
  });
});

describe("format check on a fake Gitea", () => {
  let git: FakeGit;
  const cfg = (over: Partial<GitConfig> = {}): GitConfig => ({
    ...readGitConfig(connectionInput.parse(presetConnection(SONORCH_GIT, "sonorch.ai")) as unknown as Record<string, unknown>),
    repository: "https://gitea.test/lumoras/sonorch.ai",
    apiBaseUrl: git.apiBase,
    ...over,
  });
  before(async () => {
    git = await startFakeGit({ provider: "gitea", hostName: "gitea.test", repos: [{ owner: "lumoras", repo: "sonorch.ai", defaultBranch: "dev", files: { "src/content/posts.ts": "export const POSTS = [];" } }] });
  });
  after(() => git.close());

  it("before the format change is on dev: Test fails on Site format and publish writes nothing", async () => {
    const p = new GitPublisher(cfg(), git.token, POLICY);
    const v = await p.validate();
    assert.equal(v.ok, false);
    const check = v.checks.find((c) => c.label === "Site format")!;
    assert.equal(check.ok, false);
    assert.match(check.detail, /src\/content\/post-schema\.ts is not on dev/);
    assert.ok(v.checks.find((c) => c.label === "Author keys")?.ok);
    const before = git.requests.length;
    await assert.rejects(p.publish(article()), (e: unknown) => e instanceof PublishError && e.opts.status === 409 && /merge the site's file-per-post change first/.test(e.message));
    assert.ok(git.requests.slice(before).every((r) => r.method === "GET"), "a refused publish wrote something");
    assert.equal(git.repo("lumoras", "sonorch.ai").pulls.length, 0);
  });

  it("an unmapped byline is refused before the repository is contacted", async () => {
    const before = git.requests.length;
    await assert.rejects(new GitPublisher(cfg(), git.token, POLICY).publish(article({ author: { kind: "person", name: "Someone", role: "", type: "Person" } })), /No author key for "Someone"/);
    assert.equal(git.requests.length, before);
  });

  it("once the format file is on dev: Test passes and publish opens a pull request with the .mdx file", async () => {
    const schema = "export const AUTHORS = {};";
    git.repo("lumoras", "sonorch.ai").branches.get("dev")!.files.set("src/content/post-schema.ts", { content: schema, sha: createHash("sha1").update(schema).digest("hex") });
    const p = new GitPublisher(cfg(), git.token, POLICY);
    const v = await p.validate();
    assert.equal(v.ok, true, JSON.stringify(v.checks));
    const r = await p.publish(article());
    assert.equal(r.status, "open");
    assert.equal(r.path, "src/content/posts/walk-ins-and-appointments.mdx");
    const file = git.fileOn("lumoras", "sonorch.ai", r.branch!, r.path!)!;
    assert.equal(matter(file).data.author, "tran");
    assert.match(file, /\\<20 minutes/);
    assert.equal(git.fileOn("lumoras", "sonorch.ai", "dev", r.path!), null, "PR mode wrote to dev");
  });

  it("a connection without a format check publishes as before", () => {
    assert.equal(readGitConfig({ repository: "https://gitea.test/a/b" }).requiredPath, "");
    assert.equal(readGitConfig({ repository: "https://gitea.test/a/b" }).bodyFormat, "markdown");
    assert.deepEqual(readGitConfig({ repository: "https://gitea.test/a/b", authorKeys: { A: "a", B: 3 } }).authorKeys, { A: "a" });
  });
});
