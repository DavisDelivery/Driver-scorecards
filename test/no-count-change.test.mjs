// v0.20.0 changed how charts look and where category colours come from — and was not
// allowed to change a single number. These are snapshot totals for a fixture, taken by
// running the v0.19.2 analytics.js on it; the new code must reproduce them exactly.
//
// The fixture is built to hit the cases that have broken before: rows that count for
// nothing (no-fault, no driver, unable-to-track, returns), a month with only
// compliments and complaints, history superseded by a live month, and a live month on
// each side of Jan 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableYears,
  buildMonthlyTotals,
  buildYearlyTotals,
  aggregateReport,
  reportColumn,
  REPORT_OTHER,
  ANALYTICS_CATEGORY_IDS,
} from "../src/data/analytics.js";
import { buildBlend } from "../src/data/blend.js";
import { rowTotal, chartTable } from "../src/views/kit/shape.js";
import { categoriesFor, CHARTED6 } from "../src/data/categories.js";

const incidents = [
  { id: "a", driver_id: "d1", category: "late", fault: "driver", actual_delivery: "2026-04-03", report_id: "r1", sources: ["laters"] },
  { id: "b", driver_id: "d1", category: "damage", fault: "driver", delivered_date: "2026-04-09", report_id: "r1", has_photos: true },
  { id: "c", driver_id: "d2", category: "forgotten_freight", fault: "driver", delivered_date: "2026-04-21" },
  { id: "d", driver_id: "d2", category: "attempts", fault: "", delivered_date: "2026-04-22" },
  { id: "e", driver_id: "d3", category: "missing", fault: "warehouse", return_date: "2026-04-30", report_id: "r1", sources: ["returns"] },
  { id: "f", driver_id: "d3", category: "misdelivery", fault: "unknown", no_fault: true, delivered_date: "2026-04-11", report_id: "r1" },
  { id: "g", driver_id: "", category: "late", fault: "unknown", actual_delivery: "2026-04-12", report_id: "r1" },
  { id: "h", driver_id: "d4", category: "unable_to_track", fault: "", delivered_date: "2026-04-15" },
  { id: "i", driver_id: "d5", category: "return", fault: "customer", return_date: "2026-04-02", report_id: "r1", sources: ["returns", "traces"] },
  { id: "j", driver_id: "d1", category: "compliment", fault: "", delivered_date: "2026-05-04" },
  { id: "k", driver_id: "d2", category: "complaint", fault: "driver", delivered_date: "2026-05-06" },
  { id: "l", driver_id: "d2", category: "late", fault: "driver", ship_date: "2025-12-30", report_id: "r2" },
  { id: "m", driver_id: "d1", category: "forgotten_freight", fault: "driver", week_ending: "2026-01-02", report_id: "r2" },
];
const history = [
  { year: 2026, month: 4, driver_id: "d1", category: "late", count: 9 },
  { year: 2026, month: 5, driver_id: "d1", category: "damage", count: 2 },
  { year: 2026, month: 5, driver_id: "d3", category: "missing", count: 1 },
  { year: 2026, month: 5, driver_id: "d3", category: "compliment", count: 4 },
  { year: 2025, month: 11, driver_id: "d2", category: "forgotten_freight", count: 3 },
  { year: 2025, month: 12, driver_id: "d2", category: "damage", count: 5 },
  { year: 2024, month: 2, driver_id: "d9", category: "misdelivery", count: 6 },
  { year: 2024, month: 2, driver_id: "", category: "attempts", count: 1 },
];

// v0.19.2's output, verbatim (months with no data left out).
const SNAPSHOT = {
  2024: [{ month: 2, source: "history", total: 7, byCat: { misdelivery: 6, attempts: 1 } }],
  2025: [
    { month: 11, source: "history", total: 3, byCat: { forgotten_freight: 3 } },
    { month: 12, source: "live", total: 1, byCat: { late: 1 } },
  ],
  2026: [
    { month: 1, source: "live", total: 1, byCat: { forgotten_freight: 1 } },
    { month: 4, source: "live", total: 5, byCat: { damage: 1, missing: 1, forgotten_freight: 1, late: 1, attempts: 1 } },
    // v0.20.1: months qualify on the Scorecard's eight categories everywhere (blend.js).
    // May 2026 holds only a live compliment and complaint, so it is live now — reading 0
    // of the six, as the Scorecard always read it — where v0.19.2 fell back to history
    // (damage 2, missing 1). The one deliberate change; no production month has this
    // shape (2026-10-07 pull: the six- and eight-category rules pick the same months).
    { month: 5, source: "live", total: 0, byCat: {} },
  ],
};

const nonZero = (byCat) => Object.fromEntries(Object.entries(byCat).filter(([, n]) => n));

test("monthly totals are v0.19.2's, month by month and category by category", () => {
  assert.deepEqual(availableYears(incidents, history), [2024, 2025, 2026]);
  for (const [year, months] of Object.entries(SNAPSHOT)) {
    const got = buildMonthlyTotals(Number(year), buildBlend({ incidents, history }))
      .filter((m) => m.source !== "none")
      .map((m) => ({ month: m.month, source: m.source, total: m.total, byCat: nonZero(m.byCat) }));
    assert.deepEqual(got, months, year);
  }
});

test("yearly totals are v0.19.2's", () => {
  assert.deepEqual(
    buildYearlyTotals(availableYears(incidents, history), buildBlend({ incidents, history })).map((y) => ({ year: y.year, total: y.total, source: y.source })),
    [
      { year: 2024, total: 7, source: "history" },
      { year: 2025, total: 4, source: "blended" },
      { year: 2026, total: 6, source: "blended" }, // 9 in v0.19.2: see May 2026 above
    ],
  );
});

test("weekly report aggregates are v0.19.2's", () => {
  assert.deepEqual(aggregateReport("r1", incidents), {
    count: 6,
    byCat: { late: 2, damage: 1, missing: 1, misdelivery: 1, return: 1 },
    bySource: { traces: 1, returns: 2, laters: 1 },
    driverFault: 2,
    withPhotos: 1,
  });
  assert.equal(aggregateReport("r2", incidents).count, 2);
  assert.equal(aggregateReport("r2", incidents).driverFault, 2);
});

test("the restacked charts draw the same column totals", () => {
  // Reports and Trends now stack in the validated order; the six categories are the
  // same, so every column — and its table row — adds up to the old total.
  const series = categoriesFor(CHARTED6).map((c) => ({ id: c.id, label: c.label }));
  assert.deepEqual([...ANALYTICS_CATEGORY_IDS].sort(), [...CHARTED6].sort());
  for (const year of [2024, 2025, 2026]) {
    const months = buildMonthlyTotals(year, buildBlend({ incidents, history }));
    const rows = months.map((m) => ({ name: m.monthName, ...m.byCat, source: m.source }));
    const table = chartTable({ rows, x: { key: "name", label: "Month" }, series, total: true, source: (r) => r.source });
    months.forEach((m, i) => {
      assert.equal(rowTotal(rows[i], CHARTED6), m.total, `${year}-${m.month}`);
      assert.equal(table.rows[i].__total, m.total, `${year}-${m.month} table`);
      assert.equal(table.rows[i].__source, m.source);
    });
  }
});

test("a weekly column adds up to its report's Inc., returns and traces included", () => {
  // r1 holds a return the six don't chart. The column — and its tooltip and table
  // Total — must read the report's own count, the figure in the Inc. column below it,
  // never the six alone.
  const keys = [...ANALYTICS_CATEGORY_IDS, REPORT_OTHER];
  const series = keys.map((id) => ({ id, label: id }));
  for (const id of ["r1", "r2"]) {
    const agg = aggregateReport(id, incidents);
    const row = { name: id, ...reportColumn(agg.byCat, agg.count) };
    assert.equal(rowTotal(row, keys), agg.count, id);
    const table = chartTable({ rows: [row], x: { key: "name", label: "Week" }, series, total: true });
    assert.equal(table.rows[0].__total, agg.count, `${id} table`);
    // The six keep their own counts; only the remainder goes to "other".
    for (const c of ANALYTICS_CATEGORY_IDS) assert.equal(row[c], agg.byCat[c] || 0, `${id} ${c}`);
  }
  assert.equal(reportColumn(aggregateReport("r1", incidents).byCat, 6)[REPORT_OTHER], 1);
  // A report whose incidents aren't loaded falls back to its stored count: the column
  // still reaches it, as "other", rather than drawing nothing under a number.
  assert.equal(rowTotal(reportColumn({}, 33), keys), 33);
});
