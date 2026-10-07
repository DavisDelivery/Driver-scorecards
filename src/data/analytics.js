// Shared analytics helpers for the Reports tab.
//
// RECONCILIATION CONTRACT (do not drift):
//   Monthly and yearly totals here come from the one live/history blend (blend.js), the
//   same blend the Scorecard and Trends count from, so the three can't disagree about a
//   month. A month is live when it holds a live incident that counts; otherwise it is
//   served from the history rollup. They used to carry three inline copies of that rule.
//
//   The category set is the registry's CHARTED6 — the same six Trends charts.
//   Returns/Traces/Complaints/Compliments are intentionally excluded from these
//   totals, matching Trends.
import { CHARTED6, categoriesFor } from "./categories.js";
import { incidentYm } from "./incidentDate.js";

// The six, in the registry's validated stack order (categories.js owns the colours).
export const ANALYTICS_CATEGORIES = categoriesFor(CHARTED6).map(({ id, label, color }) => ({
  id,
  label,
  color,
}));

export const ANALYTICS_CATEGORY_IDS = ANALYTICS_CATEGORIES.map((c) => c.id);

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TRACKED = new Set(ANALYTICS_CATEGORY_IDS);

const blankByCat = () => Object.fromEntries(ANALYTICS_CATEGORY_IDS.map((id) => [id, 0]));

// All years present across live incidents + history rollup, ascending.
export function availableYears(incidents, history) {
  const set = new Set();
  for (const r of history) if (r.year) set.add(Number(r.year));
  for (const inc of incidents) {
    const ym = incidentYm(inc);
    if (ym) set.add(Number(ym.slice(0, 4)));
  }
  return Array.from(set).sort((a, b) => a - b);
}

// Per-month category totals for a year, from the blend.
// Returns [{ month, monthName, byCat, total, source }] for months 1..12.
//   source  "live" | "history" | "none" — a month with history for none of the six is
//           "none", so a chart draws it as a gap
export function buildMonthlyTotals(year, blend) {
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    const byCat = blankByCat();
    let source = "none";
    if (blend.isLive(ym)) {
      source = "live";
    } else if ([...blend.historyCategories(ym, { attributedOnly: false })].some((c) => TRACKED.has(c))) {
      source = "history";
    }
    if (source !== "none") for (const id of ANALYTICS_CATEGORY_IDS) byCat[id] = blend.companyCell(ym, id);
    const total = ANALYTICS_CATEGORY_IDS.reduce((s, id) => s + byCat[id], 0);
    rows.push({ month: m, monthName: MONTH_NAMES[m - 1], byCat, total, source });
  }
  return rows;
}

// Per-year category totals (sum of the blended monthly totals), ascending by year.
export function buildYearlyTotals(years, blend) {
  return years.map((year) => {
    const months = buildMonthlyTotals(year, blend);
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

// A weekly report as one stacked column: the six charted categories, then "other" for
// everything else on the report — returns, traces, complaints. A report counts every
// incident on it, so a column of the six alone came up one or two short of the
// report's own Inc. in half the weeks; with "other" on top it adds up to `count`.
export const REPORT_OTHER = "other";
export function reportColumn(byCat, count) {
  const row = {};
  let charted = 0;
  for (const id of ANALYTICS_CATEGORY_IDS) {
    row[id] = byCat[id] || 0;
    charted += row[id];
  }
  row[REPORT_OTHER] = Math.max(0, (count || 0) - charted);
  return row;
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
