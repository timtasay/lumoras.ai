/**
 * Runway (rule 1): how many days of scheduled content a site has left, so
 * the queue never runs dry silently. Pure function, no I/O.
 *
 * Under the rolling model (rule 2) articles are written a few days before
 * their slot, so "written articles" alone would always read short. Runway
 * therefore counts the slots that WILL go out:
 *
 *   ready    an item is written and approved or scheduled (or already
 *            published from today on): covered;
 *   review   written, waiting for a reviewer, slot still ahead: covered (a
 *            person has to act, but the content exists); once its slot has
 *            passed it is overdue and NOT covered;
 *   pending  an empty or generating slot: covered only while the pipeline can
 *            run for this site (schedule on, a real or demo author, a working
 *            publishing connection, the model budget above its reserve) and
 *            there is still a topic to write about (each pending slot uses one
 *            unit of topic supply: queued seeds plus saved keyword ideas);
 *   blocked  failed generation or changes requested and past due: not covered.
 *
 * Runway days = days from today (site time) to the last covered slot of the
 * unbroken run starting today. The first uncovered slot ends the run: a gap
 * is where the section goes stale. Level: 0 days (nothing covered) is
 * "empty" (red); fewer than the threshold is "low" (amber); else "ok".
 */
import { daysBetween } from "./schedule.ts";

export type SlotCoverage = "ready" | "review" | "pending" | "blocked";
export type RunwaySlot = { date: string; coverage: SlotCoverage; itemId?: string };
export type RunwayLevel = "ok" | "low" | "empty";

export type RunwayInput = {
  /** Today in the site's time zone, YYYY-MM-DD. */
  today: string;
  /** Every slot from today on, any order. */
  slots: RunwaySlot[];
  /** Can rolling generation run at all? null = yes; otherwise why not. */
  blockedReason: string | null;
  /** How many more topics the pipeline can pick (queued seeds + saved ideas). */
  topicSupply: number;
  thresholdDays: number;
};

export type Runway = {
  days: number;
  level: RunwayLevel;
  /** Last covered slot of the unbroken run, or null when nothing is covered. */
  coveredUntil: string | null;
  /** The first slot that will not go out, if any (where the gap starts). */
  gapAt: string | null;
  coveredSlots: number;
  /** For people: why the runway ends where it does. */
  reason: string;
};

export function runwayLevel(days: number, threshold: number): RunwayLevel {
  if (days <= 0) return "empty";
  return days < threshold ? "low" : "ok";
}

export function computeRunway(input: RunwayInput): Runway {
  const slots = input.slots.filter((s) => s.date >= input.today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let supply = Math.max(0, input.topicSupply);
  let coveredUntil: string | null = null;
  let covered = 0;
  let gapAt: string | null = null;
  let why = "";
  for (const s of slots) {
    let ok = false;
    switch (s.coverage) {
      case "ready":
        ok = true;
        break;
      case "review":
        ok = true;
        break;
      case "pending":
        if (input.blockedReason) why = input.blockedReason;
        else if (supply <= 0) why = "No topics left: the seed backlog and saved keyword ideas are used up.";
        else {
          supply--;
          ok = true;
        }
        break;
      case "blocked":
        why = "An article failed or is waiting on changes past its slot.";
        break;
    }
    if (!ok) {
      gapAt = s.date;
      break;
    }
    covered++;
    coveredUntil = s.date;
  }
  if (!slots.length) why = "No slots are scheduled.";
  const days = coveredUntil ? Math.max(0, daysBetween(input.today, coveredUntil)) : 0;
  // a slot today that is covered still counts as content: at least one day of runway
  const effective = coveredUntil ? Math.max(days, 1) : 0;
  const level = runwayLevel(effective, input.thresholdDays);
  const reason =
    level === "ok" && !gapAt
      ? `Covered through ${coveredUntil}.`
      : gapAt
        ? `Covered until ${coveredUntil ?? "today"}; the slot on ${gapAt} will not go out. ${why}`.trim()
        : coveredUntil
          ? `Covered through ${coveredUntil}, the last scheduled slot.`
          : why || "Nothing is scheduled.";
  return { days: effective, level, coveredUntil, gapAt, coveredSlots: covered, reason: reason.slice(0, 300) };
}

/** Should an alert go out now? On a worsening level, and again after a week while it stays low or empty. */
export function shouldAlert(level: RunwayLevel, last: { level: "low" | "empty" | null; at: Date | null }, now: Date): boolean {
  if (level === "ok") return false;
  if (!last.level || !last.at) return true;
  const worse = last.level === "low" && level === "empty";
  return worse || now.getTime() - last.at.getTime() >= 7 * 86_400_000;
}

export const RUNWAY_TEXT: Record<RunwayLevel, string> = {
  ok: "Runway is healthy.",
  low: "Runway is below the site's threshold.",
  empty: "The queue is empty: nothing will publish.",
};
