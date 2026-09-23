// The one date an incident is filed under, for month bucketing.
//
// The Scorecard, Trends and the driver detail each used to carry their own copy of
// this precedence, and the driver detail's had drifted: it read ship_date ahead of
// return_date, so a return shipped in July and returned in August was an August
// incident on the Scorecard and a July incident in the popup you opened from it.
// One definition, imported everywhere that buckets by month.
//
// Returns the raw string (YYYY-MM-DD or an ISO timestamp); callers slice what they
// need. Never put it through Date() — see the Dates section of CLAUDE.md.
export function incidentDateStr(inc) {
  if (!inc) return "";
  return String(
    inc.delivered_date ||
      inc.actual_delivery ||
      inc.return_date ||
      inc.trace_date ||
      inc.ship_date ||
      inc.week_ending ||
      inc.ingested_at ||
      "",
  );
}

// "YYYY-MM", or "" when the incident carries no usable date.
export function incidentYm(inc) {
  const ym = incidentDateStr(inc).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(ym) ? ym : "";
}

// MM/DD/YYYY for display, parsed from the string so the day can't shift.
export function fmtIncidentDate(inc) {
  const m = incidentDateStr(inc).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "—";
}
