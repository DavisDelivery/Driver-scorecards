// The rule for blending LIVE incidents with ROLLED-UP history.
//
// Recent months are read from the live incident set; older months, whose incidents
// have been rolled up and purged, come from dds_history. A month is served by one or
// the other, never both — "live supersedes" — because counting both would double
// every incident in a month that has been partly rolled up.
//
// The subtlety that broke it: a month qualifies for live ONLY if it contains an
// incident that actually gets counted. Deciding by "are there any live rows this
// month" meant a single row contributing nothing — a compliment, an unable-to-track
// entry, a no-fault row, or (with the driver-fault filter on) somebody else's fault —
// replaced that month's whole history with nothing, and the month rendered as zero.
//
// The rule lived inline in both Trends and the Scorecard and had already drifted
// between them, so it lives here now and both import it.

// Does this incident contribute to a driver/category count?
//
// `categoryIds` is the caller's own chart vocabulary: the views each chart a subset
// of the categories, and a category nobody charts (return, trace, unable_to_track)
// must not qualify a month either.
export function countsTowardCharts(inc, { categoryIds, faultFilter = null } = {}) {
  if (!inc || !inc.driver_id) return false;
  if (inc.no_fault) return false;
  if (faultFilter === "driver" && inc.fault !== "driver") return false;
  if (!Array.isArray(categoryIds)) return false;
  return categoryIds.includes(inc.category);
}
