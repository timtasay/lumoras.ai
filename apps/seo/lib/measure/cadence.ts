/**
 * Measurement cadences (site settings) as pure functions: which window a run
 * belongs to, whether a kind of work is due, and when it is next due.
 *
 * A cadence divides time into calendar windows in the site's time zone
 * (a local day, an ISO week, a pair of ISO weeks, a month, a quarter). Each
 * window gets at most one run of each kind: the window key is the idempotency
 * key on measurement_runs (UNIQUE site, kind, window_key) and the pg-boss
 * singleton key, so a tick that fires twice, or a job delivered twice, does
 * the work once. A minimum gap since the last success stops two runs landing
 * back to back across a window boundary (Sunday, then Monday). A refused or
 * failed run is retried in the same window once its retry_after passes.
 *
 * Search Console data is dated in Pacific time (Google's reporting day), so
 * its daily window is the Pacific date, not the site's.
 */
import { localParts } from "../content/schedule.ts";

export const RANK_CADENCES = ["off", "daily", "weekly", "fortnightly", "monthly"] as const;
export const AUDIT_CADENCES = ["off", "monthly", "quarterly"] as const;
export const BACKLINK_CADENCES = ["off", "monthly", "quarterly"] as const;
export type Cadence = "off" | "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly";

export const CADENCE_LABEL: Record<Cadence, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** Search Console reports in Pacific time. */
export const GSC_TZ = "America/Los_Angeles";

const H = 3_600_000;
/** The shortest time between two successful runs of a cadence. */
export const MIN_GAP_MS: Record<Exclude<Cadence, "off">, number> = {
  daily: 20 * H,
  weekly: 5 * 24 * H,
  fortnightly: 10 * 24 * H,
  monthly: 20 * 24 * H,
  quarterly: 60 * 24 * H,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO-8601 week of a calendar date (YYYY-MM-DD): the year it belongs to and its number. */
export function isoWeek(date: string): { year: number; week: number } {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7; // Monday 1 … Sunday 7
  t.setUTCDate(t.getUTCDate() + 4 - dow); // the Thursday of this week decides the year
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return { year, week };
}

/** The window an instant falls in, for a cadence, in a time zone: "d:2026-10-10", "w:2026-W41", "f:2026-W41", "m:2026-10", "q:2026-Q4". */
export function windowKey(cadence: Exclude<Cadence, "off">, at: Date, tz: string): string {
  const l = localParts(at, tz);
  switch (cadence) {
    case "daily":
      return `d:${l.date}`;
    case "weekly": {
      const w = isoWeek(l.date);
      return `w:${w.year}-W${pad(w.week)}`;
    }
    case "fortnightly": {
      // pairs of ISO weeks (1–2, 3–4, …), named by the pair's first week
      const w = isoWeek(l.date);
      return `f:${w.year}-W${pad(w.week - ((w.week - 1) % 2))}`;
    }
    case "monthly":
      return `m:${l.year}-${pad(l.month)}`;
    case "quarterly":
      return `q:${l.year}-Q${Math.floor((l.month - 1) / 3) + 1}`;
  }
}

export type RunMark = { window_key: string; status: string; started_at: Date; finished_at?: Date | null; retry_after?: Date | null };

export type DueDecision = { due: true; windowKey: string; retry: boolean } | { due: false; reason: string; windowKey: string | null };

/**
 * Is work of this cadence due now?
 *   - off: never;
 *   - a run in this window that succeeded, is running, waiting or was skipped: no;
 *   - a refused or failed run in this window: yes, once its retry_after has passed;
 *   - otherwise: yes, unless the last success is younger than the cadence's minimum gap.
 */
export function isDue(cadence: Cadence, now: Date, tz: string, runs: RunMark[]): DueDecision {
  if (cadence === "off") return { due: false, reason: "off", windowKey: null };
  const key = windowKey(cadence, now, tz);
  const here = runs.find((r) => r.window_key === key);
  if (here) {
    if (here.status === "refused" || here.status === "failed") {
      if (!here.retry_after || here.retry_after.getTime() <= now.getTime()) return { due: true, windowKey: key, retry: true };
      return { due: false, reason: `retry after ${here.retry_after.toISOString()}`, windowKey: key };
    }
    return { due: false, reason: `already ${here.status} in ${key}`, windowKey: key };
  }
  const lastOk = runs
    .filter((r) => r.status === "succeeded")
    .map((r) => (r.finished_at ?? r.started_at).getTime())
    .sort((a, b) => b - a)[0];
  if (lastOk !== undefined && now.getTime() - lastOk < MIN_GAP_MS[cadence]) return { due: false, reason: "too soon after the last run", windowKey: key };
  return { due: true, windowKey: key, retry: false };
}

/** Start of the window after the one `at` is in (local midnight), as an instant. Used for "next check" labels. */
export function nextWindowStart(cadence: Exclude<Cadence, "off">, at: Date, tz: string): Date {
  const key = windowKey(cadence, at, tz);
  // walk forward hour by hour until the key changes, then back to that local day's start (bounded: ≤ 93 days)
  let t = at.getTime();
  const step = cadence === "daily" ? H : 6 * H;
  for (let i = 0; i < 2000; i++) {
    t += step;
    if (windowKey(cadence, new Date(t), tz) !== key) break;
  }
  // refine to the first hour of the new window
  while (windowKey(cadence, new Date(t - H), tz) !== key) t -= H;
  return new Date(t);
}

/** When the next scheduled run should happen (null when off). Never before the minimum gap after the last success. */
export function nextDueAt(cadence: Cadence, now: Date, tz: string, runs: RunMark[]): Date | null {
  if (cadence === "off") return null;
  const d = isDue(cadence, now, tz, runs);
  if (d.due) return now;
  const here = runs.find((r) => r.window_key === d.windowKey);
  if (here && (here.status === "refused" || here.status === "failed") && here.retry_after) return here.retry_after;
  const lastOk = runs.filter((r) => r.status === "succeeded").map((r) => (r.finished_at ?? r.started_at).getTime()).sort((a, b) => b - a)[0];
  const next = here ? nextWindowStart(cadence, now, tz).getTime() : now.getTime();
  return new Date(Math.max(next, lastOk !== undefined ? lastOk + MIN_GAP_MS[cadence] : 0));
}

/** Pacific date (Search Console's reporting day) of an instant. */
export const pacificDate = (at: Date) => localParts(at, GSC_TZ).date;
