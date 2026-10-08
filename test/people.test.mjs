// people.js: who an id is, and who a driver is compared against.
//
// The reporting rules it carries: an id with no roster row is never hidden (it is named
// from the data and counted), and a deactivated driver drops out of peers and pickers
// only — never out of a total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { personIndex, nameOf, nameOfKey, peerSet, fleetStats, rankOf } from "../src/data/people.js";
import { historyLoadState, initialLoadState, isStale, HISTORY_MAX_AGE_MS } from "../src/data/loadState.js";
import { drivers, incidents, history } from "./blend-fixture.mjs";

test("an unknown id is visible and named from the data", () => {
  const people = personIndex({ drivers, incidents, history });
  // d5 is on an April incident with only a NuVizz name; d9 is in 2024 history only.
  assert.equal(nameOf(people, "d5"), "ZED ZULU");
  assert.equal(people.get("d5").onRoster, false);
  assert.equal(people.get("d5").active, true);
  assert.equal(nameOf(people, "d9"), "Old Timer");
  assert.equal(people.get("d9").firstOnFile, "2024-02");
  // An id nobody has ever seen still shows as itself; no id at all is Unattributed.
  assert.equal(nameOf(people, "zz"), "zz");
  assert.equal(nameOf(people, ""), "Unattributed");
});

test("a driver key is named the way its bar is", () => {
  // attemptRecords.js keys: a roster id, "name:<feed name>", or "unassigned".
  const people = personIndex({ drivers, incidents, history });
  assert.equal(nameOfKey(people, "d1"), "Ann Able");
  assert.equal(nameOfKey(people, "name:Kobe Boakye"), "Kobe Boakye");
  assert.equal(nameOfKey(people, "unassigned"), "Unassigned");
  assert.equal(nameOfKey(people, ""), "Unassigned");
  assert.equal(nameOfKey(people, "d5"), "ZED ZULU", "an id with no roster row is named from the data");
});

test("the roster wins for names, roles and status", () => {
  const people = personIndex({ drivers, incidents, history });
  assert.equal(nameOf(people, "d1"), "Ann Able");
  assert.equal(people.get("d3").role, "loader");
  assert.equal(people.get("d4").active, false);
  assert.equal(people.get("d4").onRoster, true);
  // The span of their record runs across history and live rows.
  assert.equal(people.get("d1").firstOnFile, "2025-11");
  assert.equal(people.get("d1").lastOnFile, "2026-06");
});

test("raw names are aliases only when they resolve back to the same driver", () => {
  const people = personIndex({
    drivers,
    incidents: [
      { id: "a", driver_id: "d1", driver_raw: "ANN  ABLE", category: "late", delivered_date: "2026-04-01" },
      // A manual entry charged to Ann on a load someone else drove: not an alias.
      { id: "b", driver_id: "d1", driver_raw: "BO BAKER", category: "forgotten_freight", delivered_date: "2026-04-02" },
    ],
  });
  assert.deepEqual([...people.get("d1").rawNames], ["ANN  ABLE"]);
});

test("inactive drivers are left out of peers; unknown ids are kept", () => {
  assert.deepEqual(peerSet(drivers, ["d1", "d5"], "driver"), ["d1", "d2", "d6", "d5"]);
  assert.deepEqual(peerSet(drivers, ["d5"], "loader"), ["d3"]);
  // Seen ids already on the roster are not added twice, inactive ones not at all.
  assert.deepEqual(peerSet(drivers, ["d4", "d2"], "driver"), ["d1", "d2", "d6"]);
});

test("fleet statistics are nearest-rank and count the zeros", () => {
  assert.deepEqual(fleetStats([0, 0, 0, 4]), { median: 0, p90: 4, mean: 1 });
  assert.deepEqual(fleetStats([5, 1, 3, 2, 4]), { median: 3, p90: 5, mean: 3 });
  assert.deepEqual(fleetStats([7]), { median: 7, p90: 7, mean: 7 });
  assert.deepEqual(fleetStats([]), { median: null, p90: null, mean: null });
});

test("rank counts who is strictly higher, and says when it is shared", () => {
  const values = [5, 3, 3, 0, 0, 0];
  assert.deepEqual(rankOf(values, 5), { rank: 1, tied: false, of: 6 });
  assert.deepEqual(rankOf(values, 3), { rank: 2, tied: true, of: 6 });
  assert.deepEqual(rankOf(values, 0), { rank: 4, tied: true, of: 6 });
});

// ── historyLoadState ─────────────────────────────────────────────────────────

test("a failed history read is an error, never an empty history", () => {
  const s = historyLoadState({ records: [], monthIds: [], error: "permission-denied" }, initialLoadState(), 1000);
  assert.equal(s.status, "error");
  assert.equal(s.error, "permission-denied");
  assert.equal(s.loadedAt, 0);
});

test("an empty store loads as empty, distinct from a failure", () => {
  const s = historyLoadState({ records: [], monthIds: [], error: null }, initialLoadState(), 1000);
  assert.equal(s.status, "empty");
  assert.equal(s.error, null);
  assert.equal(s.loadedAt, 1000);
});

test("a loaded history is ready, and a failed refresh keeps it but says so", () => {
  const loaded = historyLoadState(
    { records: history, monthIds: ["2026-01"], newestUpdatedAt: "2026-10-01", error: null },
    initialLoadState(),
    1000,
  );
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.records.length, history.length);
  const failed = historyLoadState({ error: "offline" }, loaded, 2000);
  assert.equal(failed.status, "ready");
  assert.equal(failed.records, loaded.records);
  assert.equal(failed.refreshError, "offline");
  assert.equal(failed.loadedAt, 1000);
  // The next good read clears it.
  assert.equal(historyLoadState({ records: history, error: null }, failed, 3000).refreshError, null);
});

test("a copy goes stale after 30 minutes", () => {
  const s = { ...initialLoadState(), loadedAt: 1000 };
  assert.equal(isStale(s, 1000 + HISTORY_MAX_AGE_MS), false);
  assert.equal(isStale(s, 1001 + HISTORY_MAX_AGE_MS), true);
  assert.equal(isStale(initialLoadState(), 10 ** 12), false);
});
