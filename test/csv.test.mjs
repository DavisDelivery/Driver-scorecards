// Guards the CSV every chart's table view exports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, csvName } from "../src/data/csv.js";
import { chartTable } from "../src/views/kit/shape.js";

const cols = [
  { key: "name", label: "Name" },
  { key: "n", label: "Count" },
];

test("plain rows", () => {
  assert.equal(toCsv([{ name: "Damage", n: 3 }], cols), "Name,Count\r\nDamage,3\r\n");
});

test("commas, quotes and line breaks are quoted", () => {
  const out = toCsv(
    [
      { name: "Smith, John", n: 1 },
      { name: 'He said "hi"', n: 2 },
      { name: "two\nlines", n: 3 },
    ],
    cols,
  );
  assert.equal(
    out,
    'Name,Count\r\n"Smith, John",1\r\n"He said ""hi""",2\r\n"two\nlines",3\r\n',
  );
});

test("missing values are empty, never 0", () => {
  assert.equal(toCsv([{ name: "Jan", n: null }, { name: "Feb" }], cols), "Name,Count\r\nJan,\r\nFeb,\r\n");
});

test("a text cell that looks like a formula is defused; numbers are not", () => {
  assert.equal(toCsv([{ name: "=HYPERLINK(1)", n: -3 }], cols), "Name,Count\r\n'=HYPERLINK(1),-3\r\n");
});

test("a value function overrides the key", () => {
  assert.equal(
    toCsv([{ name: "x", n: 2 }], [{ key: "n", label: "Double", value: (r) => r.n * 2 }]),
    "Double\r\n4\r\n",
  );
});

test("a chart's table always carries its source", () => {
  const t = chartTable({
    rows: [{ month: "Jan", damage: 2, late: null, src: "history" }],
    x: { key: "month", label: "Month" },
    series: [{ id: "damage", label: "Damage" }, { id: "late", label: "Late" }],
    total: true,
    source: (r) => r.src,
  });
  const csv = toCsv(t.rows, t.columns);
  assert.equal(csv, "Month,Damage,Late,Total,Source\r\nJan,2,,2,history\r\n");
});

test("file names are plain", () => {
  assert.equal(csvName("Monthly incidents ·", 2026), "Monthly_incidents_2026");
});
