// Guards the one mapping from a fault value to whose fault it was (faultGroups.js).
//
// The Scorecard's "Exonerated" tile took customer but not vendor; the weekly PDF cover
// took vendor but not customer. And a late row could never read as reviewed, because
// All Incidents gives it a late-reason dropdown instead of a fault one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  faultGroup,
  reviewGroup,
  isLateRow,
  isReviewed,
  faultSplit,
  FAULT_GROUP_ORDER,
  FAULT_GROUP_LABEL,
  NOT_DRIVER_FAULTS,
} from "../src/data/faultGroups.js";
import { FAULT_CODES, LATE_REASONS } from "../src/data/drivers.js";
import { countsTowardCharts } from "../src/data/liveHistoryBlend.js";
import { FAILURES } from "../src/data/categories.js";

test("every fault code the dropdown offers has a group, and none is a guess", () => {
  const want = {
    driver: "driver",
    preload: "not_driver",
    warehouse: "not_driver",
    customer: "not_driver",
    vendor: "not_driver",
    exonerated: "not_driver",
    unknown: "not_reviewed",
  };
  assert.deepEqual(Object.fromEntries(FAULT_CODES.map((f) => [f.id, faultGroup(f.id)])), want);
  assert.deepEqual(NOT_DRIVER_FAULTS, ["exonerated", "preload", "warehouse", "customer", "vendor"]);
});

test("nothing set is not reviewed; anything typed in is other", () => {
  for (const v of ["", null, undefined, "unknown"]) assert.equal(faultGroup(v), "not_reviewed", String(v));
  // Production holds "ZACH" and "UNABLE TO LOCATE." in the fault field.
  assert.equal(faultGroup("ZACH"), "other");
  assert.equal(faultGroup("UNABLE TO LOCATE."), "other");
  // Matched exactly, like the Driver-fault filter: a stray capital is not "driver".
  assert.equal(faultGroup("Driver"), "other");
  for (const g of FAULT_GROUP_ORDER) assert.ok(FAULT_GROUP_LABEL[g], g);
});

test("the Driver fault group is exactly the rows the Driver-fault scope counts", () => {
  for (const f of [...FAULT_CODES.map((c) => c.id), "", null, "ZACH", "Driver"]) {
    const inc = { driver_id: "d1", category: "damage", fault: f };
    assert.equal(
      countsTowardCharts(inc, { categoryIds: FAILURES, faultFilter: "driver" }),
      faultGroup(f) === "driver",
      String(f),
    );
  }
});

test("a late row with a reason is reviewed, in a group of its own", () => {
  const late = { category: "late", fault: "unknown", late_reason: "attempted" };
  assert.equal(reviewGroup(late), "late_reason");
  assert.ok(isReviewed("late_reason"));
  // Every reason is treated alike: none is mapped onto driver or not-driver.
  for (const r of LATE_REASONS) assert.equal(reviewGroup({ ...late, late_reason: r.id }), "late_reason", r.id);
  // No reason yet: not reviewed.
  assert.equal(reviewGroup({ ...late, late_reason: "" }), "not_reviewed");
  // A fault somebody did set still wins over the reason.
  assert.equal(reviewGroup({ ...late, fault: "customer", late_reason: "closed_fridays" }), "not_driver");
  assert.equal(reviewGroup({ ...late, fault: "driver" }), "driver");
  // A row that came in on the Late report is a late row whatever its category (All
  // Incidents shows it the late-reason dropdown too).
  assert.ok(isLateRow({ category: "missing", sources: ["laters", "traces"] }));
  assert.equal(reviewGroup({ category: "missing", sources: ["laters"], fault: "unknown", late_reason: "holiday" }), "late_reason");
  // A reason on a row that isn't a late row isn't a review of anything.
  assert.equal(reviewGroup({ category: "damage", fault: "unknown", late_reason: "attempted" }), "not_reviewed");
});

test("a split counts every row once, with the ids behind each group", () => {
  const rows = [
    { id: "a", category: "damage", fault: "driver" },
    { id: "b", category: "late", fault: "unknown", late_reason: "forgotten_freight" },
    { id: "c", category: "late", fault: "unknown" },
    { id: "d", category: "missing", fault: "vendor" },
    { id: "e", category: "misdelivery", fault: "ZACH" },
    { id: "f", category: "damage", fault: "driver" },
  ];
  const s = faultSplit(rows);
  assert.equal(s.total, 6);
  assert.equal(s.reviewed, 4);
  assert.deepEqual(
    Object.fromEntries(FAULT_GROUP_ORDER.map((g) => [g, s.groups[g].ids])),
    { driver: ["a", "f"], not_driver: ["d"], late_reason: ["b"], other: ["e"], not_reviewed: ["c"] },
  );
  assert.equal(FAULT_GROUP_ORDER.reduce((a, g) => a + s.groups[g].n, 0), s.total);
  assert.deepEqual(faultSplit([]).groups.driver, { n: 0, ids: [] });
});

test("the weekly PDF cover counts with the same groups, not a list of its own", () => {
  const src = readFileSync(new URL("../src/reports/pdfGenerator.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\.\/data\/faultGroups\.js"/);
  assert.doesNotMatch(src, /fault === "(exonerated|preload|warehouse|vendor|customer)"/);
});
