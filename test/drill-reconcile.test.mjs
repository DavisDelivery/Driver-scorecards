// CLAUDE.md: a drill-down shows the same number as the thing you clicked.
//
// Every number a screen draws and lets you click is built from the blend (blend.js);
// the drawer resolves the spec the click hands it through drill.js. This walks every
// mark each screen's builder produces on the fixture — Scorecard leaderboard rows and
// card totals, Trends leaderboards and per-driver months, Reports month cells, the
// roster card, the manual-entry tabs' tiles and driver card — and checks that the
// drill-down of each resolves to the value drawn.
// It covers the Jan 2026 month (forgotten freight live, the rest from history), a period
// and a window crossing Jan 1, and both driver-fault rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend, tally, tallyTotal, driverBuckets, blendCube } from "../src/data/blend.js";
import { buildMonthlyTotals } from "../src/data/analytics.js";
import { monthsOfYear } from "../src/data/scorecardDetail.js";
import {
  resolveDrill,
  driverDrill,
  drillLevels,
  driverFromDrawer,
  pushStep,
  popTo,
  dataStamp,
  drillVerdict,
} from "../src/data/drill.js";
import { incidentDateStr } from "../src/data/incidentDate.js";
import { COUNTED8, CHARTED6 } from "../src/data/categories.js";
import {
  inWindow,
  recordDate,
  keyOf,
  focusOptions,
  weekdaySeries,
  busiest,
  entriesDrill,
  attemptTiles,
  monthSpark,
  sparkSource,
} from "../src/data/manualAnalytics.js";
import { buildAttemptRecords } from "../src/data/attemptRecords.js";
import { weekdayOfYmd } from "../src/data/period.js";
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
    const ctx = ctxFor({ legacyDriverScope: legacy });
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
    const ctx = ctxFor({ legacyDriverScope: legacy });
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
  const ctx = ctxFor({ legacyDriverScope: true });
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

test("the Jan 2026 month drills to what it shows: live forgotten freight, history's damage", () => {
  const ctx = ctxFor();
  const cube = blendCube(ctx.blend(null), CHARTED6);
  const shown = (cat) =>
    [...cube.cells["2026-01"]].filter(([k]) => k.endsWith(`|${cat}`)).reduce((a, [, n]) => a + n, 0);
  // Forgotten freight is live: the 3 entries, not history's 5.
  const ff = resolveDrill({ kind: "blend", months: ["2026-01"], categoryIds: ["forgotten_freight"] }, ctx);
  assert.equal(shown("forgotten_freight"), 3);
  assert.equal(ff.total, 3);
  assert.equal(ff.historyRows.length, 0);
  assert.equal(ff.sourceOf("2026-01"), "live");
  // Nobody logged damage in January: Di Dean's 2 come from history.
  const damage = resolveDrill({ kind: "blend", months: ["2026-01"], categoryIds: ["damage"] }, ctx);
  assert.equal(shown("damage"), 2);
  assert.equal(damage.total, 2);
  assert.deepEqual(damage.historyRows.map((r) => [r.driver_id, r.count]), [["d4", 2]]);
  assert.equal(damage.sourceOf("2026-01"), "history");
  // The whole month, part live and part history, says which is which.
  const all = resolveDrill({ kind: "blend", months: ["2026-01"], categoryIds: CHARTED6 }, ctx);
  assert.equal(all.total, 5);
  assert.equal(all.incidents.length, 3);
  assert.equal(all.sourceOf("2026-01"), "mixed");
  assert.deepEqual(all.cellsOf("2026-01"), { live: ["forgotten_freight"], history: ["damage"], not_tracked: [] });
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

test("a window crossing Jan 1 resolves to the live rows dated inside it and the history months it holds whole", () => {
  const ctx = ctxFor();
  const blend = ctx.blend(null);
  const start = "2025-11-20";
  const end = "2026-01-10";
  // The builder: each live row counted on its own day, and the history cells of a month
  // wholly inside the window added whole.
  let drawn = 0;
  for (const list of Object.values(blend.liveByYm)) {
    for (const inc of list) {
      const day = incidentDateStr(inc).slice(0, 10);
      if (day >= start && day <= end && COUNTED8.includes(inc.category)) drawn++;
    }
  }
  assert.equal(drawn, 3); // Dec 30 late, Jan 5 and Jan 9 FF
  for (const cat of COUNTED8) if (!blend.isLive("2025-12", cat)) drawn += blend.companyCell("2025-12", cat);
  const d = resolveDrill({ kind: "window", start, end, categoryIds: COUNTED8 }, ctx);
  assert.equal(drawn, 8); // + December's damage (5), which nobody logged: history's
  assert.equal(d.total, drawn);
  // November is history and only part of it is in the window, and so is January's
  // damage: named, never prorated.
  assert.deepEqual(d.unsplittable, [{ ym: "2025-11", count: 9 }, { ym: "2026-01", count: 2 }]);
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
  // `key` is the driver key attemptRecords.js gives every record.
  const attemptRecords = [
    { id: "a", key: "d1", date: "2026-09-01", driver_id: "d1", driver_name: "Ann Able" },
    { id: "b", key: "d2", date: "2026-09-02", driver_id: "d2", driver_name: "Bo Baker" },
    { id: "c", key: "d1", date: "2026-10-01", driver_id: "d1", driver_name: "Ann Able" },
    { id: "d", key: "unassigned", date: "2026-09-03", driver_id: null, driver_name: "" },
  ];
  const ctx = { ...ctxFor(), attemptRecords };
  const d = resolveDrill({ kind: "attempts", start: "2026-09-01", end: "2026-09-30" }, ctx);
  assert.equal(d.total, 3);
  assert.equal(d.byCategory.get("attempts"), 3);
  assert.equal(d.byDriver.get("unassigned").count, 1, "Unassigned is a row of its own");
  assert.equal(resolveDrill({ kind: "attempts", driverId: "d1" }, ctx).total, 2);
  assert.equal(resolveDrill({ kind: "attempts", driverKey: "unassigned" }, ctx).total, 1);
});

// ── Manual-entry tabs ────────────────────────────────────────────────────────
// Forgotten Freight, Unable to Track, Mis-Deliveries, Compliments and Attempts draw
// their tiles from manualAnalytics.js. Every tile that opens a drawer, and "Driver
// detail" on the driver card, must open on its own number — with no driver picked and
// with each one the picker offers.

test("the manual-entry tabs' tiles and Driver detail reconcile, for every driver", () => {
  const ctx = ctxFor();
  const hidden = new Set(drivers.filter((d) => d.active === false).map((d) => d.id));
  for (const win of [
    { start: "2026-04-01", end: "2026-04-30", bucket: "day", months: ["2026-04"] },
    { start: "2025-12-15", end: "2026-01-31", bucket: "week", months: ["2025-12", "2026-01"] }, // crosses Jan 1
  ]) {
    for (const category of ["forgotten_freight", "unable_to_track", "misdelivery", "compliment"]) {
      const rows = inWindow(incidents.filter((i) => i.category === category), win);
      const focuses = [null, ...focusOptions(rows, { drivers }).map((o) => o.key)];
      for (const focus of focuses) {
        const what = `${category} ${win.start} ${focus}`;
        const mine = focus ? rows.filter((r) => keyOf(r) === focus) : rows;
        // Total, and Driver detail: the same list.
        const total = entriesDrill(rows, focus, { category });
        assert.equal(total.expected, mine.length, what);
        assert.equal(resolveDrill(total.spec, ctx).total, total.expected, `${what}: total`);
        // Busiest workday: the weekday's own entries.
        const top = busiest(weekdaySeries(rows, focus));
        if (top) {
          const wd = entriesDrill(
            rows.filter((r) => weekdayOfYmd(recordDate(r)) === top.wd),
            focus,
            { category },
          );
          assert.equal(resolveDrill(wd.spec, ctx).total, top.count, `${what}: busiest`);
        }
      }
    }
  }
  // Attempts: hand-logged rows here (the feed's orders are tested in manual-analytics).
  const { records } = buildAttemptRecords({ feedDays: new Map(), incidents, drivers });
  const win = { start: "2026-06-01", end: "2026-06-30", bucket: "day", months: ["2026-06"] };
  const rows = inWindow(records, win);
  assert.equal(rows.length, 2, "the June 30 timestamp is filed on June 30");
  for (const focus of [null, "d1", "d3"]) {
    const t = attemptTiles({ rows, win, focus, hidden });
    for (const name of ["orders", "rank", "busiest", "perDay", "repeat", "open"]) {
      if (!t[name]) continue;
      assert.equal(resolveDrill(t[name].drill, { ...ctx, attemptRecords: records }).total, t[name].expected, `attempts ${focus} ${name}`);
    }
  }
});

test("the driver card's months are the Scorecard's own cells", () => {
  // The sparkline says "as the Scorecard counts them": each month it draws is blend.cell,
  // which is what the Scorecard's drill-down for that driver, month and category
  // resolves to. A month that never captured the category draws no bar at all (n null):
  // the drill-down has nothing in it either, but that's not a zero to draw.
  const ctx = ctxFor();
  const blend = ctx.blend(null);
  for (const [driverId, category] of [["d1", "forgotten_freight"], ["d3", "compliment"], ["d2", "damage"]]) {
    const spark = monthSpark({
      endYm: "2026-06",
      cellOf: (ym) => blend.cell(ym, driverId, category),
      sourceOf: (ym) => sparkSource(blend, ym, category),
    });
    for (const m of spark) {
      const d = resolveDrill({ kind: "blend", months: [m.ym], categoryIds: [category], driverId }, ctx);
      if (m.n === null) {
        assert.ok(["not_tracked", "none"].includes(m.source), `${driverId} ${category} ${m.ym}: ${m.source}`);
        assert.equal(d.total, 0, `${driverId} ${category} ${m.ym}: nothing to count`);
      } else {
        assert.equal(d.total, m.n, `${driverId} ${category} ${m.ym}`);
      }
    }
  }
  // Jan 2026's forgotten freight is live: Ann's is the 2 live entries, not history's 5.
  // Its damage is history's: Di Dean's 2, though the month holds live entries.
  const jan = (driverId, category) =>
    monthSpark({
      endYm: "2026-01",
      months: 1,
      cellOf: (ym) => blend.cell(ym, driverId, category),
      sourceOf: (ym) => sparkSource(blend, ym, category),
    })[0];
  assert.deepEqual([jan("d1", "forgotten_freight").n, jan("d1", "forgotten_freight").source], [2, "live"]);
  assert.deepEqual([jan("d4", "damage").n, jan("d4", "damage").source], [2, "history"]);
});

// ── Inside an attempts drawer ────────────────────────────────────────────────
// A drawer opened from an Attempts tile lists its orders by driver and by month, and
// each of those counts narrows the drawer when clicked. Every narrowed level must
// show the count that was clicked — for every tile, with no driver picked and with
// each one. "Repeat customer" is the one that can't be worked out again inside the
// narrowed list: an order whose customer recurs elsewhere in the tile's list is a
// repeat even once the drawer is down to its own driver or month.

// Two months of feed orders. ACME recurs across drivers, so Bo's single ACME order
// and the Unassigned one are repeats only against the fleet; ZETA recurs inside Ann's
// own orders but across two months.
const attRec = (() => {
  let n = 0;
  const who = { d1: "Ann Able", d2: "Bo Baker", d3: "Cy Cole" };
  return (date, key, customerKey, extra = {}) => {
    n++;
    const id = key in who ? key : null;
    return {
      id: `feed:${date}:${n}`,
      pro_number: `ATT00${7170000 + n}`,
      date,
      delivered_date: date,
      driver_id: id,
      driver_name: id ? who[id] : key.startsWith("name:") ? key.slice(5) : "",
      key,
      customer: customerKey.split("|")[0],
      customerKey,
      outcome: "delivered",
      from_feed: true,
      order: { stopNbr: `00${7170000 + n}` },
      ...extra,
    };
  };
})();
const attemptOrders = [
  attRec("2026-08-28", "d1", "ZETA|30302"),
  attRec("2026-09-03", "d1", "ZETA|30302", { outcome: "unplanned" }),
  attRec("2026-09-03", "d1", "ACME|30301"),
  attRec("2026-09-04", "d2", "ACME|30301", { outcome: "rescheduled" }),
  attRec("2026-09-10", "unassigned", "ACME|30301", { outcome: "unplanned" }),
  attRec("2026-09-11", "name:ZED ZULU", "BETA|30303"),
  attRec("2026-09-11", "d3", "BETA|30303"), // deactivated
  attRec("2026-08-21", "d2", "GAMMA|30304"),
];

// Every level the drawer offers from one state: each By-driver row (when the level
// isn't one driver's already), then each month of each of those, and each month of the
// level itself — the click's number checked against the narrowed count each time.
function walkAttemptDrawer(state, ctx, what) {
  let checked = 0;
  const levels = drillLevels(state);
  const level = levels[levels.length - 1];
  const d = resolveDrill(level.spec, ctx);
  if (typeof level.expected === "number") {
    assert.equal(d.total, level.expected, `${what}: as clicked`);
    checked++;
  }
  if (!level.spec.driverKey && !level.spec.driverId) {
    for (const [key, e] of d.byDriver) checked += walkAttemptDrawer(pushStep(state, { driverKey: key, x: e.count }), ctx, `${what} › ${key}`);
  }
  if (!(state.path || []).some((op) => op.month)) {
    for (const [ym, n] of d.byMonth) checked += walkAttemptDrawer(pushStep(state, { month: ym, x: n }), ctx, `${what} › ${ym}`);
  }
  return checked;
}

test("an attempts drawer narrowed to a driver or a month shows the number clicked", () => {
  const ctx = { ...ctxFor(), attemptRecords: attemptOrders };
  const hidden = new Set(drivers.filter((d) => d.active === false).map((d) => d.id));
  const win = { start: "2026-08-15", end: "2026-09-14", bucket: "day", months: ["2026-08", "2026-09"] };
  const rows = inWindow(attemptOrders, win);
  let checked = 0;
  for (const focus of [null, "d1", "d2", "unassigned", "name:ZED ZULU"]) {
    const t = attemptTiles({ rows, win, focus, hidden });
    for (const name of ["orders", "rank", "busiest", "perDay", "repeat", "open"]) {
      if (!t[name]) continue;
      checked += walkAttemptDrawer({ spec: t[name].drill, expected: t[name].expected }, ctx, `${focus} ${name}`);
    }
  }
  assert.ok(checked > 60, `walked ${checked} levels`);
  // The case that disagreed: the fleet's repeat customers, narrowed to Bo, keep his one
  // ACME order — ACME recurs across the fleet, not in his own list.
  const repeat = attemptTiles({ rows, win, hidden }).repeat;
  assert.equal(repeat.expected, 7, "ACME ×3 (Unassigned's included), ZETA ×2 (August's too), BETA ×2; GAMMA once");
  const bo = drillLevels(pushStep({ spec: repeat.drill, expected: repeat.expected }, { driverKey: "d2", x: 1 }));
  assert.equal(resolveDrill(bo[bo.length - 1].spec, ctx).total, 1);
  // Ann's own repeats are found in her own list: ZETA twice, across August and September.
  const ann = attemptTiles({ rows, win, focus: "d1", hidden }).repeat;
  assert.equal(ann.expected, 2);
  const sep = drillLevels(pushStep({ spec: ann.drill, expected: 2 }, { month: "2026-09", x: 1 }));
  assert.equal(resolveDrill(sep[sep.length - 1].spec, ctx).total, 1, "her September ZETA order is still a repeat");
});

test("a tile clicked before its period's orders were published reads as moved, not as a disagreement", () => {
  // The Attempts tab draws tiles from what it has while the period loads; the drawer
  // counts the orders the tab publishes once it's in. The click is stamped with the
  // data on screen then — before publication — so the later count is the data moving.
  const base = { incidents, history, drivers };
  const win = { start: "2026-08-15", end: "2026-09-14", bucket: "day", months: ["2026-08", "2026-09"] };
  const whileLoading = attemptTiles({ rows: [], win });
  const atClick = dataStamp({ ...base, attemptRecords: null });
  const ready = dataStamp({ ...base, attemptRecords: attemptOrders });
  assert.notEqual(atClick, ready);
  const total = resolveDrill(whileLoading.orders.drill, { attemptRecords: attemptOrders }).total;
  assert.equal(total, 8);
  assert.equal(drillVerdict({ expected: whileLoading.orders.expected, total, at: atClick, stamp: ready }), "moved");
  // Clicked once the orders were in, the same count is checked — and agrees.
  const loaded = attemptTiles({ rows: inWindow(attemptOrders, win), win });
  assert.equal(drillVerdict({ expected: loaded.orders.expected, total, at: ready, stamp: ready }), null);
  // A real difference on the same data is still the alarm.
  assert.equal(drillVerdict({ expected: 7, total, at: ready, stamp: ready }), "mismatch");
  // A state no screen stamped was opened just now, from the data on screen.
  assert.equal(drillVerdict({ expected: 7, total, at: null, stamp: ready }), "mismatch");
});
