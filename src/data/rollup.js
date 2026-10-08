// What a report's rows add to history: the rollup's counting, without the database.
//
// Moved out of firebase.js unchanged (v0.23.0) so it can be imported where the SDK
// can't be: the Data Coverage page recomputes what each report would roll up today and
// compares it with the snapshot dds_report_contrib holds for it — a difference is a
// stale rollup (coverage.js rollupStatus) — and the tests can run it. firebase.js still
// does every write; it imports the same functions, so the page and the rollup can't
// count two different ways.

import { COUNTED8 } from "./categories.js";

// The eight categories the rollup tracks — the registry's COUNTED8, so the screens that
// decide which months' categories are live can never disagree with what the rollup wrote.
const TRACKED = new Set(COUNTED8);

export const compositeKey = (year, month, driverId, category) =>
  `${year}:${String(month).padStart(2, "0")}:${driverId}:${category}`;
const srcKey = (year, month, driverId, source) =>
  `${year}:${String(month).padStart(2, "0")}:${driverId}:${source}`;

function incidentYearMonth(inc) {
  const d =
    inc.delivered_date ||
    inc.actual_delivery ||
    inc.return_date ||
    inc.trace_date ||
    inc.ship_date ||
    inc.week_ending ||
    inc.ingested_at ||
    "";
  if (!d || d.length < 7) return null;
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
}

// A report's contribution: { cat: { "YYYY:MM:driver:category": n }, src: { …:source: n } }.
export function computeContribution(incidents) {
  const cat = {};
  const src = {};
  for (const inc of incidents) {
    if (!inc.driver_id || inc.no_fault) continue;
    const ym = incidentYearMonth(inc);
    if (!ym) continue;
    if (TRACKED.has(inc.category)) {
      const k = compositeKey(ym.year, ym.month, inc.driver_id, inc.category);
      cat[k] = (cat[k] || 0) + 1;
    }
    for (const s of Array.isArray(inc.sources) ? inc.sources : []) {
      const k = srcKey(ym.year, ym.month, inc.driver_id, s);
      src[k] = (src[k] || 0) + 1;
    }
  }
  return { cat, src };
}

export const parseCatKey = (k) => {
  const [year, month, driver_id, category] = k.split(":");
  return { year: Number(year), month: Number(month), driver_id, category };
};
export const parseSrcKey = (k) => {
  const [year, month, driver_id, source] = k.split(":");
  return { year: Number(year), month: Number(month), driver_id, source };
};
