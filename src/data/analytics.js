// Shared analytics helpers for the Reports redesign (Phase 6).
//
// RECONCILIATION CONTRACT (do not drift):
//   Monthly/Yearly rollups here MUST match the Trends tab and the Dashboard.
//   - Trends reads the data-history rollup directly (history-only).
//   - Dashboard blends live incidents with the history rollup: for each month it
//     uses LIVE incidents where any exist, otherwise the history rollup. The live
//     count is taken over incidents that have a driver_id AND a tracked category —
//     exactly the filter the server-side /rollup-report uses to populate history.
//   We replicate that same blend + filter here so Reports' monthly/yearly numbers
//     reconcile with both views. (For a month that has live incidents, history was
//     already populated by the save-time rollup with the same count, so the
//     history-only Trends view agrees too.)
//
//   The category set mirrors Trends' CATEGORY_IDS (the 6 tracked, driver-attributed
//   categories). Returns/Traces/Complaints/Compliments are intentionally excluded
//   from these rollups, matching Trends.

export const ANALYTICS_CATEGORIES = [
  { id: "damage", label: "Damage", color: "#dc3545" },
  { id: "missing", label: "Lost/Missing", color: "#a855f7" },
  { id: "misdelivery", label: "Misdelivery", color: "#f472b6" },
  { id: "forgotten_freight", label: "Forgotten Freight", color: "#fb923c" },
  { id: "late", label: "Late", color: "#facc15" },
  { id: "attempts", label: "Attempts", color: "#14b8a6" },
];

export const ANALYTICS_CATEGORY_IDS = ANALYTICS_CATEGORIES.map((c) => c.id);

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TRACKED = new Set(ANALYTICS_CATEGORY_IDS);

// Representative date for an incident, using the same precedence as the views
// and the server rollup (delivered → actual → return → trace → ship → week → ingested).
export function incidentDate(inc) {
  const d =
    inc.delivered_date ||
    inc.actual_delivery ||
    inc.return_date ||
    inc.trace_date ||
    inc.ship_date ||
    inc.week_ending ||
    inc.ingested_at ||
    "";
  return d && d.length >= 10 ? d.slice(0, 10) : d || "";
}

export function incidentYearMonth(inc) {
  const d = incidentDate(inc);
  if (!d || d.length < 7) return null;
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
}

// Does a live incident count toward the tracked rollup? (matches /rollup-report:
// has a driver, a tracked category, and is NOT flagged "do not fault driver")
function counts(inc) {
  return !!inc.driver_id && !inc.no_fault && TRACKED.has(inc.category);
}

const blankByCat = () => Object.fromEntries(ANALYTICS_CATEGORY_IDS.map((id) => [id, 0]));

// All years present across live incidents + history rollup, ascending.
export function availableYears(incidents, history) {
  const set = new Set();
  for (const r of history) if (r.year) set.add(Number(r.year));
  for (const inc of incidents) {
    const ym = incidentYearMonth(inc);
    if (ym) set.add(ym.year);
  }
  return Array.from(set).sort((a, b) => a - b);
}

// Group the tracked live incidents of a given year by month (1..12).
function liveByMonthForYear(year, incidents) {
  const byMonth = {};
  for (const inc of incidents) {
    if (!counts(inc)) continue;
    const ym = incidentYearMonth(inc);
    if (!ym || ym.year !== year) continue;
    (byMonth[ym.month] = byMonth[ym.month] || []).push(inc);
  }
  return byMonth;
}

// Per-month category totals for a year, blending live + history exactly as Dashboard.
// Returns [{ month, monthName, byCat, total, source }] for months 1..12.
export function buildMonthlyTotals(year, incidents, history) {
  const live = liveByMonthForYear(year, incidents);

  // Pre-index history rollup for the year by month.
  const histByMonth = {};
  for (const rec of history) {
    if (Number(rec.year) !== year || !TRACKED.has(rec.category)) continue;
    const m = Number(rec.month);
    (histByMonth[m] = histByMonth[m] || []).push(rec);
  }

  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const byCat = blankByCat();
    let source = "none";
    if (live[m] && live[m].length > 0) {
      source = "live";
      for (const inc of live[m]) byCat[inc.category] += 1;
    } else if (histByMonth[m]) {
      source = "history";
      for (const rec of histByMonth[m]) {
        byCat[rec.category] = (byCat[rec.category] || 0) + (Number(rec.count) || 0);
      }
    }
    const total = ANALYTICS_CATEGORY_IDS.reduce((s, id) => s + byCat[id], 0);
    rows.push({ month: m, monthName: MONTH_NAMES[m - 1], byCat, total, source });
  }
  return rows;
}

// Per-year category totals (sum of the blended monthly totals), ascending by year.
export function buildYearlyTotals(incidents, history) {
  const years = availableYears(incidents, history);
  return years.map((year) => {
    const months = buildMonthlyTotals(year, incidents, history);
    const byCat = blankByCat();
    let total = 0;
    let anyLive = false;
    for (const mo of months) {
      if (mo.source === "live") anyLive = true;
      for (const id of ANALYTICS_CATEGORY_IDS) byCat[id] += mo.byCat[id];
      total += mo.total;
    }
    return { year, byCat, total, source: anyLive ? "blended" : "history" };
  });
}

// Weekly per-report aggregation from live incidents (operational view; report-scoped,
// counts ALL incidents in the report, not just the tracked-category subset).
export function aggregateReport(reportId, incidents) {
  const list = incidents.filter((i) => i.report_id === reportId);
  const byCat = {};
  // Overlapping Uline-report volumes: one PRO can be on more than one report,
  // so these can sum to more than the row count. True per-report volume.
  const bySource = { traces: 0, returns: 0, laters: 0 };
  let driverFault = 0;
  let withPhotos = 0;
  for (const inc of list) {
    byCat[inc.category] = (byCat[inc.category] || 0) + 1;
    if (inc.fault === "driver" && !inc.no_fault) driverFault += 1;
    if (inc.has_photos || (inc.photo_urls && inc.photo_urls.length > 0)) withPhotos += 1;
    const sources = Array.isArray(inc.sources) ? inc.sources : [];
    for (const s of sources) if (s in bySource) bySource[s] += 1;
  }
  return { count: list.length, byCat, bySource, driverFault, withPhotos };
}

// Relative "x ago" string for a timestamp.
export function relativeTime(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (isNaN(then)) return "";
  const diff = Date.now() - then;
  const day = 86400000;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < day) return `${Math.round(diff / 3600000)}h ago`;
  const days = Math.round(diff / day);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}
