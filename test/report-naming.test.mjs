// A weekly report's week, as the Reports table and its weekly chart name it: one Monday
// for both, read from the date's parts so no timezone can move it a day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportWeekOf, reportWeekName, reportWeekTick, reportSpanLabel, storedRangeLabel } from "../src/reports/reportNaming.js";

test("a report's week is the Monday of the week it covers", () => {
  // A Uline label names its own week.
  assert.equal(reportWeekOf({ name: "9/14/2026 THRU 9/18/2026", starts_at: "2026-09-15" }), "2026-09-14");
  // Otherwise the first day of its span, moved back to that week's Monday: the chart
  // used to tick this report "Jun 30" (its first incident) under a table's "Jun 29".
  assert.equal(reportWeekOf({ name: "Week of Jun 30–Jul 2", starts_at: "2026-06-30", ends_at: "2026-07-02" }), "2026-06-29");
  // A Monday is its own week; a Sunday belongs to the week before it.
  assert.equal(reportWeekOf({ starts_at: "2026-09-14" }), "2026-09-14");
  assert.equal(reportWeekOf({ starts_at: "2026-09-20" }), "2026-09-14");
  // Across a year end.
  assert.equal(reportWeekOf({ starts_at: "2026-01-01" }), "2025-12-29");
  // A report that predates spans has its week ending.
  assert.equal(reportWeekOf({ week_ending: "2026-04-17" }), "2026-04-13");
  assert.equal(reportWeekOf({ name: "Untitled" }), null);
});

test("the table's name and the chart's tick name the same Monday", () => {
  const r = { name: "6/29/2026 THRU 7/3/2026", starts_at: "2026-06-30", ends_at: "2026-07-02" };
  assert.equal(reportWeekName(r), "Week of Jun 29, 2026");
  assert.equal(reportWeekTick(r), "Jun 29");
  // A name someone typed is shown as typed; the tick still falls on the week's Monday.
  const typed = { name: "Holiday week", starts_at: "2026-12-22", ends_at: "2026-12-24" };
  assert.equal(reportWeekName(typed), "Holiday week");
  assert.equal(reportWeekTick(typed), "Dec 21");
  assert.equal(reportWeekName({}), "Untitled report");
});

test("a week ending reads as a date, never an ISO string", () => {
  assert.equal(reportSpanLabel({ week_ending: "2026-04-17" }), "Week ending Apr 17, 2026");
  assert.equal(reportSpanLabel({ starts_at: "2026-09-14", ends_at: "2026-09-18" }), "Sep 14–18, 2026");
});

test("the range_label a new report is saved with keeps its stored format", () => {
  // The on-screen reading changed ("Week ending Apr 17, 2026"); what Ingest writes to
  // Firestore did not.
  assert.equal(storedRangeLabel({ week_ending: "2026-04-17" }), "Week ending 2026-04-17");
  assert.equal(storedRangeLabel({ starts_at: "2026-09-14", ends_at: "2026-09-18", week_ending: "2026-09-18" }), "Sep 14–18, 2026");
  assert.equal(storedRangeLabel({ starts_at: "2026-12-29", ends_at: "2027-01-02" }), "Dec 29, 2026 – Jan 2, 2027");
  assert.equal(storedRangeLabel({}), "—");
});
