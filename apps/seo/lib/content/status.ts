/**
 * The content item status machine: the only place that says which status
 * may follow which. Every write that changes a status calls assertTransition.
 *
 *   planned ─▶ generating ─▶ awaiting_review ─▶ approved ─▶ publishing ─▶ published ─▶ unpublished
 *      │           │               │    ▲            │            │
 *      ▼           ▼               ▼    │            ▼            ▼
 *   skipped      failed     changes_requested     (back to review    failed
 *                  │          (editor edits,        if edited)
 *                  ▼           resubmits)
 *              generating (retry / resume)
 *   awaiting_review ─▶ rejected (terminal: the slot gets a fresh planned item)
 */
export const STATUSES = [
  "planned",
  "generating",
  "failed",
  "awaiting_review",
  "changes_requested",
  "approved",
  "publishing",
  "published",
  "rejected",
  "unpublished",
  "skipped",
] as const;
export type ContentStatus = (typeof STATUSES)[number];

export const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  planned: ["generating", "skipped"],
  generating: ["awaiting_review", "approved", "failed", "planned"],
  failed: ["generating", "planned", "skipped"],
  awaiting_review: ["approved", "rejected", "changes_requested", "generating", "awaiting_review"],
  changes_requested: ["awaiting_review", "generating", "rejected"],
  approved: ["publishing", "awaiting_review", "changes_requested", "generating"],
  publishing: ["published", "failed", "approved"],
  published: ["unpublished", "publishing"],
  rejected: [],
  unpublished: ["publishing"],
  skipped: ["planned"],
};

export class TransitionError extends Error {
  constructor(
    public readonly from: ContentStatus,
    public readonly to: ContentStatus,
  ) {
    super(`An article that is ${LABEL[from].toLowerCase()} cannot become ${LABEL[to].toLowerCase()}.`);
    this.name = "TransitionError";
  }
}

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

export const LABEL: Record<ContentStatus, string> = {
  planned: "Planned",
  generating: "Writing",
  failed: "Failed",
  awaiting_review: "Awaiting review",
  changes_requested: "Changes requested",
  approved: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  rejected: "Rejected",
  unpublished: "Unpublished",
  skipped: "Skipped",
};

export type Tone = "neutral" | "ion" | "info" | "warn" | "amber" | "danger";
export const TONE: Record<ContentStatus, Tone> = {
  planned: "neutral",
  generating: "info",
  failed: "danger",
  awaiting_review: "amber",
  changes_requested: "amber",
  approved: "ion",
  publishing: "info",
  published: "ion",
  rejected: "danger",
  unpublished: "neutral",
  skipped: "neutral",
};

/** Items that hold a slot on the calendar (rejected and skipped ones do not). */
export const ON_CALENDAR: readonly ContentStatus[] = ["planned", "generating", "failed", "awaiting_review", "changes_requested", "approved", "publishing", "published", "unpublished"];
/** Items whose head term counts for rule 5 (published and scheduled work). */
export const HOLDS_HEAD_TERM: readonly ContentStatus[] = ["generating", "awaiting_review", "changes_requested", "approved", "publishing", "published"];
/** Content an editor may change in the editor. */
export const EDITABLE: readonly ContentStatus[] = ["awaiting_review", "changes_requested", "approved", "failed"];
/** Content a reviewer may decide on. */
export const REVIEWABLE: readonly ContentStatus[] = ["awaiting_review"];
