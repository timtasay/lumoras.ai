/**
 * Recorded fixtures for the FakeLlm. SYNTHETIC, like the SEO provider's: no
 * API key exists in the build environment and the suite must never spend, so
 * these are hand-written responses in the exact shapes the real model is
 * asked for (lib/pipeline/prompts.ts), filled from the step's own <input> so
 * they always respect what code allowed (the candidate list, the link
 * targets, the cover kinds). Everything they produce is marked as demo
 * content by the screens.
 *
 * The draft is an article about answering a small business's phone: plain,
 * second person, example arithmetic labelled as an example, no statistics,
 * no em dashes, no hype words, and only claims the brand profile's product
 * facts support. Tests assert on structure, never on this wording.
 *
 * Scenarios (FakeLlm option `scenarios`) switch a fixture into a failure the
 * suite needs to see: an unverifiable claim, an off-list topic, a link the
 * brief was not allowed to use.
 */
import { slugify } from "../validation-client.ts";
import { BRAND_SOURCE, type BriefInput, type BriefOutput, type DraftInput, type DraftOutput, type FactInput, type FactOutput, type TopicInput, type TopicOutput } from "../pipeline/prompts.ts";

export type Scenario = "default" | "unverifiable" | "off_list_topic" | "bad_link" | "greedy_tools";

const cap = (s: string) => s.replace(/\b(ai|seo|pos|faq)\b/gi, (w) => w.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
const titleCase = (s: string) =>
  s
    .split(" ")
    .map((w, i) => (/^(ai|seo|pos)$/i.test(w) ? w.toUpperCase() : i > 0 && /^(for|and|of|the|a|an|to|in|on|vs)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

/** The recorded answers are about answering a business's phone, so the fixture prefers a candidate on that subject. */
const PHONE_TOPIC = /receptionist|call|phone|answer|booking|voicemail|reminder|no show/;

export function topicAnswer(input: TopicInput, scenario: Scenario): TopicOutput {
  const c = input.candidates.find((x) => PHONE_TOPIC.test(x.keyword)) ?? input.candidates[0];
  const keyword = scenario === "off_list_topic" ? "dental implants cost" : c.keyword;
  return {
    keyword,
    secondary: input.candidates.filter((x) => x !== c).slice(0, 2).map((x) => x.keyword),
    cluster: c.intent === "commercial" ? "Buying guides" : "How-to",
    intent: (c.intent as TopicOutput["intent"]) ?? "informational",
    rationale: {
      volume: c.volume !== null ? `About ${c.volume.toLocaleString("en-US")} searches a month in this market.` : "Volume unknown; chosen on fit.",
      difficulty: c.kd !== null ? `Keyword difficulty ${c.kd} of 100.` : "Difficulty unknown.",
      cpc: c.cpcUsd !== null ? `Advertisers pay about $${c.cpcUsd.toFixed(2)} a click, a sign of buying intent.` : "No paid competition data.",
      intent: `Searchers want ${c.intent ?? "information"}; an article answers it directly.`,
      fit: `It matches what the business sells${c.fit === "offered" ? " (on the sells list)" : ""}, and no other page targets this head term.`,
      whyNow: `It is the strongest candidate left after the duplicate and doorway checks, and nothing scheduled before ${input.publishDate} covers it.`,
    },
  };
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

export function briefAnswer(input: BriefInput, scenario: Scenario): BriefOutput {
  const kw = input.target.keyword;
  const kt = tokens(`${kw} ${input.target.secondary.join(" ")} receptionist calls phone voice`);
  const scored = input.linkTargets
    .filter((l) => l.path !== "/")
    .map((l, i) => ({ l, i, s: [...tokens(`${l.path} ${l.title}`)].filter((w) => kt.has(w)).length + (/^\/(insights|knowledge-base)\//.test(l.path) ? 1 : 0) + (l.path === "/demo" ? 0.5 : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const demo = input.linkTargets.find((l) => l.path === "/demo");
  const n = Math.min(Math.max(input.links.min, 4), input.links.max, scored.length);
  const picked = scored.filter(({ l }) => l.path !== "/demo").slice(0, demo ? n - 1 : n).map(({ l }) => l);
  if (demo) picked.push(demo);
  const links = picked.map((l) => ({ path: l.path, anchor: l.path === "/demo" ? "book a walkthrough" : l.title.replace(/\s+[|·-]\s+.*$/, "").slice(0, 80) || l.path, why: "Related reading that exists on the publish date." }));
  if (scenario === "bad_link") links[0] = { path: "/insights/not-a-real-page", anchor: "a page that does not exist", why: "test" };
  const kinds = input.cover.kinds.length ? input.cover.kinds : ["call"];
  const kind = kinds.includes("call") ? "call" : kinds[0];
  const chips = ["Every call answered", "Booked while you work", "After-hours calls", "Handed to your team"].map((c) => c.slice(0, input.cover.chipMax)).slice(0, input.cover.chips || 2);
  let title = `${titleCase(kw)}: What It Handles`;
  if (title.length > input.titleMax) title = titleCase(kw).slice(0, input.titleMax);
  return {
    title,
    slug: slugify(kw),
    intent: `The reader is weighing ${kw} for their own business and wants to know what it does, what it costs to run and how to tell it works.`,
    outline: [
      { heading: "What it answers on a normal day", points: ["bookings and changes", "hours and directions", "questions about services"] },
      { heading: "What it hands to a person", points: ["complaints", "anything outside policy", "a caller who asks for someone"] },
      { heading: "Work out the cost with your own numbers", points: ["example arithmetic, labelled as an example"] },
      { heading: "How it fits the tools you already use", points: ["the calendar and the POS", "switching voice on later"] },
      { heading: "How to tell it is working", points: ["answered calls", "bookings from calls", "handoffs"] },
      { heading: "Where to go next", points: ["related reading"] },
    ],
    questions: [`What does ${kw} actually do?`, "Which calls still need a person?", "How do I work out whether it pays for itself?"],
    internalLinks: links,
    // statements about the product (not labels such as "Company legal name: …")
    claimsToSource: input.site.productFacts.filter((f) => !f.includes(":")).slice(0, 2),
    cover: { kind, chips },
    tags: ["salons", "restaurants", "clinics"],
  };
}

/** Fits a description into [min, max] characters by choosing among variants. */
function fitDescription(keyword: string, min: number, max: number): string {
  const kw = keyword.replace(/\b(ai|seo|pos|faq)\b/gi, (w) => w.toUpperCase());
  const variants = [
    `What ${kw} handles on a normal day, what it hands to your team, and how to judge the cost with your own call numbers before you switch it on.`,
    `What ${kw} handles, what it hands to your team, and how to judge the cost with your own call numbers before you switch it on.`,
    `What ${kw} handles, what it hands to people, and how to judge the cost with your own numbers before you start.`,
    `What ${kw} handles and how to judge its cost with your own numbers.`,
  ];
  const fit = variants.find((v) => v.length >= min && v.length <= max);
  if (fit) return fit;
  const shortest = variants.reduce((a, b) => (b.length < a.length ? b : a));
  if (shortest.length > max) return `${shortest.slice(0, max - 1).replace(/\s+\S*$/, "")}.`;
  const longest = variants.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length < min ? `${longest} Read this first.`.slice(0, max) : longest;
}

const link = (l: { path: string; anchor: string } | undefined, fallback: string, start = false) => {
  if (!l) return fallback;
  const a = l.anchor.toLowerCase().replace(/\bai\b/g, "AI");
  return `[${start ? a.charAt(0).toUpperCase() + a.slice(1) : a}](${l.path})`;
};

export function draftAnswer(input: DraftInput): DraftOutput {
  const b = input.brief;
  const kw = b.keyword;
  const K = cap(kw);
  const L = b.internalLinks;
  const fact = (i: number) => b.claimsToSource[i];
  const body = `${K} answers the phone when you cannot, books what callers ask for and hands everything else to a person. It works best when it runs on the same calendar and customer list as the rest of the business. Here is what it handles, what it should pass on, and how to work out whether it pays for itself.

## What it answers on a normal day

Most calls to a small business are short and routine. Someone wants to book, move or cancel an appointment. Someone wants to know your hours, where to park, or whether you take walk-ins. Someone wants a price for a common service. A good setup answers all of these on the first ring, in plain language, and writes the result straight into your calendar.

That last part matters. An answering tool that only takes messages leaves you with a list to work through at the end of the day. One that books into the live calendar finishes the job while the caller is still on the line. If you want the longer background, start with ${link(L[0], "how voice tools answer calls")}.

Calls also arrive when you are busy with a customer, on a delivery, or closed. Those are the calls that turn into voicemail and then into a booking somewhere else. Covering them is usually the first reason a business looks at ${kw}.

## What it hands to a person

Some calls should always reach a human. Write them down before you switch anything on:

- A complaint, or a caller who is upset.
- A request that falls outside your written policies, such as a refund you would only give case by case.
- A caller who asks for a specific person by name.
- Anything about health, safety or money that needs judgement.

For each one, decide where the call goes: a transfer to a phone that someone answers, a text to the owner, or a callback within an hour. Then test it. Call your own number and ask for a refund. If the call does not reach the right person, fix the rule before customers find it. ${link(L[1], "Read more about handing calls to your team", true)} covers the common patterns.

## Work out the cost with your own numbers

You do not need anyone else's statistics to judge this. Use your own. Here is the arithmetic as an example, with numbers you would replace with yours:

- 8 missed calls a week that would have booked
- An average ticket of $60
- 8 × $60 = $480 a week
- $480 × 50 working weeks = $24,000 a year

Not every one of those calls would have booked, and some callers would have tried again. Halve it if you want to be careful: $12,000 a year. Now compare that with what ${kw} costs you each month. If the careful number is still well above the cost, it is worth a trial. If it is close, look at how many calls you really miss first. Your phone provider can usually show missed calls by hour.

## How it fits the tools you already use

The setup that causes the least work is the one that shares your existing records. ${fact(0) ? `Here is how it works on ${input.site.name}: ${fact(0).replace(/\.$/, "")}.` : "Check that it reads and writes the same calendar you already use."} ${fact(1) ? `${fact(1).replace(/\.$/, "")}.` : ""}

Before you choose, ask three questions. Does it book into the calendar your staff already use? Does it know your services, prices and policies, or will you maintain a second copy? Can you change the greeting, hours and handoff rules yourself, without a support ticket? ${link(L[2], "This comparison of the options", true)} goes through the trade-offs in more detail.

## How to tell it is working

Give it a month and look at three numbers each week:

1. Calls answered, against calls received. Every call should get an answer.
2. Bookings made on calls, against the weeks before you switched it on.
3. Calls handed to a person, and whether each one reached someone.

Listen to a handful of recordings or read the transcripts every week. You are listening for callers who repeat themselves, questions it could not answer, and handoffs that went nowhere. Each one is a rule or a fact to add, not a reason to give up.

## Where to go next

If the arithmetic above works for your business, the next step is to see it answer a real call. ${link(L[3], "Book a walkthrough", true)} and bring your own services and hours, so you are judging it on your business and not on a demo script.
`;
  const fixedTitle = b.title.length <= input.rules.titleMax ? b.title : b.title.slice(0, input.rules.titleMax);
  return {
    title: fixedTitle,
    description: fitDescription(kw, input.rules.descriptionMin, input.rules.descriptionMax),
    bodyMd: body.replace(/\n{3,}/g, "\n\n"),
    cover: b.cover,
  };
}

/** Fact-check fixture: product claims sourced to the brand profile; scenario "unverifiable" adds a web claim whose quote is not on the fetched page. */
export function factAnswer(input: FactInput, scenario: Scenario, fetched: Map<string, string>): FactOutput {
  const claims: FactOutput["claims"] = input.site.productFacts
    .filter((f) => input.bodyMd.includes(f.replace(/\.$/, "").slice(0, 40)))
    .map((f) => ({ claim: f.replace(/\.$/, ""), status: "sourced", sourceUrl: BRAND_SOURCE, quote: f, replacement: null, note: "Stated in the client's confirmed product facts (first-party source)." }));
  claims.push({
    claim: "Eight missed calls a week at a $60 ticket is $480 a week",
    status: "rewritten",
    sourceUrl: null,
    quote: null,
    replacement: "Kept as example arithmetic, labelled as an example, with the reader's own numbers to substitute.",
    note: "Not a statistic about anyone: arithmetic on example inputs.",
  });
  if (scenario === "unverifiable") {
    const url = "https://sources.example/missed-calls-study";
    claims.push({
      claim: "Most callers who reach voicemail never call back",
      status: "sourced",
      sourceUrl: url,
      quote: "85% of callers who reach voicemail never call back",
      replacement: null,
      note: fetched.has(url) ? "Quoted from the fetched page." : "Could not fetch the page.",
    });
  }
  return { claims, bodyMd: scenario === "unverifiable" ? `${input.bodyMd.trim()}\n\nMost callers who reach voicemail never call back.\n` : input.bodyMd };
}

/** Recorded pages for the recorded fetcher (reserved .example domains: clearly synthetic, never a real organisation). */
export const RECORDED_PAGES: Record<string, { status: number; title: string; text: string }> = {
  "https://sources.example/missed-calls-study": {
    status: 200,
    title: "Phone habits survey (synthetic test page)",
    text: "This synthetic page exists for tests. It reports that some callers leave a message and some do not, and gives no percentage.",
  },
  "https://sources.example/consent-guide": {
    status: 200,
    title: "Consent for marketing texts (synthetic test page)",
    text: "Businesses must get the customer's consent before sending marketing text messages. Keep a record of when and how consent was given.",
  },
  "https://sonorch.ai/": { status: 200, title: "Sonorch", text: "Sonorch home page (recorded status only)." },
  "https://seasonx.ai/": { status: 200, title: "SeasonX", text: "SeasonX home page (recorded status only)." },
  "https://kitchenspot.ai/": { status: 200, title: "KitchenSpot", text: "KitchenSpot home page (recorded status only)." },
};
