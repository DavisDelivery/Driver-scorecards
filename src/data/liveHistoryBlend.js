// The rule for blending LIVE incidents with ROLLED-UP history.
//
// Recent months are read from the live incident set; older months, whose incidents
// have been rolled up and purged, come from dds_history. Each category of each month is
// served by one or the other, never both — "live supersedes" — because counting both
// would double every incident in a month that has been partly rolled up.
//
// The subtlety that broke it: a month qualifies for live ONLY if it contains an
// incident that actually gets counted. Deciding by "are there any live rows this
// month" meant a single row contributing nothing — a compliment, an unable-to-track
// entry, a no-fault row, or (with the driver-fault filter on) somebody else's fault —
// replaced that month's whole history with nothing, and the month rendered as zero.
// Since v0.21.1 the blend qualifies each category of a month on its own (blend.js), so a
// counted row hides only its own category's history, never the rest of the month's.
//
// The rule lived inline in both Trends and the Scorecard and had already drifted
// between them, so it lives here now, and blend.js — the one blend every screen counts
// from — imports it.

// Does this incident contribute to a driver/category count?
//
// `categoryIds` is the caller's own chart vocabulary: the views each chart a subset
// of the categories, and a category nobody charts (return, trace, unable_to_track)
// must not make anything live either.
export function countsTowardCharts(inc, { categoryIds, faultFilter = null } = {}) {
  if (!inc || !inc.driver_id) return false;
  if (inc.no_fault) return false;
  if (faultFilter === "driver" && inc.fault !== "driver") return false;
  if (!Array.isArray(categoryIds)) return false;
  return categoryIds.includes(inc.category);
}

// Which categories a rolled-up history month actually tracked, as ym => Set of ids.
//
// The backfill held lost/missing only for 2023 and FF/damage/misdelivery only for 2024,
// and a report rollup never carries FF or attempts. So in a month served from history,
// a 0 for any other category means "not tracked", not "none happened", and a table
// shows it as "—". A category counts as tracked in a month when one of the sources the
// month's records came from (backfill, report) holds that category anywhere in the
// same year. This only decides how a cell reads; it never changes a count.
export function historyCoverage(history, categoryIds) {
  const catsBy = new Map(); // "year|source" -> Set of category ids
  const sourcesBy = new Map(); // ym -> Set of sources
  const add = (map, key, value) => (map.get(key) || map.set(key, new Set()).get(key)).add(value);
  for (const rec of history || []) {
    if (!rec || !categoryIds.includes(rec.category)) continue;
    const y = Number(rec.year);
    const m = Number(rec.month);
    if (!y || !m) continue;
    const source = rec.source || "";
    add(catsBy, `${y}|${source}`, rec.category);
    add(sourcesBy, `${y}-${String(m).padStart(2, "0")}`, source);
  }
  return (ym) => {
    const out = new Set();
    for (const source of sourcesBy.get(ym) || []) {
      for (const c of catsBy.get(`${ym.slice(0, 4)}|${source}`) || []) out.add(c);
    }
    return out;
  };
}
