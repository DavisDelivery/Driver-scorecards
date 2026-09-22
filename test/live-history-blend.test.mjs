// Guards the rule that decides whether a month is served by LIVE incidents or by the
// ROLLED-UP history.
//
// This exists because the rule was "does this month have any live rows at all", which
// meant a single row that contributes nothing to a chart — a compliment, an
// unable-to-track entry, a no-fault row, or somebody else's fault under the
// driver-fault filter — replaced that whole month's history with nothing. The month
// then rendered as zero on both Trends and the Scorecard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countsTowardCharts } from "../src/data/liveHistoryBlend.js";

const CHARTED = ["damage", "late", "missing", "misdelivery", "attempts", "forgotten_freight"];
const inc = (over = {}) => ({ driver_id: "d1", category: "damage", fault: "driver", ...over });

test("a normal charted incident counts", () => {
  assert.equal(countsTowardCharts(inc(), { categoryIds: CHARTED }), true);
});

test("rows that contribute nothing can never claim a month", () => {
  // Each of these used to be enough to wipe the month's history.
  assert.equal(countsTowardCharts(inc({ no_fault: true }), { categoryIds: CHARTED }), false);
  assert.equal(countsTowardCharts(inc({ driver_id: "" }), { categoryIds: CHARTED }), false);
  assert.equal(countsTowardCharts(inc({ category: "compliment" }), { categoryIds: CHARTED }), false);
  // The Unable-to-Track category is charted nowhere by design.
  assert.equal(
    countsTowardCharts(inc({ category: "unable_to_track" }), { categoryIds: CHARTED }),
    false,
  );
});

test("the driver-fault filter is part of the rule", () => {
  // With the filter on, a vendor-fault row counts for nothing and so must not
  // qualify the month either.
  assert.equal(
    countsTowardCharts(inc({ fault: "vendor" }), { categoryIds: CHARTED, faultFilter: "driver" }),
    false,
  );
  // With no filter, the same row counts.
  assert.equal(countsTowardCharts(inc({ fault: "vendor" }), { categoryIds: CHARTED }), true);
});

test("each view's own chart vocabulary decides", () => {
  // Trends charts six categories; the Scorecard charts those plus complaint and
  // compliment. A category the caller doesn't chart must not qualify its months.
  assert.equal(countsTowardCharts(inc({ category: "complaint" }), { categoryIds: CHARTED }), false);
  assert.equal(
    countsTowardCharts(inc({ category: "complaint" }), { categoryIds: [...CHARTED, "complaint"] }),
    true,
  );
});

test("junk is rejected rather than counted", () => {
  assert.equal(countsTowardCharts(null, { categoryIds: CHARTED }), false);
  assert.equal(countsTowardCharts(undefined, { categoryIds: CHARTED }), false);
  assert.equal(countsTowardCharts(inc(), {}), false);
  assert.equal(countsTowardCharts(inc()), false);
});
