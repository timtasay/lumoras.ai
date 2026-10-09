/**
 * The lint step, rule by rule (section 7 step 7; rules 4 to 13 where they are
 * deterministic). A baseline article passes every rule; each test breaks one
 * thing and expects exactly that rule to fail (or warn) with a reason a person
 * can act on. Includes the two guards the brief names explicitly: internal
 * links must exist ON THE PUBLISH DATE (rule 9) and no duplicate head term
 * (rule 5).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bannedWordsIn, keywordInTitle, LINT_RULES, lintArticle, lintPassed, lintSummary, type LintInput, type LintResult } from "../../lib/content/lint.ts";
import { resolveLink, linkTargetsOn, normPath, pagePath } from "../../lib/content/links.ts";
import { headTerm, headTermConflicts } from "../../lib/content/headterm.ts";
import { analyzeMarkdown } from "../../lib/content/markdown.ts";
import { DEFAULT_SEO_RULES, type SeoRules } from "../../lib/validation.ts";

const RULES: SeoRules = { ...DEFAULT_SEO_RULES, introMinSentences: 2, introMaxSentences: 4, noEmDash: true, noEmoji: true, coverKinds: ["call", "chart"], coverChips: 2, coverChipMax: 22 };

const para = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `The front desk handles ${seed} call number ${i + 1} with care and writes it down for the team.`).join(" ");

function body(o: { intro?: string; links?: string[]; extra?: string; sections?: number } = {}) {
  const links = o.links ?? ["/pricing", "/insights/no-show-policy", "/demo"];
  const parts = [o.intro ?? "An AI receptionist answers the phone when you cannot. It books, moves and cancels appointments. Everything else goes to a person."];
  const sections = o.sections ?? 3;
  for (let s = 0; s < sections; s++) {
    parts.push(`## Section ${s + 1}`);
    parts.push(para(16, `section ${s + 1}`));
  }
  parts.push(`See [pricing](${links[0]}), our [no-show policy guide](${links[1] ?? links[0]}) and [book a walkthrough](${links[2] ?? links[0]}).`);
  if (o.extra) parts.push(o.extra);
  return parts.join("\n\n");
}

function base(over: Partial<LintInput> = {}): LintInput {
  return {
    title: "AI Receptionist for Small Business: What It Handles",
    description: "What an AI receptionist handles for a small business, what it hands to your team, and how to judge the cost with your own call numbers first.",
    bodyMd: body(),
    slug: "ai-receptionist-for-small-business",
    primaryKeyword: "ai receptionist for small business",
    authorId: "a1",
    cover: { kind: "call", chips: ["Every call answered", "Booked while you work"] },
    publishDate: "2026-10-13",
    rules: RULES,
    bannedWords: ["revolutionary", "game changer"],
    siteDomain: "lumoras.ai",
    authors: [{ id: "a1", name: "Ada Real", is_demo: false }],
    routes: [{ path: "/pricing" }, { path: "/demo" }, { path: "/" }],
    pages: [{ path: "/insights/no-show-policy", title: "No-show policy", publishDate: "2026-09-01", status: "published" }],
    linkChecks: new Map(),
    existingTargets: [],
    itemId: "item-1",
    ...over,
  };
}

const byRule = (r: LintResult[], rule: string) => r.filter((x) => x.rule === rule);
const only = (r: LintResult[]) => r.filter((x) => x.status !== "pass");

function expectFail(over: Partial<LintInput>, rule: string, detail?: RegExp) {
  const r = lintArticle(base(over));
  const bad = only(r);
  assert.ok(
    bad.some((x) => x.rule === rule && x.status === "fail"),
    `${rule} did not fail: ${JSON.stringify(byRule(r, rule))}`,
  );
  assert.deepEqual([...new Set(bad.map((x) => x.rule))], [rule], `other rules failed too: ${JSON.stringify(bad)}`);
  if (detail) assert.match(byRule(r, rule).find((x) => x.status === "fail")!.detail, detail);
  assert.equal(lintPassed(r), false, "a failing rule must hold the article");
}

describe("lint: the baseline passes every rule", () => {
  it("passes all fifteen rules and is publishable", () => {
    const r = lintArticle(base());
    assert.deepEqual(only(r), []);
    assert.deepEqual([...new Set(r.map((x) => x.rule))].sort(), [...LINT_RULES].sort());
    assert.ok(lintPassed(r));
    assert.deepEqual(lintSummary(r), { pass: 15, warn: 0, fail: 0, total: 15 });
  });
});

describe("lint: each rule fails on its own", () => {
  it("title_length: empty and too long", () => {
    const empty = lintArticle(base({ title: "" }));
    assert.match(byRule(empty, "title_length")[0].detail, /no title/);
    // keep the keyword in, go over 60
    const r = lintArticle(base({ title: "AI Receptionist for Small Business: What It Handles and What It Hands Back" }));
    assert.equal(byRule(r, "title_length")[0].status, "fail");
  });
  it("keyword_in_title: missing keyword, or none set", () => {
    expectFail({ title: "What a Virtual Front Desk Handles" }, "keyword_in_title", /does not appear/);
    assert.ok(keywordInTitle("For Small Businesses: an AI Receptionist", "ai receptionist for small business"), "word order and plurals are tolerated");
    assert.equal(keywordInTitle("Phone tips", ""), false);
  });
  it("description_length: below and above the range", () => {
    expectFail({ description: "Too short." }, "description_length", /140–155/);
    expectFail({ description: "x".repeat(156) }, "description_length");
  });
  it("slug: not kebab case, or taken by another article", () => {
    expectFail({ slug: "AI_Receptionist" }, "slug");
    expectFail({ slug: "no-show-policy", pages: [{ path: "/insights/no-show-policy", title: "x", publishDate: "2026-09-01", status: "published" }], bodyMd: body({ links: ["/pricing", "/demo", "/"] }) }, "slug", /already uses/);
  });
  it("headings: an H1 in the body, too few sections, a skipped level", () => {
    expectFail({ bodyMd: body({ extra: "# A second title" }) }, "headings", /title is the H1/);
    const few = lintArticle(base({ bodyMd: body({ sections: 1 }) }));
    assert.match(byRule(few, "headings").find((x) => x.status === "fail")!.detail, /at least 2 expected/);
    expectFail({ bodyMd: body({ extra: "#### Deep heading\n\nText." }) }, "headings", /jumps to level 4/);
  });
  it("direct_answer: no answer before the first heading, or too long", () => {
    expectFail({ bodyMd: body({ intro: "One sentence only." }) }, "direct_answer", /1 sentence/);
    expectFail({ bodyMd: body({ intro: "One. Two. Three. Four. Five sentences here." }) }, "direct_answer");
  });
  it("word_count: outside the range", () => {
    const r = lintArticle(base({ bodyMd: body({ sections: 2 }).split(" ").slice(0, 200).join(" ") }));
    assert.equal(byRule(r, "word_count")[0].status, "fail");
    expectFail({ bodyMd: body({ extra: para(40, "extra") }) }, "word_count", /the range is 700–1,100/);
  });
  it("banned_words: whole words and phrases, case-insensitive, in title, description or body", () => {
    expectFail({ bodyMd: body({ extra: "It is a Game Changer for clinics." }) }, "banned_words", /"game changer"/);
    assert.deepEqual(bannedWordsIn("revolutionaryish but not revolutionary.", ["revolutionary"]), ["revolutionary"]);
    assert.deepEqual(bannedWordsIn("no match here", ["revolutionary"]), []);
  });
  it("punctuation: em dashes and emoji when the site forbids them", () => {
    expectFail({ bodyMd: body({ extra: "Short answer — yes." }) }, "punctuation", /1 em dash/);
    expectFail({ bodyMd: body({ extra: "We love it 🎉." }) }, "punctuation", /emoji/);
    const allowed = lintArticle(base({ rules: { ...RULES, noEmDash: false, noEmoji: false }, bodyMd: body({ extra: "Yes — really 🎉." }) }));
    assert.equal(byRule(allowed, "punctuation")[0].status, "pass");
  });
  it("internal_link_count: fewer than three or more than six", () => {
    expectFail({ bodyMd: body({ links: ["/pricing", "/pricing", "/pricing"] }) }, "internal_link_count", /1 internal link/);
  });
  it("internal_links_resolve (rule 9): a missing page, and a page scheduled AFTER the publish date", () => {
    expectFail({ bodyMd: body({ links: ["/pricing", "/insights/no-show-policy", "/does-not-exist"] }) }, "internal_links_resolve", /not in the site's route inventory/);
    const pages = [
      { path: "/insights/no-show-policy", title: "No-show policy", publishDate: "2026-09-01", status: "published" },
      { path: "/insights/call-forwarding", title: "Call forwarding", publishDate: "2026-10-20", status: "approved" },
    ];
    expectFail({ pages, bodyMd: body({ links: ["/pricing", "/insights/no-show-policy", "/insights/call-forwarding"] }) }, "internal_links_resolve", /scheduled for 2026-10-20, after this article goes live on 2026-10-13/);
    // the same link is fine once the article itself goes out after that date
    const later = lintArticle(base({ pages, publishDate: "2026-10-23", bodyMd: body({ links: ["/pricing", "/insights/no-show-policy", "/insights/call-forwarding"] }) }));
    assert.equal(byRule(later, "internal_links_resolve")[0].status, "pass");
  });
  it("external_links_ok: a dead link fails; an unchecked link holds (warn, blocking)", () => {
    const url = "https://example.org/source";
    expectFail({ bodyMd: body({ extra: `Source: [study](${url}).` }), linkChecks: new Map([[url, { url, ok: false, status: 404 }]]) }, "external_links_ok", /404/);
    const unchecked = lintArticle(base({ bodyMd: body({ extra: `Source: [study](${url}).` }) }));
    const x = byRule(unchecked, "external_links_ok")[0];
    assert.equal(x.status, "warn");
    assert.equal(x.blocking, true);
    assert.equal(lintPassed(unchecked), false, "an external link nobody checked cannot go live");
    const ok = lintArticle(base({ bodyMd: body({ extra: `Source: [study](${url}).` }), linkChecks: new Map([[url, { url, ok: true, status: 200 }]]) }));
    assert.equal(byRule(ok, "external_links_ok")[0].status, "pass");
  });
  it("duplicate_head_term (rule 5): another page, article or ranked URL already targets it", () => {
    expectFail({ existingTargets: [{ keyword: "AI receptionists for small businesses", source: "published", ref: "“An older post”" }] }, "duplicate_head_term", /older post/);
    expectFail({ existingTargets: [{ keyword: "ai receptionist for small business", source: "ranked", ref: "https://lumoras.ai/" }] }, "duplicate_head_term");
    // the article's own row is not a conflict
    const self = lintArticle(base({ existingTargets: [{ keyword: "ai receptionist for small business", source: "scheduled", ref: "self", itemId: "item-1" }] }));
    assert.equal(byRule(self, "duplicate_head_term")[0].status, "pass");
    const none = lintArticle(base({ primaryKeyword: null }));
    assert.equal(byRule(none, "keyword_in_title")[0].status, "fail");
    assert.equal(byRule(none, "duplicate_head_term")[0].status, "fail", "no keyword, nothing to check: held");
  });
  it("author (rule 10): not a configured author fails; a demo placeholder warns without blocking", () => {
    expectFail({ authorId: "someone-else" }, "author", /not one of this site's configured authors/);
    const demo = lintArticle(base({ authors: [{ id: "a1", name: "Demo author", is_demo: true }] }));
    const a = byRule(demo, "author")[0];
    assert.equal(a.status, "warn");
    assert.equal(a.blocking, false);
    assert.ok(lintPassed(demo), "the demo byline warning does not block (the review screen shows it)");
  });
  it("cover: kind, chip count and chip length from the brand's content spec", () => {
    expectFail({ cover: { kind: "poster", chips: ["A", "B"] } }, "cover", /not one of call, chart/);
    expectFail({ cover: { kind: "call", chips: ["Only one"] } }, "cover", /2 expected/);
    expectFail({ cover: { kind: "call", chips: ["Every call answered", "x".repeat(23)] } }, "cover", /over 22 characters/);
    expectFail({ cover: {} }, "cover", /no cover kind/);
  });
  it("raw HTML in the body is a non-blocking warning", () => {
    const r = lintArticle(base({ bodyMd: body({ extra: "<div>hi</div>" }) }));
    assert.ok(r.some((x) => x.status === "warn" && /Raw HTML/.test(x.detail) && !x.blocking));
  });
});

describe("links and head terms", () => {
  it("normalises paths and fills the live-path pattern", () => {
    assert.equal(normPath("/Pricing/?a=1#x"), "/pricing");
    assert.equal(normPath("/"), "/");
    assert.equal(pagePath("/insights/{{slug}}", "abc"), "/insights/abc");
    assert.equal(pagePath("/blog/{slug}/", "abc"), "/blog/abc");
  });
  it("targets on a date: inventory, published, and scheduled on or before that date", () => {
    const t = linkTargetsOn("2026-10-13", [{ path: "/a" }], [
      { path: "/p", title: "P", publishDate: "2026-09-01", status: "published" },
      { path: "/s", title: "S", publishDate: "2026-10-13", status: "approved" },
      { path: "/l", title: "L", publishDate: "2026-10-14", status: "approved" },
      { path: "/r", title: "R", publishDate: "2026-10-01", status: "rejected" },
    ]);
    assert.deepEqual([...t.keys()].sort(), ["/a", "/p", "/s"]);
    const v = resolveLink("/l", "2026-10-13", [], [{ path: "/l", title: "L", publishDate: "2026-10-14", status: "approved" }]);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "later");
  });
  it("head terms collapse plurals and word order", () => {
    assert.equal(headTerm("AI receptionists for small businesses"), headTerm("small business ai receptionist"));
    assert.equal(headTermConflicts("ai receptionist", [{ keyword: "AI Receptionists", source: "published", ref: "x" }]).length, 1);
    assert.equal(headTermConflicts("ai receptionist", [{ keyword: "ai receptionist cost", source: "published", ref: "x" }]).length, 0);
  });
  it("markdown analysis counts words, sentences in the opening, headings and links", () => {
    const a = analyzeMarkdown("First. Second one.\n\n## A\n\nText with a [link](/x) and **bold**.\n\n### B\n\nMore.");
    assert.equal(a.introSentences, 2);
    assert.deepEqual(a.headings.map((h) => h.depth), [2, 3]);
    assert.deepEqual(a.links.map((l) => l.url), ["/x"]);
    assert.ok(a.words >= 10);
  });
});
