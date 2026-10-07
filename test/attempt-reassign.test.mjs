// Guards reassigning a feed attempt (src/data/attemptReassign.js).
//
// A reassignment is the only way an operator corrects who the feed charged, so it
// has to save the same document from every screen, leave exactly one per order, and
// say so when it fails — the app has lost entries before to a save that reported
// success.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reassignDoc, reassignAttempt, overridesFor } from "../src/data/attemptReassign.js";
import { createDayCache } from "../src/data/attemptsFeed.js";
import { groupAttemptLegs } from "../src/data/attemptLegs.js";

const DATE = "2026-09-11";
const [ORDER] = groupAttemptLegs([
  { date: DATE, stopNbr: "007174773", shipmentNbr: "ATT007174773", originalDriverName: "Tyrese  Griffin", businessName: "ACME", city: "NORCROSS", state: "GA" },
  { date: DATE, stopNbr: "007174773-1", shipmentNbr: "ATT007174773" },
]);
const BEN = { id: "drv_ben", name: "Ben Paintsil" };
const NOW = "2026-10-07T15:00:00.000Z";

const saved = (id, stop, date, created) => ({
  id,
  category: "attempts",
  attempt_stop_nbr: stop,
  delivered_date: date,
  driver_id: "drv_old",
  notes: `note on ${id}`,
  created_at: created,
  ingested_at: created,
});

test("reassignDoc: a deterministic id, the feed's driver kept as driver_raw, keyed to the stop", () => {
  const doc = reassignDoc({ order: ORDER, date: DATE, driver: BEN, now: NOW });
  assert.equal(doc.id, "att_2026-09-11_007174773");
  assert.equal(doc.attempt_stop_nbr, "007174773");
  assert.equal(doc.pro_number, "007174773");
  assert.equal(doc.shipment_nbr, "ATT007174773");
  assert.equal(doc.category, "attempts");
  assert.equal(doc.driver_id, "drv_ben");
  assert.equal(doc.driver_name, "Ben Paintsil");
  assert.equal(doc.driver_raw, "Tyrese  Griffin");
  assert.equal(doc.delivered_date, DATE);
  assert.equal(doc.reason, "Delivery attempt — reassigned from auto feed (was Tyrese  Griffin)");
  assert.equal(doc.manual_entry, true);
  assert.equal(doc.created_at, NOW);
  assert.equal(doc.updated_at, NOW);
  // A nameless attempt says so.
  const blank = reassignDoc({ order: { stopNbr: "1" }, date: DATE, driver: BEN, now: NOW });
  assert.equal(blank.driver_raw, "");
  assert.match(blank.reason, /\(was Unknown\)$/);
});

test("reassignDoc: changing the driver again edits the saved one rather than adding another", () => {
  const existing = saved("i_legacy_1", "007174773-1", DATE, "2026-09-12T10:00:00Z");
  const doc = reassignDoc({ order: ORDER, date: DATE, driver: BEN, existing, now: NOW });
  assert.equal(doc.id, "i_legacy_1");
  assert.equal(doc.attempt_stop_nbr, "007174773-1");
  assert.equal(doc.notes, "note on i_legacy_1");
  assert.equal(doc.created_at, "2026-09-12T10:00:00Z");
  assert.equal(doc.updated_at, NOW);
});

test("overridesFor: any stop on the order, on its own day only, the primary stop's first", () => {
  const incidents = [
    saved("on-copy", "007174773-1", DATE, "2026-09-12T10:00:00Z"),
    saved("on-primary", "007174773", DATE, "2026-09-12T09:00:00Z"),
    saved("other-day", "007174773", "2026-09-12", "2026-09-13T09:00:00Z"),
    { ...saved("not-attempt", "007174773", DATE, "x"), category: "forgotten_freight" },
  ];
  assert.deepEqual(
    overridesFor(ORDER, DATE, incidents).map((i) => i.id),
    ["on-primary", "on-copy"],
  );
});

function harness({ saveResult, saveError } = {}) {
  const log = [];
  return {
    log,
    save: async (doc) => {
      log.push(["save", doc.id]);
      if (saveError) throw new Error(saveError);
      return saveResult ? saveResult(doc) : doc;
    },
    remove: async (id) => {
      log.push(["remove", id]);
    },
    onSaved: (change) => log.push(["onSaved", change.type, change.id || change.incident?.id]),
  };
}

test("reassignAttempt: keeps one reassignment per order and invalidates the day", async () => {
  const incidents = [
    saved("on-primary", "007174773", DATE, "2026-09-12T09:00:00Z"),
    saved("on-copy", "007174773-1", DATE, "2026-09-12T10:00:00Z"),
  ];
  const cache = createDayCache();
  cache.set(DATE, { status: "ok", rows: [] }, { today: "2026-10-07", now: 0 });
  const h = harness();
  const r = await reassignAttempt({ order: ORDER, date: DATE, driver: BEN, incidents, ...h, cache });
  assert.deepEqual(r, { ok: true, pendingSync: false, error: null });
  assert.deepEqual(h.log, [
    ["remove", "on-copy"],
    ["onSaved", "delete", "on-copy"],
    ["save", "on-primary"],
    ["onSaved", "upsert", "on-primary"],
  ]);
  assert.equal(cache.has(DATE), false);
});

test("reassignAttempt: clearing removes every reassignment and saves nothing", async () => {
  const incidents = [
    saved("on-primary", "007174773", DATE, "2026-09-12T09:00:00Z"),
    saved("on-copy", "007174773-1", DATE, "2026-09-12T10:00:00Z"),
  ];
  const h = harness();
  const r = await reassignAttempt({ order: ORDER, date: DATE, driver: null, incidents, ...h, cache: createDayCache() });
  assert.equal(r.ok, true);
  assert.deepEqual(
    h.log.filter((x) => x[0] !== "onSaved"),
    [
      ["remove", "on-primary"],
      ["remove", "on-copy"],
    ],
  );
});

test("reassignAttempt: a failed save comes back as an error, never swallowed, and the day is still invalidated", async () => {
  const cache = createDayCache();
  cache.set(DATE, { status: "ok", rows: [] }, { today: "2026-10-07", now: 0 });
  const h = harness({ saveError: "permission-denied" });
  const r = await reassignAttempt({ order: ORDER, date: DATE, driver: BEN, incidents: [], ...h, cache });
  assert.deepEqual(r, { ok: false, pendingSync: false, error: "permission-denied" });
  assert.equal(h.log.some((x) => x[0] === "onSaved"), false, "nothing reported as saved");
  assert.equal(cache.has(DATE), false);
});

test("reassignAttempt: a save the server hasn't confirmed is reported as pending, not as done", async () => {
  const h = harness({ saveResult: (doc) => ({ ...doc, _pendingSync: true }) });
  const r = await reassignAttempt({ order: ORDER, date: DATE, driver: BEN, incidents: [], ...h, cache: createDayCache() });
  assert.deepEqual(r, { ok: true, pendingSync: true, error: null });
});
