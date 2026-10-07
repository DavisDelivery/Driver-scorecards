// Guards the pure half of the chart kit — what each chart draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSeries, topSegments, rowTotal, labelIndexes, chartTable } from "../src/views/kit/shape.js";
import { CHARTED6 } from "../src/data/categories.js";

test("stack order follows the registry, whatever order the series arrive in", () => {
  assert.deepEqual(
    orderSeries(["attempts", "late", "forgotten_freight", "missing", "damage", "misdelivery"]),
    CHARTED6,
  );
  // Filtering a category out doesn't move the others: Late stays after Misdelivery.
  assert.deepEqual(orderSeries(["late", "damage", "misdelivery"]), ["damage", "misdelivery", "late"]);
  // Unknown ids keep their own order, after the known ones.
  assert.deepEqual(orderSeries(["zeta", "late", "alpha"]), ["late", "zeta", "alpha"]);
});

test("only the topmost non-zero segment of each column is rounded", () => {
  const keys = ["damage", "late", "attempts"];
  const rows = [
    { damage: 2, late: 3, attempts: 1 },
    { damage: 2, late: 3, attempts: 0 }, // top is late, not the empty attempts
    { damage: 4, late: null, attempts: 0 },
    { damage: 0, late: 0, attempts: 0 }, // nothing to round
  ];
  assert.deepEqual(topSegments(rows, keys), ["attempts", "late", "damage", null]);
});

test("a column with no data is a gap, not a zero", () => {
  const keys = ["a", "b"];
  assert.equal(rowTotal({ a: 1, b: 2 }, keys), 3);
  assert.equal(rowTotal({ a: 0, b: 0 }, keys), 0);
  assert.equal(rowTotal({ a: null, b: undefined }, keys), null);
  assert.equal(rowTotal({ a: null, b: 4 }, keys), 4);
});

test("direct labels go on the latest and the largest mark only", () => {
  assert.deepEqual(labelIndexes([3, 9, 4, 5]), [1, 3]);
  // Latest is the last mark WITH a value; trailing gaps and the empty months still to
  // come in a year are skipped.
  assert.deepEqual(labelIndexes([3, 9, 4, null, null]), [1, 2]);
  assert.deepEqual(labelIndexes([3, 9, 4, 0, 0]), [1, 2]);
  // Latest and max the same mark: one label.
  assert.deepEqual(labelIndexes([1, 2, 7]), [2]);
  // Zeros are never labelled.
  assert.deepEqual(labelIndexes([0, 0, 0]), []);
  assert.deepEqual(labelIndexes([4, 0]), [0]);
  assert.deepEqual(labelIndexes([]), []);
});

test("the table twin keeps gaps as gaps and adds a total and a source", () => {
  const t = chartTable({
    rows: [
      { month: "Jan", damage: 1, late: 2, prior: 5 },
      { month: "Feb", damage: null, late: null, prior: null },
    ],
    x: { key: "month", label: "Month" },
    series: [{ id: "damage", label: "Damage" }, { id: "late", label: "Late" }],
    lines: [{ id: "prior", label: "2025 total" }],
    total: true,
    source: "live",
  });
  assert.deepEqual(t.columns.map((c) => c.label), ["Month", "Damage", "Late", "Total", "2025 total", "Source"]);
  assert.deepEqual(t.rows[0], { month: "Jan", damage: 1, late: 2, __total: 3, prior: 5, __source: "live" });
  assert.deepEqual(t.rows[1], { month: "Feb", damage: null, late: null, __total: null, prior: null, __source: "live" });
});
