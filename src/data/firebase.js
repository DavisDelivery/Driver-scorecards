// Data client for the Davis Driver Scorecard — now backed by Google Firestore.
//
// (The filename stays "firebase.js" because every view imports from it; this IS
// Firebase now, unlike the previous Netlify-Blobs implementation that carried
// the same name historically.)
//
// Why Firestore: its offline persistence queues writes made while offline / on a
// flaky connection and syncs them automatically, and all devices converge on the
// same data. That removes the old failure mode where a write silently fell back
// to one browser's localStorage and never reached anyone else.
//
// Document model (mirrors the old split-storage so nothing else had to change):
//   dds_incidents/{id}       → light incident (NO photo bytes)
//   dds_incident_photos/{id} → { photo_urls, photo_meta }      (large; size-guarded)
//   dds_reports/{id}         → report metadata (NO pdf bytes)
//   dds_report_pdfs/{id}     → { pdf_data }                     (large; size-guarded)
//   dds_app_meta/drivers     → { drivers: [...] }               (whole roster)
//   dds_app_meta/history     → { records, source_records, report_contrib, updated_at }
//
// Reviews are NOT here — they come from an external source (see data/reviews.js).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebaseApp.js";

// All collections are dds_-prefixed: davismarginiq is a shared Davis Firebase
// project, and the prefix guarantees this app can never collide with another
// app's collections in the same Firestore.
const INCIDENTS = "dds_incidents";
const INCIDENT_PHOTOS = "dds_incident_photos";
const REPORTS = "dds_reports";
const REPORT_PDFS = "dds_report_pdfs";
const META = "dds_app_meta";

// Firestore hard-caps a document at ~1 MiB. Delivery photos are base64 data URIs
// of roughly 100-300 KB each, so a stop with several POD photos blows past that
// as a single blob. Photos are therefore stored ONE PER DOCUMENT
// (dds_incident_photos/{incidentId}__{idx}), which keeps every write far under
// the cap no matter how many photos a stop has. Only a single photo that is
// itself oversize gets skipped. Legacy docs written before this change kept all
// photos in one doc keyed by incident id — getIncidentPhotos still reads those.
const DOC_MAX = 1_000_000;
// Leave headroom for the doc's other fields + Firestore overhead.
const PHOTO_MAX = 900_000;
const jsonSize = (o) => JSON.stringify(o).length;
const rand = () => Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();

// Split an incident into its light doc (no photo bytes). has_photos/photo_count
// are only set when photos are actually supplied, so a metadata-only edit can't
// clobber an existing incident's photo flags (they're preserved by merge).
function lightIncident(incident, id) {
  const { photo_urls, photo_meta, ...rest } = incident;
  const light = {
    ...rest,
    id,
    updated_at: nowISO(),
    created_at: incident.created_at || nowISO(),
  };
  if (Array.isArray(photo_urls)) {
    light.has_photos = photo_urls.length > 0;
    light.photo_count = photo_urls.length;
  }
  return { light, photo_urls, photo_meta };
}

// ---- incidents -----------------------------------------------------------

// Every photo doc belonging to one incident (new per-photo shape + the legacy
// all-in-one doc keyed by the incident id).
async function photoDocRefs(incidentId) {
  const refs = [];
  const legacy = await getDoc(doc(db, INCIDENT_PHOTOS, incidentId));
  if (legacy.exists()) refs.push(legacy.ref);
  const q = query(
    collection(db, INCIDENT_PHOTOS),
    where("incident_id", "==", incidentId),
  );
  const snap = await getDocs(q);
  snap.forEach((d) => refs.push(d.ref));
  return refs;
}

// Write an incident's photos as one document per photo. Returns how many were
// stored and how many single photos were too large to store at all.
async function savePhotosFor(incidentId, photoUrls, photoMeta) {
  // Clear any previous photo docs (including a legacy combined one) so a re-pull
  // can't leave orphaned or duplicated images behind.
  for (const ref of await photoDocRefs(incidentId)) {
    await deleteDoc(ref).catch(() => {});
  }
  let stored = 0;
  let oversize = 0;
  for (let i = 0; i < photoUrls.length; i++) {
    const url = photoUrls[i];
    if (!url) continue;
    if (url.length > PHOTO_MAX) {
      oversize++;
      continue;
    }
    await setDoc(doc(db, INCIDENT_PHOTOS, `${incidentId}__${i}`), {
      incident_id: incidentId,
      idx: i,
      url,
      meta: photoMeta?.[i] ?? null,
    });
    stored++;
  }
  return { stored, oversize };
}

export async function saveIncident(incident) {
  const id = incident.id || `i_${Date.now()}_${rand()}`;
  const { light, photo_urls, photo_meta } = lightIncident(incident, id);
  await setDoc(doc(db, INCIDENTS, id), light, { merge: true });
  if (Array.isArray(photo_urls) && photo_urls.length) {
    const { stored, oversize } = await savePhotosFor(id, photo_urls, photo_meta);
    // Reflect what actually persisted, and clear any stale oversize flag from
    // the era when a whole photo set was dropped for being too big together.
    const flags = {
      has_photos: stored > 0,
      photo_count: stored,
      photos_dropped_oversize: oversize > 0,
    };
    await setDoc(doc(db, INCIDENTS, id), flags, { merge: true });
    return { ...light, ...flags };
  }
  return light;
}

// Firestore manages its own offline write queue + retry, so there is no manual
// pending-sync bookkeeping to do here. Kept as no-op stubs so callers (App) keep
// working; the SDK guarantees queued writes reach the server once reconnected.
export function countPendingIncidents() {
  return 0;
}
export async function flushPendingIncidents() {
  return { flushed: 0, remaining: 0 };
}

export async function saveIncidentsBatch(incidents, onProgress = null) {
  const saved = [];
  let done = 0;
  const CHUNK = 200; // ≤500 writes per Firestore batch; light docs only here
  for (let i = 0; i < incidents.length; i += CHUNK) {
    const slice = incidents.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    const photoWrites = [];
    const lights = [];
    for (const inc of slice) {
      const id = inc.id || `i_${Date.now()}_${rand()}`;
      const { light, photo_urls, photo_meta } = lightIncident(inc, id);
      batch.set(doc(db, INCIDENTS, id), light, { merge: true });
      lights.push(light);
      if (Array.isArray(photo_urls) && photo_urls.length) {
        photoWrites.push([id, { photo_urls, photo_meta: photo_meta || [] }]);
      }
    }
    await batch.commit();
    // Photo docs are large — write them one photo at a time, outside the batch.
    for (const [id, payload] of photoWrites) {
      try {
        const { stored, oversize } = await savePhotosFor(
          id,
          payload.photo_urls,
          payload.photo_meta,
        );
        await setDoc(
          doc(db, INCIDENTS, id),
          {
            has_photos: stored > 0,
            photo_count: stored,
            photos_dropped_oversize: oversize > 0,
          },
          { merge: true },
        );
      } catch (e) {
        console.warn(`photo write failed for ${id}:`, e.message);
      }
    }
    saved.push(...lights);
    done += slice.length;
    onProgress?.({ done, total: incidents.length });
  }
  return saved;
}

export async function getIncidents() {
  try {
    const snap = await getDocs(collection(db, INCIDENTS));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  } catch (err) {
    console.warn("getIncidents failed:", err.message);
    return [];
  }
}

export async function getIncidentPhotos(id) {
  if (!id) return { photo_urls: [], photo_meta: [] };
  try {
    // Current shape: one doc per photo, keyed by incident_id.
    const snap = await getDocs(
      query(collection(db, INCIDENT_PHOTOS), where("incident_id", "==", id)),
    );
    if (!snap.empty) {
      const rows = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
      return {
        photo_urls: rows.map((r) => r.url).filter(Boolean),
        photo_meta: rows.map((r) => r.meta ?? null),
      };
    }
    // Legacy shape: all photos in a single doc keyed by the incident id.
    const s = await getDoc(doc(db, INCIDENT_PHOTOS, id));
    if (!s.exists()) return { photo_urls: [], photo_meta: [] };
    const d = s.data();
    return { photo_urls: d.photo_urls || [], photo_meta: d.photo_meta || [] };
  } catch (err) {
    console.warn(`getIncidentPhotos(${id}) failed:`, err.message);
    return { photo_urls: [], photo_meta: [] };
  }
}

// Fetch photos for many incidents with bounded parallelism.
export async function getIncidentPhotosBatch(ids, onProgress = () => {}) {
  const out = new Map();
  let done = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const slice = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (id) => [id, await getIncidentPhotos(id)]),
    );
    for (const [id, photos] of results) {
      out.set(id, photos);
      done++;
      onProgress({ done, total: ids.length });
    }
  }
  return out;
}

export async function getIncidentsForReport(reportId) {
  try {
    const q = query(
      collection(db, INCIDENTS),
      where("report_id", "==", reportId),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  } catch (err) {
    console.warn("getIncidentsForReport failed:", err.message);
    return [];
  }
}

// Delete every incident (and its photo doc) tied to a report.
export async function deleteIncidentsForReport(reportId) {
  try {
    const q = query(
      collection(db, INCIDENTS),
      where("report_id", "==", reportId),
    );
    const snap = await getDocs(q);
    await deleteIdsWithPhotos(snap.docs.map((d) => d.id));
  } catch (err) {
    console.warn("deleteIncidentsForReport failed:", err.message);
  }
}

export async function deleteIncident(id) {
  try {
    await deleteDoc(doc(db, INCIDENTS, id));
    for (const ref of await photoDocRefs(id)) {
      await deleteDoc(ref).catch(() => {});
    }
  } catch (err) {
    console.warn("deleteIncident failed:", err.message);
  }
}

export async function deleteIncidentsBatch(ids) {
  try {
    await deleteIdsWithPhotos(ids);
  } catch (err) {
    console.warn("deleteIncidentsBatch failed:", err.message);
  }
}

// Batch-delete incident docs plus every photo doc that belongs to them (the
// per-photo docs and any legacy combined doc), chunked under the 500-op cap.
async function deleteIdsWithPhotos(ids) {
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const id of slice) batch.delete(doc(db, INCIDENTS, id));
    await batch.commit();
    for (const id of slice) {
      for (const ref of await photoDocRefs(id)) {
        await deleteDoc(ref).catch(() => {});
      }
    }
  }
}

// ---- drivers -------------------------------------------------------------

export async function saveDrivers(drivers) {
  try {
    await setDoc(doc(db, META, "drivers"), { drivers });
  } catch (err) {
    console.warn("saveDrivers failed:", err.message);
  }
}

export async function getDrivers() {
  try {
    const s = await getDoc(doc(db, META, "drivers"));
    return s.exists() ? s.data().drivers || [] : [];
  } catch (err) {
    console.warn("getDrivers failed:", err.message);
    return [];
  }
}

// ---- reports -------------------------------------------------------------

export async function saveReport(report) {
  const id = report.id || `r_${Date.now()}_${rand()}`;
  const { pdf_data, pdf, ...rest } = report;
  const meta = {
    ...rest,
    id,
    updated_at: nowISO(),
    created_at: report.created_at || nowISO(),
  };
  await setDoc(doc(db, REPORTS, id), meta, { merge: true });
  const bytes = pdf_data || pdf;
  if (bytes) {
    const payload = { pdf_data: bytes };
    if (jsonSize(payload) <= DOC_MAX) {
      await setDoc(doc(db, REPORT_PDFS, id), payload);
    } else {
      await setDoc(
        doc(db, REPORTS, id),
        { pdf_dropped_oversize: true },
        { merge: true },
      );
    }
  }
  return meta;
}

export async function getReports() {
  try {
    const snap = await getDocs(collection(db, REPORTS));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  } catch (err) {
    console.warn("getReports failed:", err.message);
    return [];
  }
}

export async function getReportWithPdf(id) {
  try {
    const [metaSnap, pdfSnap] = await Promise.all([
      getDoc(doc(db, REPORTS, id)),
      getDoc(doc(db, REPORT_PDFS, id)),
    ]);
    if (!metaSnap.exists()) return null;
    const report = { ...metaSnap.data(), id };
    if (pdfSnap.exists()) report.pdf_data = pdfSnap.data().pdf_data;
    return report;
  } catch (err) {
    console.warn("getReportWithPdf failed:", err.message);
    return null;
  }
}

export async function deleteReport(id) {
  try {
    await deleteDoc(doc(db, REPORTS, id));
    await deleteDoc(doc(db, REPORT_PDFS, id)).catch(() => {});
  } catch (err) {
    console.warn("deleteReport failed:", err.message);
  }
}

// ---- history -------------------------------------------------------------
// Ported verbatim from the old data-history Netlify function so the aggregation
// (per driver/month/category counts, per-source counts, and idempotent per-report
// contribution snapshots) behaves identically. Stored as ONE doc, app_meta/history.

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

const compositeKey = (year, month, driverId, category) =>
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
    for (const s of Array.isArray(inc.sources) ? inc.sources : []) {
      const k = srcKey(ym.year, ym.month, inc.driver_id, s);
      src[k] = (src[k] || 0) + 1;
    }
  }
  return { cat, src };
}

const parseCatKey = (k) => {
  const [year, month, driver_id, category] = k.split(":");
  return { year: Number(year), month: Number(month), driver_id, category };
};
const parseSrcKey = (k) => {
  const [year, month, driver_id, source] = k.split(":");
  return { year: Number(year), month: Number(month), driver_id, source };
};

function applyContribution(data, contrib, sign, meta = {}) {
  const stamp = nowISO();
  for (const [k, n] of Object.entries(contrib.cat || {})) {
    const f = parseCatKey(k);
    const ex = data.records[k];
    if (!ex && sign < 0) continue;
    data.records[k] = {
      driver_id: f.driver_id,
      driver_name: meta[f.driver_id]?.name || ex?.driver_name || "",
      driver_raw: meta[f.driver_id]?.raw || ex?.driver_raw || "",
      year: f.year,
      month: f.month,
      category: f.category,
      count: Math.max(0, (ex?.count || 0) + sign * n),
      source: ex?.source || "report",
      updated_at: stamp,
    };
  }
  for (const [k, n] of Object.entries(contrib.src || {})) {
    const f = parseSrcKey(k);
    const ex = data.source_records[k];
    if (!ex && sign < 0) continue;
    data.source_records[k] = {
      driver_id: f.driver_id,
      driver_name: meta[f.driver_id]?.name || ex?.driver_name || "",
      year: f.year,
      month: f.month,
      source: f.source,
      count: Math.max(0, (ex?.count || 0) + sign * n),
      updated_at: stamp,
    };
  }
}

function driverMeta(incidents) {
  const m = {};
  for (const inc of incidents) {
    if (inc.driver_id && !m[inc.driver_id]) {
      m[inc.driver_id] = {
        name: inc.driver_name || "",
        raw: inc.driver_raw || "",
      };
    }
  }
  return m;
}

function upsertHistory(data, rec) {
  if (!rec || !rec.driver_id || !rec.year || !rec.month || !rec.category)
    return null;
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
    updated_at: nowISO(),
  };
  data.records[key] = record;
  return record;
}

async function loadHistory() {
  const s = await getDoc(doc(db, META, "history"));
  const d = s.exists() ? s.data() : {};
  return {
    records: d.records || {},
    source_records: d.source_records || {},
    report_contrib: d.report_contrib || {},
  };
}
async function saveHistoryDoc(data) {
  await setDoc(doc(db, META, "history"), { ...data, updated_at: nowISO() });
}

export async function getHistory({ driverId, year, month } = {}) {
  try {
    const data = await loadHistory();
    let list = Object.values(data.records);
    if (driverId) list = list.filter((r) => r.driver_id === driverId);
    if (year) list = list.filter((r) => r.year === Number(year));
    if (month) list = list.filter((r) => r.month === Number(month));
    return list;
  } catch (err) {
    console.warn("getHistory failed:", err.message);
    return [];
  }
}

export async function saveHistoryBatch(records, { replace = false, onProgress } = {}) {
  if (!records.length) return [];
  const data = replace
    ? { ...(await loadHistory()), records: {} }
    : await loadHistory();
  const saved = [];
  let done = 0;
  for (const rec of records) {
    const r = upsertHistory(data, rec);
    if (r) saved.push(r);
    done++;
    if (done % 150 === 0) onProgress?.({ done, total: records.length });
  }
  await saveHistoryDoc(data);
  onProgress?.({ done: records.length, total: records.length });
  return saved;
}

export async function rollupReportToHistory(incidents, reportId) {
  if (!incidents.length) return { updated: 0 };
  try {
    const data = await loadHistory();
    // Idempotent per report: reverse any prior contribution before re-applying,
    // so re-dropping a report can never double-count.
    if (reportId && data.report_contrib[reportId]) {
      applyContribution(data, data.report_contrib[reportId], -1);
    }
    const contrib = computeContribution(incidents);
    applyContribution(data, contrib, +1, driverMeta(incidents));
    if (reportId) data.report_contrib[reportId] = contrib;
    await saveHistoryDoc(data);
    return {
      updated: Object.keys(contrib.cat).length,
      source_updated: Object.keys(contrib.src).length,
    };
  } catch (err) {
    console.warn("rollupReportToHistory failed:", err.message);
    return { updated: 0, error: err.message };
  }
}

export async function deleteAllHistory() {
  try {
    const data = await loadHistory();
    const deleted = Object.keys(data.records).length;
    await setDoc(doc(db, META, "history"), {
      records: {},
      updated_at: nowISO(),
    });
    return { deleted };
  } catch (err) {
    console.warn("deleteAllHistory failed:", err.message);
    return { deleted: 0, error: err.message };
  }
}
