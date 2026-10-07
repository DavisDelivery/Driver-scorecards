// A read the server never answered is a failed read, not an empty store.
//
// With Firestore's offline cache on, getDocs/getDoc don't throw when the server can't be
// reached — they answer from this browser's cache, which on a new device is empty. These
// pin what the app does with such an answer: an old copy is shown and said to be old,
// no copy is a failure, and nothing is ever drawn as a fresh zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readResult,
  applyReadResult,
  historyLoadState,
  initialLoadState,
  SERVER_UNREACHABLE,
} from "../src/data/loadState.js";

test("an answer from the server is data; one from the cache is a failure carrying the copy", () => {
  assert.deepEqual(readResult([1, 2], false), { data: [1, 2], error: null });
  assert.deepEqual(readResult([1, 2], true), { data: [1, 2], error: SERVER_UNREACHABLE, offline: true });
  assert.deepEqual(readResult([], true), { data: [], error: SERVER_UNREACHABLE, offline: true });
});

test("an empty cache on a first load is a failure, never an empty list", () => {
  const r = applyReadResult(readResult([], true), false);
  assert.equal(r.data, undefined);
  assert.deepEqual(r.error, { message: SERVER_UNREACHABLE, stale: false });
  assert.equal(r.loaded, false);
});

test("a cached copy on a first load is shown, and said to be old", () => {
  const r = applyReadResult(readResult([{ id: "a" }], true), false);
  assert.deepEqual(r.data, [{ id: "a" }]);
  assert.deepEqual(r.error, { message: SERVER_UNREACHABLE, stale: true, offline: true });
  assert.equal(r.loaded, true);
});

test("a failed refresh keeps what is on screen", () => {
  for (const result of [readResult([{ id: "old" }], true), { data: null, error: "permission-denied" }]) {
    const r = applyReadResult(result, true);
    assert.equal(r.data, undefined);
    assert.equal(r.error.stale, true);
    assert.equal(r.loaded, true);
  }
});

test("a thrown read with nothing on screen is a failure; a good read clears it", () => {
  const failed = applyReadResult({ data: null, error: "unavailable" }, false);
  assert.deepEqual(failed, { data: undefined, error: { message: "unavailable", stale: false }, loaded: false });
  assert.deepEqual(applyReadResult({ data: [], error: null }, false), { data: [], error: null, loaded: true });
});

test("history answered from the cache is an old copy, or a failure when the cache is empty", () => {
  const records = [{ year: 2025, month: 1, driver_id: "d1", category: "late", count: 2 }];
  const offline = historyLoadState({ records, monthIds: ["2025-01"], error: SERVER_UNREACHABLE, offline: true }, initialLoadState(), 1000);
  assert.equal(offline.status, "ready");
  assert.equal(offline.offline, true);
  assert.equal(offline.refreshError, SERVER_UNREACHABLE);
  assert.deepEqual(offline.records, records);
  const empty = historyLoadState({ records: [], monthIds: [], error: SERVER_UNREACHABLE, offline: true }, initialLoadState(), 1000);
  assert.equal(empty.status, "error");
  // A good copy already on screen is kept over the cache's.
  const good = historyLoadState({ records, monthIds: ["2025-01"], error: null }, initialLoadState(), 500);
  const kept = historyLoadState({ records: [], error: SERVER_UNREACHABLE, offline: true }, good, 2000);
  assert.equal(kept.loadedAt, 500);
  assert.equal(kept.offline, undefined);
  assert.equal(kept.refreshError, SERVER_UNREACHABLE);
});
