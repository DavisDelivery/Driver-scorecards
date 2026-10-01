// Guards how dispatch's "-1" stop copies are counted on the Attempts tab.
//
// This exists because 40 of 99 attempts over a 30-day window showed as "Unassigned",
// and 25 of those were not unassigned attempts at all: they were the "-1" copy
// dispatch makes of a failed stop to carry its redelivery. The copy keeps the
// shipment number (so the ATT marker), is listed by the evening scan beside the
// original, and never matches the 8:30 AM plan because it didn't exist yet. Each one
// was the same failure counted a second time, under nobody.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupAttemptLegs,
  unassignedReason,
  closedOutBy,
  baseStopNbr,
  isRedeliveryLeg,
} from "../src/data/attemptLegs.js";

const row = (stopNbr, over = {}) => ({
  date: "2026-09-11",
  stopNbr,
  shipmentNbr: `ATT${baseStopNbr(stopNbr)}`,
  originalDriverName: null,
  currentDriverName: null,
  currentStatus: "UNPLANNED",
  ...over,
});

test("stop numbers: the -N copy is recognised and maps back to its original", () => {
  assert.equal(isRedeliveryLeg("007174773-1"), true);
  assert.equal(isRedeliveryLeg("007174773"), false);
  assert.equal(baseStopNbr("007174773-1"), "007174773");
  assert.equal(baseStopNbr("007174773"), "007174773");
});

test("an original stop and its -1 copy are ONE attempt, credited to the named leg", () => {
  // Exactly the shape the feed returned on 09/11: the original matched to Tyrese,
  // the copy unmatched and unplanned.
  const orders = groupAttemptLegs([
    row("007174773-1"),
    row("007174773", {
      originalDriverName: "Tyrese  Griffin",
      currentDriverName: "Tyrese  Griffin",
      currentStatus: "DELIVERED",
    }),
  ]);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].originalDriverName, "Tyrese  Griffin");
  assert.equal(orders[0].stopNbr, "007174773");
  assert.equal(orders[0].legs, 2);
  assert.deepEqual(
    orders[0].legRows.map((l) => l.stopNbr),
    ["007174773", "007174773-1"],
  );
  assert.equal(unassignedReason(orders[0]), null);
});

test("a named -1 DUPLICATE never speaks for an unnamed original (Chad: duplicates have nothing to do with the original driver)", () => {
  const [o] = groupAttemptLegs([
    row("007172024"),
    row("007172024-1", { originalDriverName: "Darvin  Cepeda" }),
  ]);
  assert.equal(o.stopNbr, "007172024");
  assert.equal(o.originalDriverName, null, "the order is charged to nobody, not to the duplicate's driver");
  assert.equal(o.legs, 2, "still one attempt, not two");
  assert.equal(unassignedReason(o), "not_in_plan");
});

test("a duplicate listed WITHOUT its original stands alone, with only a driver of its own", () => {
  const [own] = groupAttemptLegs([row("007172068-1", { originalDriverName: "Own Driver" })]);
  assert.equal(own.originalDriverName, "Own Driver");
  const [none] = groupAttemptLegs([row("007172068-1")]);
  assert.equal(unassignedReason(none), "copy_only");
});

test("the same PRO on different days is two attempts", () => {
  const orders = groupAttemptLegs([
    row("007174773", { date: "2026-09-10" }),
    row("007174773", { date: "2026-09-11" }),
  ]);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].legs, undefined);
});

test("rows with no shipment number are never merged together", () => {
  const orders = groupAttemptLegs([
    row("1", { shipmentNbr: "" }),
    row("2", { shipmentNbr: "" }),
  ]);
  assert.equal(orders.length, 2);
});

test("an unassigned order says why", () => {
  // Original stop on no morning route (added later in the day).
  const [late] = groupAttemptLegs([
    row("007174789", { currentDriverName: "Trevarr Howard", currentStatus: "DELIVERED" }),
    row("007174789-1"),
  ]);
  assert.equal(unassignedReason(late), "not_in_plan");

  // Only the copy made it onto the list.
  const [copy] = groupAttemptLegs([row("007172068-1")]);
  assert.equal(unassignedReason(copy), "copy_only");

  // Weekend / snapshot failure.
  const [noPlan] = groupAttemptLegs([row("007170000", { planMissing: true })]);
  assert.equal(unassignedReason(noPlan), "no_plan");

  // Detected live, not yet through the evening scan.
  const [live] = groupAttemptLegs([row("007179999", { provisional: true })]);
  assert.equal(unassignedReason(live), "provisional");
});

test("the closed-out-by lead comes only from a CLOSED original stop", () => {
  const [closed] = groupAttemptLegs([
    row("007167384", { currentDriverName: "Terrance  Hawk", currentStatus: "DELIVERED" }),
  ]);
  assert.equal(closedOutBy(closed), "Terrance Hawk");

  // Re-planned onto someone's route: that's the redelivery driver, not a lead.
  const [scheduled] = groupAttemptLegs([
    row("007173373", { currentDriverName: "Chad Davis", currentStatus: "SCHEDULED" }),
  ]);
  assert.equal(closedOutBy(scheduled), null);

  // A -1 copy's driver is always the redelivery driver.
  const [copy] = groupAttemptLegs([
    row("007166885-1", { currentDriverName: "Mone Watkins", currentStatus: "DELIVERED" }),
  ]);
  assert.equal(closedOutBy(copy), null);
});

// ── the nightly lookup's flag (Chad: "if it needs more it should throw a flag in the ui") ──
import { fillFlags, fillLeftIndex } from "../src/data/attemptLegs.js";

test("a night the lookup couldn't finish is flagged, with each stop and why; a clean night is not", () => {
  const fills = [
    { date: "2026-10-01", needsAttention: true, left: 3, maxCalls: 10, requests: 10,
      leftStops: [{ stopNbr: "007184001", reason: "over-cap" }, { stopNbr: "007184002", reason: "over-cap" }, { stopNbr: "007184003", reason: "no-stopId" }] },
    { date: "2026-10-02", needsAttention: false, left: 0, leftStops: [] },
    { date: "2026-09-30", needsAttention: true, left: 1, leftStops: [{ stopNbr: "007183999", reason: "not-read" }] },
  ];
  const flags = fillFlags(fills);
  assert.deepEqual(flags.map((f) => [f.date, f.left]), [["2026-10-01", 3], ["2026-09-30", 1]], "newest first, clean night left out");
  const idx = fillLeftIndex(fills);
  assert.equal(idx.get("2026-10-01|007184003"), "no-stopId");
  assert.equal(idx.get("2026-10-02|007184001"), undefined);
  assert.deepEqual(fillFlags(undefined), []);
});
