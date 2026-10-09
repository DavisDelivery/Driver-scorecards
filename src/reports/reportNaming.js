// Report naming + date-range helpers (Phase 5).
//
// A report's display `name` is editable, but starts_at / ends_at always hold the
// true MIN / MAX incident date so analytics group by real dates, not the label.

import { MONTH_NAMES } from "../data/analytics.js";
import { incidentDateStr } from "../data/incidentDate.js";

// True min/max incident date across a report's incidents → { starts_at, ends_at }
// (YYYY-MM-DD strings, or null when no dated incidents exist). Each incident's date is
// the one it is filed under everywhere else (incidentDateStr) — this used to read a
// private copy of that precedence in analytics.js.
export function reportDateBounds(incidents) {
  let min = null;
  let max = null;
  for (const inc of incidents) {
    const d = incidentDateStr(inc).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  return { starts_at: min, ends_at: max };
}

function parts(dateStr) {
  // dateStr is YYYY-MM-DD; build parts without timezone drift.
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

// "Week of {Mon D}–{D}" (same month) / "Week of {Mon D} – {Mon D}" (spans months)
// / "...{, YYYY}" only when the range spans different years.
export function suggestReportName(starts_at, ends_at) {
  if (!starts_at && !ends_at) return "";
  const start = starts_at || ends_at;
  const end = ends_at || starts_at;
  const s = parts(start);
  const e = parts(end);

  if (start === end) {
    return `Week of ${MONTH_NAMES[s.m - 1]} ${s.d}`;
  }
  if (s.y === e.y && s.m === e.m) {
    return `Week of ${MONTH_NAMES[s.m - 1]} ${s.d}–${e.d}`;
  }
  if (s.y === e.y) {
    return `Week of ${MONTH_NAMES[s.m - 1]} ${s.d} – ${MONTH_NAMES[e.m - 1]} ${e.d}`;
  }
  return `Week of ${MONTH_NAMES[s.m - 1]} ${s.d}, ${s.y} – ${MONTH_NAMES[e.m - 1]} ${e.d}, ${e.y}`;
}

// Compact display span for a saved report. Falls back to legacy fields when a
// report predates starts_at/ends_at.
export function reportSpanLabel(report) {
  const start = report?.starts_at;
  const end = report?.ends_at;
  if (start || end) {
    const s = parts(start || end);
    const e = parts(end || start);
    const yr = s.y === e.y ? `, ${e.y}` : "";
    if ((start || end) === (end || start)) {
      return `${MONTH_NAMES[s.m - 1]} ${s.d}${yr}`;
    }
    if (s.y === e.y && s.m === e.m) {
      return `${MONTH_NAMES[s.m - 1]} ${s.d}–${e.d}${yr}`;
    }
    if (s.y === e.y) {
      return `${MONTH_NAMES[s.m - 1]} ${s.d} – ${MONTH_NAMES[e.m - 1]} ${e.d}, ${e.y}`;
    }
    return `${MONTH_NAMES[s.m - 1]} ${s.d}, ${s.y} – ${MONTH_NAMES[e.m - 1]} ${e.d}, ${e.y}`;
  }
  if (report?.week_ending) {
    const w = String(report.week_ending).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) return `Week ending ${report.week_ending}`;
    const p = parts(w);
    return `Week ending ${MONTH_NAMES[p.m - 1]} ${p.d}, ${p.y}`;
  }
  return report?.range_label || "—";
}

// The span label a new report is saved with (its stored range_label). It keeps the stored
// format it always had — a report with no start/end span is "Week ending 2026-04-17" —
// so a visual change never alters what is written to Firestore; reportSpanLabel above
// is the on-screen reading of the same span.
export function storedRangeLabel(report) {
  if (!(report?.starts_at || report?.ends_at) && report?.week_ending) return `Week ending ${report.week_ending}`;
  return reportSpanLabel(report);
}

// The first day of a report's span, short ("Jun 30"), or its week ending for a report
// that predates spans: the weekly chart's axis tick, where a whole span doesn't fit at
// phone width. The tooltip and the table carry the span.
export function reportStartLabel(report) {
  const start = report?.starts_at || report?.ends_at || report?.week_ending;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(start || ""))) return reportSpanLabel(report);
  const s = parts(String(start).slice(0, 10));
  return `${MONTH_NAMES[s.m - 1]} ${s.d}`;
}

// A Uline report's own label: "9/14/2026 THRU 9/18/2026".
const ULINE_LABEL = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+thru\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/i;

// The Monday of the week a report covers (YYYY-MM-DD): the week its Uline label starts
// in when its name is one, otherwise the week of the first day of its span (or of its
// week ending, for a report that predates spans). null when it has no date. Worked out
// from the date's parts in UTC arithmetic, so no timezone can move it a day.
export function reportWeekOf(report) {
  const m = ULINE_LABEL.exec(String(report?.name || ""));
  let d;
  if (m && +m[1] >= 1 && +m[1] <= 12) d = `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  else d = String(report?.starts_at || report?.ends_at || report?.week_ending || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const { y, m: mo, d: day } = parts(d);
  const t = Date.UTC(y, mo - 1, day);
  const back = (new Date(t).getUTCDay() + 6) % 7; // days since Monday
  return new Date(t - back * 86400000).toISOString().slice(0, 10);
}

// A report's name as a person reads it, in the reports table: a Uline label reads "Week
// of Sep 14, 2026" (its Monday); a name someone typed is shown as typed.
export function reportWeekName(report) {
  const name = report?.name || "";
  const week = ULINE_LABEL.test(name) ? reportWeekOf(report) : null;
  if (!week) return name || "Untitled report";
  const p = parts(week);
  return `Week of ${MONTH_NAMES[p.m - 1]} ${p.d}, ${p.y}`;
}

// The weekly chart's tick for a report: its week's Monday, short ("Sep 14") — the same
// Monday the table's "Week of" names, so the ticks fall on a weekly grid.
export function reportWeekTick(report) {
  const week = reportWeekOf(report);
  if (!week) return reportStartLabel(report);
  const p = parts(week);
  return `${MONTH_NAMES[p.m - 1]} ${p.d}`;
}
