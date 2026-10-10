/**
 * Site formats offered when adding a Git connection ("Site format" on the
 * Connections tab and in onboarding). A preset fills the repository, branch,
 * folder, file name, live path, frontmatter template, body format, author
 * keys and format check; everything stays editable before saving.
 *
 * The Lumoras sites' formats are written down in docs/site-formats/*.md.
 * sonorch.ai and seasonx.ai live on Gitea (owner decision #2, option (a)):
 * one MDX file per post with YAML frontmatter, as a pull request into dev
 * (the owner's workflow: work lands on dev, then dev is promoted to main).
 */
import { DEFAULT_TEMPLATE, LUMORAS_INSIGHTS_TEMPLATE, type BodyFormat } from "./frontmatter.ts";
import type { GitProvider } from "./git.ts";
import { LUMORAS_GIT } from "./lumoras.ts";
import type { SeoRules } from "../validation.ts";

export type SitePreset = {
  key: string;
  label: string;
  provider: GitProvider;
  repository: string;
  branch: string;
  contentDir: string;
  filenamePattern: string;
  livePath: string;
  template: string;
  bodyFormat: BodyFormat;
  authorKeys: Record<string, string>;
  requiredPath: string;
  /** The site this preset is for; offered first on that site. Empty: any site. */
  domain: string;
  /** Lint rules the site's own build enforces (its cover art), applied to the site's SEO rules by the seed. */
  seoRules?: Partial<SeoRules>;
};

/**
 * sonorch.ai (docs/site-formats/sonorch.ai.md): src/content/posts/<slug>.mdx,
 * fields in the site's order, author as the site's key (tim, tran, alex,
 * jayden), cover.motif from its eight motifs with one to three chips of at most
 * 26 characters. updatedAt is left out: the site wants it only for real
 * revisions and never earlier than publishedAt. The site's build validates
 * every field and fails the pull request's CI on anything wrong.
 */
export const SONORCH_TEMPLATE = `---
slug: {{slug}}
title: {{title}}
description: {{description}}
publishedAt: {{date}}
author: {{author.key}}
readingMinutes: {{readingMinutes}}
cover:
  motif: {{cover.kind}}
  chips: {{cover.chips}}
---`;

export const SONORCH_GIT: SitePreset = {
  key: "sonorch",
  label: "sonorch.ai insights (MDX, Gitea)",
  provider: "gitea",
  repository: "https://gitea.timdatinh.com/lumoras/sonorch.ai",
  branch: "dev",
  contentDir: "src/content/posts",
  filenamePattern: "{{slug}}.mdx",
  livePath: "/insights/{{slug}}",
  template: SONORCH_TEMPLATE,
  bodyFormat: "mdx",
  // the site's AUTHORS (src/content/post-schema.ts): byline name → key
  authorKeys: { Tim: "tim", Tran: "tran", Alex: "alex", Jayden: "jayden" },
  // added by the format change (lumoras/sonorch.ai#1 into main, #2 into dev); publishing waits for it on dev
  requiredPath: "src/content/post-schema.ts",
  domain: "sonorch.ai",
  seoRules: { coverKinds: ["calendar", "phone", "receipt", "card", "chart", "clock", "people", "list"], coverChips: 2, coverChipMax: 26 },
};

const GENERIC: SitePreset = {
  key: "generic",
  label: "Markdown site (Next.js, Astro, Hugo, Jekyll)",
  provider: "github",
  repository: "",
  branch: "main",
  contentDir: "content/posts",
  filenamePattern: "{{slug}}.md",
  livePath: "/blog/{{slug}}",
  template: DEFAULT_TEMPLATE,
  bodyFormat: "markdown",
  authorKeys: {},
  requiredPath: "",
  domain: "",
};

const LUMORAS: SitePreset = {
  key: "lumoras",
  label: "lumoras.ai insights (content spec)",
  provider: LUMORAS_GIT.provider,
  repository: LUMORAS_GIT.repository,
  branch: LUMORAS_GIT.branch,
  contentDir: LUMORAS_GIT.contentDir,
  filenamePattern: LUMORAS_GIT.filenamePattern,
  livePath: LUMORAS_GIT.livePath,
  template: LUMORAS_INSIGHTS_TEMPLATE,
  bodyFormat: "markdown",
  authorKeys: {},
  requiredPath: "",
  domain: "lumoras.ai",
};

export const SITE_PRESETS: SitePreset[] = [GENERIC, LUMORAS, SONORCH_GIT];

/** The presets for a site: its own first (when there is one), then the rest. */
export function presetsFor(domain: string): SitePreset[] {
  const own = SITE_PRESETS.filter((p) => p.domain === domain);
  return [...own, ...SITE_PRESETS.filter((p) => p.domain !== domain)];
}

/** A preset as the connection form's input (createConnection, the seed). */
export function presetConnection(p: SitePreset, label: string) {
  return {
    kind: "git" as const,
    label,
    provider: p.provider,
    repository: p.repository,
    branch: p.branch,
    contentDir: p.contentDir,
    filenamePattern: p.filenamePattern,
    frontmatterTemplate: p.template,
    mode: "pr" as const,
    livePath: p.livePath,
    bodyFormat: p.bodyFormat,
    authorKeys: p.authorKeys,
    requiredPath: p.requiredPath,
  };
}
