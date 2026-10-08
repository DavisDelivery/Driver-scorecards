// Guards the Scorecard drill-downs.
//
// The rule that matters: a drill-down shows the SAME number as the card you clicked.
// The driver popup broke it — the Scorecard never passed it the rolled-up history, so
// a driver at "0 / 7" whose seven came from history opened to "No detailed incidents
// on file". These tests pin the drill-down to the cards' own rule: each category of
// each month is live or history (blend.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryDetail, buildWindowDetail, monthsOfYear } from "../src/data/scorecardDetail.js";
import { incidentYm, incidentDateStr, fmtIncidentDate } from "../src/data/incidentDate.js";
import { reportDateBounds } from "../src/reports/reportNaming.js";

const CATS = ["damage", "late", "misdelivery", "forgotten_freight"];

const inc = (id, driver, category, date) => ({
  id,
  driver_id: driver,
  driver_name: driver.toUpperCase(),
  category,
  delivered_date: date,
});

// July is rolled up (history only). September has live incidents.
const history = [
  { year: 2026, month: 7, driver_id: "steve", driver_name: "STEVE", category: "misdelivery", count: 7 },
  { year: 2026, month: 7, driver_id: "ben", driver_name: "BEN", category: "damage", count: 2 },
  // History for a LIVE month must be ignored, exactly as the cards ignore it.
  { year: 2026, month: 9, driver_id: "steve", driver_name: "STEVE", category: "misdelivery", count: 99 },
];
const liveByYm = {
  "2026-09": [
    inc("a", "steve", "misdelivery", "2026-09-16"),
    inc("b", "steve", "misdelivery", "2026-09-16"),
    inc("c", "dj", "misdelivery", "2026-09-02"),
    inc("d", "ben", "damage", "2026-09-03"),
  ],
};

test("a history-only driver's drill-down finds their history", () => {
  // The bug: "0 / 7" opened to nothing, because the history was never passed in.
  const d = buildCategoryDetail({
    scopeMonths: monthsOfYear(2026),
    liveByYm,
    history,
    categoryId: "misdelivery",
    driverId: "steve",
  });
  // 7 from July's history + 2 live in September. September's history (99) is NOT
  // added, because September is a live month.
  assert.equal(d.total, 9);
  assert.equal(d.incidents.length, 2);
  assert.equal(d.historyRows.length, 1);
  assert.equal(d.historyRows[0].count, 7);
});

test("the period count matches what the card shows for that period", () => {
  const sept = buildCategoryDetail({
    scopeMonths: ["2026-09"],
    liveByYm,
    history,
    categoryId: "misdelivery",
  });
  assert.equal(sept.total, 3);
  assert.equal(sept.byDriver.get("steve").count, 2);
  assert.equal(sept.byDriver.get("dj").count, 1);
  // Other categories never leak in.
  assert.equal(sept.byDriver.has("ben"), false);
});

test("all-categories mode stays inside the charted categories", () => {
  const d = buildCategoryDetail({
    scopeMonths: monthsOfYear(2026),
    liveByYm,
    history,
    categoryIds: CATS,
    driverId: "ben",
  });
  assert.equal(d.byCategory.get("damage"), 3); // 2 history (Jul) + 1 live (Sep)
  assert.equal(d.total, 3);
});

test("the role-group filter splits drivers from loaders like the cards do", () => {
  const loaders = new Set(["dj"]);
  const drivers = buildCategoryDetail({
    scopeMonths: ["2026-09"],
    liveByYm,
    history,
    categoryId: "misdelivery",
    inGroup: (id) => !loaders.has(id),
  });
  assert.equal(drivers.total, 2);
  assert.equal(drivers.byDriver.has("dj"), false);
});

test("incidents come back newest first", () => {
  const d = buildCategoryDetail({
    scopeMonths: ["2026-09"],
    liveByYm,
    history,
    categoryId: "misdelivery",
  });
  assert.deepEqual(
    d.incidents.map((i) => i.delivered_date),
    ["2026-09-16", "2026-09-16", "2026-09-02"],
  );
});

test("month totals line up with the scope", () => {
  const d = buildCategoryDetail({
    scopeMonths: monthsOfYear(2026),
    liveByYm,
    history,
    categoryId: "misdelivery",
  });
  assert.equal(d.byMonth.get("2026-07"), 7);
  assert.equal(d.byMonth.get("2026-09"), 3);
  assert.equal(d.byMonth.get("2026-08"), undefined);
});

test("an empty scope is empty, not an error", () => {
  const d = buildCategoryDetail({ scopeMonths: [], liveByYm, history, categoryId: "damage" });
  assert.equal(d.total, 0);
  assert.equal(d.incidents.length, 0);
});

// ---------------------------------------------------------------------------
// The shared incident date. The driver popup used to read ship_date ahead of
// return_date, so a return shipped in July and returned in August landed in
// different months on the Scorecard and in the popup opened from it.
// ---------------------------------------------------------------------------

test("an incident is filed under the same month everywhere", () => {
  const ret = { ship_date: "2026-07-28", return_date: "2026-08-03" };
  assert.equal(incidentYm(ret), "2026-08");
  assert.equal(incidentYm({ delivered_date: "2026-09-16", ship_date: "2026-09-10" }), "2026-09");
  assert.equal(incidentYm({ ingested_at: "2026-09-01T12:00:00Z" }), "2026-09");
});

test("an undated incident has no month rather than a junk one", () => {
  assert.equal(incidentYm({}), "");
  assert.equal(incidentYm(null), "");
  assert.equal(incidentYm({ delivered_date: "soon" }), "");
  assert.equal(incidentDateStr(null), "");
});

test("a report's date bounds use the same date the incident is filed under", () => {
  // It read a private copy of the precedence in analytics.js; now incidentDateStr.
  const b = reportDateBounds([
    { ship_date: "2026-07-28", return_date: "2026-08-03" },
    { delivered_date: "2026-08-05", ship_date: "2026-07-01" },
    { ingested_at: "2026-07-30T23:59:00Z" },
    { week_ending: "soon" },
  ]);
  assert.deepEqual(b, { starts_at: "2026-07-30", ends_at: "2026-08-05" });
  assert.deepEqual(reportDateBounds([]), { starts_at: null, ends_at: null });
});

test("display dates are parsed from the string, never shifted", () => {
  assert.equal(fmtIncidentDate({ delivered_date: "2026-09-16" }), "09/16/2026");
  assert.equal(fmtIncidentDate({}), "—");
});

// ---------------------------------------------------------------------------
// The blend's own cell rule, and day windows that still obey it.
// ---------------------------------------------------------------------------

test("byMonthCategory splits each month by category and adds up to byMonth", () => {
  const d = buildCategoryDetail({ scopeMonths: monthsOfYear(2026), liveByYm, history, categoryIds: CATS });
  assert.deepEqual(Object.fromEntries(d.byMonthCategory.get("2026-07")), { misdelivery: 7, damage: 2 });
  assert.deepEqual(Object.fromEntries(d.byMonthCategory.get("2026-09")), { misdelivery: 3, damage: 1 });
  for (const [ym, cats] of d.byMonthCategory) {
    assert.equal([...cats.values()].reduce((a, n) => a + n, 0), d.byMonth.get(ym), ym);
  }
});

test("isLive with an empty driver-fault live cell returns 0, not history", () => {
  // Under Driver-fault scope a cell can be live (it holds counted rows) with none of
  // them the driver's fault. Its history is all-fault, so it must not stand in.
  const isLive = (ym, cat) => (ym === "2026-07" || ym === "2026-09") && CATS.includes(cat);
  const d = buildCategoryDetail({
    scopeMonths: ["2026-07"],
    liveByYm: { "2026-07": [] },
    isLive,
    history,
    categoryId: "misdelivery",
  });
  assert.equal(d.total, 0);
  assert.equal(d.historyRows.length, 0);
  // Without isLive, the old length test falls back to July's history.
  assert.equal(
    buildCategoryDetail({ scopeMonths: ["2026-07"], liveByYm: { "2026-07": [] }, history, categoryId: "misdelivery" }).total,
    7,
  );
});

test("a month's live categories count their entries, and its other categories history", () => {
  // September's misdeliveries are live, so its history for them (99) is not added.
  // Nobody logged a late in September, so the late history counts beside them.
  const hist = [...history, { year: 2026, month: 9, driver_id: "dj", driver_name: "DJ", category: "late", count: 4 }];
  const d = buildCategoryDetail({ scopeMonths: ["2026-09"], liveByYm, history: hist, categoryIds: CATS });
  assert.equal(d.total, 8);
  assert.deepEqual(Object.fromEntries(d.byMonthCategory.get("2026-09")), { misdelivery: 3, damage: 1, late: 4 });
  assert.deepEqual(d.historyRows.map((r) => [r.category, r.count]), [["late", 4]]);
  assert.equal(d.incidents.length, 4);
  // A window over part of September names the late history rather than prorate it; the
  // live rows inside the window still count.
  const w = buildWindowDetail({ start: "2026-09-01", end: "2026-09-15", liveByYm, history: hist, categoryIds: CATS });
  assert.equal(w.total, 2);
  assert.deepEqual(w.unsplittable, [{ ym: "2026-09", count: 4 }]);
});

test("a window's live total is the sum of its days", () => {
  const d = buildWindowDetail({
    start: "2026-09-01",
    end: "2026-09-15",
    liveByYm,
    history,
    categoryIds: CATS,
  });
  // Steve's two on the 16th fall outside the window.
  assert.equal(d.total, 2);
  assert.equal([...d.byDay.values()].reduce((a, n) => a + n, 0), d.total);
  assert.deepEqual(Object.fromEntries(d.byDay), { "2026-09-02": 1, "2026-09-03": 1 });
  assert.deepEqual(d.unsplittable, []);
});

test("a history month only partly inside a window is unsplittable, never prorated", () => {
  const d = buildWindowDetail({
    start: "2026-07-15",
    end: "2026-09-30",
    liveByYm,
    history,
    categoryIds: CATS,
  });
  // July is history and only half inside: listed, not counted. September is live.
  assert.deepEqual(d.unsplittable, [{ ym: "2026-07", count: 9 }]);
  assert.equal(d.byMonth.has("2026-07"), false);
  assert.equal(d.total, 4);
  assert.equal([...d.byDay.values()].reduce((a, n) => a + n, 0), 4);
});

test("a history month wholly inside a window is added whole", () => {
  const d = buildWindowDetail({
    start: "2026-07-01",
    end: "2026-07-31",
    liveByYm,
    history,
    categoryId: "misdelivery",
  });
  assert.equal(d.total, 7);
  assert.equal(d.historyRows.length, 1);
  assert.equal(d.byDay.size, 0);
  assert.deepEqual(d.unsplittable, []);
});

test("a window crossing Jan 1 walks both years", () => {
  const live = {
    "2025-12": [inc("x", "steve", "damage", "2025-12-30")],
    "2026-01": [inc("y", "steve", "damage", "2026-01-02")],
  };
  const d = buildWindowDetail({ start: "2025-12-29", end: "2026-01-04", liveByYm: live, categoryId: "damage" });
  assert.equal(d.total, 2);
  assert.deepEqual([...d.byMonth.keys()].sort(), ["2025-12", "2026-01"]);
});

test("a malformed window is empty, not an error", () => {
  assert.equal(buildWindowDetail({ start: "2026-09-30", end: "2026-09-01", liveByYm, history, categoryIds: CATS }).total, 0);
  assert.equal(buildWindowDetail({ start: "", end: "2026-09-01", liveByYm, history, categoryIds: CATS }).total, 0);
});
