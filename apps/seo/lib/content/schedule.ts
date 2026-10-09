/**
 * Slot math (rule 2, section 7): a per-site schedule such as "Tuesday and
 * Friday, 09:00 site time" turns into publish instants, across time zones
 * and daylight-saving changes. Pure functions over IANA zones (Intl), no I/O.
 *
 *   - Slots fall on local wall-clock time in the site's zone: 09:00 stays
 *     09:00 local on both sides of a DST change (the UTC instant moves).
 *   - A local time that does not exist (the spring-forward gap, e.g. 02:30
 *     in New York on the second Sunday of March) moves forward by the gap
 *     (02:30 → 03:30), the way clocks do.
 *   - A local time that happens twice (the fall-back overlap, 01:30) takes
 *     the first occurrence.
 *   - Generation wakes `leadDays` calendar days before the slot, at the same
 *     local time (rolling model, default 3).
 *   - No back-dating by default (rule 3): a slot is never laid out in the
 *     past, and an article written after its slot date is dated the day it
 *     goes out, not the slot date.
 */

export type Schedule = {
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  days: number[];
  /** Local time "HH:MM" (or "HH:MM:SS"). */
  time: string;
  /** IANA time zone, e.g. "America/New_York". */
  timezone: string;
};

export type LocalParts = { date: string; time: string; weekday: number; year: number; month: number; day: number; hour: number; minute: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const pad = (n: number) => String(n).padStart(2, "0");

export function isTimeZone(tz: string): boolean {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `tz` at `instant`. */
export function localParts(instant: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(instant)) p[x.type] = x.value;
  const year = Number(p.year), month = Number(p.month), day = Number(p.day), hour = Number(p.hour), minute = Number(p.minute);
  return { year, month, day, hour, minute, weekday: WEEKDAY[p.weekday], date: `${p.year}-${p.month}-${p.day}`, time: `${pad(hour)}:${pad(minute)}` };
}

/** Offset of `tz` from UTC at `instant`, in minutes (New York in winter: −300). */
export function offsetMinutes(instant: Date, tz: string): number {
  const l = localParts(instant, tz);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, instant.getUTCSeconds());
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

function parseTime(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new RangeError(`not a time of day: ${t}`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

function parseDate(d: string): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new RangeError(`not a date: ${d}`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

/**
 * The UTC instant of a local wall-clock time in `tz`. Gap times move forward
 * by the gap; overlap times take the first (earlier) occurrence.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const { y, mo, d } = parseDate(date);
  const { h, m } = parseTime(time);
  const naive = Date.UTC(y, mo - 1, d, h, m);
  // candidate offsets: the zone's offset a day before and a day after the naive instant
  const offs = [...new Set([offsetMinutes(new Date(naive - 86_400_000), tz), offsetMinutes(new Date(naive + 86_400_000), tz), offsetMinutes(new Date(naive), tz)])];
  const matches = offs
    .map((o) => naive - o * 60_000)
    .filter((t) => {
      const l = localParts(new Date(t), tz);
      return l.date === date && l.hour === h && l.minute === m;
    })
    .sort((a, b) => a - b);
  if (matches.length) return new Date(matches[0]);
  // a gap: the wall time never happens. Read it with the offset in force before the jump, which
  // lands the same distance past the jump as the wall time was past its start (02:30 → 03:30).
  const before = offsetMinutes(new Date(naive - 86_400_000), tz);
  return new Date(naive - before * 60_000);
}

/** Calendar arithmetic on YYYY-MM-DD strings (time-zone free). */
export function addDaysIso(date: string, n: number): string {
  const { y, mo, d } = parseDate(date);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function isoWeekday(date: string): number {
  const { y, mo, d } = parseDate(date);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Whole days from date a to date b (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a), pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.d) - Date.UTC(pa.y, pa.mo - 1, pa.d)) / 86_400_000);
}

export function validateSchedule(s: Schedule): string[] {
  const problems: string[] = [];
  if (!s.days.length) problems.push("Pick at least one weekday.");
  if (s.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) problems.push("Weekdays are 1 (Monday) to 7 (Sunday).");
  try {
    parseTime(s.time);
  } catch {
    problems.push("Use a time like 09:00.");
  }
  if (!isTimeZone(s.timezone)) problems.push("Unknown time zone.");
  return problems;
}

/**
 * Every slot instant with from ≤ slot < to, in order. Slots are generated on
 * local calendar days, so DST never shifts a slot to another local day or hour.
 */
export function slotsBetween(s: Schedule, from: Date, to: Date): Date[] {
  if (to <= from) return [];
  const days = new Set(s.days);
  const out: Date[] = [];
  // one local day of margin on either side covers any UTC offset
  let date = addDaysIso(localParts(from, s.timezone).date, -1);
  const last = addDaysIso(localParts(to, s.timezone).date, 1);
  for (let guard = 0; date <= last && guard < 4000; guard++, date = addDaysIso(date, 1)) {
    if (!days.has(isoWeekday(date))) continue;
    const at = zonedToUtc(date, s.time, s.timezone);
    if (at >= from && at < to) out.push(at);
  }
  return out;
}

/** The next n slot instants at or after `after`. */
export function nextSlots(s: Schedule, after: Date, n: number): Date[] {
  const out: Date[] = [];
  let from = after;
  for (let window = 0; out.length < n && window < 60; window++) {
    const to = new Date(from.getTime() + 14 * 86_400_000);
    out.push(...slotsBetween(s, from, to));
    from = to;
  }
  return out.slice(0, n);
}

/**
 * When rolling generation wakes up for a slot: `leadDays` local calendar days
 * before the slot, at the slot's local time (never before `now` matters to
 * the caller, not here).
 */
export function generationWakeAt(slotAt: Date, leadDays: number, tz: string): Date {
  const l = localParts(slotAt, tz);
  return zonedToUtc(addDaysIso(l.date, -leadDays), l.time, tz);
}

/** True once a rolling slot is inside its lead window (and not yet past, unless it is overdue: then it is due too). */
export function generationDue(slotAt: Date, leadDays: number, tz: string, now: Date): boolean {
  return now >= generationWakeAt(slotAt, leadDays, tz);
}

export const BACKDATING_WARNING =
  "A post dated before it was written puts a false datePublished in its structured data, and Google can compare that date with the day it first saw the URL. Leave back-dating off unless you are migrating articles that really were published on those dates.";

/**
 * The date an article carries when it goes out (frontmatter `date`, JSON
 * datePublished), in the site's zone. Without back-dating it is never before
 * the day it was written nor before the day it actually goes out.
 */
export function publishDateFor(slotAt: Date, opts: { writtenAt: Date | null; now: Date; timezone: string; allowBackdating: boolean }): string {
  const slotDay = localParts(slotAt, opts.timezone).date;
  if (opts.allowBackdating) return slotDay;
  const floor = [opts.now, opts.writtenAt].filter((d): d is Date => !!d).map((d) => localParts(d, opts.timezone).date);
  return [slotDay, ...floor].sort().at(-1)!;
}

/** May a slot be (re)scheduled to `at`? Never into the past unless back-dating is on. */
export function canScheduleAt(at: Date, now: Date, allowBackdating: boolean): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(at.getTime())) return { ok: false, reason: "That is not a date." };
  if (at.getTime() < now.getTime() - 60_000 && !allowBackdating) {
    return { ok: false, reason: "That date is in the past. Back-dating is off for this site, so articles are only scheduled from now on." };
  }
  return { ok: true };
}

export const WEEKDAY_LABEL = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Tuesday and Friday at 09:00 (America/New_York)" */
export function describeSchedule(s: Schedule): string {
  const names = [...s.days].sort().map((d) => WEEKDAY_LABEL[d]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "no day";
  return `${list} at ${s.time.slice(0, 5)} (${s.timezone.replace(/_/g, " ")})`;
}
