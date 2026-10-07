// The three inline live/history blends as they stood in v0.20.0, copied verbatim (only
// lifted out of their components) so blend.js can be checked against each of them.
//
// Not a test file (test/*.test.mjs is the glob). Each takes the category set it
// qualifies months on as a parameter: the Scorecard qualified on eight categories,
// Trends and Reports on six, and v0.20.1 moves the latter two to eight. Passing the
// eight here is the "everything else unchanged" baseline; passing the six is what
// shipped.
import { countsTowardCharts } from "../src/data/liveHistoryBlend.js";
import { incidentDateStr } from "../src/data/incidentDate.js";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dashboard.jsx scorecardData (v0.20.0), from `const map = new Map()` to addInto.
export function legacyScorecard({ drivers, incidents, history, selectedMonth, periodMonths, faultFilter, chartCatIds }) {
  const CHART_CATEGORIES = chartCatIds.map((id) => ({ id }));
  const CHART_CAT_IDS = chartCatIds;
  const selectedYear = selectedMonth.slice(0, 4);
  const map = new Map();
  const blankCounts = () => Object.fromEntries(CHART_CATEGORIES.map((c) => [c.id, 0]));

  for (const drv of drivers) {
    map.set(drv.id, { driver: drv, month: blankCounts(), period: blankCounts(), ytd: blankCounts() });
  }
  const getOrCreate = (driverId, driverName) => {
    let entry = map.get(driverId);
    if (!entry) {
      entry = {
        driver: { id: driverId, name: driverName || "(unknown)", role: "driver" },
        month: blankCounts(), period: blankCounts(), ytd: blankCounts(),
      };
      map.set(driverId, entry);
    }
    return entry;
  };
  const ytdYear = Number(selectedYear);
  const months = new Set(periodMonths);
  for (let m = 1; m <= 12; m++) months.add(`${ytdYear}-${String(m).padStart(2, "0")}`);

  const liveByYm = {};
  for (const inc of incidents) {
    const ym = incidentDateStr(inc).slice(0, 7);
    if (!months.has(ym)) continue;
    if (!countsTowardCharts(inc, { categoryIds: CHART_CAT_IDS, faultFilter })) continue;
    if (!liveByYm[ym]) liveByYm[ym] = [];
    liveByYm[ym].push(inc);
  }

  const blend = {};
  for (const ym of months) {
    const cell = new Map();
    const live = liveByYm[ym] || [];
    if (live.length > 0) {
      for (const inc of live) {
        const k = `${inc.driver_id}|${inc.category}`;
        cell.set(k, (cell.get(k) || 0) + 1);
        getOrCreate(inc.driver_id, inc.driver_name || inc.driver_raw);
      }
    } else {
      const [y, m] = ym.split("-").map(Number);
      for (const rec of history) {
        if (rec.year !== y || rec.month !== m || !rec.driver_id) continue;
        if (!CHART_CATEGORIES.some((c) => c.id === rec.category)) continue;
        const k = `${rec.driver_id}|${rec.category}`;
        cell.set(k, (cell.get(k) || 0) + (rec.count || 0));
        getOrCreate(rec.driver_id, rec.driver_name);
      }
    }
    blend[ym] = cell;
  }

  const addInto = (bucketName, ym) => {
    for (const [k, n] of blend[ym] || []) {
      const [did, cat] = k.split("|");
      const entry = map.get(did);
      if (entry) entry[bucketName][cat] = (entry[bucketName][cat] || 0) + n;
    }
  };
  addInto("month", selectedMonth);
  for (let m = 1; m <= 12; m++) addInto("ytd", `${ytdYear}-${String(m).padStart(2, "0")}`);
  for (const ym of periodMonths) addInto("period", ym);
  return { rows: Array.from(map.values()), liveByYm };
}

// Trends.jsx cube (v0.20.0), with its qualification set as a parameter.
export function legacyTrendsCube({ incidents, history, drivers, catIds, qualifyIds = catIds }) {
  const incidentYm = (inc) => incidentDateStr(inc).slice(0, 7);
  const CAT_IDS = catIds;
  const liveByYm = {};
  for (const inc of incidents) {
    const ym = incidentYm(inc);
    if (!ym || ym.length !== 7) continue;
    if (!countsTowardCharts(inc, { categoryIds: qualifyIds })) continue;
    (liveByYm[ym] = liveByYm[ym] || []).push(inc);
  }
  const cells = {};
  const names = new Map();
  const sourceByYm = {};
  const ensure = (ym) => (cells[ym] = cells[ym] || new Map());
  for (const [ym, list] of Object.entries(liveByYm)) {
    const cell = ensure(ym);
    sourceByYm[ym] = "live";
    for (const inc of list) {
      // v0.20.1 note: with qualifyIds wider than catIds, a live row outside the charted
      // set qualifies the month but is not a charted cell.
      if (!CAT_IDS.includes(inc.category)) continue;
      const k = `${inc.driver_id}|${inc.category}`;
      cell.set(k, (cell.get(k) || 0) + 1);
      if (!names.has(inc.driver_id)) names.set(inc.driver_id, inc.driver_name || inc.driver_raw || inc.driver_id);
    }
  }
  for (const rec of history) {
    if (!rec.driver_id || !CAT_IDS.includes(rec.category)) continue;
    const ym = `${rec.year}-${String(rec.month).padStart(2, "0")}`;
    if (liveByYm[ym]) continue; // live supersedes
    const cell = ensure(ym);
    sourceByYm[ym] = "history";
    const k = `${rec.driver_id}|${rec.category}`;
    cell.set(k, (cell.get(k) || 0) + (rec.count || 0));
    if (!names.has(rec.driver_id)) names.set(rec.driver_id, rec.driver_name || rec.driver_id);
  }
  for (const d of drivers) names.set(d.id, d.name);
  return { cells, names, sourceByYm };
}

// analytics.js buildMonthlyTotals (v0.20.0), with its tracked set and qualification set
// as parameters.
export function legacyMonthlyTotals(year, incidents, history, { catIds, qualifyIds = catIds }) {
  const TRACKED = new Set(catIds);
  const QUALIFY = new Set(qualifyIds);
  const incidentYearMonth = (inc) => {
    const d =
      inc.delivered_date || inc.actual_delivery || inc.return_date || inc.trace_date ||
      inc.ship_date || inc.week_ending || inc.ingested_at || "";
    const s = d && d.length >= 10 ? d.slice(0, 10) : d || "";
    if (!s || s.length < 7) return null;
    return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
  };
  const counts = (inc) => !!inc.driver_id && !inc.no_fault && QUALIFY.has(inc.category);
  const live = {};
  for (const inc of incidents) {
    if (!counts(inc)) continue;
    const ym = incidentYearMonth(inc);
    if (!ym || ym.year !== year) continue;
    (live[ym.month] = live[ym.month] || []).push(inc);
  }
  const histByMonth = {};
  for (const rec of history) {
    if (Number(rec.year) !== year || !TRACKED.has(rec.category)) continue;
    const m = Number(rec.month);
    (histByMonth[m] = histByMonth[m] || []).push(rec);
  }
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const byCat = Object.fromEntries(catIds.map((id) => [id, 0]));
    let source = "none";
    if (live[m] && live[m].length > 0) {
      source = "live";
      for (const inc of live[m]) if (TRACKED.has(inc.category)) byCat[inc.category] += 1;
    } else if (histByMonth[m]) {
      source = "history";
      for (const rec of histByMonth[m]) {
        byCat[rec.category] = (byCat[rec.category] || 0) + (Number(rec.count) || 0);
      }
    }
    const total = catIds.reduce((s, id) => s + byCat[id], 0);
    rows.push({ month: m, monthName: MONTH_NAMES[m - 1], byCat, total, source });
  }
  return rows;
}
