// The drawer's state: breadcrumb levels, the number each level must show, and the hash
// encoding that lets Back close the drawer and a link reopen it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  narrowSpec,
  drillLevels,
  driverDrill,
  pushStep,
  popTo,
  encodeDrill,
  decodeDrill,
  groupFilter,
  drillStamp,
  attemptStamp,
  spanMonths,
} from "../src/data/drill.js";

const yearMonths = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

test("narrowing sets one thing and keeps the rest", () => {
  const spec = { kind: "blend", months: yearMonths, categoryIds: ["late", "damage"], fault: "driver" };
  assert.deepEqual(narrowSpec(spec, { category: "late" }).categoryIds, ["late"]);
  assert.equal(narrowSpec(spec, { driverId: "d1" }).driverId, "d1");
  assert.deepEqual(narrowSpec(spec, { month: "2026-04" }).months, ["2026-04"]);
  assert.equal(narrowSpec(spec, { month: "2026-04" }).fault, "driver");
  // A day window narrows to the part of the month inside it.
  const win = { kind: "window", start: "2026-03-20", end: "2026-05-10", categoryIds: ["late"] };
  assert.deepEqual(narrowSpec(win, { month: "2026-03" }), { ...win, start: "2026-03-20", end: "2026-03-31" });
  assert.deepEqual(narrowSpec(win, { month: "2026-04" }), { ...win, start: "2026-04-01", end: "2026-04-30" });
  assert.deepEqual(narrowSpec(win, { month: "2026-05" }), { ...win, start: "2026-05-01", end: "2026-05-10" });
});

test("each level carries the number that was clicked to reach it, per scope", () => {
  const state = driverDrill(
    "d1",
    {
      categoryIds: ["late", "damage"],
      scopes: [
        { label: "This Mo", months: ["2026-04"], expected: 3 },
        { label: "YTD 2026", months: yearMonths, expected: 11 },
      ],
    },
    { category: "late", x: [2, 7] },
  );
  const now = drillLevels(state);
  assert.deepEqual(now.map((l) => l.expected), [3, 2]);
  assert.deepEqual(now[1].spec, { kind: "blend", driverId: "d1", categoryIds: ["late"], fault: null, months: ["2026-04"] });
  assert.deepEqual(drillLevels({ ...state, scope: 1 }).map((l) => l.expected), [11, 7]);
  // A month clicked under one scope only vouches for that scope.
  const deeper = pushStep(state, { month: "2026-04", x: 2 });
  assert.deepEqual(drillLevels(deeper).map((l) => l.expected), [3, 2, 2]);
  assert.equal(drillLevels({ ...deeper, scope: 1 })[2].expected, undefined);
  assert.equal(popTo(deeper, 1).path.length, 1);
  assert.equal(popTo(deeper, 0).path.length, 0);
});

test("a category outside the drawer's set doesn't narrow it", () => {
  const state = driverDrill("d1", { categoryIds: ["late"], scopes: [] }, { category: "unable_to_track", x: 1 });
  assert.equal(state.path, undefined);
});

test("the hash round-trips, with month runs packed", () => {
  const state = pushStep(
    driverDrill(
      "drv_84_vincentbonzo",
      {
        categoryIds: ["late"],
        fault: "driver",
        scopes: [
          { label: "Last 3 Mo", months: ["2025-11", "2025-12", "2026-01"], expected: 4 },
          { label: "All time", months: ["2023-01", "2023-02", "2023-12", "2024-01"], expected: 9 },
        ],
      },
      { category: "late", x: [1, 2] },
    ),
    { month: "2025-12", x: 1 },
  );
  state.vocab = ["late", "damage"];
  const s = encodeDrill(state);
  assert.match(s, /2025-11~2026-01/);
  assert.match(s, /2023-01~2023-02,2023-12~2024-01/);
  assert.deepEqual(decodeDrill(s), state);
});

test("a malformed or hand-edited link opens nothing rather than breaking", () => {
  for (const bad of ["", "{", "null", "{}", '{"spec":{"kind":"nope"}}', '{"spec":{"kind":"blend","months":"2026-13~2026-01"}}']) {
    assert.equal(decodeDrill(bad), null, bad);
  }
  assert.equal(encodeDrill(null), "");
});

test("role groups follow the Scorecard: loaders, and everyone else", () => {
  const roles = { a: "loader", b: "driver", c: "non-driver" };
  const loaders = groupFilter("loader", (id) => roles[id]);
  const others = groupFilter("driver", (id) => roles[id]);
  assert.deepEqual(["a", "b", "c", "zz"].filter(loaders), ["a"]);
  // An id with no roster row reads as a driver.
  assert.deepEqual(["a", "b", "c", "zz"].filter(others), ["b", "c", "zz"]);
  assert.equal(groupFilter(null)("anything"), true);
});

test("a drawer's data stamp rides along in the link", () => {
  const state = { spec: { kind: "blend", months: ["2026-04"], categoryIds: ["late"] }, expected: 3, at: "k.1x.2y" };
  assert.deepEqual(decodeDrill(encodeDrill(state)), state);
  assert.equal(decodeDrill(encodeDrill({ ...state, at: 5 })).at, undefined);
});

test("the data stamp moves with anything a drill-down counts, and not with order", () => {
  const incidents = [
    { id: "a", driver_id: "d1", category: "late", fault: "unknown", delivered_date: "2026-04-02" },
    { id: "b", driver_id: "d2", category: "damage", fault: "driver", delivered_date: "2026-04-03" },
  ];
  const history = [{ year: 2025, month: 3, driver_id: "d1", category: "late", count: 4 }];
  const drivers = [{ id: "d1", role: "driver" }, { id: "d2", role: "loader" }];
  const stamp = drillStamp({ incidents, history, drivers });
  assert.equal(drillStamp({ incidents: [...incidents].reverse(), history, drivers }), stamp);
  // Unrelated fields don't move it: a note, a photo, a customer.
  assert.equal(drillStamp({ incidents: [{ ...incidents[0], notes: "x", has_photos: true }, incidents[1]], history, drivers }), stamp);
  for (const changed of [
    { incidents: [{ ...incidents[0], fault: "driver" }, incidents[1]], history, drivers },
    { incidents: [{ ...incidents[0], no_fault: true }, incidents[1]], history, drivers },
    { incidents: [{ ...incidents[0], delivered_date: "2026-05-01" }, incidents[1]], history, drivers },
    { incidents: [incidents[0]], history, drivers },
    { incidents, history: [{ ...history[0], count: 5 }], drivers },
    { incidents, history, drivers: [drivers[0], { ...drivers[1], role: "driver" }] },
  ]) {
    assert.notEqual(drillStamp(changed), stamp);
  }
});

test("the attempts stamp moves with which orders, their day, driver and outcome", () => {
  const recs = [
    { id: "feed:2026-09-01:1", date: "2026-09-01", key: "d1", outcome: "delivered", customer: "A" },
    { id: "feed:2026-09-02:2", date: "2026-09-02", key: "unassigned", outcome: "unplanned" },
  ];
  const stamp = attemptStamp(recs);
  assert.equal(attemptStamp([...recs].reverse()), stamp);
  assert.equal(attemptStamp([{ ...recs[0], customer: "B" }, recs[1]]), stamp, "a customer name isn't counted");
  for (const changed of [
    [recs[0]],
    [{ ...recs[0], key: "d2" }, recs[1]], // reassigned
    [{ ...recs[0], outcome: "rescheduled" }, recs[1]],
    [{ ...recs[0], date: "2026-09-03" }, recs[1]],
  ]) {
    assert.notEqual(attemptStamp(changed), stamp);
  }
  assert.equal(attemptStamp([]), "0.0.0");
});

test("a span runs from the first month to the last, gaps included", () => {
  assert.deepEqual(spanMonths(["2025-11", "2026-02", "2025-11"]), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(spanMonths([]), []);
  assert.deepEqual(spanMonths(["undated", "2026-03"]), ["2026-03"]);
});
