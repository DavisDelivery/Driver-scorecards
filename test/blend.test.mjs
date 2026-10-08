// blend.js replaces three inline copies of the live/history blend (the Scorecard, Trends
// and the Reports analytics). It must reproduce each of them exactly — the copies are
// kept verbatim in legacy-blends.mjs and run side by side here on a fixture built to hit
// every case that has broken before.
//
// The one deliberate difference: Trends and Reports qualify months on COUNTED8 now, the
// Scorecard's rule, instead of their own six. The tests below pin exactly which month
// that moves on the fixture (a compliment-only month) and nothing else. On the
// 2026-10-07 production pull it moves no month at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend, tally, tallyTotal, driverBuckets, blendCube, historyYm } from "../src/data/blend.js";
import { buildMonthlyTotals, buildYearlyTotals, availableYears } from "../src/data/analytics.js";
import { monthsOfYear } from "../src/data/scorecardDetail.js";
import { COUNTED8, CHARTED6 } from "../src/data/categories.js";
import { legacyScorecard, legacyTrendsCube, legacyMonthlyTotals } from "./legacy-blends.mjs";
import { drivers, incidents, history } from "./blend-fixture.mjs";

const rowsById = (rows) => new Map(rows.map((r) => [r.driver.id, r]));

// ── Scorecard ────────────────────────────────────────────────────────────────

const SCORECARD_CASES = [
  { selectedMonth: "2026-04", periodMonths: ["2026-04"] },
  { selectedMonth: "2026-05", periodMonths: ["2026-03", "2026-04", "2026-05"] },
  { selectedMonth: "2026-01", periodMonths: ["2026-01"] },
  // A period crossing Jan 1, with YTD in the month picker's year.
  { selectedMonth: "2026-02", periodMonths: ["2025-11", "2025-12", "2026-01", "2026-02"] },
  { selectedMonth: "2025-12", periodMonths: monthsOfYear(2026).slice(0, 6) },
];

for (const faultFilter of ["all", "driver"]) {
  for (const c of SCORECARD_CASES) {
    test(`Scorecard rows match v0.20.0 — ${c.selectedMonth}, ${c.periodMonths.length} mo, fault ${faultFilter}`, () => {
      const old = legacyScorecard({ drivers, incidents, history, ...c, faultFilter, chartCatIds: COUNTED8 });
      // Today's driver-fault rule: a month qualifies on driver-fault rows.
      const blend = buildBlend({
        incidents,
        history,
        faultFilter: faultFilter === "driver" ? "driver" : null,
        legacyQualifyWithFault: true,
      });
      const rows = driverBuckets({
        blend,
        drivers,
        buckets: {
          month: [c.selectedMonth],
          period: c.periodMonths,
          ytd: monthsOfYear(Number(c.selectedMonth.slice(0, 4))),
        },
        categoryIds: COUNTED8,
      });
      const a = rowsById(old.rows);
      const b = rowsById(rows);
      assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), "same drivers");
      for (const [id, r] of a) {
        for (const bucket of ["month", "period", "ytd"]) {
          assert.deepEqual(b.get(id)[bucket], r[bucket], `${id} ${bucket}`);
        }
      }
      // The live months the drill-downs were handed are the blend's own.
      for (const [ym, list] of Object.entries(old.liveByYm)) {
        assert.equal(blend.isLive(ym), true, ym);
        assert.deepEqual(blend.liveByYm[ym].map((i) => i.id), list.map((i) => i.id), ym);
      }
    });
  }
}

// ── Trends ───────────────────────────────────────────────────────────────────

const cubeOf = (cube) =>
  Object.fromEntries(Object.entries(cube.cells).map(([ym, cell]) => [ym, Object.fromEntries([...cell].sort())]));

test("Trends cells match v0.20.0 with months qualified on the Scorecard's eight", () => {
  const old = legacyTrendsCube({ incidents, history, drivers, catIds: CHARTED6, qualifyIds: COUNTED8 });
  const cube = blendCube(buildBlend({ incidents, history }), CHARTED6);
  assert.deepEqual(cubeOf(cube), cubeOf(old));
  assert.deepEqual(cube.sourceByYm, old.sourceByYm);
});

test("moving Trends from six to eight categories moves only the compliment-only month", () => {
  const six = legacyTrendsCube({ incidents, history, drivers, catIds: CHARTED6 });
  const cube = blendCube(buildBlend({ incidents, history }), CHARTED6);
  const changed = Object.keys({ ...six.sourceByYm, ...cube.sourceByYm }).filter(
    (ym) => six.sourceByYm[ym] !== cube.sourceByYm[ym] ||
      JSON.stringify(cubeOf(six)[ym]) !== JSON.stringify(cubeOf(cube)[ym]),
  );
  // March 2026 holds one live compliment: live on the Scorecard all along, history in
  // Trends until now (Bo Baker's 4 damage). Now it reads as the Scorecard reads it.
  assert.deepEqual(changed, ["2026-03"]);
  assert.equal(six.sourceByYm["2026-03"], "history");
  assert.equal(cube.sourceByYm["2026-03"], "live");
});

// ── Reports ──────────────────────────────────────────────────────────────────

test("Reports monthly totals match v0.20.0 with months qualified on eight", () => {
  const blend = buildBlend({ incidents, history });
  for (const year of [2024, 2025, 2026]) {
    const old = legacyMonthlyTotals(year, incidents, history, { catIds: CHARTED6, qualifyIds: COUNTED8 });
    assert.deepEqual(buildMonthlyTotals(year, blend), old, String(year));
  }
});

test("Reports keeps counting a history record with no driver, as it always has", () => {
  const feb = buildMonthlyTotals(2024, buildBlend({ incidents, history }))[1];
  assert.equal(feb.source, "history");
  assert.equal(feb.byCat.attempts, 1);
  assert.equal(feb.total, 7);
});

test("moving Reports from six to eight categories moves only the compliment-only month", () => {
  const blend = buildBlend({ incidents, history });
  for (const year of [2024, 2025, 2026]) {
    const six = legacyMonthlyTotals(year, incidents, history, { catIds: CHARTED6 });
    const now = buildMonthlyTotals(year, blend);
    const diff = now.filter((m, i) => JSON.stringify(m) !== JSON.stringify(six[i])).map((m) => `${year}-${m.month}`);
    assert.deepEqual(diff, year === 2026 ? ["2026-3"] : [], String(year));
  }
});

test("yearly totals are the sum of the months", () => {
  const blend = buildBlend({ incidents, history });
  const years = availableYears(incidents, history);
  assert.deepEqual(years, [2024, 2025, 2026]);
  const yearly = buildYearlyTotals(years, blend);
  for (const y of yearly) {
    const months = buildMonthlyTotals(y.year, blend);
    assert.equal(y.total, months.reduce((a, m) => a + m.total, 0));
  }
  assert.deepEqual(yearly.map((y) => y.source), ["history", "blended", "blended"]);
});

// ── The month rule ───────────────────────────────────────────────────────────

test("a month whose only counting row is a compliment is live — the Scorecard's rule", () => {
  // Stated on purpose (liveHistoryBlend.js warns about this shape): COUNTED8 includes the
  // compliment, so the month is live and its history (Bo Baker's 4 damage) is not shown.
  const blend = buildBlend({ incidents, history });
  assert.equal(blend.isLive("2026-03"), true);
  assert.equal(blend.cell("2026-03", "d1", "compliment"), 1);
  assert.equal(blend.cell("2026-03", "d2", "damage"), 0);
  assert.equal(blend.monthSource("2026-03"), "live");
});

test("a month whose only live row is no-fault stays on history", () => {
  const blend = buildBlend({ incidents, history });
  assert.equal(blend.isLive("2026-02"), false);
  assert.equal(blend.cell("2026-02", "d3", "missing"), 2);
  assert.equal(blend.cell("2026-02", "d3", "misdelivery"), 0);
});

test("rows that count for nothing never reach a cell", () => {
  const blend = buildBlend({ incidents, history });
  // Unattributed, unable-to-track and return rows in April.
  assert.equal(blend.cell("2026-04", "", "late"), 0);
  assert.equal(blend.cell("2026-04", "d4", "unable_to_track"), 0);
  assert.equal(blend.cell("2026-04", "d6", "return"), 0);
  // History for a live month is superseded, never added.
  assert.equal(blend.cell("2026-04", "d1", "late"), 1);
  assert.equal(blend.companyCell("2026-04", "late"), 2);
});

test("an id with no roster row is counted like anyone else", () => {
  const blend = buildBlend({ incidents, history });
  assert.equal(blend.cell("2026-04", "d5", "missing"), 1);
  const rows = driverBuckets({
    blend,
    drivers,
    buckets: { ytd: monthsOfYear(2026) },
    categoryIds: COUNTED8,
    nameOf: (id) => (id === "d5" ? "ZED ZULU" : id),
  });
  const d5 = rows.find((r) => r.driver.id === "d5");
  assert.equal(d5.driver.name, "ZED ZULU");
  assert.equal(d5.ytd.missing, 1);
});

test("tally and companyCell agree", () => {
  const blend = buildBlend({ incidents, history });
  for (const ym of blend.months) {
    const t = tally(blend, [ym], COUNTED8);
    for (const cat of COUNTED8) {
      // companyCell also carries the unattributed 2024-02 history record.
      const unattributed = ym === "2024-02" && cat === "attempts" ? 1 : 0;
      assert.equal(tallyTotal(t, { categoryIds: [cat] }) + unattributed, blend.companyCell(ym, cat), `${ym} ${cat}`);
    }
  }
});

// ── Driver-fault scope ───────────────────────────────────────────────────────

test("today's driver-fault rule: a month with no driver-fault rows falls back to history", () => {
  const blend = buildBlend({ incidents, history, faultFilter: "driver", legacyQualifyWithFault: true });
  assert.equal(blend.isLive("2026-05"), false);
  assert.equal(blend.cell("2026-05", "d2", "damage"), 3);
  assert.equal(blend.monthSource("2025-11"), "history");
  // In a live month, only driver-fault rows count.
  assert.equal(blend.cell("2026-04", "d2", "damage"), 0);
  assert.equal(blend.cell("2026-04", "d1", "late"), 1);
});

test("the newer driver-fault rule: qualification ignores the filter and history is not tracked", () => {
  const blend = buildBlend({ incidents, history, faultFilter: "driver" });
  // May qualifies on its vendor rows, then counts no driver-fault row: 0, not history's 3.
  assert.equal(blend.isLive("2026-05"), true);
  assert.equal(blend.cell("2026-05", "d2", "damage"), 0);
  assert.equal(blend.liveByYm["2026-05"].length, 0);
  // History has no fault field, so a history month counts nothing and says so.
  assert.equal(blend.monthSource("2025-11"), "not_tracked");
  assert.equal(blend.cell("2025-11", "d1", "forgotten_freight"), 0);
  assert.equal(blend.companyCell("2025-11", "damage"), 0);
  assert.equal(blend.historyServed, false);
});

// ── Conflicts ────────────────────────────────────────────────────────────────

test("a conflict is any live month whose count differs from history, either way", () => {
  const { conflicts } = buildBlend({ incidents, history });
  const key = (c) => `${c.ym} ${c.category} ${c.live}/${c.history}`;
  assert.deepEqual(conflicts.map(key).sort(), [
    "2025-12 damage 0/5",
    "2026-01 damage 0/2",
    "2026-01 forgotten_freight 3/5",
    "2026-03 damage 0/4",
    "2026-04 late 2/9",
    "2026-05 damage 1/3",
    "2026-06 attempts 2/1",
  ]);
});

test("the Jan 2026 shape: 19 back-dated forgotten freight against 28 in history", () => {
  const ff = Array.from({ length: 19 }, (_, i) => ({
    id: `ff${i}`,
    driver_id: `d${i % 4}`,
    category: "forgotten_freight",
    fault: "driver",
    delivered_date: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}`,
  }));
  const hist = [
    { year: 2026, month: 1, driver_id: "d0", category: "forgotten_freight", count: 20 },
    { year: 2026, month: 1, driver_id: "d1", category: "forgotten_freight", count: 8 },
    { year: 2026, month: 1, driver_id: "d1", category: "damage", count: 6 },
  ];
  const blend = buildBlend({ incidents: ff, history: hist });
  assert.equal(blend.isLive("2026-01"), true);
  assert.equal(blend.companyCell("2026-01", "forgotten_freight"), 19);
  assert.deepEqual(
    blend.conflicts.find((c) => c.category === "forgotten_freight"),
    { ym: "2026-01", category: "forgotten_freight", live: 19, history: 28 },
  );
  // The live month hides history's damage too, and that is flagged as well.
  assert.deepEqual(blend.conflicts.find((c) => c.category === "damage"), { ym: "2026-01", category: "damage", live: 0, history: 6 });
});

test("a driver's conflicts compare their own live count with their own history", () => {
  const blend = buildBlend({ incidents, history });
  // Ann logged two of January's three FF against her own five in history; Di Dean's
  // one FF has no history of its own, and her history is damage (2), live 0.
  assert.deepEqual(blend.driverConflicts("d1").filter((c) => c.ym === "2026-01"), [
    { ym: "2026-01", category: "forgotten_freight", live: 2, history: 5 },
  ]);
  assert.deepEqual(blend.driverConflicts("d4"), [{ ym: "2026-01", category: "damage", live: 0, history: 2 }]);
  assert.deepEqual(blend.driverConflicts("nobody"), []);
});

test("conflicts are measured without the fault filter", () => {
  const plain = buildBlend({ incidents, history }).conflicts;
  const blend = buildBlend({ incidents, history, faultFilter: "driver", legacyQualifyWithFault: true });
  // Under today's rule March (a compliment) and May (vendor rows) aren't live with the
  // filter on, so they have no conflict; every month that is live keeps the all-fault
  // comparison — what the history rollup would hold for it.
  assert.deepEqual(blend.conflicts, plain.filter((c) => blend.isLive(c.ym)));
  assert.equal(blend.conflicts.some((c) => c.ym === "2026-05" || c.ym === "2026-03"), false);
});

test("months lists every month with live or history data, ascending", () => {
  const blend = buildBlend({ incidents, history });
  assert.deepEqual(blend.months, [
    "2024-02", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ]);
  assert.equal(blend.monthSource("2023-11"), "none");
  assert.equal(historyYm({ year: "2026", month: "7" }), "2026-07");
  assert.equal(historyYm({ year: 2026 }), "");
});
