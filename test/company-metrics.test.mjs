// Company History's numbers (companyMetrics.js): the window, the monthly series and its
// rolling mean, the headline against its comparison, and the verdict's guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend } from "../src/data/blend.js";
import { ulineCoverage, buildCoverage } from "../src/data/coverage.js";
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
} from "../src/data/companyMetrics.js";
import { resolveDrill, drillLevels } from "../src/data/drill.js";
import { TODAY, incidents, history, monthIds, reports } from "./coverage-fixture.mjs";

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
