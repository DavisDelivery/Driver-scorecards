// Guards the Scorecard drill-downs.
//
// The rule that matters: a drill-down shows the SAME number as the card you clicked.
// The driver popup broke it — the Scorecard never passed it the rolled-up history, so
// a driver at "0 / 7" whose seven came from history opened to "No detailed incidents
// on file". These tests pin the drill-down to the cards' own month-by-month rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryDetail, monthsOfYear } from "../src/data/scorecardDetail.js";
import { incidentYm, incidentDateStr, fmtIncidentDate } from "../src/data/incidentDate.js";

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

test("display dates are parsed from the string, never shifted", () => {
  assert.equal(fmtIncidentDate({ delivered_date: "2026-09-16" }), "09/16/2026");
  assert.equal(fmtIncidentDate({}), "—");
});
