// The one live/history blend. Every screen that counts by month reads it from here.
//
// Live incidents serve the recent months; older months, whose incidents were rolled up
// and purged, come from dds_history. A month is served by one or the other, never both
// ("live supersedes"), because counting both would double every incident in a month
// that has been partly rolled up. Which months are live is decided once, here, with
// countsTowardCharts (liveHistoryBlend.js): a month is live when it holds at least one
// live incident that actually counts.
//
// The Scorecard, Trends and the Reports analytics each carried an inline copy of this
// and they had drifted: Trends and Reports qualified months on six categories, the
// Scorecard on eight. They all qualify on COUNTED8 now — the Scorecard's rule, and the
// set the history rollup writes — so a month is live or history on every screen alike.
// That includes the case liveHistoryBlend.js warns about: a month whose only counting
// rows are compliments is live, exactly as the Scorecard has always treated it. On the
// 2026-10-07 production pull the six- and eight-category rules pick the same months.
//
// Driver-fault scope. History has no fault field, so a history month can't be split by
// fault. Two rules exist:
//   legacyQualifyWithFault  (today's Scorecard) a month qualifies on driver-fault rows
//                           only, so a month with none falls back to all-fault history
//   otherwise               qualification ignores the filter; a live month with no
//                           driver-fault rows reads 0, and history months are "not
//                           tracked" and count nothing
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

// incidents  every live incident (the blend picks the ones that count)
// history    dds_history records: { year, month, driver_id, driver_name, category, count }
// qualifyIds the categories that count (and so decide which months are live)
// faultFilter null, or "driver" for Driver-fault scope
export function buildBlend({
  incidents = [],
  history = [],
  qualifyIds = COUNTED8,
  faultFilter = null,
  legacyQualifyWithFault = false,
} = {}) {
  const fault = faultFilter === "driver" ? "driver" : null;
  // Under the newer driver-fault rule history can't answer, so it serves nothing.
  const historyServed = !fault || legacyQualifyWithFault;

  // Which months are live.
  const live = new Set();
  const qualifyFault = legacyQualifyWithFault ? fault : null;
  for (const inc of incidents) {
    if (!countsTowardCharts(inc, { categoryIds: qualifyIds, faultFilter: qualifyFault })) continue;
    const ym = incidentYm(inc);
    if (ym) live.add(ym);
  }

  // The rows each live month counts, and its cells. `allFault` is the same month counted
  // without the fault filter — what the history rollup would hold for it — so a conflict
  // is always measured like for like.
  const liveByYm = {};
  for (const ym of live) liveByYm[ym] = [];
  const liveCells = new Map(); // ym -> Map("driver|cat" -> n)
  const allFault = new Map(); // ym -> Map(cat -> n)
  const allFaultCells = new Map(); // ym -> Map("driver|cat" -> n)
  for (const inc of incidents) {
    const ym = incidentYm(inc);
    if (!live.has(ym)) continue;
    if (countsTowardCharts(inc, { categoryIds: qualifyIds })) {
      bump(inner(allFault, ym), inc.category, 1);
      bump(inner(allFaultCells, ym), `${inc.driver_id}|${inc.category}`, 1);
    }
    if (!countsTowardCharts(inc, { categoryIds: qualifyIds, faultFilter: fault })) continue;
    liveByYm[ym].push(inc);
    bump(inner(liveCells, ym), `${inc.driver_id}|${inc.category}`, 1);
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

  const isLive = (ym) => live.has(ym);
  const hasHistory = (ym) => histCats.has(ym);

  // Where a month's numbers come from: "live", "history", "not_tracked" (a history month
  // under the newer driver-fault rule) or "none".
  const monthSource = (ym) => {
    if (live.has(ym)) return "live";
    if (!histCats.has(ym)) return "none";
    return historyServed ? "history" : "not_tracked";
  };

  const servedCells = (ym) => {
    if (live.has(ym)) return liveCells.get(ym) || new Map();
    return historyServed ? histCells.get(ym) || new Map() : new Map();
  };

  // One driver's count for a category in a month, from whichever source serves it.
  const cell = (ym, driverId, cat) => servedCells(ym).get(`${driverId}|${cat}`) || 0;

  // The company's count for a category in a month: every driver, and in a history month
  // the unattributed records too.
  const companyCell = (ym, cat) => {
    if (live.has(ym)) {
      let n = 0;
      for (const [k, v] of liveCells.get(ym) || []) if (k.slice(k.lastIndexOf("|") + 1) === cat) n += v;
      return n;
    }
    return historyServed ? histCompany.get(ym)?.get(cat) || 0 : 0;
  };

  // Every attributed (driver, category, count) the month serves, zeros included where a
  // history record holds one.
  const entries = (ym) =>
    [...servedCells(ym)].map(([k, n]) => {
      const i = k.lastIndexOf("|");
      return { driverId: k.slice(0, i), category: k.slice(i + 1), n };
    });

  const driverIds = (ym) => new Set(entries(ym).filter((e) => e.n > 0).map((e) => e.driverId));

  // Categories a history month holds records for (attributed only, or every record).
  const historyCategories = (ym, { attributedOnly = true } = {}) => {
    const c = histCats.get(ym);
    return c ? (attributedOnly ? c.attributed : c.all) : new Set();
  };

  // Live and history disagree for a (month, category): the month is live, history holds
  // a count for it, and the two differ — in either direction. Today's rule shows the live
  // number; this is how a screen says the other one exists (Jan 2026 FF: live 19, history
  // 28, from forgotten freight back-dated into a month the spreadsheet already covered).
  const conflicts = [];
  for (const ym of [...live].sort()) {
    const hist = histCompany.get(ym);
    if (!hist) continue;
    for (const [category, h] of hist) {
      if (!qualifyIds.includes(category) || h <= 0) continue;
      const l = allFault.get(ym)?.get(category) || 0;
      if (l !== h) conflicts.push({ ym, category, live: l, history: h });
    }
  }

  // The same comparison for one driver: their live count against their own history.
  const driverConflicts = (driverId) => {
    const out = [];
    for (const ym of [...live].sort()) {
      const hist = histCells.get(ym);
      if (!hist) continue;
      for (const [k, h] of hist) {
        const i = k.lastIndexOf("|");
        const category = k.slice(i + 1);
        if (k.slice(0, i) !== driverId || !qualifyIds.includes(category) || h <= 0) continue;
        const l = allFaultCells.get(ym)?.get(k) || 0;
        if (l !== h) out.push({ ym, category, live: l, history: h });
      }
    }
    return out;
  };

  const months = [...new Set([...live, ...histCats.keys()])].sort();

  return {
    faultFilter: fault,
    legacyQualifyWithFault: !!legacyQualifyWithFault,
    qualifyIds,
    historyServed,
    liveByYm,
    isLive,
    hasHistory,
    monthSource,
    cell,
    companyCell,
    entries,
    driverIds,
    historyCategories,
    conflicts,
    driverConflicts,
    months,
  };
}

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
//   { cells: { ym: Map("driver|cat" -> n) }, sourceByYm: { ym: "live" | "history" } }
// A month is in it when it is live, or when its history holds an attributed record in
// one of the categories — a month that only ever tracked something else is a gap.
export function blendCube(blend, categoryIds) {
  const want = new Set(categoryIds);
  const cells = {};
  const sourceByYm = {};
  for (const ym of blend.months) {
    const src = blend.monthSource(ym);
    if (src === "history" && ![...blend.historyCategories(ym)].some((c) => want.has(c))) continue;
    if (src !== "live" && src !== "history") continue;
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
