// Guards the business-timezone calendar day.
//
// The reviews screen used to give three different answers for one review: the period
// filter bucketed it by the UTC prefix of its timestamp, the list rendered it in the
// browser's timezone, and the click-through time was pinned to Eastern. A review
// submitted at 8pm in Georgia is stored as the NEXT day in UTC, so it dropped out of
// the week it belonged to while still displaying the earlier date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { etDay } from "../src/data/period.js";

test("an evening review belongs to the ET day it was submitted", () => {
  // 11:30pm ET on Aug 31 is already Sep 1 in UTC — the case that broke the filter.
  assert.equal(etDay("2026-09-01T03:30:00Z"), "2026-08-31");
  // 7:30pm ET on Aug 31.
  assert.equal(etDay("2026-08-31T23:30:00Z"), "2026-08-31");
});

test("a daytime timestamp is unaffected", () => {
  assert.equal(etDay("2026-09-01T12:00:00Z"), "2026-09-01");
  assert.equal(etDay("2026-09-01T16:45:12.345Z"), "2026-09-01");
});

test("the year boundary follows Eastern, not UTC", () => {
  // 9pm on New Year's Eve in Georgia is still the old year.
  assert.equal(etDay("2026-01-01T02:00:00Z"), "2025-12-31");
});

test("an explicit offset is honoured", () => {
  assert.equal(etDay("2026-08-31T20:00:00-04:00"), "2026-08-31");
});

test("a bare calendar date is never shifted", () => {
  // Putting YYYY-MM-DD through Date() reads it as UTC midnight, which in ET is the
  // PREVIOUS day — the exact trap CLAUDE.md warns about.
  assert.equal(etDay("2026-08-31"), "2026-08-31");
  assert.equal(etDay("2026-01-01"), "2026-01-01");
});

test("junk degrades instead of throwing mid-render", () => {
  assert.equal(etDay(""), "");
  assert.equal(etDay(null), "");
  assert.equal(etDay(undefined), "");
  assert.equal(etDay("not a date"), "not a date");
});
