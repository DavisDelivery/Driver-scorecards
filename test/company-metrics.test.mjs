// Company History's numbers (companyMetrics.js): the window, the monthly series and its
// rolling mean, the headline against its comparison, and the verdict's guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend } from "../src/data/blend.js";
import { ulineCoverage, buildCoverage, exclusionText } from "../src/data/coverage.js";
import {
  companyWindow,
  comparisonMonths,
  lastCompleteYm,
  basketCategories,
  workdaysOf,
  monthlySeries,
  monthSignature,
  rolling3,
  sparkRuns,
  coveredTotal,
  compareWindows,
  quasiPoissonVerdict,
  dispersion,
  overviewTiles,
  driversInvolved,
  basketFaultSplit,
  weeklyAttempts,
  mondayOfYmd,
  compareByCategory,
  comparedTotalsDrill,
  sharedMonths,
  comparedCells,
  cellsDrill,
  driverTotals,
  movers,
  breadthIntensity,
  decomposeByCategory,
  yearLines,
  quarterMix,
  quarterKey,
  roundShares,
} from "../src/data/companyMetrics.js";
import { resolveDrill, drillLevels } from "../src/data/drill.js";
import { TODAY, incidents, history, monthIds, reports } from "./coverage-fixture.mjs";
import * as F from "./compare-fixture.mjs";

const blend = buildBlend({ incidents, history });
const cov = buildCoverage({ blend, historyMonthIds: monthIds, uline: ulineCoverage(reports, incidents), today: TODAY, incidents });
const CATS = basketCategories();

test("the Range presets, counted back from the Through month", () => {
  assert.equal(lastCompleteYm(TODAY), "2026-09");
  const w24 = companyWindow("24", { through: "2026-09" });
  assert.equal(w24.months.length, 24);
  assert.deepEqual([w24.months[0], w24.months[23]], ["2024-10", "2026-09"]);
  assert.equal(w24.label, "Oct 2024 – Sep 2026");
  assert.deepEqual(companyWindow("12", { through: "2026-02" }).months.slice(0, 2), ["2025-03", "2025-04"]);
  assert.deepEqual(companyWindow("ytd", { through: "2026-03" }).months, ["2026-01", "2026-02", "2026-03"]);
  const ly = companyWindow("ly", { through: "2026-09" }).months;
  assert.deepEqual([ly[0], ly[11], ly.length], ["2025-01", "2025-12", 12]);
  const all = companyWindow("all", { through: "2026-09" }).months;
  assert.deepEqual([all[0], all.length], ["2023-01", 45]);
  assert.deepEqual(companyWindow("custom", { through: "2026-09", from: "2026-03", to: "2026-01" }).months, [
    "2026-01",
    "2026-02",
    "2026-03",
  ]);
  // A custom range missing an end reads as the default 24M.
  assert.equal(companyWindow("custom", { through: "2026-09", from: "2026-03" }).months.length, 24);
});

test("comparison months are aligned with the window, month for month", () => {
  assert.deepEqual(comparisonMonths(["2026-01", "2026-02"], "yoy"), ["2025-01", "2025-02"]);
  assert.deepEqual(comparisonMonths(["2026-01", "2026-02"], "prior"), ["2025-11", "2025-12"]);
});

test("the basket is the failures; complaints only when there are any", () => {
  assert.deepEqual(basketCategories(), ["damage", "forgotten_freight", "misdelivery", "late", "missing"]);
  assert.deepEqual(basketCategories({ hasComplaints: true }).slice(-1), ["complaint"]);
});

test("workdays: a month in progress counts the days it has had", () => {
  assert.equal(workdaysOf("2026-09", TODAY), 22);
  // Oct 1–8, 2026: Thu, Fri, Mon–Thu.
  assert.equal(workdaysOf("2026-10", TODAY), 6);
});

test("the monthly series: gaps stay gaps, and every value is a blend cell", () => {
  const rows = monthlySeries(cov, companyWindow("all", { through: "2026-10" }).months, CATS, { today: TODAY });
  const at = (ym) => rows.find((r) => r.ym === ym);
  // No history document: a gap, never 0.
  assert.equal(at("2023-11").__total, null);
  assert.ok(CATS.every((c) => at("2025-07")[c] === null));
  assert.equal(at("2025-12").count, null);
  // 2023 has lost/missing only: the rest are gaps, missing is the spreadsheet's.
  assert.deepEqual(
    CATS.map((c) => at("2023-05")[c]),
    [null, null, null, null, 2],
  );
  // Jan 2026: the back-dated forgotten freight (3) and the spreadsheet's other three.
  assert.equal(at("2026-01").forgotten_freight, 3);
  assert.equal(at("2026-01").count, 2 + 3 + 4 + 1);
  for (const r of rows) {
    for (const c of CATS) if (r[c] !== null) assert.equal(r[c], blend.companyCell(r.ym, c));
  }
  // Per workday: each count over its month's Mon–Fri days.
  const wd = monthlySeries(cov, ["2025-03"], CATS, { measure: "workday", today: TODAY })[0];
  assert.equal(wd.workdays, 21);
  assert.equal(wd.damage, Math.round((2 / 21) * 100) / 100);
  assert.equal(wd.count, 10);
});

test("a month's signature changes where what was captured changes", () => {
  const sig = (ym) => monthSignature(cov, ym, CATS);
  assert.equal(sig("2025-02"), sig("2025-03"));
  // Lost/missing joins in 2025.
  assert.notEqual(sig("2024-12"), sig("2025-01"));
  // Jan 2026's forgotten freight is back-dated app entries, not the spreadsheet's.
  assert.notEqual(sig("2026-01"), sig("2026-02"));
  // The app era: Late arrives, and April is only partly covered.
  assert.notEqual(sig("2026-03"), sig("2026-04"));
  assert.notEqual(sig("2026-04"), sig("2026-05"));
  // July's stale late rollup is history's problem: the live count drawn is whole.
  assert.equal(sig("2026-07"), sig("2026-08"));
});

test("the rolling mean never bridges a gap or a change in what was captured", () => {
  assert.deepEqual(rolling3([3, 6, 9, 12]), [null, null, 6, 9]);
  assert.deepEqual(rolling3([3, null, 9, 12, 15]), [null, null, null, null, 12]);
  assert.deepEqual(rolling3([3, 6, 9, 30], ["a", "a", "a", "b"]), [null, null, 6, null]);
  const rows = monthlySeries(cov, companyWindow("all", { through: "2026-09" }).months, CATS, { today: TODAY });
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].roll3 === null) continue;
    assert.ok(i >= 2, `${rows[i].ym} has no two months before it on file`);
    for (const j of [i - 2, i - 1]) {
      assert.notEqual(rows[j].__total, null);
      assert.equal(rows[j].sig, rows[i].sig, `${rows[i].ym} spans a capture change`);
    }
  }
  // Nothing in the app era before September has three like months in this fixture.
  assert.equal(rows.find((r) => r.ym === "2026-04").roll3, null);
  // A window's series is the same months of the longer one, average included.
  const w24 = monthlySeries(cov, companyWindow("24", { through: "2026-09" }).months, CATS, { today: TODAY });
  for (const r of w24) assert.equal(r.roll3, rows.find((x) => x.ym === r.ym).roll3, r.ym);
});

test("a window's first months take their average from the months before it, when those were captured alike", () => {
  // 2025-01..03 hold the same four categories, whole: March's average is theirs even in
  // a window that starts in March.
  const [mar, apr] = monthlySeries(cov, ["2025-03", "2025-04"], CATS, { today: TODAY });
  assert.equal(mar.roll3, 10);
  assert.equal(apr.roll3, 10);
  // 2024's spreadsheet held no lost/missing: January 2025 is a change in what was
  // captured, so a window starting there gets no average for its first two months.
  const [jan, feb, m3] = monthlySeries(cov, ["2025-01", "2025-02", "2025-03"], CATS, { today: TODAY });
  assert.deepEqual([jan.roll3, feb.roll3, m3.roll3], [null, null, 10]);
  // Only the window's own months come back.
  assert.deepEqual(
    monthlySeries(cov, ["2025-03", "2025-04"], CATS, { today: TODAY }).map((r) => r.ym),
    ["2025-03", "2025-04"],
  );
});

test("a sparkline's runs break at gaps and capture changes", () => {
  assert.deepEqual(
    sparkRuns([1, 2, null, 3, 4, 5], ["a", "a", "a", "a", "b", "b"]).map((r) => r.map((p) => p.i)),
    [[0, 1], [3], [4, 5]],
  );
});

test("the headline is every covered cell, and like-for-like is the part of it compared", () => {
  const P = companyWindow("ly", { through: "2026-09" }).months; // 2025
  const C = comparisonMonths(P, "yoy"); // 2024
  const r = compareWindows(cov, P, C, CATS, { today: TODAY });
  // 2025: ten months with a document, 2 + 3 + 4 + 1 each.
  assert.equal(r.A, 100);
  assert.equal(coveredTotal(cov, P, CATS), r.A);
  // Compared: damage, FF and misdelivery in the ten months 2024 also has; lost/missing
  // wasn't in 2024's spreadsheet.
  const by = Object.fromEntries(r.byCat.map((b) => [b.cat, b]));
  assert.deepEqual(Object.keys(by).sort(), ["damage", "forgotten_freight", "misdelivery"]);
  assert.equal(by.damage.X, 20);
  assert.equal(by.damage.Cmp, 20);
  // 2024-09's misdelivery zero is a whole spreadsheet month: compared, as 0.
  assert.ok(by.misdelivery.cmpMonths.includes("2024-09"));
  // Jan–Jun, Aug–Nov 2024: the months 2025 has a document for.
  assert.equal(by.misdelivery.Cmp, 5 + 6 + 7 + 5 + 6 + 8 + 6 + 0 + 4 + 4);
  assert.equal(r.X, 20 + 30 + 40);
  assert.equal(r.delta, r.X - r.Cmp);
  assert.ok(r.exclusions.some((e) => e.cat === "missing" && e.reason === "not_tracked" && e.side === "comparison"));
  assert.equal(r.sourceChange, false);
  // Not like-for-like: every covered cell on each side, no verdict.
  const all = compareWindows(cov, P, C, CATS, { lfl: false, today: TODAY });
  assert.equal(all.X, all.A);
  assert.equal(all.verdict.verdict, "withheld");
  assert.equal(all.verdict.why, "not like-for-like");
  // Allowing a source change pairs app months with spreadsheet ones: no verdict.
  const P2 = ["2026-06", "2026-07", "2026-08"];
  const src = compareWindows(cov, P2, comparisonMonths(P2, "yoy"), ["damage", "forgotten_freight"], {
    allowSourceChange: true,
    today: TODAY,
  });
  assert.ok(src.sourceChange);
  assert.equal(src.verdict.why, "different source");
  const strict = compareWindows(cov, P2, comparisonMonths(P2, "yoy"), ["damage", "forgotten_freight"], { today: TODAY });
  assert.equal(strict.X, 0);
});

test("the verdict's guards", () => {
  const steady = Array.from({ length: 12 }, () => ({ n: 20, e: 21 }));
  // φ is floored at 1: a perfectly steady series doesn't shrink the error.
  assert.equal(quasiPoissonVerdict({ A: 240, eA: 252, C: 240, eC: 252, monthlyRates: steady }).phi, 1);
  // Too few to judge.
  assert.equal(quasiPoissonVerdict({ A: 10, eA: 100, C: 19, eC: 100 }).verdict, "withheld");
  assert.equal(quasiPoissonVerdict({ A: 10, eA: 100, C: 19, eC: 100 }).why, "too few to judge");
  // A doubling over a year is a swing; a few percent is not.
  assert.equal(quasiPoissonVerdict({ A: 480, eA: 252, C: 240, eC: 252, monthlyRates: steady }).verdict, "swing");
  assert.equal(quasiPoissonVerdict({ A: 250, eA: 252, C: 240, eC: 252, monthlyRates: steady }).verdict, "normal");
  // Overdispersion widens the band: the same change, judged against a jumpy series.
  const jumpy = [5, 40, 8, 35, 6, 38, 4, 41, 7, 36, 5, 40].map((n) => ({ n, e: 21 }));
  const v = quasiPoissonVerdict({ A: 300, eA: 252, C: 240, eC: 252, monthlyRates: jumpy });
  assert.ok(v.phi > 1);
  assert.equal(v.verdict, "normal");
  assert.equal(quasiPoissonVerdict({ A: 300, eA: 252, C: 240, eC: 252, monthlyRates: steady }).verdict, "swing");
  // Across a source change: withheld whatever the numbers.
  assert.equal(quasiPoissonVerdict({ A: 480, eA: 252, C: 240, eC: 252, sourceChange: true }).verdict, "withheld");
});

test("the swing is each category's own: a month that compared fewer categories doesn't read as one", () => {
  // Two steady categories over three months, the second not compared in the first (Jan
  // 2026's shape). Month totals would read 40, 60, 60; each category against its own
  // mean doesn't move.
  const a = Array.from({ length: 3 }, () => ({ n: 40, e: 21 }));
  const b = Array.from({ length: 2 }, () => ({ n: 20, e: 21 }));
  assert.equal(dispersion([a, b]), 1);
  const totals = a.map((m, i) => ({ n: m.n + (i ? 20 : 0), e: 21 }));
  assert.ok(dispersion([totals]) > 2, "summed per month, the missing category reads as swing");
  // A jumpy category still widens the band.
  assert.ok(dispersion([a, [5, 40, 8, 35, 6, 38].map((n) => ({ n, e: 21 }))]) > 1);
  assert.equal(dispersion([]), 1);
  // On the fixture: Jan 2026 compares three categories (its forgotten freight is a
  // conflict), Feb and Mar four — every category steady, so no swing at all.
  const P = ["2026-01", "2026-02", "2026-03"];
  const r = compareWindows(cov, P, comparisonMonths(P, "yoy"), CATS, { today: TODAY });
  assert.deepEqual(
    r.byCat.map((b) => [b.cat, b.months.length]),
    [
      ["damage", 3],
      ["forgotten_freight", 2],
      ["misdelivery", 3],
      ["missing", 3],
    ],
  );
  assert.equal(r.verdict.phi, 1);
});

test("drivers involved count everyone with a failure: inactive and off-roster ids too", () => {
  const ids = driversInvolved(blend, ["2026-07", "2026-08"], CATS).sort();
  // d3 is inactive (an August misdelivery); d9 has no roster row (July's missing).
  assert.deepEqual(ids, ["d1", "d2", "d3", "d9"]);
});

test("the fault split is over counted live failures; history months are named", () => {
  const s = basketFaultSplit(blend, ["2026-03", "2026-07"], CATS);
  // July: two late rows and the missing row counted (no-fault and unattributed never).
  assert.equal(s.total, 3);
  assert.equal(s.groups.driver.n, 3);
  assert.deepEqual(s.historyMonths, ["2026-03"]);
});

test("attempted orders a week at a time, clamped to the loaded days", () => {
  assert.equal(mondayOfYmd("2026-09-27"), "2026-09-21");
  assert.equal(mondayOfYmd("2026-09-21"), "2026-09-21");
  const records = [
    { date: "2026-09-02", key: "d1" },
    { date: "2026-09-03", key: "unassigned" },
    { date: "2026-09-08", key: "d2" },
    { date: "2026-08-30", key: "d1" }, // before the loaded span
  ];
  const days = new Map([
    ["2026-09-02", { status: "ok" }],
    ["2026-09-04", { status: "no_manifest" }],
    ["2026-09-08", { status: "fetch_not_ok" }],
  ]);
  const weeks = weeklyAttempts(records, days, { start: "2026-09-02", end: "2026-09-09" });
  assert.deepEqual(
    weeks.map((w) => [w.key, w.start, w.end, w.n, w.noData, w.unassigned]),
    [
      ["2026-08-31", "2026-09-02", "2026-09-06", 2, 1, 1],
      ["2026-09-07", "2026-09-07", "2026-09-09", 1, 1, 0],
    ],
  );
  assert.equal(weeks[0].gap, "1d no data");
  assert.ok(weeks[0].__notes.includes("Sep 2 – Sep 6 loaded"));
  assert.deepEqual(weeklyAttempts(records, days, { start: null, end: null }), []);
});

test("the Overview's tiles: a number, or why there is none — never a 0 for nothing captured", () => {
  const ctx = { blend: () => blend, history, incidents, roleOf: () => "driver" };
  const opens = (state) => {
    const level = drillLevels(state).at(-1);
    return { got: resolveDrill(level.spec, ctx).total, want: level.expected };
  };
  // A window wholly before the entry tabs and the app: 2025.
  const ly = companyWindow("ly", { through: "2026-09" });
  const before = overviewTiles({ cov, blend, incidents, months: ly.months, cats: CATS, today: TODAY, label: ly.label });
  assert.equal(before.counted.value, 100);
  // Ten months with a document, 2025-07 and 2025-12 have none: their workdays aren't in it.
  assert.equal(before.perWorkday.workdays, 261 - 23 - 23);
  assert.equal(before.perWorkday.value, 100 / before.perWorkday.workdays);
  assert.equal(before.drivers.value, 3);
  for (const t of ["compliments", "attempts"]) {
    assert.equal(before[t].value, null, `${t}: not captured, never 0`);
    assert.equal(before[t].reason, "not captured before Jun 2026");
    assert.equal(before[t].drill, null);
  }
  assert.equal(before.unattributed.value, null);
  assert.equal(before.unattributed.reason, "not tracked in imported history");
  assert.equal(before.fault.value, null);
  // A window across both: the entry tabs count from June, and say so.
  const w = companyWindow("24", { through: "2026-09" });
  const t = overviewTiles({ cov, blend, incidents, months: w.months, cats: CATS, today: TODAY, label: w.label });
  assert.equal(t.counted.value, coveredTotal(cov, w.months, CATS));
  assert.equal(t.compliments.value, 1);
  assert.equal(t.compliments.from, "2026-06");
  assert.equal(t.attempts.value, 1);
  assert.deepEqual([t.unattributed.value, t.unattributed.noFault, t.unattributed.liveOnly], [2, 1, true]);
  // July: the two late rows and the missing row, all driver fault.
  assert.equal(t.fault.value, 1);
  // Every tile's drawer opens on the number it shows.
  for (const name of ["counted", "unattributed", "compliments", "attempts"]) {
    const o = opens(t[name].drill);
    assert.equal(o.got, t[name].value, name);
    assert.equal(o.got, o.want, name);
  }
  // A captured window with none is a real zero, and opens nothing.
  const sep = overviewTiles({ cov, blend, incidents, months: ["2026-09"], cats: CATS, today: TODAY, label: "Sep 2026" });
  assert.deepEqual([sep.compliments.value, sep.compliments.from, sep.compliments.drill], [0, null, null]);
});

// ── Compare (v0.24.0) ────────────────────────────────────────────────────────
// On a store shaped like production's 2024–2026 (compare-fixture.mjs).

const fBlend = buildBlend({ incidents: F.incidents, history: F.history });
const fCov = buildCoverage({
  blend: fBlend,
  historyMonthIds: F.monthIds,
  uline: ulineCoverage(F.reports, F.incidents),
  today: F.TODAY,
  incidents: F.incidents,
});
const fCtx = { blend: () => fBlend, history: F.history, incidents: F.incidents, roleOf: () => "driver" };
const total = (state) => {
  const level = drillLevels(state).at(-1);
  return { got: resolveDrill(level.spec, fCtx).total, want: level.expected };
};

test("2024 → 2025 over the months both hold: damage 93 → 80, forgotten freight 190 → 180, misdelivery 63 → 63, 346 → 323", () => {
  const P = companyWindow("ly", { through: "2026-09" }).months;
  const r = compareWindows(fCov, P, comparisonMonths(P, "yoy"), CATS, { today: F.TODAY });
  assert.deepEqual([r.X, r.Cmp], [323, 346]);
  assert.equal(Math.round(r.pct * 1000) / 10, -6.6);
  // The naive charted totals, every month on file: 379 against 424.
  assert.deepEqual([r.A, coveredTotal(fCov, comparisonMonths(P, "yoy"), CATS)], [379, 424]);
  const rows = compareByCategory(fCov, r, CATS, { today: F.TODAY });
  const at = Object.fromEntries(rows.map((row) => [row.cat, row]));
  assert.deepEqual(rows.map((row) => row.cat), CATS, "the basket's fixed order");
  assert.deepEqual([at.damage.Cmp, at.damage.X], [93, 80]);
  assert.deepEqual([at.forgotten_freight.Cmp, at.forgotten_freight.X], [190, 180]);
  assert.deepEqual([at.misdelivery.Cmp, at.misdelivery.X], [63, 63]);
  // Matched months: all but July and December (2025 has no document for them).
  assert.deepEqual(
    at.damage.months.map((ym) => ym.slice(5)),
    ["01", "02", "03", "04", "05", "06", "08", "09", "10", "11"],
  );
  assert.deepEqual(at.damage.cmpMonths, at.damage.months.map((ym) => ym.replace("2025", "2024")));
  assert.deepEqual(at.damage.exclusions.map(exclusionText), ["Damage · Jul 2025, Dec 2025 · no data on file this period"]);
  // A row that can't be compared says why — never a zero.
  assert.equal(at.late.compared, false);
  assert.equal(at.late.X, undefined);
  assert.deepEqual(at.late.exclusions.map(exclusionText), ["Late · Jan 2025 – Dec 2025 · not tracked"]);
  assert.deepEqual(at.missing.exclusions.map(exclusionText), [
    "Lost/Missing · Jan 2025 – Dec 2025 · not tracked in Jan 2024 – Dec 2024",
  ]);
  // Each row's verdict is its own, and never more than the swing words.
  for (const row of rows.filter((x) => x.compared)) assert.ok(["swing", "normal", "withheld"].includes(row.verdict.verdict));
  assert.equal(at.damage.verdict.verdict, "normal");
  // Each dot opens the drawer on the months it counted.
  for (const row of rows.filter((x) => x.compared)) {
    for (const [drill, ms, n] of [[row.drill, row.months, row.X], [row.cmpDrill, row.cmpMonths, row.Cmp]]) {
      assert.deepEqual(drill.scopes[0].months, ms);
      const o = total(drill);
      assert.equal(o.got, n, row.cat);
      assert.equal(o.got, o.want);
    }
  }
  assert.equal(at.late.drill, undefined, "a row not compared has no dot to open");
  // Per workday: each count over the Mon–Fri days of its own compared months.
  const wd = compareByCategory(fCov, r, CATS, { today: F.TODAY, measure: "workday" });
  assert.equal(wd[0].value, Math.round((80 / wd[0].eA) * 100) / 100);
  assert.equal(wd[0].cmpValue, Math.round((93 / wd[0].eC) * 100) / 100);
});

test("like-for-like off: a category on file on one side only is in the total, and its row says so", () => {
  // 2025 against 2024 over every covered cell: Lost/Missing is on file in 2025 only,
  // Late in neither.
  const P = companyWindow("ly", { through: "2026-09" }).months;
  const C = comparisonMonths(P, "yoy");
  const r = compareWindows(fCov, P, C, CATS, { today: F.TODAY, lfl: false });
  const rows = compareByCategory(fCov, r, CATS, { today: F.TODAY });
  const at = Object.fromEntries(rows.map((row) => [row.cat, row]));
  assert.deepEqual([at.missing.compared, at.missing.oneSided, at.missing.n], [false, "current", 56]);
  assert.equal(at.missing.why, "not tracked in Jan 2024 – Dec 2024");
  assert.deepEqual(total(at.missing.drill), { got: 56, want: 56 });
  assert.deepEqual([at.late.compared, at.late.oneSided, at.late.why], [false, null, "not tracked in either period"]);
  // Every row that isn't compared says why, and never "nothing on file on either side"
  // when one side holds numbers.
  for (const row of rows.filter((x) => !x.compared)) assert.ok(row.why || row.exclusions.length, row.cat);
  // The rows add up to the totals: compared rows on both sides, one-sided rows on theirs.
  const n = (row, side) => (row.compared ? (side === "current" ? row.X : row.Cmp) : row.oneSided === side ? row.n : 0);
  const sum = (side) => rows.reduce((a, row) => a + n(row, side), 0);
  assert.deepEqual([sum("current"), sum("comparison")], [r.X, r.Cmp]);
  assert.deepEqual([r.X, r.Cmp], [379, 424]);
  // Every covered cell, so Jul and Dec 2024 count on the comparison side.
  assert.deepEqual([at.damage.X, at.damage.Cmp], [80, 113]);
  // And the comparison side alone: Late in 2026 against 2025 over every covered cell.
  const P2 = companyWindow("custom", { from: "2026-06", to: "2026-09" }).months;
  const r2 = compareWindows(fCov, P2, comparisonMonths(P2, "yoy"), CATS, { today: F.TODAY, lfl: false });
  const late = compareByCategory(fCov, r2, CATS, { today: F.TODAY }).find((row) => row.cat === "late");
  assert.deepEqual([late.oneSided, late.n, late.why], ["current", 26, "not tracked in Jun 2025 – Sep 2025"]);
  // The two totals open exactly the cells they added up.
  const t = comparedTotalsDrill(r, CATS, "every covered cell");
  assert.deepEqual([total(t.cur).got, total(t.cmp).got], [r.X, r.Cmp]);
  // 24 months against the same months a year earlier share twelve of them.
  const w = companyWindow("24", { through: "2026-09" }).months;
  assert.deepEqual(sharedMonths(w, comparisonMonths(w, "yoy")), companyWindow("12", { through: "2025-09" }).months);
  assert.deepEqual(sharedMonths(P, C), []);
});

test("a source change is compared only when allowed, and then withholds every verdict", () => {
  const P = ["2026-06", "2026-07", "2026-08"];
  const C = comparisonMonths(P, "yoy");
  const strict = compareByCategory(fCov, compareWindows(fCov, P, C, CATS, { today: F.TODAY }), CATS, { today: F.TODAY });
  assert.ok(strict.every((row) => !row.compared));
  const loose = compareByCategory(fCov, compareWindows(fCov, P, C, CATS, { allowSourceChange: true, today: F.TODAY }), CATS, {
    today: F.TODAY,
  });
  const damage = loose.find((row) => row.cat === "damage");
  assert.ok(damage.compared && damage.sourceChange);
  assert.equal(damage.verdict.why, "different source");
});

test("the cells each side counted, and a drawer on exactly them", () => {
  const P = companyWindow("ytd", { through: "2026-09" }).months;
  const r = compareWindows(fCov, P, comparisonMonths(P, "yoy"), CATS, { today: F.TODAY });
  const cells = comparedCells(r.pairs);
  // Jan 2026's forgotten freight is a conflict: that category runs Feb–Mar.
  assert.deepEqual(cells.cur.forgotten_freight, ["2026-02", "2026-03"]);
  assert.deepEqual(cells.cmp.forgotten_freight, ["2025-02", "2025-03"]);
  assert.deepEqual(cells.cur.damage, ["2026-01", "2026-02", "2026-03"]);
  const cur = cellsDrill(cells.cur, r.X, "ytd", { vocab: CATS });
  assert.ok(cur.spec.cells, "categories over different months need their cells");
  assert.equal(cur.spec.unattributed, true);
  assert.deepEqual(total(cur), { got: r.X, want: r.X });
  assert.deepEqual(total(cellsDrill(cells.cmp, r.Cmp, "cmp")), { got: r.Cmp, want: r.Cmp });
  // The same months for every category: a plain block, no cells.
  const block = cellsDrill({ damage: ["2026-02"], misdelivery: ["2026-02"] }, 13, "Feb");
  assert.equal(block.spec.cells, undefined);
  assert.deepEqual(block.scopes[0].months, ["2026-02"]);
  assert.deepEqual(total(block), { got: 13, want: 13 });
  // One driver's share of the cells: their count, nobody's unattributed records.
  const d = driverTotals(fBlend, cells.cur);
  const one = cellsDrill(cells.cur, d.get("d2"), "ytd", { driverId: "d2" });
  assert.equal(one.spec.unattributed, undefined);
  assert.deepEqual(total(one), { got: d.get("d2"), want: d.get("d2") });
  let sum = 0;
  for (const n of d.values()) sum += n;
  assert.equal(sum, r.X, "every compared failure belongs to a driver here");
});

test("movers, breadth and the category split", () => {
  const m = movers(
    new Map([["a", 5], ["b", 2], ["c", 4], ["e", 3]]),
    new Map([["a", 1], ["b", 6], ["c", 0], ["d", 2], ["e", 3]]),
  );
  assert.deepEqual(m.up.map((r) => [r.id, r.delta]), [["a", 4], ["c", 4]]);
  assert.deepEqual(m.down.map((r) => [r.id, r.delta]), [["b", -4], ["d", -2]]);
  assert.equal(m.rows.length, 5, "unchanged drivers are rows, not movers");
  // Breadth: more drivers, each about as many — mostly breadth.
  assert.ok(Math.abs(breadthIntensity({ D_A: 40, D_C: 30, T_A: 120, T_C: 88 }).breadthShare - Math.log(40 / 30) / Math.log(120 / 88)) < 1e-12);
  // Guarded: equal totals, a zero, a small change, or counts moving opposite ways.
  assert.equal(breadthIntensity({ D_A: 40, D_C: 30, T_A: 100, T_C: 100 }).breadthShare, null);
  assert.equal(breadthIntensity({ D_A: 0, D_C: 30, T_A: 100, T_C: 80 }).breadthShare, null);
  assert.equal(breadthIntensity({ D_A: 31, D_C: 30, T_A: 105, T_C: 100 }).breadthShare, null);
  assert.equal(breadthIntensity({ D_A: 25, D_C: 30, T_A: 130, T_C: 100 }).breadthShare, null);
  assert.equal(breadthIntensity({ D_A: 30, D_C: 30, T_A: 130, T_C: 100 }).breadthShare, null);
  assert.equal(breadthIntensity({ D_A: 25, D_C: 30, T_A: 130, T_C: 100 }).I_A, 130 / 25);
  assert.deepEqual(
    decomposeByCategory([{ cat: "damage", X: 80, Cmp: 93 }, { cat: "missing", X: 21, Cmp: 17 }], -9).map((d) => [d.cat, d.delta]),
    [["damage", -13], ["missing", 4]],
  );
  assert.equal(decomposeByCategory([{ cat: "damage", X: 5, Cmp: 5 }], 0)[0].share, null);
});

test("month by month: this year and last by default, the basket over what both years tracked", () => {
  const yl = yearLines(fCov, { through: "2026-09", cats: CATS, today: F.TODAY });
  assert.deepEqual(yl.years, [2026, 2025]);
  // Late wasn't tracked in 2025, so it is left out of the basket, and said.
  assert.deepEqual(yl.cats, ["damage", "forgotten_freight", "misdelivery", "missing"]);
  assert.deepEqual(yl.left, [{ cat: "late", years: [2025] }]);
  const at = (m) => yl.rows[m - 1];
  // Each point is the blend's cells added up; a month missing any of them is a gap.
  assert.equal(at(1).y2025, 8 + 25 + 7 + 5);
  assert.equal(at(7).y2025, null, "Jul 2025 has no document: a gap, never 0");
  assert.equal(at(12).y2025, null);
  assert.equal(at(4).y2026, null, "Apr 2026: the entry tabs hadn't started — forgotten freight not tracked");
  // The selected year stops at the Through month.
  assert.equal(at(10).y2026, undefined);
  assert.equal(at(1).y2026, 9 + 3 + 2 + 6);
  // Like-for-like: Jan 2026's forgotten freight is a conflict, so January is drawn
  // hollow, off the line, and so is every 2025 month captured differently from 2026's
  // (Jan's back-dated app entries, the app from June) — a spreadsheet June is never
  // drawn against an app June. Feb–Mar compare spreadsheet with spreadsheet.
  assert.deepEqual([at(1).y2026_x, at(1).off[2026], at(1).state[2026]], [20, true, "live and history disagree"]);
  assert.deepEqual([at(2).y2026_0, at(3).y2026_0, at(2).y2025_0, at(3).y2025_0], [37, 36, 37, 40]);
  assert.deepEqual([at(6).y2025_x, at(6).off[2025], at(6).state[2025]], [35, true, "spreadsheet vs 2026's app"]);
  assert.equal(at(6).y2025_0, undefined);
  // The newest year is the reference: its whole app months stay on its line.
  assert.deepEqual([at(6).y2026_1, at(9).y2026_1], [8, 8]);
  assert.equal(yl.runs[2026], 2);
  // 2025's line holds where 2026 has nothing to compare it with (Apr–May, Oct–Nov).
  assert.deepEqual([at(4).y2025_0, at(5).y2025_0, at(10).y2025_1, at(11).y2025_1], [37, 34, 46, 27]);
  // Every point left off a line is named, by year and why.
  assert.deepEqual(
    yl.notCompared.map((g) => [g.year, g.months, g.why]),
    [
      [2026, ["2026-01"], "live and history disagree"],
      [2025, ["2025-01"], "spreadsheet vs 2026's spreadsheet and app"],
      [2025, ["2025-06", "2025-08", "2025-09"], "spreadsheet vs 2026's app"],
    ],
  );
  // Allowing a source change puts those back on the line, marked; a conflict stays off.
  const src = yearLines(fCov, { through: "2026-09", cats: CATS, today: F.TODAY, allowSourceChange: true });
  assert.deepEqual([src.rows[5].y2025_0, src.rows[5].off[2025]], [35, false]);
  assert.equal(src.rows[5].state[2025], "different source (spreadsheet vs 2026's app)");
  assert.equal(src.rows[0].off[2026], true);
  assert.deepEqual(
    src.otherSource.map((g) => [g.year, g.months]),
    [[2025, ["2025-01"]], [2025, ["2025-06", "2025-08", "2025-09"]]],
  );
  assert.deepEqual(yl.otherSource, [], "like-for-like, those are off the line instead");
  // Like-for-like off: every point is on its line; one not captured whole is marked.
  const all = yearLines(fCov, { through: "2026-09", cats: CATS, today: F.TODAY, lfl: false });
  assert.ok(all.rows.every((row) => all.years.every((y) => !row.off[y])));
  assert.deepEqual([all.rows[0].y2026_0, all.rows[0].marked[2026]], [20, true]);
  assert.deepEqual(all.notCompared, []);
  // A line breaks where what was captured changes: Jan 2026's forgotten freight is the
  // app's back-dated entries, Feb–Mar the spreadsheet's, Jun on the app's.
  assert.equal(all.runs[2026], 3);
  assert.deepEqual([all.rows[1].y2026_1, all.rows[5].y2026_2], [37, 8]);
  // One category: a year that never tracked it is left out, and said.
  const late = yearLines(fCov, { through: "2026-09", cats: ["late"], today: F.TODAY });
  assert.deepEqual([late.years, late.dropped], [[2026], [2025]]);
  // Three years when asked.
  assert.deepEqual(yearLines(fCov, { through: "2026-09", years: 3, cats: ["damage"], today: F.TODAY }).years, [2026, 2025, 2024]);
  // Several categories, none tracked in all three years (nothing is on file for 2023):
  // the oldest year is dropped, and said, rather than the chart emptied.
  const three = yearLines(fCov, { through: "2025-12", years: 3, cats: CATS, today: F.TODAY });
  assert.deepEqual([three.years, three.dropped, three.cats], [[2025, 2024], [2023], ["damage", "forgotten_freight", "misdelivery"]]);
  // Nothing before the first month on file.
  assert.deepEqual(yearLines(fCov, { through: "2023-06", years: 3, cats: ["damage"], today: F.TODAY, first: "2023-01" }).years, []);
  // Per workday: each month's count over its Mon–Fri days.
  const wd = yearLines(fCov, { through: "2026-09", cats: ["damage"], measure: "workday", today: F.TODAY });
  assert.equal(wd.rows[0].y2025, Math.round((8 / workdaysOf("2025-01", F.TODAY)) * 100) / 100);
  assert.equal(wd.rows[0].count[2025], 8);
  // Every point, on its line or off it, opens what it drew.
  for (const v of [yl, src, all, wd]) {
    for (const row of v.rows) {
      for (const y of v.years) {
        if (row.count[y] === null || row.count[y] === undefined) continue;
        const o = total(row.drill[y]);
        assert.equal(o.got, row.count[y], `${row.label} ${y}`);
        assert.equal(o.got, o.want);
      }
    }
  }
});

test("the mix by quarter: whole quarters only, over the categories captured whole in all of them", () => {
  const w = companyWindow("24", { through: "2026-09" });
  const qm = quarterMix(fCov, w.months, CATS);
  assert.deepEqual(qm.cats, ["damage", "forgotten_freight", "misdelivery"]);
  assert.deepEqual(qm.left, [
    { cat: "late", why: "not tracked in Q4 2024" },
    { cat: "missing", why: "not tracked in Q4 2024" },
  ]);
  const by = Object.fromEntries(qm.quarters.map((q) => [q.label, q]));
  assert.deepEqual(qm.quarters.map((q) => q.label), ["Q4 2024", "Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026"]);
  assert.deepEqual(by["Q1 2025"].counts, { damage: 24, forgotten_freight: 53, misdelivery: 28 });
  assert.deepEqual(by["Q1 2025"].shares, { damage: 22.8, forgotten_freight: 50.5, misdelivery: 26.7 });
  // Incomplete quarters are named, not drawn.
  assert.equal(by["Q3 2025"].drawn, false);
  assert.equal(by["Q3 2025"].why, "Damage: no data on file (Jul 2025)");
  assert.equal(by["Q1 2026"].why, "Forgotten Freight: live and history disagree (Jan 2026)");
  assert.equal(by["Q2 2026"].why, "Forgotten Freight: not tracked (Apr 2026)");
  assert.ok(by["Q3 2026"].drawn && !by["Q3 2026"].mixed);
  for (const q of qm.quarters.filter((x) => x.drawn)) {
    assert.equal(Math.round(Object.values(q.shares).reduce((a, v) => a + v, 0) * 10) / 10, 100, q.label);
    // A segment opens on its quarter's months and category, with the count behind it;
    // the column on every category drawn.
    for (const c of qm.cats) {
      const o = total(q.drills[c]);
      assert.equal(o.got, q.counts[c], `${q.label} ${c}`);
      assert.equal(o.got, o.want);
    }
    assert.deepEqual(total(q.drill), { got: q.total, want: q.total });
  }
  // A quarter only partly in the range isn't drawn.
  const part = quarterMix(fCov, companyWindow("12", { through: "2026-08" }).months, CATS);
  assert.equal(part.quarters[0].why, "only part of the quarter is in the range");
  // One category is no mix.
  assert.deepEqual(quarterMix(fCov, w.months, ["damage"]).cats, []);
  assert.equal(quarterKey("2026-04"), "2026-Q2");
});

test("a quarter whose months mix the spreadsheet and the app says so", () => {
  // The app era starts with a calendar quarter, so on the data on file no whole quarter
  // straddles it; a category whose app capture started mid-quarter would.
  const cov = {
    cell: (ym, c) => ({ state: "history", value: c === "damage" ? 2 : 1, instrument: ym < "2026-03" ? "backfill" : "app" }),
  };
  const qm = quarterMix(cov, ["2026-01", "2026-02", "2026-03"], ["damage", "missing"]);
  assert.deepEqual([qm.quarters[0].drawn, qm.quarters[0].mixed], [true, true]);
  assert.deepEqual(qm.quarters[0].shares, { damage: 66.7, missing: 33.3 });
});

test("shares to one decimal always add up to 100", () => {
  assert.deepEqual(roundShares({ a: 1, b: 1, c: 1 }, 3), { a: 33.4, b: 33.3, c: 33.3 });
  assert.deepEqual(roundShares({ a: 0, b: 0 }, 0), { a: 0, b: 0 });
  for (const counts of [{ a: 7, b: 13, c: 29 }, { a: 1, b: 2, c: 3, d: 4, e: 5 }, { a: 66, b: 1 }]) {
    const n = Object.values(counts).reduce((x, y) => x + y, 0);
    const s = roundShares(counts, n);
    assert.equal(Math.round(Object.values(s).reduce((x, y) => x + y, 0) * 10), 1000);
  }
});
