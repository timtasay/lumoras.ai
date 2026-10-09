/**
 * Slot math across time zones and daylight-saving changes (rule 2), lead-day
 * wake-ups (rolling model), no back-dating by default (rule 3), and the
 * runway (rule 1) with its alert thresholds.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIso,
  canScheduleAt,
  daysBetween,
  describeSchedule,
  generationDue,
  generationWakeAt,
  isoWeekday,
  localParts,
  nextSlots,
  offsetMinutes,
  publishDateFor,
  slotsBetween,
  validateSchedule,
  zonedToUtc,
} from "../../lib/content/schedule.ts";
import { computeRunway, runwayLevel, shouldAlert, type RunwaySlot } from "../../lib/content/runway.ts";

const NY = "America/New_York";
const iso = (d: Date) => d.toISOString();

describe("slot math", () => {
  it("Tuesday and Friday at 09:00 New York, in UTC, for a plain week", () => {
    const s = slotsBetween({ days: [2, 5], time: "09:00", timezone: NY }, new Date("2026-10-12T00:00:00Z"), new Date("2026-10-19T00:00:00Z"));
    assert.deepEqual(s.map(iso), ["2026-10-13T13:00:00.000Z", "2026-10-16T13:00:00.000Z"]);
    for (const d of s) assert.equal(localParts(d, NY).time, "09:00");
  });

  it("09:00 stays 09:00 local across fall back (1 Nov 2026): the UTC instant moves an hour", () => {
    const s = slotsBetween({ days: [5, 2], time: "09:00", timezone: NY }, new Date("2026-10-26T00:00:00Z"), new Date("2026-11-07T00:00:00Z"));
    assert.deepEqual(s.map(iso), ["2026-10-27T13:00:00.000Z", "2026-10-30T13:00:00.000Z", "2026-11-03T14:00:00.000Z", "2026-11-06T14:00:00.000Z"]);
    assert.deepEqual(s.map((d) => localParts(d, NY).time), ["09:00", "09:00", "09:00", "09:00"]);
  });

  it("and across spring forward (8 Mar 2026)", () => {
    const s = slotsBetween({ days: [1], time: "09:00", timezone: NY }, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-10T00:00:00Z"));
    assert.deepEqual(s.map(iso), ["2026-03-02T14:00:00.000Z", "2026-03-09T13:00:00.000Z"]);
  });

  it("a local time in the spring-forward gap moves forward by the gap; one in the fall-back overlap takes the first occurrence", () => {
    assert.equal(iso(zonedToUtc("2026-03-08", "02:30", NY)), "2026-03-08T07:30:00.000Z"); // 03:30 EDT
    assert.equal(localParts(zonedToUtc("2026-03-08", "02:30", NY), NY).time, "03:30");
    assert.equal(iso(zonedToUtc("2026-11-01", "01:30", NY)), "2026-11-01T05:30:00.000Z"); // 01:30 EDT, the first one
    // Europe changes on other dates (29 Mar, 25 Oct 2026)
    assert.equal(iso(zonedToUtc("2026-03-29", "01:30", "Europe/London")), "2026-03-29T01:30:00.000Z");
    assert.equal(iso(zonedToUtc("2026-03-29", "09:00", "Europe/London")), "2026-03-29T08:00:00.000Z");
    assert.equal(iso(zonedToUtc("2026-10-25", "09:00", "Europe/London")), "2026-10-25T09:00:00.000Z");
  });

  it("a zone with no DST and a half-hour offset", () => {
    assert.equal(iso(zonedToUtc("2026-10-13", "09:00", "Asia/Kolkata")), "2026-10-13T03:30:00.000Z");
    assert.equal(offsetMinutes(new Date("2026-10-13T00:00:00Z"), "Asia/Kolkata"), 330);
    assert.equal(offsetMinutes(new Date("2026-01-13T12:00:00Z"), NY), -300);
    assert.equal(offsetMinutes(new Date("2026-07-13T12:00:00Z"), NY), -240);
  });

  it("slots fall on the site's local day, not the UTC day", () => {
    // 21:00 Tuesday in Los Angeles is Wednesday in UTC
    const [s] = slotsBetween({ days: [2], time: "21:00", timezone: "America/Los_Angeles" }, new Date("2026-10-12T00:00:00Z"), new Date("2026-10-19T00:00:00Z"));
    assert.equal(iso(s), "2026-10-14T04:00:00.000Z");
    assert.equal(localParts(s, "America/Los_Angeles").weekday, 2);
  });

  it("nextSlots spans windows and keeps order; [from, to) bounds", () => {
    const n = nextSlots({ days: [2, 5], time: "09:00", timezone: NY }, new Date("2026-10-13T13:00:00Z"), 5);
    assert.equal(n.length, 5);
    assert.equal(iso(n[0]), "2026-10-13T13:00:00.000Z", "a slot exactly at `after` is included");
    assert.ok(n.every((d, i) => i === 0 || d > n[i - 1]));
    assert.deepEqual(slotsBetween({ days: [2], time: "09:00", timezone: NY }, new Date("2026-10-13T13:00:00Z"), new Date("2026-10-13T13:00:00Z")), []);
  });

  it("calendar helpers", () => {
    assert.equal(addDaysIso("2026-02-27", 2), "2026-03-01");
    assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
    assert.equal(isoWeekday("2026-10-13"), 2);
    assert.equal(isoWeekday("2026-10-18"), 7);
    assert.equal(daysBetween("2026-10-09", "2026-10-13"), 4);
    assert.deepEqual(validateSchedule({ days: [], time: "25:00", timezone: "Mars/Olympus" }), ["Pick at least one weekday.", "Use a time like 09:00.", "Unknown time zone."]);
    assert.deepEqual(validateSchedule({ days: [2, 5], time: "09:00", timezone: NY }), []);
    assert.equal(describeSchedule({ days: [5, 2], time: "09:00:00", timezone: NY }), "Tuesday and Friday at 09:00 (America/New York)");
  });
});

describe("rolling generation", () => {
  it("wakes lead_days local days before the slot at the same local time, across a DST change", () => {
    const slot = zonedToUtc("2026-11-03", "09:00", NY); // Tuesday after fall back
    const wake = generationWakeAt(slot, 3, NY);
    assert.equal(localParts(wake, NY).date, "2026-10-31");
    assert.equal(localParts(wake, NY).time, "09:00");
    assert.equal(iso(wake), "2026-10-31T13:00:00.000Z");
    assert.equal(generationDue(slot, 3, NY, new Date("2026-10-31T12:59:00Z")), false);
    assert.equal(generationDue(slot, 3, NY, new Date("2026-10-31T13:00:00Z")), true);
    assert.equal(iso(generationWakeAt(slot, 0, NY)), iso(slot));
  });
});

describe("no back-dating (rule 3)", () => {
  const slot = zonedToUtc("2026-10-13", "09:00", NY);
  it("an article written after its slot date carries the day it goes out, not the slot date", () => {
    assert.equal(publishDateFor(slot, { writtenAt: new Date("2026-10-10T12:00:00Z"), now: new Date("2026-10-11T12:00:00Z"), timezone: NY, allowBackdating: false }), "2026-10-13");
    assert.equal(publishDateFor(slot, { writtenAt: new Date("2026-10-15T12:00:00Z"), now: new Date("2026-10-15T12:00:00Z"), timezone: NY, allowBackdating: false }), "2026-10-15");
    // with back-dating on (and acknowledged) it keeps the slot date
    assert.equal(publishDateFor(slot, { writtenAt: new Date("2026-10-15T12:00:00Z"), now: new Date("2026-10-15T12:00:00Z"), timezone: NY, allowBackdating: true }), "2026-10-13");
    // the date is the site's local day: 23:30 New York is already tomorrow in UTC
    assert.equal(publishDateFor(zonedToUtc("2026-10-13", "23:30", NY), { writtenAt: null, now: new Date("2026-10-01T00:00:00Z"), timezone: NY, allowBackdating: false }), "2026-10-13");
  });
  it("a slot cannot be moved into the past unless back-dating is on", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const r = canScheduleAt(new Date("2026-10-08T12:00:00Z"), now, false);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /Back-dating is off/);
    assert.deepEqual(canScheduleAt(new Date("2026-10-08T12:00:00Z"), now, true), { ok: true });
    assert.deepEqual(canScheduleAt(new Date("2026-10-10T12:00:00Z"), now, false), { ok: true });
    assert.equal(canScheduleAt(new Date("nope"), now, true).ok, false);
  });
});

describe("runway (rule 1)", () => {
  const today = "2026-10-09";
  const slots = (...xs: [string, RunwaySlot["coverage"]][]) => xs.map(([date, coverage]) => ({ date, coverage }));
  const base = { today, blockedReason: null, topicSupply: 10, thresholdDays: 10 };

  it("counts days to the last covered slot of the unbroken run", () => {
    const r = computeRunway({ ...base, slots: slots(["2026-10-13", "ready"], ["2026-10-16", "review"], ["2026-10-20", "pending"], ["2026-10-23", "pending"]) });
    assert.equal(r.days, 14);
    assert.equal(r.level, "ok");
    assert.equal(r.coveredUntil, "2026-10-23");
    assert.equal(r.gapAt, null);
    assert.equal(r.coveredSlots, 4);
  });

  it("the first slot that will not go out ends the run (amber below the threshold)", () => {
    const r = computeRunway({ ...base, slots: slots(["2026-10-13", "ready"], ["2026-10-16", "blocked"], ["2026-10-20", "ready"]) });
    assert.equal(r.days, 4);
    assert.equal(r.level, "low");
    assert.equal(r.gapAt, "2026-10-16");
    assert.match(r.reason, /Covered until 2026-10-13; the slot on 2026-10-16 will not go out\. An article failed/);
  });

  it("empty (red) when nothing is covered: generation blocked, or no topics left, or no slots", () => {
    const blocked = computeRunway({ ...base, blockedReason: "No publishing connection is set.", slots: slots(["2026-10-13", "pending"]) });
    assert.equal(blocked.level, "empty");
    assert.equal(blocked.days, 0);
    assert.match(blocked.reason, /^Nothing is covered; the slot on 2026-10-13 will not go out\. No publishing connection is set\.$/);
    const dry = computeRunway({ ...base, topicSupply: 1, slots: slots(["2026-10-13", "pending"], ["2026-10-16", "pending"]) });
    assert.equal(dry.coveredUntil, "2026-10-13");
    assert.match(dry.reason, /No topics left/);
    const none = computeRunway({ ...base, slots: [] });
    assert.equal(none.level, "empty");
    assert.equal(none.reason, "No slots are scheduled.");
  });

  it("past slots are ignored; a covered slot today still counts one day", () => {
    const r = computeRunway({ ...base, slots: slots(["2026-10-06", "blocked"], ["2026-10-09", "ready"]) });
    assert.equal(r.days, 1);
    assert.equal(r.level, "low");
  });

  it("levels and alerts: on a worsening level, then weekly while it stays low", () => {
    assert.equal(runwayLevel(0, 10), "empty");
    assert.equal(runwayLevel(9, 10), "low");
    assert.equal(runwayLevel(10, 10), "ok");
    const now = new Date("2026-10-09T12:00:00Z");
    assert.equal(shouldAlert("ok", { level: null, at: null }, now), false);
    assert.equal(shouldAlert("low", { level: null, at: null }, now), true);
    assert.equal(shouldAlert("low", { level: "low", at: new Date("2026-10-08T12:00:00Z") }, now), false);
    assert.equal(shouldAlert("empty", { level: "low", at: new Date("2026-10-08T12:00:00Z") }, now), true);
    assert.equal(shouldAlert("low", { level: "low", at: new Date("2026-10-02T12:00:00Z") }, now), true);
  });
});
