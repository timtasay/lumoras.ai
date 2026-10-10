/**
 * Phase 4 pure logic: cadence windows and scheduling, Search Console date-lag
 * handling and sync planning, aggregation (impression-weighted position),
 * rank movement, chart scales and data transforms, GA4 measurement health,
 * audit grouping, and the scheduler's due list.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDue, isoWeek, MIN_GAP_MS, nextDueAt, pacificDate, windowKey, type RunMark } from "../../lib/measure/cadence.ts";
import { aggregateRows, daysDesc, isFinalDay, pctChange, planGscSync, retentionStart, weightedPosition, cleanText } from "../../lib/measure/search.ts";
import { alignSeries, byMovement, keywordTrends, movement, movementSpoken, movementSummary, movementText, rankAxisMax } from "../../lib/measure/movement.ts";
import { bucketSums, columnDownPath, columnPath, fillDays, linear, linePath, niceTicks, rankTicks, timeTickIndices, valueTicks } from "../../lib/ui/chart-math.ts";
import { assessHealth } from "../../lib/measure/health.ts";
import { describeIssue, groupIssues, normalizeIssueType } from "../../lib/measure/audit-groups.ts";
import { dueWork, type DueInput } from "../../lib/measure/scheduler.ts";
import { diffReferring } from "../../lib/measure/backlinks.ts";

const at = (s: string) => new Date(s);
const run = (window_key: string, status: string, started: string, extra: Partial<RunMark> = {}): RunMark => ({ window_key, status, started_at: at(started), finished_at: at(started), ...extra });

describe("cadence windows", () => {
  it("ISO weeks, including the year boundary", () => {
    assert.deepEqual(isoWeek("2026-10-10"), { year: 2026, week: 41 });
    assert.deepEqual(isoWeek("2026-01-01"), { year: 2026, week: 1 }); // Thursday
    assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 }); // Friday: still 2026's last week
    assert.deepEqual(isoWeek("2024-12-30"), { year: 2025, week: 1 }); // Monday of 2025-W01
  });

  it("window keys per cadence, in the site's time zone", () => {
    const t = at("2026-10-12T02:30:00Z"); // Sunday 22:30 in New York, Monday in UTC
    assert.equal(windowKey("daily", t, "America/New_York"), "d:2026-10-11");
    assert.equal(windowKey("daily", t, "UTC"), "d:2026-10-12");
    assert.equal(windowKey("weekly", t, "America/New_York"), "w:2026-W41");
    assert.equal(windowKey("weekly", t, "UTC"), "w:2026-W42");
    assert.equal(windowKey("fortnightly", t, "UTC"), "f:2026-W41"); // weeks 41–42 pair
    assert.equal(windowKey("fortnightly", at("2026-10-05T12:00:00Z"), "UTC"), "f:2026-W41");
    assert.equal(windowKey("fortnightly", at("2026-09-30T12:00:00Z"), "UTC"), "f:2026-W39");
    assert.equal(windowKey("monthly", at("2026-10-31T23:30:00Z"), "America/Los_Angeles"), "m:2026-10");
    assert.equal(windowKey("monthly", at("2026-10-31T23:30:00Z"), "Europe/Berlin"), "m:2026-11");
    assert.equal(windowKey("quarterly", at("2026-12-31T12:00:00Z"), "UTC"), "q:2026-Q4");
    assert.equal(windowKey("quarterly", at("2027-01-01T12:00:00Z"), "UTC"), "q:2027-Q1");
  });

  it("windows stay correct across a DST change (local days, not 24-hour blocks)", () => {
    // New York falls back on 1 November 2026: the local day has 25 hours
    assert.equal(windowKey("daily", at("2026-11-01T04:30:00Z"), "America/New_York"), "d:2026-11-01"); // 00:30 EDT
    assert.equal(windowKey("daily", at("2026-11-02T04:30:00Z"), "America/New_York"), "d:2026-11-01"); // 23:30 EST, same local day
    assert.equal(windowKey("daily", at("2026-11-02T05:30:00Z"), "America/New_York"), "d:2026-11-02");
  });

  it("isDue: off never; once per window; refused/failed retry after retry_after; a minimum gap across window edges", () => {
    const now = at("2026-10-13T09:00:00Z"); // Tuesday, W42
    assert.deepEqual(isDue("off", now, "UTC", []), { due: false, reason: "off", windowKey: null });
    assert.deepEqual(isDue("weekly", now, "UTC", []), { due: true, windowKey: "w:2026-W42", retry: false });
    assert.equal(isDue("weekly", now, "UTC", [run("w:2026-W42", "succeeded", "2026-10-12T09:00:00Z")]).due, false);
    assert.equal(isDue("weekly", now, "UTC", [run("w:2026-W42", "running", "2026-10-13T08:00:00Z")]).due, false);
    // refused earlier this week, retry_after not reached / reached
    const refused = run("w:2026-W42", "refused", "2026-10-12T09:00:00Z", { retry_after: at("2026-10-13T10:00:00Z") });
    assert.equal(isDue("weekly", now, "UTC", [refused]).due, false);
    assert.deepEqual(isDue("weekly", at("2026-10-13T10:00:00Z"), "UTC", [refused]), { due: true, windowKey: "w:2026-W42", retry: true });
    // Sunday's run blocks Monday's (new window, but only a day later)
    const sunday = run("w:2026-W41", "succeeded", "2026-10-11T22:00:00Z");
    assert.equal(isDue("weekly", at("2026-10-12T09:00:00Z"), "UTC", [sunday]).due, false);
    assert.equal(isDue("weekly", at("2026-10-17T09:00:00Z"), "UTC", [sunday]).due, true);
    assert.ok(MIN_GAP_MS.weekly < 7 * 86_400_000);
  });

  it("nextDueAt: now when due; the next window or the minimum gap otherwise", () => {
    const now = at("2026-10-13T09:00:00Z");
    assert.equal(nextDueAt("off", now, "UTC", []), null);
    assert.deepEqual(nextDueAt("weekly", now, "UTC", []), now);
    const next = nextDueAt("weekly", now, "UTC", [run("w:2026-W42", "succeeded", "2026-10-12T09:00:00Z")])!;
    assert.equal(next.toISOString(), "2026-10-19T00:00:00.000Z", "the start of next week (Monday)");
    const m = nextDueAt("monthly", at("2026-10-31T12:00:00Z"), "UTC", [run("m:2026-10", "succeeded", "2026-10-30T09:00:00Z")])!;
    assert.equal(m.toISOString(), new Date(at("2026-10-30T09:00:00Z").getTime() + MIN_GAP_MS.monthly).toISOString(), "the gap is later than the next window");
  });

  it("Search Console's reporting day is the Pacific date", () => {
    assert.equal(pacificDate(at("2026-10-10T06:00:00Z")), "2026-10-09");
    assert.equal(pacificDate(at("2026-10-10T08:00:00Z")), "2026-10-10");
  });
});

describe("Search Console sync planning and date lag", () => {
  it("retention starts 16 months back (plus a day of margin), clamped to short months", () => {
    assert.equal(retentionStart("2026-10-10"), "2025-06-11");
    assert.equal(retentionStart("2026-06-30"), "2025-03-01"); // 2025-02-28 + 1
  });

  it("first sync: totals for the whole window, details for the newest 30 days, ending yesterday", () => {
    const p = planGscSync("2026-10-10", { backfillCursor: null, backfillFrom: null, finalThrough: null });
    assert.deepEqual(p.totals, { start: "2025-06-11", end: "2026-10-09" });
    assert.equal(p.detailDays.length, 30);
    assert.equal(p.detailDays[0], "2026-10-09");
    assert.equal(p.detailDays[29], "2026-09-10");
    assert.equal(p.cursorAfter, "2026-09-10");
    assert.equal(p.firstSync, true);
    assert.equal(p.backfillDone, false);
  });

  it("later syncs: every day not yet final (and at least the last four), plus the next backfill chunk", () => {
    const p = planGscSync("2026-10-12", { backfillCursor: "2026-09-10", backfillFrom: "2025-06-11", finalThrough: "2026-10-07" });
    assert.deepEqual(p.totals, { start: "2026-10-08", end: "2026-10-11" });
    assert.deepEqual(p.detailDays.slice(0, 4), ["2026-10-11", "2026-10-10", "2026-10-09", "2026-10-08"]);
    assert.equal(p.detailDays[4], "2026-09-09", "the backfill chunk continues below the cursor");
    assert.equal(p.cursorAfter, "2026-08-11");
    // Google calls everything final through yesterday: still re-read the last four days (late revisions)
    const q = planGscSync("2026-10-12", { backfillCursor: "2025-06-11", backfillFrom: "2025-06-11", finalThrough: "2026-10-11" });
    assert.deepEqual(q.detailDays, ["2026-10-11", "2026-10-10", "2026-10-09", "2026-10-08"]);
    assert.equal(q.backfillDone, true);
    // a sync that was not run for a week catches up on every non-final day
    const late = planGscSync("2026-10-20", { backfillCursor: "2025-06-11", backfillFrom: "2025-06-11", finalThrough: "2026-10-07" });
    assert.equal(late.totals.start, "2026-10-08");
    assert.equal(late.detailDays.length, 12);
  });

  it("the backfill never goes past retention and finishes", () => {
    const p = planGscSync("2026-10-10", { backfillCursor: "2025-06-20", backfillFrom: "2025-06-11", finalThrough: "2026-10-07" }, { chunkDays: 30 });
    assert.equal(p.cursorAfter, "2025-06-11");
    assert.equal(p.backfillDone, true);
    assert.ok(p.detailDays.every((d) => d >= "2025-06-11"));
  });

  it("first_incomplete_date: days from it on are provisional; without it every day is final", () => {
    assert.equal(isFinalDay("2026-10-07", "2026-10-08"), true);
    assert.equal(isFinalDay("2026-10-08", "2026-10-08"), false);
    assert.equal(isFinalDay("2026-10-09", null), true);
    assert.deepEqual(daysDesc("2026-10-08", "2026-10-10"), ["2026-10-10", "2026-10-09", "2026-10-08"]);
  });

  it("aggregation weights position by impressions (a page seen once at #90 does not drag a page seen 5,000 times at #3)", () => {
    assert.equal(weightedPosition([{ impressions: 5000, position: 3 }, { impressions: 1, position: 90 }]).toFixed(3), "3.017");
    assert.equal(weightedPosition([]), 0);
    const rows = aggregateRows(
      [
        { q: "a", clicks: 10, impressions: 100, position: 4 },
        { q: "a", clicks: 0, impressions: 300, position: 8 },
        { q: "b", clicks: 1, impressions: 10, position: 2 },
      ],
      (r) => [r.q],
    );
    assert.deepEqual(rows.find((r) => r.keys[0] === "a"), { keys: ["a"], clicks: 10, impressions: 400, ctr: 0.025, position: 7 });
    assert.equal(pctChange(120, 100), 20);
    assert.equal(pctChange(5, 0), null);
    assert.equal(cleanText("bad\u0000query\nline", 20), "bad query line");
  });
});

describe("rank movement", () => {
  it("up, down, same, entered, lost, new, none", () => {
    assert.deepEqual(movement(14, 9), { kind: "up", delta: 5 });
    assert.deepEqual(movement(3, 7), { kind: "down", delta: -4 });
    assert.deepEqual(movement(5, 5), { kind: "same", delta: 0 });
    assert.deepEqual(movement(null, 18), { kind: "entered", delta: null });
    assert.deepEqual(movement(22, null), { kind: "lost", delta: null });
    assert.deepEqual(movement(undefined, 8), { kind: "new", delta: null });
    assert.deepEqual(movement(null, null), { kind: "none", delta: null });
    assert.equal(movementText(movement(14, 9)), "+5");
    assert.equal(movementText(movement(3, 7)), "−4");
    assert.equal(movementSpoken(movement(2, 1)), "up 1 place");
    assert.equal(movementSpoken(movement(22, null)), "dropped out");
  });

  it("trends: latest two checks per keyword, best position, history in order; sorted by size of move", () => {
    const s = (keyword: string, position: number | null, day: string) => ({ keyword, position, captured_at: at(`${day}T09:00:00Z`), run_id: day });
    const t = keywordTrends([s("b", 12, "2026-10-05"), s("a", 9, "2026-10-12"), s("a", 14, "2026-10-05"), s("b", 11, "2026-10-12"), s("c", null, "2026-10-12"), s("c", 30, "2026-10-05"), s("d", 40, "2026-10-12")]);
    const a = t.find((x) => x.keyword === "a")!;
    assert.deepEqual([a.current, a.previous, a.best, a.movement.kind], [9, 14, 9, "up"]);
    assert.deepEqual(a.history.map((h) => h.position), [14, 9]);
    assert.equal(t.find((x) => x.keyword === "d")!.movement.kind, "new");
    assert.deepEqual([...t].sort(byMovement).map((x) => x.keyword), ["a", "c", "b", "d"]);
    assert.deepEqual(movementSummary(t), { up: 2, down: 0, same: 0, entered: 0, lost: 1, ranking: 3, top10: 1, tracked: 4 });
    const al = alignSeries(t, ["a", "d"]);
    assert.deepEqual(al.dates.map((d) => d.toISOString().slice(0, 10)), ["2026-10-05", "2026-10-12"]);
    assert.deepEqual(al.series.map((x) => x.positions), [[14, 9], [null, 40]]);
    assert.equal(rankAxisMax([3, 9, null]), 10);
    assert.equal(rankAxisMax([3, 41]), 50);
    assert.equal(rankAxisMax([99]), 100);
  });
});

describe("chart scales and data transforms", () => {
  it("linear scales map and invert (the rank axis puts #1 at the top)", () => {
    const y = linear([1, 40], [10, 232]);
    assert.equal(y(1), 10);
    assert.equal(y(40), 232);
    assert.ok(y(3) < y(10), "a better position is drawn higher");
    assert.equal(linear([5, 5], [0, 100])(5), 0, "a flat domain does not divide by zero");
  });

  it("nice ticks cover the data with round steps; an all-zero series still has an axis", () => {
    assert.deepEqual(niceTicks(0, 87, 4), [0, 25, 50, 75, 100]);
    assert.deepEqual(niceTicks(0, 1240, 4), [0, 500, 1000, 1500]);
    assert.deepEqual(valueTicks([0, 0, 0]), [0, 1]);
    assert.deepEqual(rankTicks(40), [1, 10, 20, 30, 40]);
    assert.deepEqual(rankTicks(100), [1, 25, 50, 75, 100]);
  });

  it("missing days are zero, never interpolated; weekly buckets end on the last day", () => {
    const f = fillDays([{ day: "2026-10-01", v: 5 }, { day: "2026-10-04", v: 7 }], "2026-10-01", "2026-10-04", (r) => r.v);
    assert.deepEqual(f.map((d) => d.value), [5, 0, 0, 7]);
    assert.deepEqual(bucketSums([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3], 7), [1, 8, 15]);
    assert.deepEqual(timeTickIndices(90, 1200), [0, 22, 45, 67, 89]);
    assert.deepEqual(timeTickIndices(90, 340), [0, 45, 89]);
  });

  it("paths: null breaks a line; columns have a rounded data end and none at zero height", () => {
    assert.equal(linePath([{ x: 0, y: 0 }, null, { x: 10, y: 5 }, { x: 20, y: 5 }]), "M0.0,0.0M10.0,5.0L20.0,5.0");
    assert.equal(columnPath(0, 100, 10, 100), "");
    assert.match(columnPath(0, 50, 10, 100), /^M0,100V54Q0,50 4,50H6Q10,50 10,54V100Z$/);
    assert.match(columnDownPath(0, 100, 10, 130), /^M0,100V126Q0,130 4,130H6Q10,130 10,126V100Z$/);
  });
});

describe("GA4 measurement health", () => {
  const days = (sessions: number[], organicShare = 0.6) => sessions.map((s, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, sessions: s, organic: Math.round(s * organicShare) }));
  const base = { gscClicks: null, streams: [{ type: "WEB_DATA_STREAM", defaultUri: "https://sonorch.ai" }], keyEvents: 2, notSetSessions: 0, domain: "sonorch.ai", checkedAt: at("2026-10-15T00:00:00Z") };

  it("a broken tag reads as an error, not as zero traffic", () => {
    const h = assessHealth({ ...base, days: days(Array(14).fill(0)) });
    assert.equal(h.state, "error");
    assert.match(h.headline, /zero here does not mean zero traffic/);
    assert.deepEqual(h.signals.map((s) => s.code), ["no_data"]);
  });

  it("sessions that stopped, a sharp drop, Search Console disagreeing, another site's stream, (not set) landing pages, no key events", () => {
    assert.equal(assessHealth({ ...base, days: days([50, 52, 48, 51, 49, 47, 50, 52, 48, 50, 49, 0, 0, 0]) }).state, "error");
    assert.equal(assessHealth({ ...base, days: days([50, 52, 48, 51, 49, 47, 50, 52, 48, 50, 49, 51, 0, 0]) }).signals[0].code, "stopped");
    assert.equal(assessHealth({ ...base, days: days([50, 52, 48, 51, 49, 47, 50, 52, 48, 50, 49, 8, 7, 9]) }).signals[0].code, "sharp_drop");
    const mismatch = assessHealth({ ...base, days: days(Array(14).fill(40), 0.1), gscClicks: 1200 });
    assert.deepEqual([mismatch.state, mismatch.signals.map((s) => s.code)], ["warn", ["gsc_mismatch"]]);
    assert.ok(assessHealth({ ...base, days: days(Array(14).fill(40)), streams: [{ type: "WEB_DATA_STREAM", defaultUri: "https://example.org" }] }).signals.some((s) => s.code === "stream_domain"));
    assert.equal(assessHealth({ ...base, days: days(Array(14).fill(40)), streams: [{ type: "WEB_DATA_STREAM", defaultUri: "https://www.sonorch.ai/" }] }).state, "ok");
    assert.equal(assessHealth({ ...base, days: days(Array(14).fill(40)), streams: [] }).signals[0].code, "no_web_stream");
    assert.ok(assessHealth({ ...base, days: days(Array(14).fill(40)), notSetSessions: 200 }).signals.some((s) => s.code === "not_set_landing"));
    const info = assessHealth({ ...base, days: days(Array(14).fill(40)), keyEvents: 0 });
    assert.deepEqual([info.state, info.signals.map((s) => s.level)], ["ok", ["info"]], "a missing key event is advice, not a broken tag");
  });
});

describe("audit grouping and fix tasks", () => {
  it("normalises both providers' issue names onto one vocabulary", () => {
    assert.equal(normalizeIssueType("title-too-long"), "title_too_long");
    assert.equal(normalizeIssueType("Title Too Long"), "title_too_long");
    assert.deepEqual(describeIssue("title-too-long", 17, "Titles over 60 characters"), { group: "metadata", title: "17 titles over 60 characters", taskTitle: "Shorten 17 titles over 60 characters" });
    assert.deepEqual(describeIssue("broken_internal_link", 1, ""), { group: "links", title: "1 broken internal link", taskTitle: "Fix 1 broken internal link" });
    assert.equal(describeIssue("strange_new_check", 3, "Strange new check").group, "other");
  });

  it("groups: the group with a critical issue first, issues by severity then count", () => {
    const g = groupIssues([
      { issue_type: "title_too_long", category: "metadata", severity: "warning" as const, count: 17 },
      { issue_type: "no_description", category: "metadata", severity: "warning" as const, count: 40 },
      { issue_type: "broken_links", category: "links", severity: "critical" as const, count: 2 },
    ]);
    assert.deepEqual(g.map((x) => [x.group, x.issues.map((i) => i.issue_type)]), [["links", ["broken_links"]], ["metadata", ["no_description", "title_too_long"]]]);
  });

  it("backlinks: new and lost referring domains against the previous snapshot", () => {
    assert.equal(diffReferring(null, ["a"]), null);
    assert.deepEqual(diffReferring(["a", "b", "c"], ["b", "c", "d", "e"]), { added: 2, lost: 1 });
  });
});

describe("the scheduler's due list", () => {
  const input = (o: Partial<DueInput> = {}): DueInput => ({
    site: { timezone: "America/New_York", status: "active", rank_cadence: "weekly", audit_cadence: "monthly", backlinks_cadence: "quarterly", search_sync: true },
    provider: true,
    google: true,
    gscReady: true,
    ga4Ready: false,
    runs: {},
    ...o,
  });
  const now = at("2026-10-13T15:00:00Z");

  it("a new site: the Search Console sync, inspection and the paid baseline are all due", () => {
    assert.deepEqual(dueWork(input(), now).map((d) => `${d.kind}@${d.windowKey}`), ["gsc@d:2026-10-13", "inspect@d:2026-10-13", "rank@w:2026-W42", "audit@m:2026-10", "backlinks@q:2026-Q4"]);
  });

  it("nothing paid without a provider; nothing from Google without a property; nothing for a paused site", () => {
    assert.deepEqual(dueWork(input({ provider: false }), now).map((d) => d.kind), ["gsc", "inspect"]);
    assert.deepEqual(dueWork(input({ gscReady: false, google: true }), now).map((d) => d.kind), ["rank", "audit", "backlinks"]);
    assert.deepEqual(dueWork(input({ site: { ...input().site, status: "paused" } }), now), []);
    assert.deepEqual(dueWork(input({ site: { ...input().site, rank_cadence: "off", audit_cadence: "off", backlinks_cadence: "off", search_sync: false } }), now), []);
  });

  it("done this window: not due again", () => {
    const runs = { gsc: [run("d:2026-10-13", "succeeded", "2026-10-13T10:00:00Z")], inspect: [run("d:2026-10-13", "succeeded", "2026-10-13T10:00:00Z")], rank: [run("w:2026-W42", "succeeded", "2026-10-12T10:00:00Z")], audit: [run("m:2026-10", "waiting", "2026-10-02T10:00:00Z")], backlinks: [run("q:2026-Q4", "refused", "2026-10-13T10:00:00Z", { retry_after: at("2026-10-14T10:00:00Z") })] };
    assert.deepEqual(dueWork(input({ runs }), now), []);
  });
});

describe("measurement environment", () => {
  it("GOOGLE_PACE_MS: 200 ms between Google requests by default, validated", async () => {
    const { readWorkerEnv, EnvError } = await import("../../lib/env.ts");
    const APP = "postgres://seo_app:x@localhost:5432/seo";
    assert.equal(readWorkerEnv({ DATABASE_URL: APP }).googlePauseMs, 200);
    assert.equal(readWorkerEnv({ DATABASE_URL: APP, GOOGLE_PACE_MS: "0" }).googlePauseMs, 0);
    assert.throws(() => readWorkerEnv({ DATABASE_URL: APP, GOOGLE_PACE_MS: "-5" }), (e: unknown) => e instanceof EnvError && /GOOGLE_PACE_MS/.test(e.message));
  });
});
