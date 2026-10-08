// The manual-entry tabs' analytics (src/data/manualAnalytics.js).
//
// The panel's math was lifted out of ManualEntryAnalytics.jsx and ManualEntry.jsx. With
// no driver picked it must draw exactly what v0.20.1 drew: `legacyPanel` below is that
// code, copied verbatim, and the new builders are held to it — the intended changes
// being that rows are dated by incidentDateStr (tested on its own) and that day buckets
// are zero-filled (the non-zero days are the same days with the same counts).
//
// Then the new behaviour: a picked driver re-scopes every number to that driver against
// the rest of the fleet, every chart click narrows the table to exactly the bar's
// count, and every tile's drill-down resolves to the tile (drill.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordDate,
  keyOf,
  inWindow,
  activeFocus,
  focusOptions,
  byDriver,
  focusRank,
  ordinal,
  topDriver,
  fleetMean,
  weekdaySeries,
  busiest,
  trendSeries,
  classBreakdown,
  outcomeMix,
  wholePercents,
  repeatCustomerRows,
  perActiveDay,
  filterAttempts,
  customerPatterns,
  lateByPro,
  ageDays,
  sortQueue,
  priorDelta,
  feedLoadPlan,
  attemptTiles,
  entriesDrill,
  applyChips,
  searchOrders,
  sortOrders,
  monthSpark,
  sparkSource,
  liveMonthCounts,
  weekSpark,
  dayDiff,
  bucketGap,
  printPeriodLabel,
  NOT_SET,
} from "../src/data/manualAnalytics.js";
import { buildAttemptRecords } from "../src/data/attemptRecords.js";
import { resolveDrill } from "../src/data/drill.js";
import { periodWindow, toYMD, mondayOf, weekdayOfYmd, addDays } from "../src/data/period.js";
import { hiddenDriverIds } from "../src/data/drivers.js";
import { FEED_EPOCH } from "../src/data/attemptsFeed.js";

// ---- v0.20.1 ManualEntryAnalytics.jsx + ManualEntry.jsx byDriver, verbatim ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function legacyPanel({ records, drivers, win }) {
  const dateOf = (r) => (r.delivered_date || r.created_at || "").slice(0, 10);
  const driverName = (r) =>
    r.driver_name || drivers.find((d) => d.id === r.driver_id)?.name || r.driver_raw || "Unassigned";
  const inPeriod = records.filter((r) => {
    const d = dateOf(r);
    return d && d >= win.start && d <= win.end;
  });
  const bucket = win.bucket;
  const map = new Map();
  let trend;
  if (bucket === "day") {
    for (const r of inPeriod) {
      const d = dateOf(r);
      if (d) map.set(d, (map.get(d) || 0) + 1);
    }
    trend = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, count]) => ({ label: `${d.slice(5, 7)}/${d.slice(8, 10)}`, count }));
  } else if (bucket === "week") {
    let cursor = mondayOf(win.start);
    const lastMonday = mondayOf(win.end);
    while (cursor <= lastMonday) {
      map.set(cursor, 0);
      const [y, m, d] = cursor.split("-").map(Number);
      cursor = toYMD(new Date(y, m - 1, d + 7));
    }
    for (const r of inPeriod) {
      const d = dateOf(r);
      if (!d) continue;
      const wk = mondayOf(d);
      if (map.has(wk)) map.set(wk, map.get(wk) + 1);
    }
    trend = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([wk, count]) => ({ label: `${wk.slice(5, 7)}/${wk.slice(8, 10)}`, count }));
  } else {
    for (const ym of win.months) map.set(ym, 0);
    for (const r of inPeriod) {
      const ym = dateOf(r).slice(0, 7);
      if (map.has(ym)) map.set(ym, map.get(ym) + 1);
    }
    trend = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, count]) => ({ label: `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`, count }));
  }
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const r of inPeriod) {
    const w = weekdayOfYmd(dateOf(r));
    if (w != null) counts[w] += 1;
  }
  const order = [1, 2, 3, 4, 5];
  if (counts[6]) order.push(6);
  if (counts[0]) order.unshift(0);
  const weekday = order.map((w) => ({ label: WD[w], count: counts[w] }));
  const total = inPeriod.length;
  const topWeekday = weekday.reduce((a, b) => (b.count > a.count ? b : a), { label: "—", count: -1 });
  const activeDays = bucket === "day" ? trend.length : new Set(inPeriod.map((r) => dateOf(r))).size;
  const avg = activeDays ? (total / activeDays).toFixed(1) : "0";
  const hidden = hiddenDriverIds(drivers);
  const m = new Map();
  for (const r of inPeriod) {
    if (r.driver_id && hidden.has(r.driver_id)) continue;
    if (!r.driver_id && !r.driver_name && !r.driver_raw) continue;
    const n = driverName(r);
    m.set(n, (m.get(n) || 0) + 1);
  }
  let best = "—";
  let bestN = 0;
  for (const [n, c] of m) if (c > bestN) { best = n; bestN = c; }
  const topDriverText = bestN ? `${best} (${bestN})` : "—";
  // ManualEntry.jsx byDriver
  const bd = new Map();
  for (const i of inPeriod) {
    if (i.driver_id && hidden.has(i.driver_id)) continue;
    const name = driverName(i);
    const key = i.driver_id || (i.driver_name || i.driver_raw ? `name:${i.driver_name || i.driver_raw}` : "unassigned");
    if (!bd.has(key)) bd.set(key, { key, id: i.driver_id || null, name, count: 0 });
    bd.get(key).count += 1;
  }
  const byDriverRows = [...bd.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    inPeriod,
    trend,
    weekday,
    total,
    busiest: topWeekday.count > 0 ? topWeekday.label : "—",
    avg,
    topDriver: topDriverText,
    byDriver: byDriverRows,
  };
}

// ---- fixture ------------------------------------------------------------------
const drivers = [
  { id: "d1", name: "Ann Able", role: "driver", active: true },
  { id: "d2", name: "Bo Baker", role: "driver", active: true },
  { id: "d3", name: "Cy Cole", role: "driver", active: false }, // deactivated
  { id: "d4", name: "Di Dunn", role: "loader", active: true },
  { id: "d5", name: "Ed Eve", role: "driver", active: true }, // on the roster, no entries
];
const nameOf = (r) =>
  r.driver_name || drivers.find((d) => d.id === r.driver_id)?.name || r.driver_raw || "Unassigned";

let seq = 0;
const ff = (date, driver_id, extra = {}) => ({
  id: `i${++seq}`,
  category: "forgotten_freight",
  pro_number: `00710${String(seq).padStart(4, "0")}`,
  driver_id,
  driver_name: drivers.find((d) => d.id === driver_id)?.name || "",
  delivered_date: date,
  created_at: `${date}T15:00:00.000Z`,
  forgotten_item: "Skid",
  ...extra,
});
const incidents = [
  ff("2026-09-01", "d1"),
  ff("2026-09-01", "d1", { forgotten_item: "Box" }),
  ff("2026-09-02", "d2"),
  ff("2026-09-04", "d1", { forgotten_item: "" }),
  ff("2026-09-05", "d2"), // a Saturday
  ff("2026-09-08", "d3"), // inactive driver: counted in totals, never charted
  ff("2026-09-09", "", { driver_raw: "ZED ZULU", driver_name: "" }), // a name only
  ff("2026-09-10", "", { driver_name: "", driver_raw: "" }), // nobody
  ff("2026-09-15", "d4"),
  ff("2026-09-16", "d1"),
  ff("2026-09-16", "dX", { driver_name: "Gone Guy" }), // an id with no roster row
  ff("2026-08-30", "d2"), // outside a September window
  ff("2026-10-02", "d1"),
];
const sep = { start: "2026-09-01", end: "2026-09-30", bucket: "day", months: ["2026-09"] };

// ---- parity with v0.20.1 -------------------------------------------------------

function assertParity(records, win, label) {
  const old = legacyPanel({ records, drivers, win });
  const rows = inWindow(records, win);
  assert.deepEqual(rows.map((r) => r.id), old.inPeriod.map((r) => r.id), `${label}: rows`);
  const wd = weekdaySeries(rows);
  assert.deepEqual(wd.map(({ label: l, count }) => ({ label: l, count })), old.weekday, `${label}: weekday`);
  const trend = trendSeries(rows, win);
  const drawn = win.bucket === "day" ? trend.filter((b) => b.count > 0) : trend;
  assert.deepEqual(drawn.map(({ label: l, count }) => ({ label: l, count })), old.trend, `${label}: trend`);
  assert.equal(rows.length, old.total, `${label}: total`);
  assert.equal(busiest(wd)?.label || "—", old.busiest, `${label}: busiest`);
  const per = perActiveDay(rows);
  assert.equal(per.days ? per.value.toFixed(1) : "0", old.avg, `${label}: avg`);
  const top = topDriver(rows, { hidden: hiddenDriverIds(drivers), nameOf });
  assert.equal(top ? `${top.name} (${top.count})` : "—", old.topDriver, `${label}: leader`);
  const bd = byDriver(rows, { hidden: hiddenDriverIds(drivers), nameOf });
  assert.deepEqual(bd.rows, old.byDriver, `${label}: by driver`);
}

test("with no driver picked, the panel draws what v0.20.1 drew", () => {
  assertParity(incidents, sep, "September");
  assertParity(incidents, { start: "2026-08-25", end: "2026-10-10", bucket: "day", months: [] }, "span");
  assertParity(incidents, { start: "2026-07-01", end: "2026-10-31", bucket: "week", months: [] }, "weeks");
  assertParity(
    incidents,
    { start: "2026-08-01", end: "2026-10-31", bucket: "month", months: ["2026-08", "2026-09", "2026-10"] },
    "months",
  );
  assertParity(incidents, { start: "2026-09-06", end: "2026-09-06", bucket: "day", months: [] }, "an empty day");
});

test("parity holds for attempt records too, -1/-2 duplicates folded", () => {
  const feedDays = new Map([
    [
      "2026-09-03",
      {
        status: "ok",
        rows: [
          { date: "2026-09-03", stopNbr: "007171306", shipmentNbr: "ATT007171306", originalDriverName: "Ann Able", currentStatus: "SCHEDULED", businessName: "HOUSE OF HEARTS", zip: "30263" },
          { date: "2026-09-03", stopNbr: "007171306-1", shipmentNbr: "ATT007171306", originalDriverName: "Bo Baker", currentStatus: "UNPLANNED", businessName: "HOUSE OF HEARTS", zip: "30263" },
          { date: "2026-09-03", stopNbr: "007171456", shipmentNbr: "ATT007171456", originalDriverName: "", currentStatus: "DELIVERED", businessName: "FOOD BANK", zip: "30344" },
        ],
      },
    ],
  ]);
  const { records } = buildAttemptRecords({ feedDays, incidents: [], drivers });
  assert.equal(records.length, 2, "the -1 copy is the same order");
  assertParity(records, sep, "attempts");
  // The duplicate is never charged to anyone: the order is the original's driver's.
  const t = attemptTiles({ rows: inWindow(records, sep), win: sep, focus: "d2", hidden: hiddenDriverIds(drivers) });
  assert.equal(t.orders.value, 0);
  assert.equal(attemptTiles({ rows: inWindow(records, sep), win: sep, focus: "d1" }).orders.value, 1);
});

test("rows are filed by incidentDateStr: a report trace lands on its trace date", () => {
  const trace = {
    id: "t1",
    category: "misdelivery",
    pro_number: "007100001",
    driver_id: "d1",
    trace_date: "2026-04-08",
    created_at: "2026-04-17T18:54:14.171Z",
  };
  assert.equal(recordDate(trace), "2026-04-08");
  // v0.20.1 filed it under the day its report was loaded.
  const old = legacyPanel({ records: [trace], drivers, win: { start: "2026-04-17", end: "2026-04-17", bucket: "day", months: [] } });
  assert.equal(old.total, 1);
  assert.equal(inWindow([trace], { start: "2026-04-17", end: "2026-04-17" }).length, 0);
  assert.equal(inWindow([trace], { start: "2026-04-08", end: "2026-04-08" }).length, 1);
  // A manual entry still files under its delivered_date, as before.
  assert.equal(recordDate(incidents[0]), "2026-09-01");
});

// ---- the focus ---------------------------------------------------------------

test("picking a driver re-scopes the counts; the fleet's never move", () => {
  const rows = inWindow(incidents, sep);
  const fleetWd = weekdaySeries(rows);
  const wd = weekdaySeries(rows, "d1");
  assert.deepEqual(wd.map((w) => w.fleet), fleetWd.map((w) => w.count), "fleet totals unchanged");
  for (const w of wd) assert.equal(w.count + w.rest, w.fleet);
  assert.equal(wd.reduce((a, w) => a + w.count, 0), rows.filter((r) => keyOf(r) === "d1").length);
  const tr = trendSeries(rows, sep, { focus: "d1", today: "2026-10-08" });
  assert.equal(tr.reduce((a, b) => a + b.count, 0), 4);
  assert.equal(tr.reduce((a, b) => a + b.fleet, 0), rows.length);
  // Busiest workday is the driver's own.
  assert.equal(busiest(wd).label, "Tue");
  // Clearing the focus restores the fleet view.
  assert.deepEqual(weekdaySeries(rows, null), fleetWd);
});

test("a deactivated driver can't be the focus; any other key can", () => {
  assert.equal(activeFocus("d3", drivers), null);
  assert.equal(activeFocus("d1", drivers), "d1");
  assert.equal(activeFocus("dX", drivers), "dX", "an id with no roster row is never hidden");
  assert.equal(activeFocus("name:ZED ZULU", drivers), "name:ZED ZULU");
  assert.equal(activeFocus("", drivers), null);
});

test("the picker lists every active roster driver plus the period's other names", () => {
  const rows = inWindow(incidents, sep);
  const opts = focusOptions(rows, { drivers, nameOf });
  const keys = opts.map((o) => o.key);
  assert.ok(!keys.includes("d3"), "inactive excluded");
  assert.ok(keys.includes("d5"), "an active driver with nothing this period is still offered");
  assert.equal(opts.find((o) => o.key === "d5").count, 0);
  assert.equal(opts.find((o) => o.key === "name:ZED ZULU").label, "ZED ZULU (feed name)");
  const onEntries = focusOptions(rows, { drivers, nameOf, nameNote: "no roster match" });
  assert.equal(onEntries.find((o) => o.key === "name:ZED ZULU").label, "ZED ZULU (no roster match)");
  assert.equal(opts.find((o) => o.key === "dX").label, "Gone Guy (not on roster)");
  assert.equal(opts.find((o) => o.key === "d4").label, "Di Dunn (loader)");
  assert.equal(keys[keys.length - 1], "unassigned");
  assert.equal(opts.length, 4 + 3, "four active roster drivers, three other keys, no cap");
});

test("by driver hides deactivated drivers and says how many rows that was", () => {
  const rows = inWindow(incidents, sep);
  const bd = byDriver(rows, { hidden: hiddenDriverIds(drivers), nameOf });
  assert.equal(bd.hiddenCount, 1);
  assert.equal(bd.rows.reduce((a, r) => a + r.count, 0) + bd.hiddenCount, rows.length);
  assert.ok(bd.rows.some((r) => r.key === "dX"), "unknown id shown");
  assert.ok(bd.rows.some((r) => r.key === "unassigned"));
});

test("rank leaves out Unassigned, feed names and deactivated drivers, and says ties", () => {
  const rows = inWindow(incidents, sep);
  const hidden = hiddenDriverIds(drivers);
  // d1: 4, d2: 2, d4: 1, dX: 1 — d3 (inactive), ZED ZULU and nobody don't rank.
  assert.deepEqual(focusRank(rows, null, { hidden }), { drivers: 4 });
  assert.deepEqual(focusRank(rows, "d1", { hidden }), { drivers: 4, rank: 1, tied: false, of: 4, count: 4 });
  assert.deepEqual(focusRank(rows, "d4", { hidden }), { drivers: 4, rank: 3, tied: true, of: 4, count: 1 });
  assert.equal(focusRank(rows, "unassigned", { hidden }).reason, "unassigned");
  assert.equal(focusRank(rows, "name:ZED ZULU", { hidden }).reason, "unmatched");
  assert.equal(focusRank(rows, "d5", { hidden }).reason, "none");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), [
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st",
  ]);
});

test("the fleet mean counts only the active roster in the role group", () => {
  const rows = inWindow(incidents, sep);
  // Drivers group: d1, d2, d5 active (d3 inactive, d4 a loader). Their rows: 4 + 2 + 0.
  assert.deepEqual(fleetMean(rows, { drivers, group: "driver" }), { mean: 2, peers: 3, counted: 6 });
  assert.deepEqual(fleetMean(rows, { drivers, group: "loader" }), { mean: 1, peers: 1, counted: 1 });
  assert.equal(fleetMean(rows, { drivers: [] }), null);
});

// ---- charts and chips ------------------------------------------------------------

test("day buckets are zero-filled up to today, never into the future", () => {
  const rows = inWindow(incidents, sep);
  const tr = trendSeries(rows, sep, { today: "2026-09-20" });
  assert.equal(tr.length, 20);
  assert.equal(tr[0].key, "2026-09-01");
  assert.equal(tr[tr.length - 1].key, "2026-09-20");
  assert.equal(tr.find((b) => b.key === "2026-09-03").count, 0);
  assert.equal(trendSeries(rows, sep, { today: "2026-10-08" }).length, 30);
});

test("a feed day with no data is a gap, never a zero", () => {
  const status = { "2026-09-02": "no_manifest", "2026-09-08": "fetch_not_ok", "2026-09-29": "not_loaded" };
  const statusOf = (d) => status[d] || "ok";
  const tr = trendSeries([], sep, { today: "2026-10-08", statusOf });
  assert.equal(tr.find((b) => b.key === "2026-09-02").gap, "no_manifest");
  assert.equal(tr.find((b) => b.key === "2026-09-08").gap, "fetch_not_ok");
  assert.equal(tr.find((b) => b.key === "2026-09-01").gap, null);
  const weeks = trendSeries([], { start: "2026-09-01", end: "2026-09-30", bucket: "week" }, { today: "2026-10-08", statusOf });
  assert.equal(weeks[0].gapDays, 1, "the week of 08/31 has 09/02");
  assert.equal(weeks[0].start, "2026-09-01", "a week clipped to the window");
  assert.equal(weeks[1].gapDays, 1);
  assert.equal(weeks[1].unloaded, 0);
  assert.equal(weeks[4].key, "2026-09-28");
  assert.equal(weeks[4].unloaded, 1, "a day nobody has asked the feed for yet");
});

test("a week or month says what its column can't show", () => {
  // Months on a 6M window: May before the feed, July not loaded, Aug partly loaded,
  // Sep with one night the scan never ran.
  const statusOf = (d) =>
    d < "2026-06-25" ? "before_feed" : d < "2026-08-01" ? "not_loaded" : d < "2026-08-10" ? "not_loaded" : d === "2026-09-02" ? "no_manifest" : "ok";
  const win = { start: "2026-05-01", end: "2026-09-30", bucket: "month", months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] };
  const [may, jun, jul, aug, sepB] = trendSeries([], win, { today: "2026-10-08", statusOf });
  assert.deepEqual([may.beforeFeed, may.days], [31, 31]);
  assert.equal(bucketGap(may).short, "hand-logged only", "before the feed: not a zero");
  assert.equal(bucketGap(may).empty, true);
  assert.equal(bucketGap(jun).short, "hand-logged only", "before the feed, then not loaded: still no feed data at all");
  assert.match(bucketGap(jun).note, /6 not loaded yet, 24 before the feed started/);
  assert.equal(bucketGap(jul).short, "hand-logged only", "nothing loaded is not 'part not loaded'");
  assert.equal(bucketGap(aug).short, "part not loaded");
  assert.equal(bucketGap(aug).empty, false);
  assert.equal(bucketGap(sepB).short, null, "one night with no scan is said in the hover, not on the column");
  assert.match(bucketGap(sepB).note, /^1 of 30 days without feed data/);
  // A day is its own status; a fully loaded bucket has nothing to say.
  const days = trendSeries([], sep, { today: "2026-10-08", statusOf });
  assert.equal(bucketGap(days.find((b) => b.key === "2026-09-02")).short, "no scan");
  assert.equal(bucketGap(days.find((b) => b.key === "2026-09-03")), null);
  // Partly before the feed, the rest loaded.
  const late = trendSeries([], { ...win, start: "2026-06-01", end: "2026-06-30", months: ["2026-06"] }, {
    today: "2026-10-08",
    statusOf: (d) => (d < "2026-06-25" ? "before_feed" : "ok"),
  });
  assert.equal(bucketGap(late[0]).short, "part before feed");
});

test("a printout narrowed on screen says by what, and how much of the period it is", () => {
  assert.equal(printPeriodLabel("Last 30 Days"), "Last 30 Days");
  assert.equal(printPeriodLabel("Last 30 Days", { narrowing: [null, ""], shown: 10, of: 10 }), "Last 30 Days");
  assert.equal(
    printPeriodLabel("Last 30 Days", { narrowing: ["Tuesdays"], shown: 6, of: 10 }),
    "Last 30 Days · Tuesdays only (6 of 10)",
  );
  assert.equal(
    printPeriodLabel("Last 30 Days", { narrowing: ["Tuesdays", "matching “acme”"] }),
    "Last 30 Days · Tuesdays, matching “acme” only",
  );
  const long = printPeriodLabel("This Month", { narrowing: ["x".repeat(80)], shown: 1, of: 2 });
  assert.ok(long.length < 90 && long.includes("…") && long.endsWith("(1 of 2)"));
});

test("a name on an entry that is a roster driver's is 'not linked', not 'no roster match'", () => {
  const rows = [ff("2026-09-03", "", { driver_name: "", driver_raw: "BO BAKER" }), ff("2026-09-03", "", { driver_raw: "ZED ZULU", driver_name: "" })];
  const opts = focusOptions(rows, { drivers, nameOf, nameNote: "no roster match" });
  const bo = opts.find((o) => o.key === "name:BO BAKER");
  assert.equal(bo.label, "BO BAKER (not linked to the roster)");
  assert.equal(bo.linked, true);
  assert.equal(opts.find((o) => o.key === "d2").label, "Bo Baker", "the roster driver is a separate option");
  assert.equal(opts.find((o) => o.key === "name:ZED ZULU").label, "ZED ZULU (no roster match)");
});

test("a click on any bar narrows the list to exactly that bar's count", () => {
  const rows = inWindow(incidents, sep);
  for (const focus of [null, "d1", "unassigned"]) {
    const F = focus ? rows.filter((r) => keyOf(r) === focus) : rows;
    for (const b of trendSeries(rows, sep, { focus, today: "2026-10-08" })) {
      assert.equal(applyChips(F, { bucket: b }).length, b.count, `${focus} ${b.key}`);
    }
    for (const w of weekdaySeries(rows, focus)) {
      assert.equal(applyChips(F, { weekday: w }).length, w.count, `${focus} ${w.label}`);
    }
    for (const c of classBreakdown(F, "forgotten_item")) {
      assert.equal(applyChips(F, { cls: c }, { classifyField: "forgotten_item" }).length, c.count);
    }
  }
  const weeks = { start: "2026-07-01", end: "2026-10-31", bucket: "week" };
  const wrows = inWindow(incidents, weeks);
  for (const b of trendSeries(wrows, weeks)) assert.equal(applyChips(wrows, { bucket: b }).length, b.count);
});

test("the classification tally puts Not set last", () => {
  const rows = inWindow(incidents, sep);
  const c = classBreakdown(rows, "forgotten_item");
  assert.deepEqual(c.map((x) => [x.label, x.count]), [["Skid", 9], ["Box", 1], ["Not set", 1]]);
  assert.equal(c[2].key, NOT_SET);
  assert.deepEqual(classBreakdown(rows, null), []);
});

// ---- attempts ----------------------------------------------------------------------

const att = (date, key, extra = {}) => {
  const d = drivers.find((x) => x.id === key);
  return {
    id: `feed:${date}:${++seq}`,
    pro_number: `ATT00${7170000 + seq}`,
    pro: `00${7170000 + seq}`,
    date,
    delivered_date: date,
    driver_id: d ? d.id : null,
    driver_name: d ? d.name : key.startsWith("name:") ? key.slice(5) : "",
    key: d ? d.id : key,
    customer: "ACME",
    customerKey: "ACME|30301",
    outcome: "delivered",
    from_feed: true,
    order: { stopNbr: `00${7170000 + seq}`, shipmentNbr: `ATT00${7170000 + seq}`, businessName: "ACME", zip: "30301" },
    ...extra,
  };
};
const attempts = [
  att("2026-09-01", "d1", { outcome: "unplanned" }),
  att("2026-09-01", "d2", { customerKey: "ZETA|30302", customer: "ZETA", outcome: "rescheduled" }),
  att("2026-09-04", "d1", { customerKey: "ZETA|30302", customer: "ZETA" }),
  att("2026-09-04", "d1", { outcome: "other" }),
  att("2026-09-11", "unassigned", { customerKey: "BETA|30303", customer: "BETA", outcome: "unplanned" }),
  att("2026-09-11", "name:ZED ZULU", { customerKey: "BETA|30303", customer: "BETA" }),
  att("2026-09-12", "d3"), // inactive
  { ...att("2026-09-15", "d2", { from_feed: false, outcome: null, attributedBy: "hand" }), id: "hand1", order: null },
];

test("every Attempts tile opens a drill-down that counts exactly the tile", () => {
  const rows = inWindow(attempts, sep);
  const ctx = { attemptRecords: attempts };
  for (const focus of [null, "d1", "d2", "unassigned", "name:ZED ZULU"]) {
    const t = attemptTiles({ rows, win: sep, focus, hidden: hiddenDriverIds(drivers) });
    for (const name of ["orders", "rank", "busiest", "perDay", "repeat", "open"]) {
      const tile = t[name];
      if (!tile) continue;
      assert.equal(resolveDrill(tile.drill, ctx).total, tile.expected, `${focus} ${name}`);
    }
  }
  const t = attemptTiles({ rows, win: sep, focus: "d1" });
  assert.equal(t.orders.value, 3);
  assert.equal(t.orders.fleet, 8);
  assert.equal(t.busiest.label, "Fri");
  assert.equal(t.busiest.count, 2);
  assert.equal(t.perDay.days, 2);
  assert.equal(t.repeat.value, 2, "ACME twice in d1's own orders");
  assert.equal(t.open.value, 1);
  // No focus: the last tile is the Unassigned orders.
  assert.equal(attemptTiles({ rows, win: sep }).open.value, 1);
  // The drawer's by-driver list is keyed like the bars, so Unassigned and feed names show.
  const d = resolveDrill({ kind: "attempts", start: sep.start, end: sep.end }, ctx);
  assert.equal(d.byDriver.get("unassigned").count, 1);
  assert.equal(d.byDriver.get("name:ZED ZULU").count, 1);
});

test("an incident tab's Driver detail lists exactly the tile's entries", () => {
  const rows = inWindow(incidents, sep);
  for (const focus of [null, "d1", "dX", "name:ZED ZULU", "unassigned"]) {
    const { spec, expected } = entriesDrill(rows, focus, { category: "forgotten_freight", label: "x" });
    assert.equal(resolveDrill(spec, { incidents }).total, expected, String(focus));
  }
  assert.equal(entriesDrill(rows, "d1", { category: "forgotten_freight" }).spec.driverId, "d1");
});

test("outcomes: shares add to 100 and hand-logged rows are counted apart", () => {
  const m = outcomeMix(inWindow(attempts, sep));
  assert.equal(m.scanned, 7);
  assert.equal(m.unscanned, 1);
  assert.deepEqual(m.parts.map((p) => p.count), [3, 1, 2, 1]);
  assert.equal(m.parts.reduce((a, p) => a + p.pct, 0), 100);
  assert.deepEqual(wholePercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(wholePercents([0, 0]), [0, 0]);
  assert.deepEqual(wholePercents([2, 0, 1]), [67, 0, 33]);
});

test("attempt filters: weekday, outcome, repeat, customer", () => {
  const rows = inWindow(attempts, sep);
  assert.equal(filterAttempts(rows, { weekday: 5 }).length, 4); // 09/04 and 09/11 are Fridays
  assert.equal(filterAttempts(rows, { outcomes: ["unplanned"] }).length, 2);
  assert.equal(filterAttempts(rows, { repeat: true }).length, repeatCustomerRows(rows).length);
  assert.equal(filterAttempts(rows, { customer: "BETA|30303" }).length, 2);
  assert.equal(filterAttempts(rows, null).length, rows.length);
  // A repeat is found in the pool the tile counted, not in what's left after narrowing:
  // Unassigned's one BETA order is a repeat of ZED ZULU's.
  const un = rows.filter((r) => keyOf(r) === "unassigned");
  assert.equal(filterAttempts(un, { repeat: true }).length, 0, "on its own, nothing repeats");
  assert.equal(filterAttempts(un, { repeat: true }, { pool: rows }).length, 1);
});

test("a customer pattern needs two drivers within 30 days; Unassigned names nobody", () => {
  const recs = [
    att("2026-08-01", "d1", { customerKey: "K|1" }),
    att("2026-09-15", "d2", { customerKey: "K|1" }), // 45 days later: not a pattern
    att("2026-09-20", "d1", { customerKey: "K|1" }), // d2 five days earlier: a pattern
    att("2026-09-21", "unassigned", { customerKey: "U|1" }),
    att("2026-09-22", "d1", { customerKey: "U|1" }),
  ];
  const p = customerPatterns(recs);
  assert.equal(p.get(recs[0].id), undefined);
  assert.equal(p.get(recs[1].id), undefined);
  assert.equal(p.get(recs[2].id), 2);
  assert.equal(p.get(recs[4].id), undefined);
});

test("an order is also Late when a Late incident carries its base PRO", () => {
  const idx = lateByPro([
    { id: "L1", category: "late", pro_number: "7171306" },
    { id: "D1", category: "damage", pro_number: "007171306" },
  ]);
  assert.deepEqual(idx.get("007171306").map((i) => i.id), ["L1"]);
});

test("the unassigned queue ages from today and sorts oldest first", () => {
  assert.equal(ageDays("2026-10-08", "2026-10-08"), 0);
  assert.equal(ageDays("2026-09-30", "2026-10-08"), 8);
  assert.equal(ageDays("2026-02-28", "2026-03-01"), 1);
  assert.equal(dayDiff("2024-02-28", "2024-03-01"), 2, "leap year");
  const row = (date, pro_number) => ({ date, delivered_date: date, pro_number });
  const q = sortQueue([row("2026-09-10", "2"), row("2026-09-01", "1"), row("2026-09-10", "1")]);
  assert.deepEqual(q.map((r) => `${r.date}/${r.pro_number}`), ["2026-09-01/1", "2026-09-10/1", "2026-09-10/2"]);
  assert.equal(sortQueue(q, "newest")[0].date, "2026-09-10");
});

test("Δ compares like with like or says why it can't", () => {
  const win = { start: "2026-09-21", end: "2026-09-27", bucket: "day", months: [] };
  const ok = () => "ok";
  const recs = [att("2026-09-21", "d1"), att("2026-09-22", "d1"), att("2026-09-15", "d1"), att("2026-09-16", "d2")];
  const d = priorDelta(recs, win, { today: "2026-10-08", statusOf: ok });
  assert.deepEqual(d, { delta: 0, current: 2, previous: 2, days: 7, throughYesterday: false });
  assert.equal(priorDelta(recs, win, { focus: "d1", today: "2026-10-08", statusOf: ok }).delta, 1);
  const gap = priorDelta(recs, win, { today: "2026-10-08", statusOf: (x) => (x === "2026-09-16" ? "no_manifest" : "ok") });
  assert.deepEqual(gap, { delta: null, reason: "no_data", days: 7 });
  const notLoaded = priorDelta(recs, win, { today: "2026-10-08", statusOf: (x) => (x < "2026-09-18" ? "not_loaded" : "ok") });
  assert.equal(notLoaded.reason, "not_loaded");
  const early = priorDelta(recs, { start: "2026-06-26", end: "2026-07-02" }, { today: "2026-10-08", statusOf: (x) => (x < FEED_EPOCH ? "before_feed" : "ok") });
  assert.equal(early.reason, "before_feed");
  // A window running to today, before its 8 PM scan, compares through yesterday.
  const live = priorDelta(recs, { start: "2026-10-02", end: "2026-10-08" }, { today: "2026-10-08", statusOf: (x) => (x === "2026-10-08" ? "pending" : "ok") });
  assert.equal(live.throughYesterday, true);
  assert.equal(live.days, 6);
});

test("the feed loads the 45 most recent days first, then 45 more at a time", () => {
  const today = "2026-10-08";
  const thirty = { start: "2026-09-09", end: "2026-10-08" };
  assert.deepEqual(feedLoadPlan(thirty, { today, epoch: FEED_EPOCH }), {
    start: "2026-09-09",
    end: "2026-10-08",
    chunks: [["2026-09-09", "2026-10-08"]],
    more: true,
  });
  // One more chunk reaches 45 days before the window, for the comparison.
  const more = feedLoadPlan(thirty, { today, epoch: FEED_EPOCH, extra: 1 });
  assert.equal(more.start, "2026-07-26");
  assert.deepEqual(more.chunks, [["2026-08-25", "2026-10-08"], ["2026-07-26", "2026-08-24"]]);
  const q = { start: "2026-08-01", end: "2026-10-31" };
  const p0 = feedLoadPlan(q, { today, epoch: FEED_EPOCH });
  assert.equal(p0.start, "2026-08-25", "45 days ending today");
  for (const [s, e] of feedLoadPlan(q, { today, epoch: FEED_EPOCH, extra: 3 }).chunks) {
    assert.ok(dayDiff(s, e) + 1 <= 45, "each request within the feed's cap");
  }
  const toEpoch = feedLoadPlan(q, { today, epoch: FEED_EPOCH, extra: 9 });
  assert.equal(toEpoch.start, FEED_EPOCH);
  assert.equal(toEpoch.more, false);
  assert.equal(feedLoadPlan({ start: "2026-05-01", end: "2026-05-31" }, { today, epoch: FEED_EPOCH }).chunks.length, 0);
});

test("the order table searches and sorts", () => {
  const rows = inWindow(attempts, sep);
  assert.equal(searchOrders(rows, "zeta").length, 2);
  assert.equal(searchOrders(rows, "").length, rows.length);
  assert.equal(searchOrders(rows, "30303").length, 0, "the zip on these fixtures sits on the order");
  const byDate = sortOrders(rows, { key: "date", dir: "asc" });
  assert.equal(byDate[0].date, "2026-09-01");
  const byStatus = sortOrders(rows, { key: "status", dir: "asc" });
  assert.equal(byStatus[0].outcome, "delivered");
  assert.equal(byStatus[byStatus.length - 1].outcome, null, "hand-logged rows have no scan status");
});

test("sparklines: twelve months from the blend, weeks from the feed", () => {
  const s = monthSpark({ endYm: "2026-02", cellOf: (ym) => (ym === "2025-12" ? 3 : 0), sourceOf: (ym) => (ym >= "2026-01" ? "live" : "history") });
  assert.equal(s.length, 12);
  assert.equal(s[0].ym, "2025-03");
  assert.equal(s[9].n, 3);
  assert.equal(s[11].source, "live");
  const live = liveMonthCounts(incidents);
  assert.equal(live.get("2026-09"), 11);
  const w = weekSpark(attempts, { start: "2026-09-01", end: "2026-09-16", statusOf: (d) => (d === "2026-09-08" ? "fetch_not_ok" : "ok") });
  assert.deepEqual(w.map((x) => [x.key, x.n, x.partial]), [
    ["2026-08-31", 4, true],
    ["2026-09-07", 3, true],
    ["2026-09-14", 1, true],
  ]);
  assert.equal(addDays("2026-09-14", 2), "2026-09-16");
});

test("a driver-card month that never captured the category draws no bar", () => {
  // A stand-in blend: Jan 2026 is live with FF back-dated into it, Feb is history
  // holding damage only, Apr is live with no FF logged, Jul is live after logging began.
  const blend = {
    monthSource: (ym) => ({ "2026-01": "live", "2026-02": "history", "2026-04": "live", "2026-07": "live" })[ym] || "none",
    historyCategories: (ym) => new Set(ym === "2026-02" ? ["damage"] : []),
    companyCell: (ym, cat) => (ym === "2026-01" && cat === "forgotten_freight" ? 19 : 0),
  };
  const src = (ym) => sparkSource(blend, ym, "forgotten_freight");
  assert.equal(src("2026-01"), "live", "back-dated entries are counted, as the Scorecard counts them");
  assert.equal(src("2026-02"), "not_tracked", "history that holds none of it");
  assert.equal(src("2026-04"), "not_tracked", "a live month before logging began, with none logged");
  assert.equal(src("2026-07"), "live", "after logging began, none is a real zero");
  assert.equal(src("2026-03"), "none");
  assert.equal(sparkSource(blend, "2026-02", "damage"), "history");
  const s = monthSpark({ endYm: "2026-07", months: 7, cellOf: () => 0, sourceOf: src });
  assert.deepEqual(s.map((m) => m.n), [0, null, null, null, null, null, 0]);
});

test("the default window is the one the panel and the log share", () => {
  const w = periodWindow("30d");
  assert.equal(w.bucket, "day");
  assert.ok(w.start < w.end);
});
