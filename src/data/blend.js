// The one live/history blend. Every screen that counts by month reads it from here.
//
// Live incidents serve the recent months; older months, whose incidents were rolled up
// and purged, come from dds_history. The rule is decided per CELL — one category in
// one month: a cell is served by live incidents or by history, never both ("live
// supersedes"), because counting both would double every incident in a month that has
// been partly rolled up. Which cells are live is decided once, here, with
// countsTowardCharts (liveHistoryBlend.js): a cell is live when that category holds at
// least one live incident that actually counts that month. It is decided for the
// company — anyone's counted row makes the cell live for every driver — and never per
// driver, which would put one driver's live count beside another's stale rollup inside
// the same cell.
//
// Until v0.21.1 the rule was per MONTH: one counted row in any category hid the whole
// month's history. Jan 2026 holds 19 forgotten freight entries back-dated in August, and
// they hid the month's imported damage (9), lost/missing (6) and misdelivery (2), so the
// month read 19 instead of 36. Per cell, its forgotten freight is still the 19 live
// entries (history's 28 is flagged as a conflict) and the other three come back from
// history. It also settles the shape liveHistoryBlend.js warns about: a month whose only
// counting rows are compliments makes only its compliment cell live.
//
// The Scorecard, Trends and the Reports analytics each carried an inline copy of the
// rule and they had drifted: Trends and Reports qualified months on six categories, the
// Scorecard on eight. They all qualify on COUNTED8 now — the Scorecard's set, and the
// set the history rollup writes — so a cell is live or history on every screen alike.
//
// Driver-fault scope. History has no fault field, so a history cell can't be split by
// fault. Which cells are live never depends on the filter (a live cell with no
// driver-fault rows reads 0, not its all-fault history); inside a live cell only
// driver-fault rows count. For the cells live entries don't cover, two rules exist:
//   (default)          they are "not tracked" and count nothing — the app's rule
//                      from v0.22.0
//   legacyDriverScope  (the Scorecard until v0.22.0) they read their all-fault
//                      history, as the all-fault view does — beside live cells counting
//                      driver fault only. Kept so the tests can measure the change
//                      against it; nothing on screen builds it.
// Whichever rule a blend is built with, its cells, its drill-downs (drill.js) and the
// leaderboards built from it all follow it, so they can never disagree with each other.
import { countsTowardCharts } from "./liveHistoryBlend.js";
import { incidentYm } from "./incidentDate.js";
import { COUNTED8 } from "./categories.js";

const pad2 = (n) => String(n).padStart(2, "0");

// "YYYY-MM" for a history record, or "" when it has no usable year/month.
export function historyYm(rec) {
  const y = Number(rec?.year);
  const m = Number(rec?.month);
  return y && m >= 1 && m <= 12 ? `${y}-${pad2(m)}` : "";
}

const bump = (map, key, n) => map.set(key, (map.get(key) || 0) + n);
const inner = (map, key) => map.get(key) || map.set(key, new Map()).get(key);

// incidents          every live incident (the blend picks the ones that count)
// history            dds_history records: { year, month, driver_id, driver_name, category, count }
// qualifyIds         the categories that count (and so decide which cells are live)
// faultFilter        null, or "driver" for Driver-fault scope
// legacyDriverScope  under Driver-fault scope, history still serves the cells live
//                    entries don't (above; the rule before v0.22.0)
export function buildBlend({
  incidents = [],
  history = [],
  qualifyIds = COUNTED8,
  faultFilter = null,
  legacyDriverScope = false,
} = {}) {
  const fault = faultFilter === "driver" ? "driver" : null;
  // Under the newer driver-fault rule history can't answer, so it serves nothing.
  const historyServed = !fault || legacyDriverScope;

  // Which cells are live, and what each holds without the fault filter. `allFault` is
  // what the history rollup would hold for a cell, so a conflict is always measured like
  // for like.
  const liveCats = new Map(); // ym -> Set(cat)
  const allFault = new Map(); // ym -> Map(cat -> n)
  const allFaultCells = new Map(); // ym -> Map("driver|cat" -> n)
  for (const inc of incidents) {
    if (!countsTowardCharts(inc, { categoryIds: qualifyIds })) continue;
    const ym = incidentYm(inc);
    if (!ym) continue;
    (liveCats.get(ym) || liveCats.set(ym, new Set()).get(ym)).add(inc.category);
    bump(inner(allFault, ym), inc.category, 1);
    bump(inner(allFaultCells, ym), `${inc.driver_id}|${inc.category}`, 1);
  }

  // One category in one month is live: at least one of its live rows counts.
  const isLive = (ym, cat) => !!liveCats.get(ym)?.has(cat);

  // The rows each live cell counts under the fault filter, filed by month, and the
  // cells they make. Every row that counts under the filter counts without it too, so
  // it always lands in a live cell.
  const liveByYm = {};
  for (const ym of liveCats.keys()) liveByYm[ym] = [];
  const liveCells = new Map(); // ym -> Map("driver|cat" -> n)
  const liveCompany = new Map(); // ym -> Map(cat -> n)
  for (const inc of incidents) {
    if (!countsTowardCharts(inc, { categoryIds: qualifyIds, faultFilter: fault })) continue;
    const ym = incidentYm(inc);
    if (!isLive(ym, inc.category)) continue;
    liveByYm[ym].push(inc);
    bump(inner(liveCells, ym), `${inc.driver_id}|${inc.category}`, 1);
    bump(inner(liveCompany, ym), inc.category, 1);
  }

  // History, indexed once. Records without a driver_id count toward the company total
  // (the Reports analytics always added them) but belong to no driver. The rollup and the
  // import never write one; this only keeps hand-made data from vanishing.
  const histCells = new Map(); // ym -> Map("driver|cat" -> n), attributed records only
  const histCompany = new Map(); // ym -> Map(cat -> n), every record
  const histCats = new Map(); // ym -> { attributed: Set(cat), all: Set(cat) }
  for (const rec of history) {
    const ym = historyYm(rec);
    if (!ym || !rec.category) continue;
    const n = Number(rec.count) || 0;
    const cats = histCats.get(ym) || histCats.set(ym, { attributed: new Set(), all: new Set() }).get(ym);
    cats.all.add(rec.category);
    bump(inner(histCompany, ym), rec.category, n);
    if (!rec.driver_id) continue;
    cats.attributed.add(rec.category);
    bump(inner(histCells, ym), `${rec.driver_id}|${rec.category}`, n);
  }

  const hasHistory = (ym) => histCats.has(ym);

  // Where one cell's numbers come from: "live", "history", "not_tracked" (a history cell
  // under the newer driver-fault rule) or "none" (nothing on record either way).
  const cellSource = (ym, cat) => {
    if (isLive(ym, cat)) return "live";
    if (!histCats.get(ym)?.all.has(cat)) return "none";
    return historyServed ? "history" : "not_tracked";
  };

  // A month's categories by where they come from: { live, history, not_tracked }, each a
  // list of ids in the order given. A category with nothing on record is in none of them.
  const monthCells = (ym, categoryIds = qualifyIds) => {
    const out = { live: [], history: [], not_tracked: [] };
    for (const cat of categoryIds) {
      const src = cellSource(ym, cat);
      if (src !== "none") out[src].push(cat);
    }
    return out;
  };

  // Where a month's numbers come from, over a set of categories: "live", "history",
  // "not_tracked", "mixed" (some categories live and the rest not — Jan 2026) or "none".
  // A category with nothing on record that month is an empty cell, and it reads as the
  // cells around it: where history serves some of the month, an empty cell is history's
  // too (Jan 2026's late: nobody logged one, and the imported history doesn't hold it,
  // so it is no live zero); where every cell on record is live, a category nobody logged
  // is a live zero.
  const monthSource = (ym, categoryIds = qualifyIds) => {
    const c = monthCells(ym, categoryIds);
    if (c.live.length) return c.history.length || c.not_tracked.length ? "mixed" : "live";
    if (c.history.length) return "history";
    if (c.not_tracked.length) return "not_tracked";
    const month = monthCells(ym);
    if (month.history.length || month.not_tracked.length) return historyServed ? "history" : "not_tracked";
    if (liveCats.has(ym)) return "live";
    if (!histCats.has(ym)) return "none";
    return historyServed ? "history" : "not_tracked";
  };

  // Every attributed "driver|cat" -> n a month serves: live rows for its live cells,
  // history for the rest. Built once per month; the leaderboards ask for the same months
  // again and again.
  const served = new Map();
  const servedCells = (ym) => {
    if (served.has(ym)) return served.get(ym);
    const out = new Map(liveCells.get(ym) || []);
    if (historyServed) {
      for (const [k, n] of histCells.get(ym) || []) {
        if (!isLive(ym, k.slice(k.lastIndexOf("|") + 1))) out.set(k, n);
      }
    }
    served.set(ym, out);
    return out;
  };

  // One driver's count for a category in a month, from whichever source serves the cell.
  const cell = (ym, driverId, cat) => servedCells(ym).get(`${driverId}|${cat}`) || 0;

  // The company's count for a category in a month: every driver, and in a history cell
  // the unattributed records too.
  const companyCell = (ym, cat) => {
    if (isLive(ym, cat)) return liveCompany.get(ym)?.get(cat) || 0;
    return historyServed ? histCompany.get(ym)?.get(cat) || 0 : 0;
  };

  // The two sides of one company cell, whichever of them serves it: the live rows that
  // count there with the fault filter off (what the rollup would hold) and what history
  // holds. Data Coverage shows both beside the number served (coverage.js).
  const liveCount = (ym, cat) => allFault.get(ym)?.get(cat) || 0;
  const historyCount = (ym, cat) => histCompany.get(ym)?.get(cat) || 0;

  // Every attributed (driver, category, count) the month serves, zeros included where a
  // history record holds one.
  const entries = (ym) =>
    [...servedCells(ym)].map(([k, n]) => {
      const i = k.lastIndexOf("|");
      return { driverId: k.slice(0, i), category: k.slice(i + 1), n };
    });

  const driverIds = (ym) => new Set(entries(ym).filter((e) => e.n > 0).map((e) => e.driverId));

  // Categories a history month holds records for (attributed only, or every record),
  // whether or not live entries serve them.
  const historyCategories = (ym, { attributedOnly = true } = {}) => {
    const c = histCats.get(ym);
    return c ? (attributedOnly ? c.attributed : c.all) : new Set();
  };

  // Live and history disagree for a cell: it is live, history holds a count for it, and
  // the two differ — in either direction. The live number is shown; this is how a screen
  // says the other one exists (Jan 2026 FF: live 19, history 28, from forgotten freight
  // back-dated into a month the spreadsheet already covered). A cell with no live
  // entries is history's own, so it has nothing to disagree with.
  const liveMonths = [...liveCats.keys()].sort();
  const conflicts = [];
  for (const ym of liveMonths) {
    for (const [category, h] of histCompany.get(ym) || []) {
      if (!isLive(ym, category) || h <= 0) continue;
      const l = allFault.get(ym).get(category);
      if (l !== h) conflicts.push({ ym, category, live: l, history: h });
    }
  }

  // The same comparison for one driver, in the cells that are live: their live count
  // against their own history.
  const driverConflicts = (driverId) => {
    const out = [];
    for (const ym of liveMonths) {
      for (const [k, h] of histCells.get(ym) || []) {
        const i = k.lastIndexOf("|");
        const category = k.slice(i + 1);
        if (k.slice(0, i) !== driverId || !isLive(ym, category) || h <= 0) continue;
        const l = allFaultCells.get(ym)?.get(k) || 0;
        if (l !== h) out.push({ ym, category, live: l, history: h });
      }
    }
    return out;
  };

  const months = [...new Set([...liveCats.keys(), ...histCats.keys()])].sort();

  return {
    faultFilter: fault,
    legacyDriverScope: !!legacyDriverScope,
    qualifyIds,
    historyServed,
    liveByYm,
    isLive,
    hasHistory,
    cellSource,
    monthCells,
    monthSource,
    cell,
    companyCell,
    liveCount,
    historyCount,
    entries,
    driverIds,
    historyCategories,
    conflicts,
    driverConflicts,
    months,
  };
}

// How a month's source reads on screen. "mixed" is a month whose categories don't all
// come from the same place — Jan 2026: forgotten freight live, the rest from history.
const SOURCE_LABELS = {
  live: "live",
  history: "history",
  mixed: "live + history",
  not_tracked: "not tracked",
  none: "none",
};
export const sourceLabel = (src) => SOURCE_LABELS[src] || String(src || "");

// Per-driver counts over a set of months: Map(driverId -> Map(category -> n)). This is
// what every leaderboard, roster card and per-driver chart is built from, and what
// drill.js reproduces for any one of its cells.
export function tally(blend, months, categoryIds) {
  const want = new Set(categoryIds);
  const out = new Map();
  for (const ym of new Set(months)) {
    for (const { driverId, category, n } of blend.entries(ym)) {
      if (!want.has(category)) continue;
      bump(inner(out, driverId), category, n);
    }
  }
  return out;
}

// A sum over a tally row (or the whole tally when driverId is null).
export function tallyTotal(t, { driverId = null, categoryIds = null } = {}) {
  let n = 0;
  for (const [id, cats] of t) {
    if (driverId !== null && id !== driverId) continue;
    for (const [cat, v] of cats) if (!categoryIds || categoryIds.includes(cat)) n += v;
  }
  return n;
}

// One row per driver over named sets of months — the Scorecard's month / period / YTD:
//   [{ driver: { id, name, role, active }, [bucket]: { category: n } }]
// Every roster driver gets a row (zeros included, as the charts zero-fill), and so does
// every id the blend serves in those months: an id with no roster row is named from the
// data and shown, never dropped.
export function driverBuckets({ blend, drivers = [], buckets = {}, categoryIds, nameOf = (id) => id }) {
  const names = Object.keys(buckets);
  const blank = () => Object.fromEntries(categoryIds.map((c) => [c, 0]));
  const rows = new Map();
  const row = (driver) => {
    const r = { driver };
    for (const b of names) r[b] = blank();
    rows.set(driver.id, r);
    return r;
  };
  for (const d of drivers) row(d);
  const all = new Set(names.flatMap((b) => buckets[b]));
  for (const id of tally(blend, all, categoryIds).keys()) {
    if (!rows.has(id)) row({ id, name: nameOf(id) || "(unknown)", role: "driver" });
  }
  for (const b of names) {
    for (const [id, cats] of tally(blend, buckets[b], categoryIds)) {
      const r = rows.get(id);
      for (const [cat, n] of cats) r[b][cat] = (r[b][cat] || 0) + n;
    }
  }
  return [...rows.values()];
}

// The blend as month cells for one category set, the shape Trends charts from:
//   { cells: { ym: Map("driver|cat" -> n) }, sourceByYm: { ym: "live" | "history" | "mixed" } }
// A month's source is over these categories only (monthSource). A month is in it when
// it has live entries, or when its history holds an attributed record in one of the
// categories — a month that only ever tracked something else is a gap.
export function blendCube(blend, categoryIds) {
  const want = new Set(categoryIds);
  const cells = {};
  const sourceByYm = {};
  for (const ym of blend.months) {
    const src = blend.monthSource(ym, categoryIds);
    if (src === "history" && ![...blend.historyCategories(ym)].some((c) => want.has(c))) continue;
    if (src !== "live" && src !== "history" && src !== "mixed") continue;
    const cell = new Map();
    for (const { driverId, category, n } of blend.entries(ym)) {
      if (!want.has(category)) continue;
      const k = `${driverId}|${category}`;
      cell.set(k, (cell.get(k) || 0) + n);
    }
    cells[ym] = cell;
    sourceByYm[ym] = src;
  }
  return { cells, sourceByYm };
}
