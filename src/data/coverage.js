// What the numbers on file cover, and so what can be compared with what.
//
// A month's count only means something beside another month's when both were captured
// the same way. They often weren't: the 2023 spreadsheets held lost/missing only, 2024's
// held no lost/missing, Late and every manual-entry tab only exist in the app, the
// spreadsheet backfill ends with March 2026 and the app's incidents begin in April, and
// the Uline reports that feed Late, Damage and Lost/Missing skip three weeks of April
// 2026. Compare across any of those and the chart "shows" a change that is only a
// change in what was written down.
//
// So every (month, category) cell gets a state here:
//
//   live         the app captured it: live entries, or a real zero in a month it was
//                capturing (June-on, an empty month on a manual-entry tab is a zero)
//   history      imported history serves it (a spreadsheet month, or a report rollup)
//   partial      captured in part: a Uline category in a month the reports only partly
//                cover, the month still in progress, a category whose second source
//                hadn't started (Mis-Deliveries before June), or entries back-dated into
//                a month nobody was capturing (one forgotten freight filed under April)
//   conflict     live entries serve it and history holds a different count — Jan 2026
//                forgotten freight, 19 back-dated entries against the spreadsheet's 28.
//                Hand-logged entries in a month of report rollups aren't one: they never
//                roll up, so history is always short of them (buildCoverage)
//   no_data      a spreadsheet month with no history document: 2023-11, 2025-07, 2025-12
//   not_tracked  nothing captured it — never a zero
//
// A cell that holds a count is never not_tracked or no_data (it reads partial instead),
// so the numbers a chart draws always add up to what the blend serves, and the
// drill-down of any total counts exactly it.
//
// Nothing here reads or writes the database: the page passes in what it loaded.
import { incidentDateStr, incidentYm } from "./incidentDate.js";
import { shiftYm, addDays, weekdayOfYmd, etDay, daysBetween } from "./period.js";
import { reportDateBounds } from "../reports/reportNaming.js";
import { computeContribution, parseCatKey, compositeKey } from "./rollup.js";
import { countsTowardCharts } from "./liveHistoryBlend.js";
import { historyYm, tally, tallyTotal } from "./blend.js";
import { COUNTED8, FAILURES, catLabel } from "./categories.js";

// The app's own incidents begin here; every earlier month is the spreadsheet backfill's.
export const APP_ERA = "2026-04";

// When each of the app's sources started capturing (owner, 10/07):
//   uline   the weekly Uline reports — Late, Damage, Lost/Missing, report misdeliveries.
//           Their real coverage is decided by day from the reports' spans
//           (ulineCoverage), so April 2026 is partial.
//   manual  the entry tabs — Forgotten Freight, Mis-Deliveries, Attempts, Compliments —
//           "only from June when all this was created". Before June these categories
//           are not captured, not zero.
export const SOURCE_FROM = { uline: APP_ERA, manual: "2026-06" };
export const SOURCE_TEXT = { uline: "Uline reports", manual: "entry tabs" };

// How each category was captured, reviewed with Chad on 10/07 and checked against the
// history on file: the spreadsheet months each yearly file held it for (`backfill`, as
// inclusive YYYY-MM runs) and the app sources that have captured it since (`app`).
export const CAPTURE_WINDOWS = {
  damage: { backfill: [["2024-01", "2026-03"]], app: ["uline"] },
  forgotten_freight: { backfill: [["2024-01", "2026-03"]], app: ["manual"] },
  misdelivery: { backfill: [["2024-01", "2026-03"]], app: ["uline", "manual"] },
  late: { backfill: [], app: ["uline"] },
  // 2023's spreadsheet held lost/missing only; 2024's held none of it.
  missing: { backfill: [["2023-01", "2023-12"], ["2025-01", "2026-03"]], app: ["uline"] },
  complaint: { backfill: [], app: ["uline"] },
  attempts: { backfill: [], app: ["manual"] },
  compliment: { backfill: [], app: ["manual"] },
};

// The share of a month's weekdays the Uline reports must cover for a Uline category to
// count as whole. May 2026 (19 of 21, after the April gap) passes; April (5 of 22) and a
// month the latest report stops partway through don't.
export const ULINE_WHOLE = 0.9;

const inRuns = (ym, runs) => runs.some(([a, b]) => ym >= a && ym <= b);
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtYm = (ym) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fmtDay = (ymd) => `${MONTH_ABBR[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}`;

// Where a month's number for a category was captured, by date alone:
//   "backfill"  a month a spreadsheet held this category for
//   "app"       the app era (April 2026 on)
//   null        neither
export function instrument(ym, cat) {
  const w = CAPTURE_WINDOWS[cat];
  if (!w) return ym >= APP_ERA ? "app" : null;
  if (ym < APP_ERA) return inRuns(ym, w.backfill) ? "backfill" : null;
  return "app";
}

// Whether a month is inside a category's capture window: a spreadsheet month that held
// it, or a month since one of its app sources started.
export function inCaptureWindow(ym, cat) {
  const w = CAPTURE_WINDOWS[cat];
  if (!w) return false;
  if (ym < APP_ERA) return inRuns(ym, w.backfill);
  return w.app.some((s) => ym >= SOURCE_FROM[s]);
}

// Which of a category's app sources had started by a month, and which hadn't yet.
function appSources(ym, cat) {
  const w = CAPTURE_WINDOWS[cat] || { app: [] };
  if (ym < APP_ERA) return { on: [], pending: [] };
  return {
    on: w.app.filter((s) => ym >= SOURCE_FROM[s]),
    pending: w.app.filter((s) => ym < SOURCE_FROM[s]),
  };
}

// ── Uline report coverage, by day ────────────────────────────────────────────

// The days the Uline reports cover: each report's span (starts_at..ends_at, or the
// dates of its own rows when it predates spans), merged where they touch.
//   → { intervals: [{ start, end }], gaps: [{ start, end, days }], first, through }
// Spans are the min and max incident dates of a report, so coverage is approximate.
export function ulineCoverage(reports = [], incidents = []) {
  const rowsOf = new Map();
  for (const inc of incidents || []) {
    if (!inc?.report_id) continue;
    (rowsOf.get(inc.report_id) || rowsOf.set(inc.report_id, []).get(inc.report_id)).push(inc);
  }
  const spans = [];
  for (const r of reports || []) {
    let start = String(r?.starts_at || "").slice(0, 10);
    let end = String(r?.ends_at || "").slice(0, 10);
    if (!isYmd(start) || !isYmd(end)) {
      const b = reportDateBounds(rowsOf.get(r?.id) || []);
      if (!isYmd(start)) start = b.starts_at || "";
      if (!isYmd(end)) end = b.ends_at || "";
    }
    if (!isYmd(start) || !isYmd(end)) continue;
    spans.push(start <= end ? { start, end } : { start: end, end: start });
  }
  spans.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const intervals = [];
  for (const s of spans) {
    const last = intervals[intervals.length - 1];
    if (last && s.start <= addDays(last.end, 1)) {
      if (s.end > last.end) last.end = s.end;
    } else {
      intervals.push({ ...s });
    }
  }
  const gaps = [];
  for (let i = 1; i < intervals.length; i++) {
    const start = addDays(intervals[i - 1].end, 1);
    const end = addDays(intervals[i].start, -1);
    gaps.push({ start, end, days: daysBetween(start, end) });
  }
  return {
    intervals,
    gaps,
    first: intervals[0]?.start || null,
    through: intervals.length ? intervals[intervals.length - 1].end : null,
  };
}

// The share of a month's weekdays inside the Uline intervals (0..1).
export function ulineShare(ym, uline) {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let weekdays = 0;
  let covered = 0;
  for (let d = 1; d <= days; d++) {
    const ymd = `${ym}-${String(d).padStart(2, "0")}`;
    const wd = weekdayOfYmd(ymd);
    if (wd < 1 || wd > 5) continue;
    weekdays++;
    if ((uline?.intervals || []).some((iv) => ymd >= iv.start && ymd <= iv.end)) covered++;
  }
  return weekdays ? covered / weekdays : 0;
}

// How long a report row takes to arrive: days from the date it is filed under to the ET
// day it was entered. → { n, median, p90 } (nearest rank), or nulls with no rows.
export function reportLag(incidents = []) {
  const lags = [];
  for (const inc of incidents || []) {
    if (!inc?.report_id || inc.manual_entry) continue;
    const day = incidentDateStr(inc).slice(0, 10);
    const entered = etDay(inc.created_at || inc.ingested_at);
    if (!isYmd(day) || !isYmd(entered) || entered < day) continue;
    lags.push(daysBetween(day, entered) - 1);
  }
  lags.sort((a, b) => a - b);
  const rank = (p) => lags[Math.max(1, Math.ceil((p / 100) * lags.length)) - 1];
  return lags.length ? { n: lags.length, median: rank(50), p90: rank(90) } : { n: 0, median: null, p90: null };
}

// ── The coverage of every cell ───────────────────────────────────────────────

export const STATE_TEXT = {
  live: "live",
  history: "imported history",
  partial: "partly captured",
  conflict: "live and history disagree",
  no_data: "no data on file",
  not_tracked: "not tracked",
};

// Why a cell is partial (or no data), in words.
export const REASON_TEXT = {
  in_progress: "month still in progress",
  uline_partial: "Uline reports cover only part of the month",
  uline_none: "no Uline report covers this month",
  pending: "Mis-Deliveries tab logging began Jun 2026 — Uline report misdeliveries only",
  outside: "entries on file in a month this category wasn't being captured",
  back_dated: "entries back-dated into a spreadsheet month that holds none",
  no_doc: "no history document for this month",
};

// The coverage of every (month, category) cell, from the all-fault blend.
//   blend            buildBlend({ incidents, history }) — fault filter off
//   historyMonthIds  the dds_history month documents that exist (loadHistoryChecked)
//   uline            ulineCoverage(reports, incidents)
//   today            YYYY-MM-DD (ET): the month it falls in is still in progress
//   incidents        the live rows, to tell an expected difference from a disagreement
//                    (below); without them every blend conflict is a conflict
// → { cell(ym, cat), conflicts }, where cell is
//   { ym, category, state, value, instrument, complete, live, history, reasons }
//   value       what the blend serves, or null for not_tracked / no_data
//   instrument  how the value was captured: "backfill" (a spreadsheet), "app" (live
//               entries or a report rollup), null — Jan 2026's forgotten freight is
//               "app", its back-dated entries, though the month is a spreadsheet month
//   complete    the cell's capture is whole (live or history, not partial or conflict)
//   live / history  the cell's two sides (blend.liveCount / historyCount)
export function buildCoverage({ blend, historyMonthIds = [], uline = null, today, incidents = null }) {
  const docs = new Set(historyMonthIds || []);
  const hasDoc = (ym) => docs.has(ym) || blend.hasHistory(ym);
  const conflicts = new Map(blend.conflicts.map((c) => [`${c.ym}|${c.category}`, c]));
  // Only reports roll up, so an app-era month whose history is their rollup holds less
  // than its live count wherever someone also logged by hand (Aug 2026 misdelivery: live
  // 11, history 6 — the six report rows, all rolled up). That is expected, not a
  // disagreement: the live count is the whole one. The cell disagrees only when its
  // report rows alone don't match history. Data Coverage still lists the difference,
  // with that cause (reconcile).
  const reportRows = new Map();
  for (const inc of incidents || []) {
    if (!inc?.report_id || !countsTowardCharts(inc, { categoryIds: COUNTED8 })) continue;
    const k = `${incidentYm(inc)}|${inc.category}`;
    reportRows.set(k, (reportRows.get(k) || 0) + 1);
  }
  const disagree = (ym, cat) => {
    const k = `${ym}|${cat}`;
    if (!conflicts.has(k)) return false;
    if (!incidents || ym < APP_ERA) return true;
    return (reportRows.get(k) || 0) !== blend.historyCount(ym, cat);
  };
  const nowYm = String(today || "").slice(0, 7);
  const share = new Map();
  const shareOf = (ym) => (share.has(ym) ? share.get(ym) : share.set(ym, ulineShare(ym, uline)).get(ym));
  const memo = new Map();

  const decide = (ym, cat) => {
    const served = blend.cellSource(ym, cat); // live | history | none (fault filter off)
    const hasData = served !== "none";
    const date = instrument(ym, cat);
    const conflict = disagree(ym, cat);
    if (ym < APP_ERA) {
      if (date !== "backfill") return hasData ? ["partial", ["outside"]] : ["not_tracked", []];
      if (conflict) return ["conflict", []];
      if (served === "live") return ["partial", ["back_dated"]];
      if (!hasDoc(ym)) return ["no_data", ["no_doc"]];
      return ["history", []];
    }
    const { on, pending } = appSources(ym, cat);
    if (!on.length) return hasData ? ["partial", ["outside"]] : ["not_tracked", []];
    const reasons = [];
    if (ym === nowYm) reasons.push("in_progress");
    if (on.includes("uline")) {
      const s = shareOf(ym);
      // A month no report reaches, with nothing on file, holds no data rather than a
      // zero: a Uline-only category has nobody else to have captured it.
      if (s === 0 && !hasData && on.length === 1 && ym < nowYm) return ["no_data", ["uline_none"]];
      if (s < ULINE_WHOLE && ym !== nowYm) reasons.push(s === 0 ? "uline_none" : "uline_partial");
    }
    if (pending.length) reasons.push("pending");
    if (conflict) return ["conflict", reasons];
    if (reasons.length) return ["partial", reasons];
    return [served === "history" ? "history" : "live", []];
  };

  const cell = (ym, cat) => {
    const key = `${ym}|${cat}`;
    if (memo.has(key)) return memo.get(key);
    const [state, reasons] = decide(ym, cat);
    const counted = state !== "not_tracked" && state !== "no_data";
    const served = blend.cellSource(ym, cat);
    const out = {
      ym,
      category: cat,
      state,
      value: counted ? blend.companyCell(ym, cat) : null,
      // Live entries are the app's, whichever month they are filed under.
      instrument: !counted ? null : served === "live" ? "app" : instrument(ym, cat),
      complete: state === "live" || state === "history",
      live: blend.liveCount(ym, cat),
      history: blend.historyCount(ym, cat),
      reasons,
    };
    if (ym >= APP_ERA && CAPTURE_WINDOWS[cat]?.app.includes("uline")) out.uline = shareOf(ym);
    memo.set(key, out);
    return out;
  };

  return { cell, conflicts: blend.conflicts };
}

// The comparable states: whole on both sides.
const COMPARABLE = new Set(["live", "history"]);

// Why one aligned pair of cells can't be compared, or null when it can. The worse side
// decides, in this order.
const DROP_ORDER = ["not_tracked", "no_data", "conflict", "partial"];
export const DROP_TEXT = {
  not_tracked: "not tracked",
  no_data: "no data on file",
  conflict: "live and history disagree",
  partial: "partly captured",
  source_change: "spreadsheet vs app",
};
function dropReason(a, b, allowSourceChange) {
  for (const s of DROP_ORDER) if (a.state === s || b.state === s) return s;
  if (!COMPARABLE.has(a.state) || !COMPARABLE.has(b.state)) return "partial";
  if (a.instrument !== b.instrument && !allowSourceChange) return "source_change";
  return null;
}

// Like-for-like: the aligned (month, comparison month, category) triples of P and C
// that were captured whole, the same way, on both sides. Every triple left out is
// listed, grouped by category and reason, with the months on each side.
//   → { pairs: [{ cat, cur, cmp, a, b, sourceChange }],
//       exclusions: [{ cat, reason, months, cmpMonths, side }] }
// side: "current", "comparison" or "both" — where the reason lies.
export function likeForLike(P, C, cats, cov, { allowSourceChange = false } = {}) {
  const pairs = [];
  const dropped = new Map();
  const n = Math.min(P.length, C.length);
  for (const cat of cats) {
    for (let i = 0; i < n; i++) {
      const a = cov.cell(P[i], cat);
      const b = cov.cell(C[i], cat);
      const reason = dropReason(a, b, allowSourceChange);
      if (!reason) {
        pairs.push({ cat, cur: P[i], cmp: C[i], a: a.value, b: b.value, sourceChange: a.instrument !== b.instrument });
        continue;
      }
      const onA = reason === "source_change" || a.state === reason;
      const onB = reason === "source_change" || b.state === reason;
      const side = onA && onB ? "both" : onA ? "current" : "comparison";
      const key = `${cat}|${reason}|${side}`;
      const e = dropped.get(key) || dropped.set(key, { cat, reason, side, months: [], cmpMonths: [] }).get(key);
      e.months.push(P[i]);
      e.cmpMonths.push(C[i]);
    }
  }
  return { pairs, exclusions: [...dropped.values()] };
}

// A caveat chip's words: the category, the months of this period left out, and why —
// naming the comparison months when the reason lies there: "Lost/Missing · Oct 2024 –
// Dec 2024 · not tracked in Oct 2023 – Dec 2023". `withCat` false leaves the category
// out, for a row that already names it.
export function exclusionText(e, { withCat = true } = {}) {
  const where =
    e.side === "both" || e.reason === "source_change" ? "" : e.side === "current" ? " this period" : ` in ${monthsText(e.cmpMonths)}`;
  return `${withCat ? `${catLabel(e.cat)} · ` : ""}${monthsText(e.months)} · ${DROP_TEXT[e.reason]}${where}`;
}

// Months in words, runs joined: "Oct 2024 – Dec 2025", "Jul 2025, Dec 2025".
export function monthsText(months) {
  const sorted = [...new Set(months || [])].sort();
  const runs = [];
  for (const ym of sorted) {
    const last = runs[runs.length - 1];
    if (last && shiftYm(last[1], 1) === ym) last[1] = ym;
    else runs.push([ym, ym]);
  }
  return runs.map(([a, b]) => (a === b ? fmtYm(a) : `${fmtYm(a)} – ${fmtYm(b)}`)).join(", ");
}

// The evidence beside the capture windows: the months each source actually holds a
// count for, per category. → { [cat]: { hist: [ym], live: [ym] } }
export function captureEvidence(blend, months, cats) {
  const out = {};
  for (const cat of cats) {
    out[cat] = {
      hist: months.filter((ym) => blend.historyCount(ym, cat) > 0),
      live: months.filter((ym) => blend.liveCount(ym, cat) > 0),
    };
  }
  return out;
}

// The ids on file with no roster row, with what they count across every month on file
// (people.js's index: { id, name, onRoster, firstOnFile, lastOnFile }) — counted in
// every total and never hidden, so they're listed. Most counted first.
export function offRosterCounts(people, blend) {
  const all = tally(blend, blend.months, COUNTED8);
  return [...(people?.values?.() || [])]
    .filter((p) => !p.onRoster)
    .map((p) => ({ ...p, n: tallyTotal(all, { driverId: p.id }) }))
    .sort((x, y) => y.n - x.n || String(x.name).localeCompare(String(y.name)));
}

// ── Anomalies ────────────────────────────────────────────────────────────────

// History cells that read 0 where the category usually runs at 4 or more a month (the
// median of the up-to-12 whole months before it, at least 3 of them): more likely a
// sheet that wasn't imported than a clean month. 2024-09 misdelivery is one.
//   → [{ ym, category, median, prior }]
export function suspiciousZeros(cov, months, cats, { minMedian = 4, window = 12, minPrior = 3 } = {}) {
  const out = [];
  const sorted = [...new Set(months)].sort();
  for (const cat of cats) {
    const prior = [];
    for (const ym of sorted) {
      const c = cov.cell(ym, cat);
      if (c.state === "history" && c.value === 0 && prior.length >= minPrior) {
        const v = [...prior].sort((a, b) => a - b);
        const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
        if (median >= minMedian) out.push({ ym, category: cat, median, prior: v.length });
      }
      if (c.complete && c.value !== null) {
        prior.push(c.value);
        if (prior.length > window) prior.shift();
      }
    }
  }
  return out.sort((a, b) => a.ym.localeCompare(b.ym) || a.category.localeCompare(b.category));
}

// Failures with no driver, by month — in no driver's total and no company total, so
// this is where they stay visible. Rows marked "do not fault driver" are counted
// apart: they would count against nobody even with a driver.
//   → [{ ym, byCat, total, noFault, counted, ids, countedIds, names: [{ name, n }] }]
// `names` are the load-driver names the rows carry that the roster didn't resolve,
// most frequent first.
export function unattributedByMonth(incidents = [], months = null, cats = FAILURES) {
  const want = months ? new Set(months) : null;
  const by = new Map();
  for (const inc of incidents || []) {
    if (!inc || inc.driver_id || !cats.includes(inc.category)) continue;
    const ym = incidentYm(inc);
    if (!ym || (want && !want.has(ym))) continue;
    const m =
      by.get(ym) ||
      by.set(ym, { ym, byCat: {}, total: 0, noFault: 0, counted: 0, ids: [], countedIds: [], names: new Map() }).get(ym);
    m.byCat[inc.category] = (m.byCat[inc.category] || 0) + 1;
    m.total++;
    m.ids.push(inc.id);
    if (inc.no_fault) m.noFault++;
    else {
      m.counted++;
      m.countedIds.push(inc.id);
    }
    const raw = String(inc.driver_raw || "").replace(/\s+/g, " ").trim();
    if (raw) m.names.set(raw, (m.names.get(raw) || 0) + 1);
  }
  return [...by.values()]
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map((m) => ({
      ...m,
      names: [...m.names].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    }));
}

// ── Report rollups ───────────────────────────────────────────────────────────

const sumBy = (catMap) => {
  const out = new Map();
  for (const [k, n] of Object.entries(catMap || {})) {
    const f = parseCatKey(k);
    const key = `${f.year}-${String(f.month).padStart(2, "0")}|${f.category}`;
    out.set(key, (out.get(key) || 0) + (Number(n) || 0));
  }
  return out;
};

// Each report's rollup against what its rows would roll up today (rollup.js, the
// rollup's own counting):
//   ok     its snapshot matches its rows
//   stale  its rows have changed since it was rolled up — history still holds the old
//          counts (July 2026's: late 52 in history, 39 in the rows)
//   cleared  its snapshot matches its rows, but history no longer holds what it rolled
//          up: a History Import replaces every month's records and keeps the
//          snapshots, so the reports it cleared still look rolled up
//   never  it has rows that count and no snapshot: it was never rolled up (Apr–Jun 2026)
//   empty  nothing in it counts, and nothing was rolled up
// → [{ id, name, report, status, cleared, diffs: [{ ym, category, snapshot, current }],
//      current, snapshot, cells }]
// diffs are per month and category; a stale report whose diffs are empty moved counts
// between drivers only. `cleared` is also set on a stale report history has lost.
// `cells` is the snapshot by "ym|category". Without `history` nothing is checked
// against it, and no report reads as cleared.
export function rollupStatus(reports = [], incidents = [], contribs = [], history = null) {
  const snap = new Map((contribs || []).map((c) => [c.report_id, c]));
  const rowsOf = new Map();
  for (const inc of incidents || []) {
    if (!inc?.report_id) continue;
    (rowsOf.get(inc.report_id) || rowsOf.set(inc.report_id, []).get(inc.report_id)).push(inc);
  }
  // What history holds for each driver, month and category, against what every
  // snapshot together rolled into it. A key holding less than the snapshots owe it has
  // lost counts, and every report that rolled into it needs its Re-sync.
  let short = null;
  if (history) {
    const held = new Map();
    for (const rec of history) {
      if (!rec?.driver_id || !rec.category || !historyYm(rec)) continue;
      const k = compositeKey(rec.year, rec.month, rec.driver_id, rec.category);
      held.set(k, (held.get(k) || 0) + (Number(rec.count) || 0));
    }
    const owed = new Map();
    for (const c of contribs || []) {
      for (const [k, n] of Object.entries(c?.cat || {})) owed.set(k, (owed.get(k) || 0) + (Number(n) || 0));
    }
    short = (k) => (held.get(k) || 0) < (owed.get(k) || 0);
  }
  return (reports || []).map((r) => {
    const cur = computeContribution(rowsOf.get(r.id) || []).cat;
    const s = snap.get(r.id);
    const has = !!s;
    const old = s?.cat || {};
    const keys = new Set([...Object.keys(cur), ...Object.keys(old)]);
    const same = [...keys].every((k) => (Number(cur[k]) || 0) === (Number(old[k]) || 0));
    const cleared = !!short && Object.entries(old).some(([k, n]) => Number(n) > 0 && short(k));
    const a = sumBy(old);
    const b = sumBy(cur);
    const diffs = [];
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const snapshot = a.get(key) || 0;
      const current = b.get(key) || 0;
      if (snapshot === current) continue;
      const [ym, category] = key.split("|");
      diffs.push({ ym, category, snapshot, current });
    }
    diffs.sort((x, y) => x.ym.localeCompare(y.ym) || x.category.localeCompare(y.category));
    const total = (m) => [...m.values()].reduce((t, n) => t + n, 0);
    const status = has ? (!same ? "stale" : cleared ? "cleared" : "ok") : Object.keys(cur).length ? "never" : "empty";
    return { id: r.id, report: r, status, cleared, diffs, current: total(b), snapshot: has ? total(a) : null, cells: a };
  });
}

// ── Reconciliation: why live and history disagree ─────────────────────────────

// For each conflict cell, the rows behind its live count and the likely causes:
//   back_dated         manual entries filed under a spreadsheet month, entered months
//                      later (Jan 2026 forgotten freight: 19, entered Aug 2026)
//   manual_not_rolled  manual entries in a month whose history is report rollups:
//                      only reports roll up, so these were never going to be in it
//   stale_rollup       reports whose snapshot for the cell differs from their rows now
//   never_rolled_up    rows from reports that were never rolled up
//   cleared_rollup     reports rolled up into it whose counts history no longer holds
//   unchecked          the snapshots couldn't be read, so rollups weren't checked
//   unexplained        none of the above
// → [{ ym, category, live, history, delta, ids, causes: [{ kind, n?, … }] }]
export function reconcile({ conflicts = [], incidents = [], history = [], rollups = null }) {
  const sources = new Map(); // "ym|cat" -> Set(source)
  for (const rec of history || []) {
    const ym = historyYm(rec);
    if (!ym || !rec.category || !(Number(rec.count) > 0)) continue;
    const k = `${ym}|${rec.category}`;
    (sources.get(k) || sources.set(k, new Set()).get(k)).add(rec.source || "import");
  }
  const byReport = new Map((rollups || []).map((r) => [r.id, r]));
  return conflicts.map((c) => {
    const rows = (incidents || []).filter(
      (inc) => inc?.category === c.category && incidentYm(inc) === c.ym && countsTowardCharts(inc, { categoryIds: COUNTED8 }),
    );
    const manual = rows.filter((inc) => !inc.report_id);
    const fromReports = rows.filter((inc) => inc.report_id);
    const src = sources.get(`${c.ym}|${c.category}`) || new Set();
    const causes = [];
    const later = manual.filter((inc) => etDay(inc.created_at || inc.ingested_at).slice(0, 7) > c.ym);
    if (src.has("backfill") && later.length) {
      const months = new Map();
      for (const inc of later) {
        const m = etDay(inc.created_at || inc.ingested_at).slice(0, 7);
        months.set(m, (months.get(m) || 0) + 1);
      }
      const enteredIn = [...months].sort((a, b) => b[1] - a[1])[0][0];
      causes.push({ kind: "back_dated", n: later.length, enteredIn });
    }
    if (src.has("report") && manual.length) causes.push({ kind: "manual_not_rolled", n: manual.length });
    if (rollups === null) {
      if (fromReports.length) causes.push({ kind: "unchecked" });
    } else {
      const stale = [];
      let never = 0;
      const neverIds = new Set();
      for (const inc of fromReports) {
        const r = byReport.get(inc.report_id);
        if (r?.status === "never") {
          never++;
          neverIds.add(r.id);
        }
      }
      for (const r of rollups) {
        if (r.status !== "stale") continue;
        const d = r.diffs.find((x) => x.ym === c.ym && x.category === c.category);
        if (d) stale.push({ id: r.id, report: r.report, snapshot: d.snapshot, current: d.current });
      }
      if (stale.length) causes.push({ kind: "stale_rollup", reports: stale });
      const cleared = rollups.filter(
        (r) => r.status === "cleared" && (r.cells?.get(`${c.ym}|${c.category}`) || 0) > 0,
      );
      if (cleared.length) causes.push({ kind: "cleared_rollup", reports: cleared.map((r) => ({ id: r.id, report: r.report })) });
      if (never) causes.push({ kind: "never_rolled_up", n: never, reportIds: [...neverIds] });
    }
    if (!causes.length) causes.push({ kind: "unexplained" });
    return {
      ym: c.ym,
      category: c.category,
      live: c.live,
      history: c.history,
      delta: c.live - c.history,
      ids: rows.map((inc) => inc.id),
      causes,
    };
  });
}

// One cause in words.
export function causeText(cause) {
  switch (cause.kind) {
    case "back_dated":
      return `back-dated entries: ${cause.n} entered in ${fmtYm(cause.enteredIn)}`;
    case "manual_not_rolled":
      return `${cause.n} manual ${cause.n === 1 ? "entry" : "entries"} — manual entries never roll up`;
    case "stale_rollup": {
      const snap = cause.reports.reduce((t, r) => t + r.snapshot, 0);
      const cur = cause.reports.reduce((t, r) => t + r.current, 0);
      const n = cause.reports.length;
      return `stale report rollup: ${n} report${n === 1 ? "" : "s"} rolled up ${snap}, their rows now count ${cur}`;
    }
    case "cleared_rollup": {
      const n = cause.reports.length;
      return `${n} report rollup${n === 1 ? "" : "s"} no longer in history — an import or a delete cleared ${n === 1 ? "it" : "them"}`;
    }
    case "never_rolled_up":
      return `${cause.n} row${cause.n === 1 ? "" : "s"} from reports never rolled up`;
    case "unchecked":
      return "report rollups not checked — their snapshots couldn't be read";
    default:
      return "no cause found";
  }
}

// A report's span in words, for the rollup lists.
export function reportSpanText(r) {
  const a = String(r?.starts_at || "").slice(0, 10);
  const b = String(r?.ends_at || "").slice(0, 10);
  if (isYmd(a) && isYmd(b)) return a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;
  return r?.week_ending ? `week ending ${r.week_ending}` : "";
}
export { fmtDay };
