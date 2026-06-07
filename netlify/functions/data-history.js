// data-history — historical driver-performance rollups.
// Store: "davis-history", SINGLE blob "history:all":
//   { records: { "{year}:{MM}:{driver_id}:{category}": {record}, ... }, updated_at }
// where each record = { driver_id, driver_name, driver_raw, year, month, category, count, source, updated_at }.
//
// Routes (under /.netlify/functions/data-history):
//   GET    /                     → { records: [...] }  (filters: ?driver_id ?year ?month)
//   PUT    /        body=record   → upsert one → { record }
//   POST   /batch   body={records,replace} → bulk upsert → { records: [...saved] }
//   POST   /rollup-report  body={incidents,report_id} → aggregate into history → { updated }
//   DELETE /all                   → clear all → { deleted }
//
// NOTE: the /rollup-report aggregation is reconstructed from the documented
// behavior (the original function source was unrecoverable). It rolls up each
// incident that has a driver_id and a tracked category into per
// driver/month/category counts (additively). Verify before relying on it.
import { getStore } from "@netlify/blobs";

const STORE = "davis-history";
const KEY = "history:all";

// Categories tracked in historical performance (mirrors the trends/dashboard set).
const TRACKED = new Set([
  "forgotten_freight",
  "damage",
  "missing",
  "misdelivery",
  "attempts",
  "late",
  "complaint",
  "compliment",
]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const compositeKey = (year, month, driverId, category) =>
  `${year}:${String(month).padStart(2, "0")}:${driverId}:${category}`;
const srcKey = (year, month, driverId, source) =>
  `${year}:${String(month).padStart(2, "0")}:${driverId}:${source}`;

// Compute a report's contribution to history. Per-category counts (driver-fault,
// TRACKED categories only) and per-source counts (overlapping Uline volumes).
// "Do not fault driver" incidents (no_fault) are excluded from BOTH.
function computeContribution(incidents) {
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
    const sources = Array.isArray(inc.sources) ? inc.sources : [];
    for (const s of sources) {
      const k = srcKey(ym.year, ym.month, inc.driver_id, s);
      src[k] = (src[k] || 0) + 1;
    }
  }
  return { cat, src };
}

function parseCatKey(k) {
  const [year, month, driver_id, category] = k.split(":");
  return { year: Number(year), month: Number(month), driver_id, category };
}
function parseSrcKey(k) {
  const [year, month, driver_id, source] = k.split(":");
  return { year: Number(year), month: Number(month), driver_id, source };
}

// Apply a signed contribution to the history maps (+1 add, -1 remove). Counts
// floor at 0. meta = { driverId: { name, raw } } for fresh records.
function applyContribution(data, contrib, sign, meta = {}) {
  const stamp = new Date().toISOString();
  for (const [k, n] of Object.entries(contrib.cat || {})) {
    const f = parseCatKey(k);
    const ex = data.records[k];
    const count = Math.max(0, (ex?.count || 0) + sign * n);
    data.records[k] = {
      driver_id: f.driver_id,
      driver_name: meta[f.driver_id]?.name || ex?.driver_name || "",
      driver_raw: meta[f.driver_id]?.raw || ex?.driver_raw || "",
      year: f.year,
      month: f.month,
      category: f.category,
      count,
      source: ex?.source || "report",
      updated_at: stamp,
    };
  }
  for (const [k, n] of Object.entries(contrib.src || {})) {
    const f = parseSrcKey(k);
    const ex = data.source_records[k];
    const count = Math.max(0, (ex?.count || 0) + sign * n);
    data.source_records[k] = {
      driver_id: f.driver_id,
      driver_name: meta[f.driver_id]?.name || ex?.driver_name || "",
      year: f.year,
      month: f.month,
      source: f.source,
      count,
      updated_at: stamp,
    };
  }
}

function driverMeta(incidents) {
  const m = {};
  for (const inc of incidents) {
    if (inc.driver_id && !m[inc.driver_id]) {
      m[inc.driver_id] = { name: inc.driver_name || "", raw: inc.driver_raw || "" };
    }
  }
  return m;
}

async function loadAll(store) {
  const blob = await store.get(KEY, { type: "json" });
  return {
    records: blob?.records || {},
    source_records: blob?.source_records || {},
    report_contrib: blob?.report_contrib || {},
    updated_at: blob?.updated_at || null,
  };
}
async function saveAll(store, data) {
  data.updated_at = new Date().toISOString();
  await store.setJSON(KEY, data);
}

function upsert(data, rec) {
  if (!rec || !rec.driver_id || !rec.year || !rec.month || !rec.category) return null;
  const key = compositeKey(rec.year, rec.month, rec.driver_id, rec.category);
  const record = {
    driver_id: rec.driver_id,
    driver_name: rec.driver_name || "",
    driver_raw: rec.driver_raw || "",
    year: Number(rec.year),
    month: Number(rec.month),
    category: rec.category,
    count: Number(rec.count) || 0,
    source: rec.source || "import",
    updated_at: new Date().toISOString(),
  };
  data.records[key] = record;
  return record;
}

// Derive YYYY-MM from an incident using the same date precedence as the views.
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

export default async (req) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    if (req.method === "GET") {
      const data = await loadAll(store);
      let records = Object.values(data.records);
      let sourceRecords = Object.values(data.source_records || {});
      const driverId = url.searchParams.get("driver_id");
      const year = url.searchParams.get("year");
      const month = url.searchParams.get("month");
      const f = (list) => {
        if (driverId) list = list.filter((r) => r.driver_id === driverId);
        if (year) list = list.filter((r) => r.year === Number(year));
        if (month) list = list.filter((r) => r.month === Number(month));
        return list;
      };
      return json({ records: f(records), source_records: f(sourceRecords) });
    }

    if (req.method === "PUT") {
      const data = await loadAll(store);
      const record = upsert(data, await req.json());
      await saveAll(store, data);
      return json({ record });
    }

    if (req.method === "POST" && path.endsWith("/batch")) {
      const { records = [], replace = false } = await req.json();
      const data = replace ? { records: {}, updated_at: null } : await loadAll(store);
      const saved = [];
      for (const rec of records) {
        const r = upsert(data, rec);
        if (r) saved.push(r);
      }
      await saveAll(store, data);
      return json({ records: saved });
    }

    if (req.method === "POST" && path.endsWith("/rollup-report")) {
      const { incidents = [], report_id } = await req.json();
      const data = await loadAll(store);

      // Idempotent per report: reverse any prior contribution for this
      // report_id before applying the fresh one, so re-dropping a report
      // can never double-count.
      if (report_id && data.report_contrib[report_id]) {
        applyContribution(data, data.report_contrib[report_id], -1);
      }
      const contrib = computeContribution(incidents);
      applyContribution(data, contrib, +1, driverMeta(incidents));
      if (report_id) data.report_contrib[report_id] = contrib;

      await saveAll(store, data);
      return json({
        updated: Object.keys(contrib.cat).length,
        source_updated: Object.keys(contrib.src).length,
      });
    }

    if (req.method === "POST" && path.endsWith("/unroll-report")) {
      // Reverse a report's contribution. Uses the stored snapshot when present;
      // otherwise recomputes from the supplied incidents (for reports rolled up
      // before snapshots existed).
      const { incidents = [], report_id } = await req.json();
      const data = await loadAll(store);
      const contrib =
        (report_id && data.report_contrib[report_id]) ||
        computeContribution(incidents);
      applyContribution(data, contrib, -1);
      if (report_id) delete data.report_contrib[report_id];
      await saveAll(store, data);
      return json({
        unrolled: Object.keys(contrib.cat || {}).length,
        source_unrolled: Object.keys(contrib.src || {}).length,
      });
    }

    if (req.method === "DELETE" && path.endsWith("/all")) {
      const data = await loadAll(store);
      const deleted = Object.keys(data.records).length;
      await store.setJSON(KEY, { records: {}, updated_at: new Date().toISOString() });
      return json({ deleted });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};
