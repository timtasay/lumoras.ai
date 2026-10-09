import type { IconName } from "@/components/Icons";

/**
 * The ten pipeline steps (build prompt, section 7). Phase 0 ships them as
 * sample data for the run view; Phase 3 persists each as a pipeline_step row
 * and streams status over server-sent events.
 */
export type StepKind = "free" | "paid" | "model" | "code" | "human" | "connector";

export type Evidence = { claim: string; source: string; status: "sourced" | "rewritten" | "removed" };

export type PipelineStep = {
  key: string;
  label: string;
  icon: IconName;
  kind: StepKind;
  /** simulated duration, ms */
  ms: number;
  summary: string;
  inputs: [string, string][];
  outputs: [string, string][];
  model?: string;
  tokens?: number;
  /** USD */
  cost: number;
  evidence?: Evidence[];
};

export const KIND_LABEL: Record<StepKind, string> = {
  free: "Free data",
  paid: "Paid data · budgeted",
  model: "Model call",
  code: "Deterministic code",
  human: "Human gate",
  connector: "Publishing connector",
};

export const STEPS: PipelineStep[] = [
  {
    key: "context",
    label: "Context",
    icon: "db",
    kind: "free",
    ms: 900,
    summary: "Loaded everything the run is allowed to know about the site.",
    inputs: [["Site", "lumoras.ai"], ["Slot", "Tue 14 Oct, 09:00 site time"]],
    outputs: [
      ["Brand profile", "v12 · 6 sells, 4 does-not-sell"],
      ["Route inventory", "41 routes (sitemap, today)"],
      ["Published + scheduled", "23 items"],
      ["Search Console", "312 queries, 28 days"],
    ],
    cost: 0,
  },
  {
    key: "scan",
    label: "Opportunity scan",
    icon: "search",
    kind: "free",
    ms: 1200,
    summary: "Checked free signals first: striking-distance queries and pages to refresh.",
    inputs: [["Queries at positions 4–20", "18"], ["Pages with impressions, no clicks", "5"]],
    outputs: [["Decision", "Write a new article (no refresh beats it)"], ["Best gap", "“ai receptionist for salons”, avg pos 14.2"]],
    cost: 0,
  },
  {
    key: "topic",
    label: "Topic selection",
    icon: "target",
    kind: "paid",
    ms: 1600,
    summary: "Spent research credits on the next seeds, clustered by intent, applied the content rules.",
    inputs: [["Seeds from backlog", "2 (never fetched before)"], ["Budget left", "3,716 credits · reserve 500"]],
    outputs: [
      ["Target", "ai receptionist for salons"],
      ["Volume · KD · CPC", "880 · 23 · $6.10"],
      ["Rejected", "3 (1 duplicate head term, 2 not offered)"],
    ],
    model: "claude-opus-5-5",
    tokens: 6200,
    cost: 0.42,
  },
  {
    key: "brief",
    label: "Brief",
    icon: "doc",
    kind: "model",
    ms: 1100,
    summary: "Outline, intent, keywords, questions to answer, links valid on the publish date.",
    inputs: [["Search intent", "Commercial investigation"]],
    outputs: [["Sections", "7"], ["Internal links", "4 (all live on 14 Oct)"], ["Claims needing sources", "9"]],
    model: "claude-opus-5-5",
    tokens: 4100,
    cost: 0.09,
  },
  {
    key: "draft",
    label: "Draft",
    icon: "pen",
    kind: "model",
    ms: 2000,
    summary: "Written to the brand voice and SEO rules, under a configured author.",
    inputs: [["Author", "Configured site author"], ["Voice rules", "13"]],
    outputs: [["Words", "2,140"], ["Title", "58 characters"], ["Description", "149 characters"]],
    model: "claude-sonnet-5-5",
    tokens: 18200,
    cost: 0.21,
  },
  {
    key: "factcheck",
    label: "Fact-check",
    icon: "shield",
    kind: "model",
    ms: 1800,
    summary: "Every claim gets a primary source and quote, or is rewritten or removed.",
    inputs: [["Claims", "9"]],
    outputs: [["Sourced", "7"], ["Rewritten", "1"], ["Removed", "1 (no primary source)"]],
    model: "claude-opus-5-5",
    tokens: 22400,
    cost: 0.38,
    evidence: [
      { claim: "Businesses must get consent before sending marketing texts.", source: "fcc.gov · TCPA consumer guide", status: "sourced" },
      { claim: "Missed calls go to voicemail most of the time.", source: "Rewritten to cite the site’s own call data", status: "rewritten" },
      { claim: "AI receptionists cut no-shows by 50%.", source: "No primary source found", status: "removed" },
    ],
  },
  {
    key: "lint",
    label: "Lint",
    icon: "lint",
    kind: "code",
    ms: 700,
    summary: "Deterministic checks, no model: lengths, headings, links, duplicates, author, cover.",
    inputs: [["Rules", "14"]],
    outputs: [["Passed", "14 of 14"], ["Internal links on 14 Oct", "4 of 4 resolve"], ["External links", "6 of 6 return 200"]],
    cost: 0,
  },
  {
    key: "review",
    label: "Review gate",
    icon: "gate",
    kind: "human",
    ms: 0,
    summary: "Approval required (the default): an editor approves before anything goes live.",
    inputs: [["Mode", "Approval required"], ["Reviewers notified", "2"]],
    outputs: [["Decision", "Waiting for a reviewer"]],
    cost: 0,
  },
  {
    key: "publish",
    label: "Publish",
    icon: "send",
    kind: "connector",
    ms: 1200,
    summary: "Published through the site’s connector: Git, file per post, as a pull request.",
    inputs: [["Connector", "Git · open a pull request"], ["Path", "apps/web/content/insights/<slug>.md"]],
    outputs: [["Pull request", "opened, checks running"], ["Live URL", "after merge and deploy"]],
    cost: 0,
  },
  {
    key: "after",
    label: "After publishing",
    icon: "trend",
    kind: "free",
    ms: 1100,
    summary: "Measured from day one: tracking, live check, indexing, social drafts, runway.",
    inputs: [["Target keyword", "ai receptionist for salons"]],
    outputs: [["Rank tracking", "added (weekly)"], ["Live URL", "200 OK"], ["Social drafts", "5 channels"], ["Runway", "+3 days → 9 days"]],
    cost: 0.02,
  },
];

export const REVIEW_INDEX = STEPS.findIndex((s) => s.key === "review");
