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
//   dds_history/{YYYY-MM}    → { month, records, source_records }  (one per month)
//   dds_report_contrib/{id}  → { report_id, cat, src }   (idempotent rollup snapshot)
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
  waitForPendingWrites,
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
// History is sharded one document per calendar month, and each report's
// contribution snapshot is its own document (see the history section below).
const HISTORY = "dds_history";
const REPORT_CONTRIB = "dds_report_contrib";

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
// A generated photo report runs several MB, so its data URI is split across
// chunk documents (dds_report_pdfs/{reportId}__{idx}) and rejoined on read.
const PDF_CHUNK = 700_000;
// History is sharded per month so no single document can fill up, but never let
// a write fail silently: warn well before the cap and throw at it.
const HISTORY_WARN = 700_000;
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
    await trackWrite(
      setDoc(doc(db, INCIDENT_PHOTOS, `${incidentId}__${i}`), {
        incident_id: incidentId,
        idx: i,
        url,
        meta: photoMeta?.[i] ?? null,
      }),
    );
    stored++;
  }
  return { stored, oversize };
}

export async function saveIncident(incident) {
  const id = incident.id || `i_${Date.now()}_${rand()}`;
  const { light, photo_urls, photo_meta } = lightIncident(incident, id);
  const { acked } = await trackWrite(setDoc(doc(db, INCIDENTS, id), light, { merge: true }));

  // Photo docs + the persisted-flags update, issued the same way in both branches;
  // when the main write is unacked they queue behind it rather than hanging the UI.
  const writePhotos = () =>
    savePhotosFor(id, photo_urls, photo_meta).then(({ stored, oversize }) => {
      const flags = {
        has_photos: stored > 0,
        photo_count: stored,
        photos_dropped_oversize: oversize > 0,
      };
      return trackWrite(setDoc(doc(db, INCIDENTS, id), flags, { merge: true })).then(
        () => flags,
      );
    });

  if (!acked) {
    // The server hasn't confirmed. The write stays queued and will sync when the
    // connection returns — but the caller must be able to say so instead of
    // reporting a green "Saved" (the bug that lost a week of entries, twice now).
    if (Array.isArray(photo_urls) && photo_urls.length) {
      writePhotos().catch((e) => console.warn(`queued photo write for ${id}:`, e.message));
    }
    return { ...light, _pendingSync: true };
  }
  if (Array.isArray(photo_urls) && photo_urls.length) {
    const flags = await writePhotos();
    return { ...light, ...flags };
  }
  return light;
}

// ---- pending-write truth -------------------------------------------------
// Firestore's setDoc/commit promises resolve ONLY when the SERVER acknowledges
// the write. Offline (or blocked by an extension/firewall), they hang forever
// while the write sits queued in this browser's IndexedDB — visible locally,
// invisible to everyone else, and gone for good if the browser evicts storage.
// The original stubs here returned 0 pending forever, which silenced the app's
// unsynced banner and let exactly that happen: an entry typed on 08/20 never
// reached the server and evaporated. Never swallow a write failure — so every
// write below is tracked, raced against an ack timeout, and reported honestly.

const ACK_TIMEOUT_MS = 8_000;

let pendingWrites = 0;
const pendingListeners = new Set();
const notifyPending = () => {
  for (const l of pendingListeners) {
    try {
      l(pendingWrites);
    } catch {
      /* a broken listener must not break the write path */
    }
  }
};
// Live subscription for the App banner; returns an unsubscribe.
export function onPendingWritesChange(fn) {
  pendingListeners.add(fn);
  try {
    fn(pendingWrites);
  } catch {
    /* ignore */
  }
  return () => pendingListeners.delete(fn);
}

// Count a write as pending until the server acks it, and resolve { acked:false }
// if the ack hasn't arrived within the window. The write itself is NOT cancelled —
// it stays queued and still syncs when the connection returns; this only stops the
// UI from waiting forever and lets it say "not on the server yet" out loud.
// A rejection inside the window still throws, so real errors surface as failures.
function trackWrite(p) {
  pendingWrites++;
  notifyPending();
  const settle = () => {
    pendingWrites = Math.max(0, pendingWrites - 1);
    notifyPending();
  };
  p.then(settle, settle);
  return Promise.race([
    p.then(() => ({ acked: true })),
    new Promise((res) => setTimeout(() => res({ acked: false }), ACK_TIMEOUT_MS)),
  ]);
}

export function countPendingIncidents() {
  return pendingWrites;
}

// Are queued writes still waiting on the server — INCLUDING ones queued by an
// earlier session this counter never saw? waitForPendingWrites resolves at once
// when the queue is empty, so a timeout means the queue is stuck.
export async function hasStuckWrites(timeoutMs = 4_000) {
  try {
    return await Promise.race([
      waitForPendingWrites(db).then(() => false),
      new Promise((res) => setTimeout(() => res(true), timeoutMs)),
    ]);
  } catch {
    return false;
  }
}

export async function flushPendingIncidents() {
  const stuck = await hasStuckWrites();
  // The tracker knows this session's writes; a stuck queue from a previous
  // session reports as at least one so the banner can't stay dark.
  return { flushed: 0, remaining: stuck ? Math.max(1, pendingWrites) : pendingWrites };
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
    // Raced against the ack timeout so an offline import still queues every chunk
    // instead of hanging forever on the first; the pending banner reports the truth.
    await trackWrite(batch.commit());
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

// Throws on failure — a swallowed error here meant an add/edit/deactivate looked
// like it worked while the roster was never written, which is exactly the class
// of silent data loss this app has been bitten by. Callers must surface it.
export async function saveDrivers(drivers) {
  const { acked } = await trackWrite(setDoc(doc(db, META, "drivers"), { drivers }));
  if (!acked) {
    // Queued locally, not confirmed. Roster edits are rare and important enough
    // that "maybe" is not an acceptable answer — callers alert on throw.
    throw new Error(
      "The server has not confirmed this roster change (connection problem?). " +
        "It will keep retrying in the background — do not trust the roster until it syncs.",
    );
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

// Every PDF doc belonging to a report: the chunk docs plus any legacy
// single-doc PDF stored before chunking existed.
async function pdfDocRefs(reportId) {
  const refs = [];
  const legacy = await getDoc(doc(db, REPORT_PDFS, reportId));
  if (legacy.exists()) refs.push(legacy.ref);
  const snap = await getDocs(
    query(collection(db, REPORT_PDFS), where("report_id", "==", reportId)),
  );
  snap.forEach((d) => refs.push(d.ref));
  return refs;
}

export async function saveReport(report) {
  const id = report.id || `r_${Date.now()}_${rand()}`;
  const { pdf_data, pdf, ...rest } = report;
  const meta = {
    ...rest,
    id,
    updated_at: nowISO(),
    created_at: report.created_at || nowISO(),
  };
  const { acked } = await trackWrite(setDoc(doc(db, REPORTS, id), meta, { merge: true }));
  if (!acked) meta._pendingSync = true;
  const bytes = pdf_data || pdf;
  if (bytes) {
    // A photo report runs several MB, so the data URI is split across chunk
    // documents; storing it whole silently exceeded the 1 MB document cap and
    // the PDF was thrown away (see PHOTO/PDF note at the top of this file).
    for (const ref of await pdfDocRefs(id)) {
      await deleteDoc(ref).catch(() => {});
    }
    const total = Math.ceil(bytes.length / PDF_CHUNK);
    for (let i = 0; i < total; i++) {
      await trackWrite(
        setDoc(doc(db, REPORT_PDFS, `${id}__${i}`), {
          report_id: id,
          idx: i,
          chunks: total,
          data: bytes.slice(i * PDF_CHUNK, (i + 1) * PDF_CHUNK),
        }),
      );
    }
    await trackWrite(
      setDoc(
        doc(db, REPORTS, id),
        { pdf_chunks: total, pdf_dropped_oversize: false },
        { merge: true },
      ),
    );
    return { ...meta, pdf_chunks: total };
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
    const metaSnap = await getDoc(doc(db, REPORTS, id));
    if (!metaSnap.exists()) return null;
    const report = { ...metaSnap.data(), id };
    // Current shape: chunk docs reassembled in order.
    const snap = await getDocs(
      query(collection(db, REPORT_PDFS), where("report_id", "==", id)),
    );
    if (!snap.empty) {
      const parts = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
      const expected = parts[0]?.chunks ?? parts.length;
      if (parts.length === expected) {
        report.pdf_data = parts.map((p) => p.data || "").join("");
        return report;
      }
      console.warn(
        `report ${id}: PDF is incomplete (${parts.length}/${expected} chunks) — regenerate it`,
      );
      return report;
    }
    // Legacy shape: whole PDF in one doc.
    const legacy = await getDoc(doc(db, REPORT_PDFS, id));
    if (legacy.exists()) report.pdf_data = legacy.data().pdf_data;
    return report;
  } catch (err) {
    console.warn("getReportWithPdf failed:", err.message);
    return null;
  }
}

export async function deleteReport(id) {
  try {
    await deleteDoc(doc(db, REPORTS, id));
    for (const ref of await pdfDocRefs(id)) {
      await deleteDoc(ref).catch(() => {});
    }
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

// --- month-sharded storage -------------------------------------------------
// History used to be ONE document holding every record, which put a hard
// ceiling on how much history the app could ever record (and it failed
// silently on reaching it). It is now split one document per calendar month:
//   dds_history/{YYYY-MM}        → { month, records, source_records }
//   dds_report_contrib/{reportId}→ { report_id, cat, src }
// Per-month documents stay tiny forever (a month is bounded by drivers ×
// categories), and the per-report contribution snapshots that keep the rollup
// idempotent are one document each instead of an unbounded map.

// "2026:07:drv_x:late" -> "2026-07"
const monthOfKey = (k) => {
  const [y, m] = String(k).split(":");
  return y && m ? `${y}-${m}` : null;
};

async function loadMonth(ym) {
  const s = await getDoc(doc(db, HISTORY, ym));
  const d = s.exists() ? s.data() : {};
  return { records: d.records || {}, source_records: d.source_records || {} };
}

async function saveMonth(ym, data) {
  const records = data.records || {};
  const source_records = data.source_records || {};
  // A month with nothing left in it is removed rather than left as an empty doc.
  if (!Object.keys(records).length && !Object.keys(source_records).length) {
    await deleteDoc(doc(db, HISTORY, ym)).catch(() => {});
    return;
  }
  const payload = { month: ym, records, source_records, updated_at: nowISO() };
  const size = jsonSize(payload);
  if (size > DOC_MAX) {
    // Not reachable with real data (a single month is bounded by drivers ×
    // categories), but never fail silently if it somehow is.
    throw new Error(
      `History for ${ym} is too large to save (${Math.round(size / 1024)} KB, limit ${Math.round(DOC_MAX / 1024)} KB).`,
    );
  }
  if (size > HISTORY_WARN) {
    console.warn(`History month ${ym} is unusually large: ${Math.round(size / 1024)} KB.`);
  }
  await setDoc(doc(db, HISTORY, ym), payload);
}

async function monthIds() {
  const snap = await getDocs(collection(db, HISTORY));
  return snap.docs.map((d) => d.id);
}

// Pre-shard data lived in dds_app_meta/history. Read it so a store that has not
// been migrated yet still returns history instead of looking empty.
async function loadLegacyHistory() {
  const s = await getDoc(doc(db, META, "history"));
  const d = s.exists() ? s.data() : {};
  return {
    records: d.records || {},
    source_records: d.source_records || {},
    report_contrib: d.report_contrib || {},
  };
}

// Split a contribution ({cat,src} keyed by composite key) into per-month pieces.
function contribByMonth(contrib) {
  const out = {};
  for (const [k, n] of Object.entries(contrib.cat || {})) {
    const ym = monthOfKey(k);
    if (!ym) continue;
    (out[ym] ||= { cat: {}, src: {} }).cat[k] = n;
  }
  for (const [k, n] of Object.entries(contrib.src || {})) {
    const ym = monthOfKey(k);
    if (!ym) continue;
    (out[ym] ||= { cat: {}, src: {} }).src[k] = n;
  }
  return out;
}

async function loadReportContrib(reportId) {
  const s = await getDoc(doc(db, REPORT_CONTRIB, reportId));
  if (!s.exists()) return null;
  const d = s.data();
  return { cat: d.cat || {}, src: d.src || {} };
}

export async function getHistory({ driverId, year, month } = {}) {
  try {
    let list = [];
    const ids = await monthIds();
    if (ids.length === 0) {
      // Not sharded yet — fall back to the single legacy document.
      list = Object.values((await loadLegacyHistory()).records);
    } else if (year && month) {
      // Targeted read: one document instead of the whole history.
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      list = Object.values((await loadMonth(ym)).records);
    } else {
      const wanted = year ? ids.filter((id) => id.startsWith(`${year}-`)) : ids;
      const months = await Promise.all(wanted.map((id) => loadMonth(id)));
      list = months.flatMap((m) => Object.values(m.records));
    }
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
  // replace=true (History backfill import) resets the rollup records but must
  // PRESERVE source_records and the per-report contribution snapshots, so a
  // later re-rollup of an already-counted report still has something to reverse.
  const existing = {};
  for (const ym of await monthIds()) existing[ym] = await loadMonth(ym);
  const touched = {};
  if (replace) {
    for (const [ym, data] of Object.entries(existing)) {
      touched[ym] = { records: {}, source_records: data.source_records };
    }
  }

  const saved = [];
  let done = 0;
  for (const rec of records) {
    if (!rec || !rec.driver_id || !rec.year || !rec.month || !rec.category) {
      done++;
      continue;
    }
    const ym = `${rec.year}-${String(rec.month).padStart(2, "0")}`;
    touched[ym] ||= replace
      ? { records: {}, source_records: existing[ym]?.source_records || {} }
      : existing[ym] || { records: {}, source_records: {} };
    const r = upsertHistory(touched[ym], rec);
    if (r) saved.push(r);
    done++;
    if (done % 150 === 0) onProgress?.({ done, total: records.length });
  }

  for (const [ym, data] of Object.entries(touched)) await saveMonth(ym, data);
  onProgress?.({ done: records.length, total: records.length });
  return saved;
}

export async function rollupReportToHistory(incidents, reportId) {
  if (!incidents.length) return { updated: 0 };
  try {
    const contrib = computeContribution(incidents);
    const meta = driverMeta(incidents);
    // Idempotent per report: reverse any prior contribution before re-applying,
    // so re-dropping a report can never double-count.
    const prior = reportId ? await loadReportContrib(reportId) : null;

    // Only the months either contribution touches need to be read and written.
    const priorByMonth = prior ? contribByMonth(prior) : {};
    const nextByMonth = contribByMonth(contrib);
    const months = new Set([
      ...Object.keys(priorByMonth),
      ...Object.keys(nextByMonth),
    ]);

    for (const ym of months) {
      const data = await loadMonth(ym);
      if (priorByMonth[ym]) applyContribution(data, priorByMonth[ym], -1);
      if (nextByMonth[ym]) applyContribution(data, nextByMonth[ym], +1, meta);
      await saveMonth(ym, data);
    }

    if (reportId) {
      await setDoc(doc(db, REPORT_CONTRIB, reportId), {
        report_id: reportId,
        cat: contrib.cat,
        src: contrib.src,
        updated_at: nowISO(),
      });
    }
    return {
      updated: Object.keys(contrib.cat).length,
      source_updated: Object.keys(contrib.src).length,
      months: months.size,
    };
  } catch (err) {
    console.warn("rollupReportToHistory failed:", err.message);
    return { updated: 0, error: err.message };
  }
}

export async function deleteAllHistory() {
  try {
    let deleted = 0;
    for (const ym of await monthIds()) {
      const { records } = await loadMonth(ym);
      deleted += Object.keys(records).length;
      await deleteDoc(doc(db, HISTORY, ym)).catch(() => {});
    }
    // Clear the legacy document too so it can't resurface as a fallback.
    const legacy = await getDoc(doc(db, META, "history"));
    if (legacy.exists()) {
      deleted += Object.keys(legacy.data().records || {}).length;
      await setDoc(doc(db, META, "history"), { records: {}, updated_at: nowISO() });
    }
    return { deleted };
  } catch (err) {
    console.warn("deleteAllHistory failed:", err.message);
    return { deleted: 0, error: err.message };
  }
}
