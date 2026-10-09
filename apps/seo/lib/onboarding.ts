/** The guided onboarding sequence (build prompt section 12). "later" steps are designed and skippable until their phase. */
export type StepKey = "workspace" | "site" | "scan" | "brand" | "authors" | "search" | "publishing" | "schedule" | "done";
export const STEPS: { key: StepKey; label: string; later?: number }[] = [
  { key: "workspace", label: "Workspace" },
  { key: "site", label: "First site" },
  { key: "scan", label: "Sitemap scan" },
  { key: "brand", label: "Brand profile" },
  { key: "authors", label: "Authors" },
  { key: "search", label: "Search Console & GA4" },
  { key: "publishing", label: "Publishing" },
  { key: "schedule", label: "Schedule & budget" },
  { key: "done", label: "Done" },
];
export const stepIndex = (k: string) => STEPS.findIndex((s) => s.key === k);
