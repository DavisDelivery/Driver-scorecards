// CLAUDE.md: a drill-down shows the same number as the thing you clicked.
//
// Every number a screen draws and lets you click is built from the blend (blend.js);
// the drawer resolves the spec the click hands it through drill.js. This walks every
// mark each screen's builder produces on the fixture — Scorecard leaderboard rows and
// card totals, Trends leaderboards and per-driver months, Reports month cells, the
// roster card — and checks that the drill-down of each resolves to the value drawn.
// It covers the Jan 2026 conflict month, a period and a window crossing Jan 1, and both
// driver-fault rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend, tally, tallyTotal, driverBuckets, blendCube } from "../src/data/blend.js";
import { buildMonthlyTotals } from "../src/data/analytics.js";
import { monthsOfYear } from "../src/data/scorecardDetail.js";
import { resolveDrill, driverDrill, drillLevels, driverFromDrawer, pushStep, popTo } from "../src/data/drill.js";
import { incidentDateStr } from "../src/data/incidentDate.js";
import { COUNTED8, CHARTED6 } from "../src/data/categories.js";
import { drivers, incidents, history } from "./blend-fixture.mjs";

const roleOf = (id) => drivers.find((d) => d.id === id)?.role || "driver";
const ctxFor = (opts = {}) => {
  const cache = new Map();
  return {
    blend: (fault) => {
      const k = fault || "all";
      if (!cache.has(k)) cache.set(k, buildBlend({ incidents, history, faultFilter: fault, ...opts }));
      return cache.get(k);
    },
    history,
    incidents,
    roleOf,
  };
};

// Resolve every breadcrumb level of a drill state under every scope, and check each
// against the number that was clicked to reach it.
function assertReconciles(state, ctx, what) {
  const scopes = state.scopes?.length || 1;
  for (let scope = 0; scope < scopes; scope++) {
    for (const level of drillLevels({ ...state, scope })) {
      if (level.expected === undefined) continue;
      assert.equal(resolveDrill(level.spec, ctx).total, level.expected, `${what} scope ${scope}`);
    }
  }
}

const sumCats = (counts) => Object.values(counts).reduce((a, n) => a + n, 0);
const inGroup = (role, group) => (group === "loader" ? role === "loader" : role !== "loader");

// ── Scorecard ────────────────────────────────────────────────────────────────

for (const [fault, legacy] of [[null, true], ["driver", true], ["driver", false]]) {
  test(`Scorecard leaderboards reconcile — fault ${fault || "all"}${legacy ? "" : ", newer rule"}`, () => {
    const ctx = ctxFor({ legacyQualifyWithFault: legacy });
    const blend = ctx.blend(fault);
    for (const [selectedMonth, periodMonths] of [
      ["2026-04", ["2026-04"]],
      ["2026-01", ["2025-11", "2025-12", "2026-01"]], // crosses Jan 1
      ["2026-06", monthsOfYear(2026).slice(0, 6)],
    ]) {
      const ytdMonths = monthsOfYear(Number(selectedMonth.slice(0, 4)));
      const rows = driverBuckets({
        blend,
        drivers,
        buckets: { month: [selectedMonth], period: periodMonths, ytd: ytdMonths },
        categoryIds: COUNTED8,
      });
      for (const r of rows) {
        // A row: the driver's drawer, opened on the category clicked, period and YTD.
        for (const cat of COUNTED8) {
          if (!r.period[cat] && !r.ytd[cat]) continue;
          const state = driverDrill(
            r.driver.id,
            {
              categoryIds: COUNTED8,
              fault,
              scopes: [
                { label: "period", months: periodMonths, expected: sumCats(r.period) },
                { label: "ytd", months: ytdMonths, expected: sumCats(r.ytd) },
              ],
            },
            { category: cat, x: [r.period[cat], r.ytd[cat]] },
          );
          assertReconciles(state, ctx, `${selectedMonth} ${r.driver.id} ${cat}`);
        }
      }
      // A card's totals: everyone in the role group, inactive drivers included.
      for (const group of ["driver", "loader"]) {
        for (const cat of COUNTED8) {
          const members = rows.filter((r) => inGroup(r.driver.role || "driver", group));
          const total = (b) => members.reduce((a, r) => a + (r[b][cat] || 0), 0);
          assertReconciles(
            {
              spec: { kind: "blend", categoryIds: [cat], roleGroup: group, fault },
              scopes: [
                { label: "period", months: periodMonths, expected: total("period") },
                { label: "ytd", months: ytdMonths, expected: total("ytd") },
              ],
            },
            ctx,
            `${selectedMonth} ${group} ${cat} card`,
          );
        }
      }
    }
  });
}

// ── Inside the drawer ────────────────────────────────────────────────────────
// A driver opened from a chart's drawer — from its By-driver list, from a row's name, or
// after narrowing to a month — and then walked back to the driver's own root crumb. The
// chart's scope totals belong to the whole chart, so they must not come along as the
// driver's: every level the driver's drawer shows a number for must count that number.

test("a driver opened inside a chart's drawer reconciles at every crumb, the root included", () => {
  for (const [fault, legacy] of [[null, true], ["driver", true], ["driver", false]]) {
    const ctx = ctxFor({ legacyQualifyWithFault: legacy });
    const blend = ctx.blend(fault);
    const periodMonths = ["2025-11", "2025-12", "2026-01"];
    const ytdMonths = monthsOfYear(2026);
    const rows = driverBuckets({
      blend,
      drivers,
      buckets: { period: periodMonths, ytd: ytdMonths },
      categoryIds: COUNTED8,
    });
    let opened = 0;
    for (const group of ["driver", "loader"]) {
      for (const cat of COUNTED8) {
        const members = rows.filter((r) => inGroup(r.driver.role || "driver", group));
        const total = (b) => members.reduce((a, r) => a + (r[b][cat] || 0), 0);
        const chart = {
          spec: { kind: "blend", categoryIds: [cat], roleGroup: group, fault },
          scopes: [
            { label: "period", months: periodMonths, expected: total("period") },
            { label: "ytd", months: ytdMonths, expected: total("ytd") },
          ],
          vocab: COUNTED8,
        };
        for (let scope = 0; scope < 2; scope++) {
          const at = { ...chart, scope };
          const detail = resolveDrill(drillLevels(at)[0].spec, ctx);
          for (const [id, e] of detail.byDriver) {
            if (!id) continue;
            // By-driver list: the count on the row clicked.
            const viaList = driverFromDrawer(at, id, e.count);
            assertReconciles(viaList, ctx, `${fault} ${group} ${cat} ${id} list`);
            // Back to the driver's own crumb: the chart's totals are not the driver's.
            assert.equal(drillLevels(popTo(viaList, 0))[0].expected, undefined);
            assertReconciles(popTo(viaList, 0), ctx, `${fault} ${group} ${cat} ${id} root`);
            // A row's name in the entry list carries no count at all.
            assertReconciles(driverFromDrawer(at, id), ctx, `${fault} ${group} ${cat} ${id} row`);
            opened++;
          }
          // Narrowed to a month first, then a driver from that month's list.
          for (const ym of drillLevels(at)[0].spec.months) {
            const month = pushStep(at, { month: ym, x: detail.byMonth.get(ym) || 0 });
            const inMonth = resolveDrill(drillLevels(month).at(-1).spec, ctx);
            for (const [id, e] of inMonth.byDriver) {
              if (!id) continue;
              const next = driverFromDrawer(month, id, e.count);
              assertReconciles(next, ctx, `${fault} ${group} ${cat} ${ym} ${id} month`);
              for (let i = 0; i < drillLevels(next).length; i++) {
                assertReconciles(popTo(next, i), ctx, `${fault} ${group} ${cat} ${ym} ${id} crumb ${i}`);
              }
            }
          }
        }
      }
    }
    assert.ok(opened > 0, "the fixture opens at least one driver");
  }
});

test("a driver opened from a window or a list drawer narrows it, with the count clicked", () => {
  const ctx = ctxFor();
  const win = { spec: { kind: "window", start: "2025-11-20", end: "2026-01-10", categoryIds: COUNTED8 } };
  const d = resolveDrill(win.spec, ctx);
  for (const [id, e] of d.byDriver) {
    if (!id) continue;
    const next = driverFromDrawer(win, id, e.count);
    assert.equal(next.path.at(-1).driverId, id);
    assertReconciles(next, ctx, `window ${id}`);
  }
});

test("the inactive driver's counts stay in the card total the drawer shows", () => {
  const ctx = ctxFor({ legacyQualifyWithFault: true });
  const d = resolveDrill(
    { kind: "blend", months: monthsOfYear(2026), categoryIds: ["forgotten_freight"], roleGroup: "driver" },
    ctx,
  );
  // Di Dean (inactive) logged one of January's three.
  assert.equal(d.byDriver.get("d4").count, 1);
  assert.equal(d.total, 3);
});

// ── Trends ───────────────────────────────────────────────────────────────────

test("Trends leaderboards and per-driver months reconcile", () => {
  const ctx = ctxFor();
  const blend = ctx.blend(null);
  const cube = blendCube(blend, CHARTED6);
  const all = Object.keys(cube.cells).sort();
  for (const year of [2024, 2025, 2026]) {
    const yearMonths = monthsOfYear(year);
    const yr = tally(blend, yearMonths, CHARTED6);
    const ever = tally(blend, all, CHARTED6);
    for (const [id, cats] of ever) {
      for (const [cat, n] of cats) {
        const state = driverDrill(
          id,
          {
            categoryIds: CHARTED6,
            scopes: [
              { label: String(year), months: yearMonths, expected: tallyTotal(yr, { driverId: id }) },
              { label: "All time", months: all, expected: tallyTotal(ever, { driverId: id }) },
            ],
          },
          { category: cat, x: [yr.get(id)?.get(cat) || 0, n] },
        );
        assertReconciles(state, ctx, `${year} ${id} ${cat}`);
      }
    }
    // Overview columns and a driver's monthly bars.
    for (const ym of yearMonths) {
      const cell = cube.cells[ym];
      if (!cell) continue;
      const total = [...cell.values()].reduce((a, n) => a + n, 0);
      assert.equal(resolveDrill({ kind: "blend", months: [ym], categoryIds: CHARTED6 }, ctx).total, total, ym);
      for (const id of new Set([...cell.keys()].map((k) => k.split("|")[0]))) {
        const n = [...cell].filter(([k]) => k.startsWith(`${id}|`)).reduce((a, [, v]) => a + v, 0);
        assert.equal(
          resolveDrill({ kind: "blend", months: [ym], categoryIds: CHARTED6, driverId: id }, ctx).total,
          n,
          `${ym} ${id}`,
        );
      }
    }
  }
});

test("the Jan 2026 conflict month drills to the live number it shows, not history's", () => {
  const ctx = ctxFor();
  const cube = blendCube(ctx.blend(null), CHARTED6);
  const shown = [...cube.cells["2026-01"]].filter(([k]) => k.endsWith("|forgotten_freight")).reduce((a, [, n]) => a + n, 0);
  const d = resolveDrill({ kind: "blend", months: ["2026-01"], categoryIds: ["forgotten_freight"] }, ctx);
  assert.equal(shown, 3);
  assert.equal(d.total, 3);
  assert.equal(d.historyRows.length, 0);
  assert.equal(d.sourceOf("2026-01"), "live");
});

// ── Reports ──────────────────────────────────────────────────────────────────

test("Reports month cells reconcile, unattributed history included", () => {
  const ctx = ctxFor();
  const blend = ctx.blend(null);
  for (const year of [2024, 2025, 2026]) {
    for (const m of buildMonthlyTotals(year, blend)) {
      const ym = `${year}-${String(m.month).padStart(2, "0")}`;
      for (const cat of CHARTED6) {
        const spec = { kind: "blend", months: [ym], categoryIds: [cat], unattributed: true };
        assert.equal(resolveDrill(spec, ctx).total, m.byCat[cat], `${ym} ${cat}`);
      }
      const spec = { kind: "blend", months: [ym], categoryIds: CHARTED6, unattributed: true };
      assert.equal(resolveDrill(spec, ctx).total, m.total, `${ym} total`);
    }
  }
});

// ── Drivers (the roster cards) ───────────────────────────────────────────────

test("roster card numbers reconcile with the driver's drawer", () => {
  const NEG = COUNTED8.filter((c) => c !== "compliment");
  const ctx = ctxFor();
  const blend = ctx.blend(null);
  const mo = tally(blend, ["2026-04"], NEG);
  const ytd = tally(blend, monthsOfYear(2026), NEG);
  const ever = tally(blend, blend.months, NEG);
  for (const d of drivers) {
    const state = {
      spec: { kind: "blend", driverId: d.id, categoryIds: NEG },
      scopes: [
        { label: "All time", months: blend.months, expected: tallyTotal(ever, { driverId: d.id }) },
        { label: "YTD", months: monthsOfYear(2026), expected: tallyTotal(ytd, { driverId: d.id }) },
        { label: "Apr", months: ["2026-04"], expected: tallyTotal(mo, { driverId: d.id }) },
      ],
    };
    assertReconciles(state, ctx, d.id);
  }
});

// ── Windows ──────────────────────────────────────────────────────────────────

test("a window crossing Jan 1 resolves to the live rows dated inside it", () => {
  const ctx = ctxFor();
  const blend = ctx.blend(null);
  const start = "2025-11-20";
  const end = "2026-01-10";
  // The builder: each live row counted on its own day.
  let drawn = 0;
  for (const list of Object.values(blend.liveByYm)) {
    for (const inc of list) {
      const day = incidentDateStr(inc).slice(0, 10);
      if (day >= start && day <= end && COUNTED8.includes(inc.category)) drawn++;
    }
  }
  const d = resolveDrill({ kind: "window", start, end, categoryIds: COUNTED8 }, ctx);
  assert.equal(drawn, 3); // Dec 30 late, Jan 5 and Jan 9 FF
  assert.equal(d.total, drawn);
  // November is history and only part of it is in the window: named, never prorated.
  assert.deepEqual(d.unsplittable, [{ ym: "2025-11", count: 9 }]);
  assert.deepEqual(d.months, ["2025-11", "2025-12", "2026-01"]);
});

// ── Explicit lists ───────────────────────────────────────────────────────────

test("an incidents spec counts exactly the rows it names", () => {
  const ctx = ctxFor();
  const ids = incidents.filter((i) => i.category === "late").map((i) => i.id);
  const d = resolveDrill({ kind: "incidents", ids }, ctx);
  assert.equal(d.total, ids.length);
  assert.equal(d.liveOnly, true);
  assert.equal(resolveDrill({ kind: "incidents", ids, driverId: "d1" }, ctx).total, 1);
});

test("an attempts spec counts orders in its window", () => {
  const attemptRecords = [
    { key: "a", date: "2026-09-01", driver_id: "d1", driver_name: "Ann Able" },
    { key: "b", date: "2026-09-02", driver_id: "d2", driver_name: "Bo Baker" },
    { key: "c", date: "2026-10-01", driver_id: "d1", driver_name: "Ann Able" },
  ];
  const ctx = { ...ctxFor(), attemptRecords };
  const d = resolveDrill({ kind: "attempts", start: "2026-09-01", end: "2026-09-30" }, ctx);
  assert.equal(d.total, 2);
  assert.equal(d.byCategory.get("attempts"), 2);
  assert.equal(resolveDrill({ kind: "attempts", driverId: "d1" }, ctx).total, 2);
});
