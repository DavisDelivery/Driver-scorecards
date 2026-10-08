// What a drill-down shows, computed from the SAME inputs the cards are.
//
// The cards count from the blend, one category in one month at a time: a cell with a
// live incident that counts is served from live incidents, every other cell from the
// rolled-up history (see blend.js). A drill-down that recomputed its numbers another way
// would show a different figure from the one you clicked — which is exactly what the
// driver popup did, because it was never given the history at all. So the drill-down
// walks the same cells with the same rule, and returns both the incidents to list and
// the totals, so the list and its numbers come from one pass. drill.js is the only
// caller on screen.
import { incidentDateStr } from "./incidentDate.js";
import { shiftYm } from "./period.js";

// Every month of a year, as YYYY-MM.
export function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

// The accumulator both builders share: one bump per counted row or history record, so
// every total, by-month, by-driver and by-category figure comes from the same pass.
function collector() {
  const out = {
    incidents: [],
    historyRows: [],
    byDriver: new Map(),
    byMonth: new Map(),
    byCategory: new Map(),
    byMonthCategory: new Map(),
    total: 0,
  };
  out.bump = (id, name, category, ym, n) => {
    out.total += n;
    out.byMonth.set(ym, (out.byMonth.get(ym) || 0) + n);
    out.byCategory.set(category, (out.byCategory.get(category) || 0) + n);
    const mc = out.byMonthCategory.get(ym) || out.byMonthCategory.set(ym, new Map()).get(ym);
    mc.set(category, (mc.get(category) || 0) + n);
    const e = out.byDriver.get(id) || { id, name: "", count: 0 };
    e.count += n;
    if (!e.name && name) e.name = name;
    out.byDriver.set(id, e);
  };
  return out;
}

// The history records a (month, filter) pick, as display rows. A record with no
// driver_id belongs to no driver's count; `unattributed` takes it anyway, for a company
// total that includes it (the Reports analytics always has).
function historyRowsFor(history, ym, keep, unattributed = false) {
  const [y, m] = ym.split("-").map(Number);
  const rows = [];
  for (const rec of history) {
    if (Number(rec.year) !== y || Number(rec.month) !== m) continue;
    if (!rec.driver_id && !unattributed) continue;
    if (!keep(rec.category, rec.driver_id || "")) continue;
    const n = Number(rec.count) || 0;
    if (!n) continue;
    rows.push({
      ym,
      driver_id: rec.driver_id || "",
      driver_name: rec.driver_name || "",
      category: rec.category,
      count: n,
    });
  }
  return rows;
}

function finish(out) {
  delete out.bump;
  // Newest first — the most recent failure is what a manager opens this to see.
  out.incidents.sort((a, b) => incidentDateStr(b).localeCompare(incidentDateStr(a)));
  out.historyRows.sort((a, b) => b.ym.localeCompare(a.ym) || b.count - a.count);
  return out;
}

// The default live test: a (month, category) cell is live when liveByYm holds a row of
// that category in that month. Pass the blend's own isLive instead, so a live cell whose
// rows the fault filter removed reads 0 rather than falling back to history.
function defaultIsLive(liveByYm) {
  const live = new Set();
  for (const [ym, list] of Object.entries(liveByYm)) for (const inc of list) live.add(`${ym}|${inc.category}`);
  return (ym, cat) => live.has(`${ym}|${cat}`);
}

// scopeMonths : the YYYY-MM months to cover (the period, the year, or one month)
// liveByYm    : { ym: [incident] } — ONLY incidents that count, as the blend built it
// isLive      : (ym, cat) => boolean, the blend's cell rule (defaults to "liveByYm has
//               rows of that category that month")
// history     : [{ year, month, driver_id, driver_name, category, count }]
// categoryId  : one category, or null for every category in `categoryIds`
// categoryIds : the charted categories (used when categoryId is null)
// driverId    : restrict to one driver, or null for everyone
// inGroup     : role-group predicate on a driver id (drivers vs loaders)
// unattributed: also count history records with no driver_id (company totals only)
export function buildCategoryDetail({
  scopeMonths = [],
  liveByYm = {},
  isLive = defaultIsLive(liveByYm),
  history = [],
  categoryId = null,
  categoryIds = [],
  driverId = null,
  inGroup = () => true,
  unattributed = false,
}) {
  const wantCat = (c) => (categoryId ? c === categoryId : categoryIds.includes(c));
  const keep = (c, d) => wantCat(c) && (!driverId || d === driverId) && inGroup(d);
  const out = collector();

  for (const ym of new Set(scopeMonths)) {
    // A live cell: its incidents ARE the count. History for that category this month is
    // not consulted, exactly as the cards don't — counting both would double it.
    for (const inc of liveByYm[ym] || []) {
      if (!isLive(ym, inc.category) || !keep(inc.category, inc.driver_id)) continue;
      out.incidents.push(inc);
      out.bump(inc.driver_id, inc.driver_name || inc.driver_raw, inc.category, ym, 1);
    }
    // Every other cell of the month is history's.
    const fromHistory = (c, d) => !isLive(ym, c) && keep(c, d);
    for (const row of historyRowsFor(history, ym, fromHistory, unattributed)) {
      out.historyRows.push(row);
      out.bump(row.driver_id, row.driver_name, row.category, ym, row.count);
    }
  }
  return finish(out);
}

const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

// The same detail for a window of days (start..end, inclusive YYYY-MM-DD) that still
// obeys the cell rule:
//   - a live cell contributes the incidents dated inside the window (incidentDateStr)
//   - a month's history cells are added whole when the month is wholly inside the window
//   - when it is only partly inside, the count they hold is listed in `unsplittable` and
//     added to nothing: history has no days, and prorating would invent them
// byDay counts the live rows per day, so the live part of the total is Σ byDay.
export function buildWindowDetail({
  start,
  end,
  liveByYm = {},
  isLive = defaultIsLive(liveByYm),
  history = [],
  categoryId = null,
  categoryIds = [],
  driverId = null,
  inGroup = () => true,
  unattributed = false,
}) {
  const wantCat = (c) => (categoryId ? c === categoryId : categoryIds.includes(c));
  const keep = (c, d) => wantCat(c) && (!driverId || d === driverId) && inGroup(d);
  const out = collector();
  out.byDay = new Map();
  out.unsplittable = [];
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  if (!ok(start) || !ok(end) || start > end) return finish(out);

  for (let ym = start.slice(0, 7); ym <= end.slice(0, 7); ym = shiftYm(ym, 1)) {
    for (const inc of liveByYm[ym] || []) {
      if (!isLive(ym, inc.category)) continue;
      const day = incidentDateStr(inc).slice(0, 10);
      if (day < start || day > end || !keep(inc.category, inc.driver_id)) continue;
      out.incidents.push(inc);
      out.byDay.set(day, (out.byDay.get(day) || 0) + 1);
      out.bump(inc.driver_id, inc.driver_name || inc.driver_raw, inc.category, ym, 1);
    }
    const rows = historyRowsFor(history, ym, (c, d) => !isLive(ym, c) && keep(c, d), unattributed);
    const whole = start <= `${ym}-01` && end >= `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
    if (!whole) {
      const count = rows.reduce((a, r) => a + r.count, 0);
      if (count > 0) out.unsplittable.push({ ym, count });
      continue;
    }
    for (const row of rows) {
      out.historyRows.push(row);
      out.bump(row.driver_id, row.driver_name, row.category, ym, row.count);
    }
  }
  return finish(out);
}
