// Report naming + date-range helpers (Phase 5).
//
// A report's display `name` is editable, but starts_at / ends_at always hold the
// true MIN / MAX incident date so analytics group by real dates, not the label.

import { incidentDate, MONTH_NAMES } from "../data/analytics.js";

// True min/max incident date across a report's incidents → { starts_at, ends_at }
// (YYYY-MM-DD strings, or null when no dated incidents exist).
export function reportDateBounds(incidents) {
  let min = null;
  let max = null;
  for (const inc of incidents) {
    const d = incidentDate(inc);
    if (!d || d.length < 10) continue;
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
  if (report?.week_ending) return `Week ending ${report.week_ending}`;
  return report?.range_label || "—";
}
