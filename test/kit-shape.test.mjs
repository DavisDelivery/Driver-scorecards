// Guards the pure half of the chart kit — what each chart draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderSeries,
  topSegments,
  rowTotal,
  chartTable,
  leaderBar,
  businessDays,
  peakSummary,
  displayName,
  barListRows,
  keepRuns,
  avgLine,
  yearLinesPlan,
  sparkPlan,
  barGeometry,
  columnCaps,
  shadedReasons,
} from "../src/views/kit/shape.js";
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

test("a leaderboard bar holds its period whole, and is only as long as a number on its row", () => {
  // Trends, and a Scorecard period inside the year to date: "3 / 12".
  assert.deepEqual(leaderBar({ month: 3, ytd: 12 }), { solid: 3, faded: 9, whole: 12 });
  // A period crossing Jan 1 holds more than the year to date. The bar is the period,
  // never clamped to the year ("7 / 0" over an empty bar, before).
  assert.deepEqual(leaderBar({ month: 7, ytd: 0 }, { nested: false }), { solid: 7, faded: 0, whole: 7 });
  // A custom range partly outside the year: "3 · YTD 2" is two counts side by side, and
  // the bar is the period alone — a bar over both would be a length no number states.
  assert.deepEqual(leaderBar({ month: 3, ytd: 2 }, { nested: false }), { solid: 3, faded: 0, whole: 3 });
  assert.deepEqual(leaderBar({ month: 0, ytd: 9 }, { nested: false }), { solid: 0, faded: 0, whole: 0 });
  assert.deepEqual(leaderBar({}), { solid: 0, faded: 0, whole: 0 });
});

// Sep 9 – Oct 8 2026: the window Chad looked at.
const DAYS = (() => {
  const out = [];
  for (let d = 9; d <= 30; d++) out.push(`2026-09-${String(d).padStart(2, "0")}`);
  for (let d = 1; d <= 8; d++) out.push(`2026-10-0${d}`);
  return out;
})();

test("a day axis drops its empty weekends, and nothing else — every sum is kept", () => {
  const rows = DAYS.map((key, i) => ({ key, count: i % 3, rest: i % 2, __gap: null }));
  // A weekend with entries stays; so does one with a gap flag.
  rows.find((r) => r.key === "2026-09-12").count = 0;
  rows.find((r) => r.key === "2026-09-12").rest = 0;
  rows.find((r) => r.key === "2026-09-13").count = 0;
  rows.find((r) => r.key === "2026-09-13").rest = 0;
  rows.find((r) => r.key === "2026-09-13").__gap = "no scan";
  rows.find((r) => r.key === "2026-09-19").count = 4;
  const kept = businessDays(rows, { series: ["count", "rest"], gapKey: "__gap" });
  const sum = (list, k) => list.reduce((a, r) => a + r[k], 0);
  assert.equal(sum(kept, "count"), sum(rows, "count"));
  assert.equal(sum(kept, "rest"), sum(rows, "rest"));
  assert.ok(!kept.some((r) => r.key === "2026-09-12"), "an empty Saturday goes");
  assert.ok(kept.some((r) => r.key === "2026-09-13"), "a weekend day with a gap stays");
  assert.ok(kept.some((r) => r.key === "2026-09-19"), "a weekend day with entries stays");
  // Every weekday stays, empty or not.
  const empty = DAYS.map((key) => ({ key, count: 0 }));
  assert.equal(businessDays(empty).length, 22);
});

test("the peak names its day, its ties, and never a bucket still in progress", () => {
  const rows = DAYS.map((key) => ({ key, count: 1 }));
  rows.find((r) => r.key === "2026-09-29").count = 6;
  assert.equal(peakSummary(rows, { grain: "day" }), "peak 6 on Tue, Sep 29");
  rows.find((r) => r.key === "2026-10-01").count = 6;
  assert.equal(peakSummary(rows, { grain: "day" }), "peak 6 on Tue, Sep 29 and Thu, Oct 1");
  rows.find((r) => r.key === "2026-10-02").count = 6;
  assert.equal(peakSummary(rows, { grain: "day" }), "peak 6 on 3 days");
  // The month in progress is not the peak even when it is the largest.
  const months = [
    { key: "2026-07", count: 119 },
    { key: "2026-08", count: 90 },
    { key: "2026-10", count: 140, partial: true },
  ];
  assert.equal(peakSummary(months, { grain: "month", partial: (r) => r.partial }), "peak 119 in Jul");
  // Across a year the year is named.
  assert.equal(
    peakSummary([{ key: "2025-12", count: 3 }, { key: "2026-01", count: 1 }], { grain: "month" }),
    "peak 3 in Dec 2025",
  );
  assert.equal(peakSummary([{ key: "2026-07", count: 0 }], { grain: "month" }), null);
  assert.equal(peakSummary([], { grain: "month" }), null);
});

test("an ALL-CAPS feed name reads as a name; a typed one is left alone", () => {
  assert.equal(displayName("SEYMOUR WATTS"), "Seymour Watts");
  assert.equal(displayName("MARY-JO O'NEIL"), "Mary-Jo O'Neil");
  assert.equal(displayName("Steven Adjetey"), "Steven Adjetey");
  assert.equal(displayName("DJ McCrary"), "DJ McCrary");
  // Initials stay initials.
  assert.equal(displayName("AB"), "AB");
  assert.equal(displayName("DJ MCCRARY"), "DJ Mccrary");
  assert.equal(displayName("JOHN SMITH JR"), "John Smith JR");
  assert.equal(displayName("HENRY FORD III"), "Henry Ford III");
  assert.equal(displayName(""), "");
  assert.equal(displayName(null), "");
});

test("a bar list shows its top 8, keeps Not set last and never hides the picked row", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ key: `d${i}`, label: `D${i}`, value: 12 - i }));
  rows.push({ key: "unassigned", label: "Unassigned", value: 30, notSet: true });
  const r = barListRows(rows, { limit: 8 });
  assert.equal(r.shown.length, 9);
  assert.equal(r.shown[8].key, "unassigned", "Unassigned is last, whatever its count");
  assert.equal(r.hidden, 4);
  assert.equal(r.total, 12);
  // A highlighted row below the fold opens the list.
  assert.equal(barListRows(rows, { limit: 8, highlightKey: "d10" }).shown.length, 13);
  // Given order (Mon → Fri) is never re-sorted.
  const wd = [
    { key: "1", value: 2 },
    { key: "2", value: 9 },
    { key: "3", value: 4 },
  ];
  assert.deepEqual(barListRows(wd, { order: "given" }).shown.map((x) => x.key), ["1", "2", "3"]);
  assert.deepEqual(barListRows(wd).shown.map((x) => x.key), ["2", "3", "1"]);
});

test("a line is drawn only over runs long enough to be a line", () => {
  assert.deepEqual(keepRuns([1, 2, 3, null, 4, null, 5, 6, null, 7, 8, 9, 10]), [1, 2, 3, null, null, null, null, null, null, 7, 8, 9, 10]);
  assert.deepEqual(keepRuns([null, null]), [null, null]);
});

test("a rolling average is drawn over runs of three, or not at all when only fragments remain", () => {
  const _ = null;
  // Company History's 24 months as they came back: Oct–Dec 2024, Mar–Jun 2025 and a
  // two-month stub, nothing over the latest six months — fragments, so no line at all.
  const frag = [_, _, _, _, _, _, _, _, _, 40, 41, 42, _, _, 39, 38, 37, 36, _, _, 30, 31, _, _];
  const f = avgLine(frag);
  assert.equal(f.drawn, false);
  assert.ok(f.values.every((v) => v === null));
  // A long run reaching the latest months: drawn, the two-month stub left out.
  const ok = [_, 1, 2, _, 5, 6, 7, 8, 9, 10, 11, 12];
  const o = avgLine(ok);
  assert.equal(o.drawn, true);
  assert.equal(o.partial, true);
  assert.deepEqual(o.values, [_, _, _, _, 5, 6, 7, 8, 9, 10, 11, 12]);
  // Enough months, but none among the latest six: not drawn.
  assert.equal(avgLine([1, 2, 3, 4, 5, 6, 7, _, _, _, _, _, _]).drawn, false);
  // Every month holds an average: drawn whole.
  assert.deepEqual(avgLine([1, 2, 3, 4, 5, 6]), { values: [1, 2, 3, 4, 5, 6], drawn: true, partial: false });
});

test("the years chart draws lines of two or more months, dots for lone months, a table when nothing runs three", () => {
  // 2026: Feb–Mar one run, Jun alone; 2025: Oct–Nov one run, May alone.
  const rows = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1) }));
  rows[1].y2026_0 = 37;
  rows[2].y2026_0 = 36;
  rows[5].y2026_1 = 46;
  rows[4].y2025_0 = 34;
  rows[9].y2025_1 = 45;
  rows[10].y2025_1 = 27;
  const p = yearLinesPlan(rows, [{ year: 2026, runs: 2 }, { year: 2025, runs: 2 }]);
  assert.equal(p.form, "table", "no run of three months: a table, not a scatter");
  assert.equal(p.rows[5].y2026_1, null, "a lone month is not a line");
  assert.equal(p.rows[5].y2026_lone, 46, "… it is a dot, with its own value");
  assert.equal(p.rows[1].y2026_0, 37);
  assert.deepEqual(p.ends, { 2026: "y2026_0", 2025: "y2025_1" }, "end labels sit on the last line");
  assert.equal(rows[5].y2026_1, 46, "the caller's rows are untouched");
  // Three in a row in another year only: still a table — the chart is read against
  // the selected (first) year.
  rows[11].y2025_1 = 31;
  assert.equal(yearLinesPlan(rows, [{ year: 2026, runs: 2 }, { year: 2025, runs: 2 }]).form, "table");
  // Three in a row in the selected year: lines.
  rows[3].y2026_0 = 30;
  assert.equal(yearLinesPlan(rows, [{ year: 2026, runs: 2 }, { year: 2025, runs: 2 }]).form, "lines");
  // A year with no line has no end label.
  assert.equal(yearLinesPlan(rows, [{ year: 2024, runs: 0 }]).ends[2024], null);
});

test("the hero sparkline draws runs of three, bands the gaps, and isn't drawn under six months", () => {
  assert.equal(sparkPlan([1, 2, 3, null, 5], { latest: 4 }), null, "fewer than six months: nothing");
  const v = [4, 5, 6, null, 7, null, 8, 9, 10, 11, null];
  const p = sparkPlan(v, { latest: 9 });
  assert.deepEqual(p.runs, [[0, 1, 2], [6, 7, 8, 9]]);
  assert.deepEqual(p.gaps, [[3, 5]], "the months between runs, a lone month included; nothing past the latest");
  assert.equal(p.latest, 9);
  // The latest month alone after a gap still gets its dot.
  const q = sparkPlan([1, 2, 3, 4, 5, 6, null, null, 9], { latest: 8 });
  assert.deepEqual(q.runs, [[0, 1, 2, 3, 4, 5]]);
  assert.deepEqual(q.gaps, [[6, 7]]);
  assert.equal(q.latest, 8);
});

test("a column fills about half its slot: 36px at most, 72px for seven slots or fewer", () => {
  // Twelve months across a wide card: the 36px cap.
  assert.equal(barGeometry(12, 1100).bar, 36);
  // Seven weeks across the same card: no 36px sticks in 155px slots.
  const w = barGeometry(7, 1085);
  assert.equal(w.bar, 72);
  assert.ok(w.bar / w.slot >= 0.45 && w.bar / w.slot <= 0.62);
  // On a phone the slot decides, as before.
  assert.equal(barGeometry(7, 300).bar, Math.round((300 / 7) * 0.62));
  // Always 2px of air between neighbours.
  assert.ok(barGeometry(40, 100).bar <= 100 / 40 - 2 || barGeometry(40, 100).bar === 2);
});

test("a column's number is its total, an outline only where nothing was counted, and last year's mark only on a counted column", () => {
  const keys = ["damage", "late"];
  const rows = [
    { damage: 2, late: 3, hist: null, prior: 4 }, // counted: its total, tick below it
    { damage: null, late: null, hist: 21, prior: null }, // only history holds it: outlined at 21
    { damage: 0, late: 0, hist: 9, prior: 12 }, // a counted zero is never replaced by an outline
    { damage: null, late: null, hist: null, prior: 7 }, // nothing at all: shaded, no tick alone in it
    { damage: null, late: null, hist: 4, prior: 7 }, // an outline: no tick across it
  ];
  assert.deepEqual(columnCaps(rows, { keys, outline: "hist", marks: ["prior"] }), [
    { value: 5, hollow: false, mark: 4 },
    { value: 21, hollow: true, mark: null },
    { value: 0, hollow: false, mark: 12 },
    { value: null, hollow: false, mark: null },
    { value: 4, hollow: true, mark: null },
  ]);
  // Without an outline or marks it is just the stack's total.
  assert.deepEqual(
    columnCaps(rows, { keys }).map((c) => c.value),
    rows.map((r) => rowTotal(r, keys)),
  );
});

test("a chart's note names each shading reason once, with the slots it covers", () => {
  const rows = [
    { key: "2025-11", why: "history only" },
    { key: "2025-12", why: "no data on file" },
    { key: "2026-01", why: null },
    { key: "2026-02", why: "history only" },
    { key: "2026-05", why: "not captured" },
  ];
  assert.deepEqual(shadedReasons(rows, { why: (r) => r.why }), [
    { why: "history only", keys: ["2025-11", "2026-02"] },
    { why: "no data on file", keys: ["2025-12"] },
    { why: "not captured", keys: ["2026-05"] },
  ]);
  assert.deepEqual(shadedReasons([{ key: "a", why: null }], { why: (r) => r.why }), []);
});
