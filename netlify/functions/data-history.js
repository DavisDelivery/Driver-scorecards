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

async function loadAll(store) {
  const blob = await store.get(KEY, { type: "json" });
  return blob && blob.records ? blob : { records: {}, updated_at: null };
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
      const driverId = url.searchParams.get("driver_id");
      const year = url.searchParams.get("year");
      const month = url.searchParams.get("month");
      if (driverId) records = records.filter((r) => r.driver_id === driverId);
      if (year) records = records.filter((r) => r.year === Number(year));
      if (month) records = records.filter((r) => r.month === Number(month));
      return json({ records });
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
      // Aggregate this report's incidents into per driver/month/category counts.
      const agg = new Map();
      for (const inc of incidents) {
        if (!inc.driver_id || !TRACKED.has(inc.category)) continue;
        const ym = incidentYearMonth(inc);
        if (!ym) continue;
        const key = compositeKey(ym.year, ym.month, inc.driver_id, inc.category);
        const cur =
          agg.get(key) ||
          {
            driver_id: inc.driver_id,
            driver_name: inc.driver_name || "",
            driver_raw: inc.driver_raw || "",
            year: ym.year,
            month: ym.month,
            category: inc.category,
            count: 0,
          };
        cur.count += 1;
        agg.set(key, cur);
      }
      let updated = 0;
      for (const [key, rec] of agg) {
        const existing = data.records[key];
        data.records[key] = {
          ...rec,
          count: (existing?.count || 0) + rec.count,
          source: report_id ? `report:${report_id}` : "report",
          updated_at: new Date().toISOString(),
        };
        updated++;
      }
      await saveAll(store, data);
      return json({ updated });
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
