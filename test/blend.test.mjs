// blend.js replaced three inline copies of the live/history blend (the Scorecard, Trends
// and the Reports analytics) in v0.20.1, and reproduced each of them exactly. Those
// copies are kept verbatim in legacy-blends.mjs as the baseline every change is
// measured against, run side by side here on a fixture built to hit every case that
// has broken before.
//
// v0.21.1 moves the rule from the month to the cell — one category in one month (Chad,
// 2026-10-07: "let's pull that historical data in even though it's not live"). A cell
// with a live entry that counts is live; every other cell is history's, even in a month
// some other category is live in. The tests below pin exactly which cells that moves on
// the fixture and check that nothing else moves. On the 2026-10-07 production pull it
// moves three: Jan 2026 damage 0 → 9, lost/missing 0 → 6, misdelivery 0 → 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBlend,
  tally,
  tallyTotal,
  driverBuckets,
  blendCube,
  historyYm,
  historyTotal,
  monthParts,
  sourceLabel,
} from "../src/data/blend.js";
import { buildMonthlyTotals, buildYearlyTotals, availableYears } from "../src/data/analytics.js";
import { monthsOfYear } from "../src/data/scorecardDetail.js";
import { COUNTED8, CHARTED6 } from "../src/data/categories.js";
import { incidentYm } from "../src/data/incidentDate.js";
import { legacyScorecard, legacyTrendsCube, legacyMonthlyTotals } from "./legacy-blends.mjs";
import { drivers, incidents, history } from "./blend-fixture.mjs";

const rowsById = (rows) => new Map(rows.map((r) => [r.driver.id, r]));

// Every cell the per-cell rule moves on the fixture, against v0.20.0. Each is a category
// with no counted live row in a month some other category made live, so the old rule
// hid its history:
//   2025-12 damage  Bo Baker 5 — December's one live late hid it
//   2026-01 damage  Di Dean 2  — the back-dated forgotten freight hid it (the Jan 2026 shape)
//   2026-03 damage  Bo Baker 4 — one live compliment hid it
// Under Driver-fault scope the compliment never made March live (it isn't a driver-fault
// row), so March doesn't move there. May does: its vendor-fault damage now makes the
// damage cell live, and a live cell counts driver-fault rows only — 0, where the old
// rule let the month fall back to all-fault history (Bo's 3). Which cells are live no
// longer depends on the filter. No production month has that shape.
const MOVED = {
  all: [
    { ym: "2025-12", driverId: "d2", category: "damage", by: 5 },
    { ym: "2026-01", driverId: "d4", category: "damage", by: 2 },
    { ym: "2026-03", driverId: "d2", category: "damage", by: 4 },
  ],
  driver: [
    { ym: "2025-12", driverId: "d2", category: "damage", by: 5 },
    { ym: "2026-01", driverId: "d4", category: "damage", by: 2 },
    { ym: "2026-05", driverId: "d2", category: "damage", by: -3 },
  ],
};

// What a bucket of months moves by, for one driver and category.
const movedBy = (moved, months, driverId, category) =>
  moved
    .filter((m) => months.includes(m.ym) && m.driverId === driverId && m.category === category)
    .reduce((a, m) => a + m.by, 0);

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
    test(`Scorecard rows are v0.20.0's but for the cells that moved — ${c.selectedMonth}, ${c.periodMonths.length} mo, fault ${faultFilter}`, () => {
      const old = legacyScorecard({ drivers, incidents, history, ...c, faultFilter, chartCatIds: COUNTED8 });
      // Today's driver-fault rule: history serves what live entries don't.
      const blend = buildBlend({
        incidents,
        history,
        faultFilter: faultFilter === "driver" ? "driver" : null,
        legacyDriverScope: true,
      });
      const buckets = {
        month: [c.selectedMonth],
        period: c.periodMonths,
        ytd: monthsOfYear(Number(c.selectedMonth.slice(0, 4))),
      };
      const rows = driverBuckets({ blend, drivers, buckets, categoryIds: COUNTED8 });
      const a = rowsById(old.rows);
      const b = rowsById(rows);
      assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), "same drivers");
      for (const [id, r] of a) {
        for (const [bucket, months] of Object.entries(buckets)) {
          const want = Object.fromEntries(
            COUNTED8.map((cat) => [cat, r[bucket][cat] + movedBy(MOVED[faultFilter], months, id, cat)]),
          );
          assert.deepEqual(b.get(id)[bucket], want, `${id} ${bucket}`);
        }
      }
      // The rows that count are the same rows: only whose history shows beside them moved.
      for (const [ym, list] of Object.entries(old.liveByYm)) {
        assert.deepEqual(blend.liveByYm[ym].map((i) => i.id), list.map((i) => i.id), ym);
      }
    });
  }
}

// ── Trends ───────────────────────────────────────────────────────────────────

const cubeOf = (cube) =>
  Object.fromEntries(Object.entries(cube.cells).map(([ym, cell]) => [ym, Object.fromEntries([...cell].sort())]));

test("Trends cells are v0.20.0's but for the cells that moved", () => {
  const old = cubeOf(legacyTrendsCube({ incidents, history, drivers, catIds: CHARTED6, qualifyIds: COUNTED8 }));
  for (const m of MOVED.all) {
    const k = `${m.driverId}|${m.category}`;
    old[m.ym][k] = (old[m.ym][k] || 0) + m.by;
  }
  for (const ym of Object.keys(old)) old[ym] = Object.fromEntries(Object.entries(old[ym]).sort());
  assert.deepEqual(cubeOf(blendCube(buildBlend({ incidents, history }), CHARTED6)), old);
});

test("a Trends month's source is over its own six categories", () => {
  const { sourceByYm } = blendCube(buildBlend({ incidents, history }), CHARTED6);
  assert.deepEqual(sourceByYm, {
    "2024-02": "history",
    "2025-11": "history",
    "2025-12": "mixed", // late live, damage from history
    "2026-01": "mixed", // forgotten freight live, damage from history
    "2026-02": "history", // its one live row is no-fault
    "2026-03": "history", // its one live row is a compliment, which Trends doesn't chart
    "2026-04": "live",
    "2026-05": "live",
    "2026-06": "live",
  });
});

test("the compliment-only month reads in Trends as it did before v0.20.1 again", () => {
  // v0.20.1 qualified Trends on the Scorecard's eight, so March's one compliment made the
  // month live and hid Bo Baker's 4 damage. Per cell it only makes the compliment live.
  const six = legacyTrendsCube({ incidents, history, drivers, catIds: CHARTED6 });
  const cube = blendCube(buildBlend({ incidents, history }), CHARTED6);
  assert.deepEqual(cubeOf(cube)["2026-03"], cubeOf(six)["2026-03"]);
  assert.equal(cube.cells["2026-03"].get("d2|damage"), 4);
});

// ── Reports ──────────────────────────────────────────────────────────────────

test("Reports monthly totals are v0.20.0's but for the cells that moved", () => {
  const blend = buildBlend({ incidents, history });
  const sources = { "2025-12": "mixed", "2026-01": "mixed", "2026-03": "history" };
  for (const year of [2024, 2025, 2026]) {
    const old = legacyMonthlyTotals(year, incidents, history, { catIds: CHARTED6, qualifyIds: COUNTED8 });
    for (const m of old) {
      const ym = `${year}-${String(m.month).padStart(2, "0")}`;
      for (const moved of MOVED.all.filter((x) => x.ym === ym)) {
        m.byCat[moved.category] += moved.by;
        m.total += moved.by;
      }
      if (sources[ym]) m.source = sources[ym];
    }
    assert.deepEqual(buildMonthlyTotals(year, blend), old, String(year));
  }
});

test("Reports keeps counting a history record with no driver, as it always has", () => {
  const feb = buildMonthlyTotals(2024, buildBlend({ incidents, history }))[1];
  assert.equal(feb.source, "history");
  assert.equal(feb.byCat.attempts, 1);
  assert.equal(feb.total, 7);
});

test("yearly totals are the sum of the months, and a part-live month makes a year blended", () => {
  const blend = buildBlend({ incidents, history });
  const years = availableYears(incidents, history);
  assert.deepEqual(years, [2024, 2025, 2026]);
  const yearly = buildYearlyTotals(years, blend);
  for (const y of yearly) {
    const months = buildMonthlyTotals(y.year, blend);
    assert.equal(y.total, months.reduce((a, m) => a + m.total, 0));
  }
  // 2025's only live entry is December's late, in a month that is part history.
  assert.deepEqual(yearly.map((y) => y.source), ["history", "blended", "blended"]);
});

// ── The cell rule ────────────────────────────────────────────────────────────

test("a compliment makes only its own cell live: the month's other history still counts", () => {
  // The shape liveHistoryBlend.js warns about. Under the month rule March's one live
  // compliment hid Bo Baker's 4 damage; per cell it hides nothing but compliments.
  const blend = buildBlend({ incidents, history });
  assert.equal(blend.isLive("2026-03", "compliment"), true);
  assert.equal(blend.isLive("2026-03", "damage"), false);
  assert.equal(blend.cell("2026-03", "d1", "compliment"), 1);
  assert.equal(blend.cell("2026-03", "d2", "damage"), 4);
  assert.equal(blend.monthSource("2026-03"), "mixed");
  assert.deepEqual(blend.monthCells("2026-03"), { live: ["compliment"], history: ["damage"], not_tracked: [] });
});

test("a month whose only live row is no-fault stays on history", () => {
  const blend = buildBlend({ incidents, history });
  assert.equal(blend.isLive("2026-02", "misdelivery"), false);
  assert.equal(blend.monthSource("2026-02"), "history");
  assert.equal(blend.cell("2026-02", "d3", "missing"), 2);
  assert.equal(blend.cell("2026-02", "d3", "misdelivery"), 0);
});

test("rows that count for nothing never reach a cell", () => {
  const blend = buildBlend({ incidents, history });
  // Unattributed, unable-to-track and return rows in April.
  assert.equal(blend.cell("2026-04", "", "late"), 0);
  assert.equal(blend.cell("2026-04", "d4", "unable_to_track"), 0);
  assert.equal(blend.cell("2026-04", "d6", "return"), 0);
  assert.equal(blend.isLive("2026-04", "unable_to_track"), false);
  // History for a live cell is superseded, never added.
  assert.equal(blend.cell("2026-04", "d1", "late"), 1);
  assert.equal(blend.companyCell("2026-04", "late"), 2);
});

test("a live cell is live for every driver: one driver's history never stands beside another's live count", () => {
  // Ann logged January's forgotten freight; Bo's January is only in history. Deciding
  // per driver would show Bo's 5 from the spreadsheet beside Ann's live entries, mixing
  // two sources inside one cell. The cell is live, so Bo reads 0 — and his history is
  // flagged as disagreeing, not added.
  const blend = buildBlend({
    incidents: [{ id: "x", driver_id: "d1", category: "forgotten_freight", fault: "driver", delivered_date: "2026-01-12" }],
    history: [
      { year: 2026, month: 1, driver_id: "d2", category: "forgotten_freight", count: 5 },
      { year: 2026, month: 1, driver_id: "d2", category: "damage", count: 2 },
    ],
  });
  assert.equal(blend.cell("2026-01", "d1", "forgotten_freight"), 1);
  assert.equal(blend.cell("2026-01", "d2", "forgotten_freight"), 0);
  assert.equal(blend.companyCell("2026-01", "forgotten_freight"), 1);
  // His damage is a cell nobody logged: history's.
  assert.equal(blend.cell("2026-01", "d2", "damage"), 2);
  assert.deepEqual(blend.driverConflicts("d2"), [
    { ym: "2026-01", category: "forgotten_freight", live: 0, history: 5 },
  ]);
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

test("every cell is exactly one source's count, checked against a plain per-cell reading", () => {
  // The rule written out the long way, independently of blend.js: a (month, category)
  // is live when a counted row of that category falls in that month; its count is then
  // the live rows, otherwise the history records.
  const counted = incidents.filter((i) => i.driver_id && !i.no_fault && COUNTED8.includes(i.category));
  const live = new Set(counted.map((i) => `${incidentYm(i)}|${i.category}`));
  const blend = buildBlend({ incidents, history });
  const ids = new Set([...drivers.map((d) => d.id), "d5", "d9"]);
  for (const ym of blend.months) {
    for (const cat of COUNTED8) {
      const isLive = live.has(`${ym}|${cat}`);
      assert.equal(blend.isLive(ym, cat), isLive, `${ym} ${cat}`);
      for (const id of ids) {
        const want = isLive
          ? counted.filter((i) => incidentYm(i) === ym && i.category === cat && i.driver_id === id).length
          : history
              .filter((r) => historyYm(r) === ym && r.category === cat && r.driver_id === id)
              .reduce((a, r) => a + r.count, 0);
        assert.equal(blend.cell(ym, id, cat), want, `${ym} ${id} ${cat}`);
      }
    }
  }
});

// ── Where a number comes from ────────────────────────────────────────────────

test("cell and month sources", () => {
  const blend = buildBlend({ incidents, history });
  assert.equal(blend.cellSource("2026-01", "forgotten_freight"), "live");
  assert.equal(blend.cellSource("2026-01", "damage"), "history");
  assert.equal(blend.cellSource("2026-01", "late"), "none");
  assert.deepEqual(blend.monthCells("2026-01", CHARTED6), {
    live: ["forgotten_freight"],
    history: ["damage"],
    not_tracked: [],
  });
  assert.equal(blend.monthSource("2026-01"), "mixed");
  assert.equal(blend.monthSource("2026-01", ["forgotten_freight"]), "live");
  assert.equal(blend.monthSource("2026-01", ["damage"]), "history");
  // Nothing on record for late in January. History serves part of that month, so an
  // empty cell is history's too, not a live zero borrowed from the forgotten freight —
  // the Trends and Reports tables show it as history that never tracked late ("—").
  assert.equal(blend.monthSource("2026-01", ["late"]), "history");
  assert.equal(blend.monthSource("2026-01", ["late", "compliment"]), "history");
  // ...as it is in a history-only month.
  assert.equal(blend.monthSource("2025-11", ["late"]), "history");
  // April's history (late 9) is all superseded by live entries: every cell on record is
  // live, so a category nobody logged is a live zero.
  assert.equal(blend.monthSource("2026-04"), "live");
  assert.equal(blend.monthSource("2026-04", ["forgotten_freight"]), "live");
  assert.equal(blend.monthSource("2023-11"), "none");
  assert.equal(sourceLabel("mixed"), "live + history");
  assert.equal(sourceLabel("live"), "live");
});

// ── Driver-fault scope ───────────────────────────────────────────────────────

test("today's driver-fault rule: a cell with no live entries reads its all-fault history", () => {
  const blend = buildBlend({ incidents, history, faultFilter: "driver", legacyDriverScope: true });
  assert.equal(blend.monthSource("2025-11"), "history");
  assert.equal(blend.cell("2025-11", "d1", "forgotten_freight"), 3);
  // March's damage has no live entries at all: history serves it.
  assert.equal(blend.cell("2026-03", "d2", "damage"), 4);
  // In a live cell, only driver-fault rows count.
  assert.equal(blend.cell("2026-04", "d2", "damage"), 0);
  assert.equal(blend.cell("2026-04", "d1", "late"), 1);
});

test("which cells are live never depends on the fault filter", () => {
  // May's damage is a vendor-fault row: it makes the cell live, then counts nothing under
  // Driver-fault scope — 0, not history's all-fault 3. Under the month rule the month
  // qualified on driver-fault rows and fell back to history. Both rules agree now.
  for (const legacyDriverScope of [true, false]) {
    const blend = buildBlend({ incidents, history, faultFilter: "driver", legacyDriverScope });
    assert.equal(blend.isLive("2026-05", "damage"), true);
    assert.equal(blend.cell("2026-05", "d2", "damage"), 0);
    assert.equal(blend.liveByYm["2026-05"].length, 0);
    const plain = buildBlend({ incidents, history });
    for (const ym of plain.months) {
      for (const cat of COUNTED8) assert.equal(blend.isLive(ym, cat), plain.isLive(ym, cat), `${ym} ${cat}`);
    }
  }
});

test("the newer driver-fault rule: history cells are not tracked", () => {
  const blend = buildBlend({ incidents, history, faultFilter: "driver" });
  // History has no fault field, so a history cell counts nothing and says so.
  assert.equal(blend.monthSource("2025-11"), "not_tracked");
  assert.equal(blend.cellSource("2026-03", "damage"), "not_tracked");
  assert.equal(blend.monthSource("2026-03"), "mixed");
  assert.equal(blend.cell("2025-11", "d1", "forgotten_freight"), 0);
  assert.equal(blend.cell("2026-03", "d2", "damage"), 0);
  assert.equal(blend.companyCell("2025-11", "damage"), 0);
  assert.equal(blend.historyServed, false);
});

// ── Conflicts ────────────────────────────────────────────────────────────────

test("a conflict is any live cell whose count differs from history, either way", () => {
  const { conflicts } = buildBlend({ incidents, history });
  const key = (c) => `${c.ym} ${c.category} ${c.live}/${c.history}`;
  // December's, January's and March's damage were conflicts under the month rule (live
  // 0 against history). Per cell nobody logged any, so they are history's own numbers.
  assert.deepEqual(conflicts.map(key).sort(), [
    "2026-01 forgotten_freight 3/5",
    "2026-04 late 2/9",
    "2026-05 damage 1/3",
    "2026-06 attempts 2/1",
  ]);
});

test("the Jan 2026 shape: 19 back-dated forgotten freight beside the month's imported history", () => {
  // Production: 19 forgotten freight logged in August, dated January, into a month the
  // spreadsheet already held — FF 28, damage 9, lost/missing 6, misdelivery 2 (45).
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
    { year: 2026, month: 1, driver_id: "d1", category: "damage", count: 9 },
    { year: 2026, month: 1, driver_id: "d2", category: "missing", count: 6 },
    { year: 2026, month: 1, driver_id: "d3", category: "misdelivery", count: 2 },
  ];
  const blend = buildBlend({ incidents: ff, history: hist });
  const month = (cats) => cats.reduce((a, c) => a + blend.companyCell("2026-01", c), 0);
  // The month rule read 19; per cell it reads 36.
  assert.equal(month(COUNTED8), 36);
  // The Scorecard's This Month tile: the 19 live rows, and the 17 history serves.
  assert.equal(historyTotal(blend, "2026-01", COUNTED8), 17);
  assert.equal(historyTotal(blend, "2026-02", COUNTED8), 0);
  assert.equal(blend.companyCell("2026-01", "forgotten_freight"), 19);
  assert.equal(blend.companyCell("2026-01", "damage"), 9);
  assert.equal(blend.companyCell("2026-01", "missing"), 6);
  assert.equal(blend.companyCell("2026-01", "misdelivery"), 2);
  assert.equal(blend.monthSource("2026-01"), "mixed");
  // Only the forgotten freight disagrees with history; the rest IS history.
  assert.deepEqual(blend.conflicts, [{ ym: "2026-01", category: "forgotten_freight", live: 19, history: 28 }]);
});

test("the Scorecard's month tile is made cell by cell, never counting a cell twice", () => {
  const tile = (blend, incs, ym) => {
    const p = monthParts(blend, incs, ym, COUNTED8);
    return { rows: p.rows.map((i) => i.id), fromHistory: p.fromHistory, total: p.rows.length + p.fromHistory };
  };
  const hist = [
    { year: 2026, month: 2, driver_id: "d1", category: "damage", count: 4 },
    { year: 2026, month: 2, driver_id: "d2", category: "misdelivery", count: 3 },
  ];
  const month = (blend) => COUNTED8.reduce((a, c) => a + blend.companyCell("2026-02", c), 0);
  // A no-fault damage back-dated into a history month counts for nothing, and the
  // month's imported damage already reports that cell: the tile is the blend's month.
  const noFault = [{ id: "nf", driver_id: "d1", category: "damage", no_fault: true, delivered_date: "2026-02-03" }];
  let blend = buildBlend({ incidents: noFault, history: hist });
  assert.deepEqual(tile(blend, noFault, "2026-02"), { rows: [], fromHistory: 7, total: 7 });
  assert.equal(month(blend), 7);
  // An unable-to-track entry has no history cell to double: it is a live row (the tile
  // counts every category raw), beside the month's history.
  const utt = [{ id: "u", driver_id: "d1", category: "unable_to_track", delivered_date: "2026-02-03" }];
  blend = buildBlend({ incidents: utt, history: hist });
  assert.deepEqual(tile(blend, utt, "2026-02"), { rows: ["u"], fromHistory: 7, total: 8 });
  // Jan 2026: the live forgotten freight, and the history of the rest.
  blend = buildBlend({ incidents, history });
  assert.deepEqual(tile(blend, incidents, "2026-01"), { rows: ["i2", "i3", "i4"], fromHistory: 2, total: 5 });
  // A month all history, and one all live (April's history is all superseded): no part
  // of either comes from the other.
  assert.deepEqual(tile(blend, incidents, "2025-11"), { rows: [], fromHistory: 9, total: 9 });
  assert.equal(tile(blend, incidents, "2026-04").fromHistory, 0);
});

test("a driver's conflicts compare their own live count with their own history", () => {
  const blend = buildBlend({ incidents, history });
  // Ann logged two of January's three FF against her own five in history. Di Dean's one
  // FF has no history of its own, and her history is damage, which nobody logged: it is
  // counted from history, so it disagrees with nothing.
  assert.deepEqual(blend.driverConflicts("d1").filter((c) => c.ym === "2026-01"), [
    { ym: "2026-01", category: "forgotten_freight", live: 2, history: 5 },
  ]);
  assert.deepEqual(blend.driverConflicts("d4"), []);
  assert.deepEqual(blend.driverConflicts("nobody"), []);
});

test("conflicts are measured without the fault filter, so every scope flags the same cells", () => {
  const plain = buildBlend({ incidents, history }).conflicts;
  for (const legacyDriverScope of [true, false]) {
    const blend = buildBlend({ incidents, history, faultFilter: "driver", legacyDriverScope });
    assert.deepEqual(blend.conflicts, plain);
  }
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
