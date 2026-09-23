// What a Scorecard drill-down shows, computed from the SAME inputs the cards are.
//
// The cards count from a month-by-month blend: a month with any live incident that
// counts is served from live incidents, every other month from the rolled-up history
// (see liveHistoryBlend.js). A drill-down that recomputed its numbers another way
// would show a different figure from the one you clicked — which is exactly what the
// driver popup did, because it was never given the history at all. So the drill-down
// walks the same months with the same rule, and returns both the incidents to list
// and the totals, so the list and its numbers come from one pass.
import { incidentDateStr } from "./incidentDate.js";

// Every month of a year, as YYYY-MM.
export function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

// scopeMonths : the YYYY-MM months to cover (the period, the year, or one month)
// liveByYm    : { ym: [incident] } — ONLY incidents that count, as the scorecard built it
// history     : [{ year, month, driver_id, driver_name, category, count }]
// categoryId  : one category, or null for every category in `categoryIds`
// categoryIds : the charted categories (used when categoryId is null)
// driverId    : restrict to one driver, or null for everyone
// inGroup     : role-group predicate on a driver id (drivers vs loaders)
export function buildCategoryDetail({
  scopeMonths = [],
  liveByYm = {},
  history = [],
  categoryId = null,
  categoryIds = [],
  driverId = null,
  inGroup = () => true,
}) {
  const wantCat = (c) => (categoryId ? c === categoryId : categoryIds.includes(c));
  const wantDriver = (d) => !driverId || d === driverId;

  const incidents = [];
  const historyRows = [];
  const byDriver = new Map();
  const byMonth = new Map();
  const byCategory = new Map();
  let total = 0;

  const bump = (id, name, category, ym, n) => {
    total += n;
    byMonth.set(ym, (byMonth.get(ym) || 0) + n);
    byCategory.set(category, (byCategory.get(category) || 0) + n);
    const e = byDriver.get(id) || { id, name: "", count: 0 };
    e.count += n;
    if (!e.name && name) e.name = name;
    byDriver.set(id, e);
  };

  for (const ym of scopeMonths) {
    const live = liveByYm[ym];
    if (live && live.length > 0) {
      // A live month: its incidents ARE the count. History for this month is not
      // consulted, exactly as the cards don't — counting both would double it.
      for (const inc of live) {
        if (!wantCat(inc.category) || !wantDriver(inc.driver_id)) continue;
        if (!inGroup(inc.driver_id)) continue;
        incidents.push(inc);
        bump(inc.driver_id, inc.driver_name || inc.driver_raw, inc.category, ym, 1);
      }
    } else {
      const [y, m] = ym.split("-").map(Number);
      for (const rec of history) {
        if (rec.year !== y || rec.month !== m || !rec.driver_id) continue;
        if (!wantCat(rec.category) || !wantDriver(rec.driver_id)) continue;
        if (!inGroup(rec.driver_id)) continue;
        const n = rec.count || 0;
        if (!n) continue;
        historyRows.push({
          ym,
          driver_id: rec.driver_id,
          driver_name: rec.driver_name || "",
          category: rec.category,
          count: n,
        });
        bump(rec.driver_id, rec.driver_name, rec.category, ym, n);
      }
    }
  }

  // Newest first — the most recent failure is what a manager opens this to see.
  incidents.sort((a, b) => incidentDateStr(b).localeCompare(incidentDateStr(a)));
  historyRows.sort((a, b) => b.ym.localeCompare(a.ym) || b.count - a.count);

  return { incidents, historyRows, byDriver, byMonth, byCategory, total };
}
