/**
 * lumoras.ai's publishing settings (owner decision, 10 October 2026): the
 * real repository timtasay/lumoras.ai, base branch dev (the team works on dev
 * and pull requests target it), one Markdown file per article in
 * apps/web/content/insights/<slug>.md with the frontmatter of
 * docs/content-spec.md, as a pull request. The token is the owner's
 * fine-grained token (Contents + Pull requests read/write, that repository
 * only), entered in the app's encrypted connection, never in git or chat.
 */
import { LUMORAS_INSIGHTS_TEMPLATE } from "./frontmatter.ts";

export const LUMORAS_GIT = {
  provider: "github" as const,
  repository: "https://github.com/timtasay/lumoras.ai",
  branch: "dev",
  contentDir: "apps/web/content/insights",
  filenamePattern: "{{slug}}.md",
  frontmatterTemplate: LUMORAS_INSIGHTS_TEMPLATE,
  mode: "pr" as const,
  livePath: "/insights/{{slug}}",
};
