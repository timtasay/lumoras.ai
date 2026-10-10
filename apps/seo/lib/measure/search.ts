/**
 * Search Console sync planning and aggregation, as pure functions.
 *
 * Google's documentation (docs/external-apis.md):
 *   - dates are Pacific-time calendar days; data "is typically available after
 *     2 to 3 days"; with dataState "all" the response's
 *     metadata.first_incomplete_date names the first day that may still
 *     change (only when grouped by date and the range has incomplete data);
 *   - Search Console keeps 16 months;
 *   - the Search Analytics method exposes at most 50,000 rows per day per
 *     search type, in pages of up to 25,000 (rowLimit / startRow): query one
 *     day at a time to get everything.
 *
 * So a sync reads:
 *   totals   one request grouped by date over the whole window (≤ 490 rows);
 *   details  per day, grouped by query+page and by page, paginated;
 * and a day is stored as provisional (final = false) until Google calls it
 * final, then re-read on the next syncs until it is.
 */
import { addDaysIso } from "../content/schedule.ts";
import type { GscRow } from "../google/analysis.ts";

export const GSC_RETENTION_MONTHS = 16;
/** Days re-read on every daily sync even when Google says they are final (late revisions). */
export const GSC_LOOKBACK_DAYS = 4;
/** Detail days fetched per backfill step (each day is two or more requests). */
export const GSC_CHUNK_DAYS = 30;
/** Search Analytics page size and the per-day cap Google documents. */
export const GSC_PAGE_ROWS = 25_000;
export const GSC_DAY_CAP_ROWS = 50_000;

/** First day Search Console still has, counting back `months` calendar months from a Pacific date. */
export function retentionStart(today: string, months = GSC_RETENTION_MONTHS): string {
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  // one extra day of margin: the oldest day may already be gone by the time a slow backfill reaches it
  return addDaysIso(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, 1);
}

export type SyncState = {
  /** Oldest day whose detail rows are stored; null before the first sync. */
  backfillCursor: string | null;
  backfillFrom: string | null;
  /** Newest day Google called final at the last sync. */
  finalThrough: string | null;
};

export type SyncPlan = {
  /** Range for the date-grouped totals request. */
  totals: { start: string; end: string };
  /** Days whose query/page details are fetched now, newest first. */
  detailDays: string[];
  backfillFrom: string;
  /** The cursor after this step (oldest detail day stored). */
  cursorAfter: string;
  backfillDone: boolean;
  firstSync: boolean;
};

const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

/** Inclusive list of days from `start` to `end`, newest first. */
export function daysDesc(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = end; d >= start; d = addDaysIso(d, -1)) out.push(d);
  return out;
}

/**
 * What one sync step reads. `today` is the Pacific date. The newest day read is
 * yesterday (today's numbers are a few hours old at best and read like a drop).
 *   - First sync: totals for the whole retention window; details for the newest chunk.
 *   - Later syncs: totals and details for every day not yet final (and at least the
 *     last GSC_LOOKBACK_DAYS), plus the next backfill chunk while one remains.
 */
export function planGscSync(today: string, state: SyncState, opts: { chunkDays?: number; lookbackDays?: number; months?: number } = {}): SyncPlan {
  const chunk = opts.chunkDays ?? GSC_CHUNK_DAYS;
  const lookback = opts.lookbackDays ?? GSC_LOOKBACK_DAYS;
  const end = addDaysIso(today, -1);
  const from = state.backfillFrom ?? retentionStart(today, opts.months);
  const firstSync = state.backfillCursor === null;
  if (firstSync) {
    const start = maxDate(from, addDaysIso(end, -(chunk - 1)));
    return { totals: { start: from, end }, detailDays: daysDesc(start, end), backfillFrom: from, cursorAfter: start, backfillDone: start <= from, firstSync };
  }
  const settleFrom = minDate(state.finalThrough ? addDaysIso(state.finalThrough, 1) : end, addDaysIso(end, -(lookback - 1)));
  const recent = daysDesc(maxDate(settleFrom, from), end);
  const cursor = state.backfillCursor!;
  let older: string[] = [];
  let cursorAfter = cursor;
  if (cursor > from) {
    const oldEnd = addDaysIso(cursor, -1);
    const oldStart = maxDate(from, addDaysIso(oldEnd, -(chunk - 1)));
    older = daysDesc(oldStart, oldEnd);
    cursorAfter = oldStart;
  }
  const detailDays = [...new Set([...recent, ...older])];
  return { totals: { start: recent[recent.length - 1] ?? end, end }, detailDays, backfillFrom: from, cursorAfter, backfillDone: cursorAfter <= from, firstSync };
}

/** Whether a day is final, given the response's first_incomplete_date (absent: every day in the range is final). */
export const isFinalDay = (day: string, firstIncomplete: string | null) => !firstIncomplete || day < firstIncomplete;

export type Agg = { clicks: number; impressions: number; position: number };

/**
 * Impression-weighted average position. Search Console's position is the
 * average top position per impression, so the right way to combine days or
 * pages is to weight by impressions (a page seen once at #90 must not drag a
 * page seen 5,000 times at #3).
 */
export function weightedPosition(rows: { impressions: number; position: number }[]): number {
  const imp = rows.reduce((s, r) => s + r.impressions, 0);
  if (!imp) return 0;
  return rows.reduce((s, r) => s + r.position * r.impressions, 0) / imp;
}

/** Combines daily rows by key (query+page, page…) into one row per key, the way Search Console would report the range. */
export function aggregateRows<T extends { clicks: number; impressions: number; position: number }>(rows: T[], key: (r: T) => string[]): GscRow[] {
  const by = new Map<string, { keys: string[]; rows: T[] }>();
  for (const r of rows) {
    const k = key(r);
    const id = JSON.stringify(k);
    const g = by.get(id) ?? { keys: k, rows: [] };
    g.rows.push(r);
    by.set(id, g);
  }
  return [...by.values()].map((g) => {
    const clicks = g.rows.reduce((s, r) => s + r.clicks, 0);
    const impressions = g.rows.reduce((s, r) => s + r.impressions, 0);
    return { keys: g.keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: Math.round(weightedPosition(g.rows) * 100) / 100 };
  });
}

/** Percent change from `prev` to `cur` (null when there is nothing to compare with). */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/**
 * Untrusted strings from Google (queries, page URLs) are stored as data and
 * rendered as text. This only bounds their length and strips control
 * characters so a row can never break a table, a log line or a CSV.
 */
export function cleanText(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, max);
}
