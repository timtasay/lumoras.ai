/**
 * The ten pipeline steps (build prompt section 7), in order. Each is a
 * persisted pipeline_steps row: input, output, model, tokens, cost,
 * duration, error; resumable and retryable from any step.
 */
export const STEP_KEYS = ["context", "scan", "topic", "brief", "draft", "factcheck", "lint", "review", "publish", "after"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export type StepKind = "free" | "paid" | "model" | "code" | "human" | "connector";

export const STEP_META: Record<StepKey, { label: string; kind: StepKind; summary: string }> = {
  context: { label: "Context", kind: "free", summary: "Everything the run may know about the site: brand profile, authors, routes, published and scheduled articles, research log, Search Console." },
  scan: { label: "Opportunity scan", kind: "free", summary: "Free signals first: striking-distance queries and pages with impressions but no clicks; refresh an existing page or write a new one." },
  topic: { label: "Topic selection", kind: "paid", summary: "Next seeds from the backlog through the metered path, rules 5–7 applied in code, one target picked with a written rationale." },
  brief: { label: "Brief", kind: "model", summary: "Outline, intent, keywords, questions, 3–6 internal links that exist on the publish date, and the claims that need sources." },
  draft: { label: "Draft", kind: "model", summary: "Written to the brand voice and SEO rules, under a configured author." },
  factcheck: { label: "Fact-check", kind: "model", summary: "A separate model call with fetching: every claim gets a primary source and a quote, or is rewritten or removed." },
  lint: { label: "Lint", kind: "code", summary: "Deterministic checks, no model: lengths, headings, words, banned words, links on the publish date, duplicate head term, author, cover." },
  review: { label: "Review gate", kind: "human", summary: "Approval required by default; autopilot only when the site turned it on." },
  publish: { label: "Publish", kind: "connector", summary: "Through the site's publishing connector at the slot time." },
  after: { label: "After publishing", kind: "free", summary: "Rank tracking queue, live URL check, Search Console inspection, runway; social derivatives arrive in Phase 5." },
};

export const KIND_LABEL: Record<StepKind, string> = {
  free: "Free data",
  paid: "Paid data · budgeted",
  model: "Model call",
  code: "Deterministic code",
  human: "Human gate",
  connector: "Publishing connector",
};

export const stepIndex = (k: StepKey) => STEP_KEYS.indexOf(k);
