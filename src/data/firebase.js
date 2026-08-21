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
  runTransaction,
} from "firebase/firestore";
import { db } from "./firebaseApp.js";
import { reportDateBounds, reportSpanLabel } from "../reports/reportNaming.js";

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
  const q = query(
    collection(db, INCIDENTS),
    where("report_id", "==", reportId),
  );
  const snap = await getDocs(q);
  await deleteIdsWithPhotos(snap.docs.map((d) => d.id));
}

// Deletes THROW on failure. They used to console.warn and resolve, which meant a
// rules denial or transport error looked exactly like success — the row vanished
// from the screen and reappeared on the next reload. Callers all have catches.
export async function deleteIncident(id) {
  await trackWrite(deleteDoc(doc(db, INCIDENTS, id)));
  for (const ref of await photoDocRefs(id)) {
    await trackWrite(deleteDoc(ref));
  }
}

export async function deleteIncidentsBatch(ids) {
  await deleteIdsWithPhotos(ids);
}

// Batch-delete incident docs plus every photo doc that belongs to them (the
// per-photo docs and any legacy combined doc), chunked under the 500-op cap.
async function deleteIdsWithPhotos(ids) {
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const id of slice) batch.delete(doc(db, INCIDENTS, id));
    await trackWrite(batch.commit());
    for (const id of slice) {
      for (const ref of await photoDocRefs(id)) {
        await deleteDoc(ref).catch(() => {});
      }
    }
  }
}

// ---- work-in-progress drafts ---------------------------------------------
// The New Report tab used to hold hours of parse + enrichment + typing purely in
// React state — one tab switch and it was gone, and no other user could ever see
// it. Drafts live in Firestore like everything else: autosaved as the user
// works, resumable from any browser by anyone.
//
// Layout (1 MB cap respected, per this project's scars):
//   dds_report_drafts/{id}        → small meta {kind, name, counts, chunks, updated_at}
//   dds_report_drafts/{id}__c{i}  → JSON chunks of the light state (700 KB each)
//   dds_report_drafts/{id}__p{k}  → ONE photo per doc (photos never share a doc)
// Photo bytes are stripped from the JSON and stored once per photo — in memory
// they exist in triplicate (photo_urls + photo_meta.dataUri + photo_meta.url),
// which serialized would put a single 3-photo incident over the document cap.

const REPORT_DRAFTS = "dds_report_drafts";

export function newDraftId() {
  return `d_${Date.now()}_${rand()}`;
}

// Save the light draft state (no photo bytes). Returns { acked } so the caller
// can show "saved to cloud" vs "not confirmed by the server" honestly.
export async function saveReportDraft(id, { kind = "ingest", name = "", week_ending = "", state = {} }) {
  const json = JSON.stringify(state);
  const total = Math.max(1, Math.ceil(json.length / PDF_CHUNK));
  let acked = true;
  for (let i = 0; i < total; i++) {
    const r = await trackWrite(
      setDoc(doc(db, REPORT_DRAFTS, `${id}__c${i}`), {
        draft_id: id,
        idx: i,
        chunks: total,
        data: json.slice(i * PDF_CHUNK, (i + 1) * PDF_CHUNK),
      }),
    );
    acked = acked && r.acked;
  }
  const r = await trackWrite(
    setDoc(
      doc(db, REPORT_DRAFTS, id),
      {
        id,
        kind,
        name,
        week_ending,
        incident_count: state.incidents?.length || 0,
        chunks: total,
        size: json.length,
        updated_at: nowISO(),
      },
      { merge: true },
    ),
  );
  return { acked: acked && r.acked };
}

// Photos are written once, when enrichment finishes — not on every keystroke.
// rows: [{ key, incident_idx, idx, url }]
export async function saveReportDraftPhotos(id, rows) {
  let stored = 0;
  let oversize = 0;
  for (const p of rows) {
    if (!p?.url) continue;
    if (p.url.length > PHOTO_MAX) {
      oversize++;
      continue;
    }
    await trackWrite(
      setDoc(doc(db, REPORT_DRAFTS, `${id}__p${p.key}`), {
        draft_id: id,
        photo: true,
        incident_idx: p.incident_idx,
        idx: p.idx,
        url: p.url,
      }),
    );
    stored++;
  }
  await trackWrite(
    setDoc(doc(db, REPORT_DRAFTS, id), { photo_count: stored, photos_dropped_oversize: oversize > 0 }, { merge: true }),
  );
  return { stored, oversize };
}

// Every draft of a kind, newest first — the "resume work in progress" list.
export async function listReportDrafts(kind = "ingest") {
  try {
    const snap = await getDocs(
      query(collection(db, REPORT_DRAFTS), where("kind", "==", kind)),
    );
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  } catch (err) {
    console.warn("listReportDrafts failed:", err.message);
    return [];
  }
}

export async function loadReportDraft(id) {
  const metaSnap = await getDoc(doc(db, REPORT_DRAFTS, id));
  if (!metaSnap.exists()) return null;
  const meta = metaSnap.data();
  const chunkSnaps = await Promise.all(
    Array.from({ length: meta.chunks || 1 }, (_, i) =>
      getDoc(doc(db, REPORT_DRAFTS, `${id}__c${i}`)),
    ),
  );
  const parts = chunkSnaps.filter((c) => c.exists()).map((c) => c.data());
  if (parts.length !== (meta.chunks || 1)) {
    throw new Error(
      `Draft is incomplete on the server (${parts.length}/${meta.chunks} parts) — it may still be syncing from the browser it was typed in.`,
    );
  }
  const state = JSON.parse(parts.sort((a, b) => a.idx - b.idx).map((p) => p.data).join(""));
  // Re-attach photos to their incidents by index.
  const photoSnap = await getDocs(
    query(collection(db, REPORT_DRAFTS), where("draft_id", "==", id)),
  );
  for (const d of photoSnap.docs) {
    const row = d.data();
    if (!row.photo) continue;
    const inc = state.incidents?.[row.incident_idx];
    if (!inc) continue;
    inc.photo_urls ||= [];
    inc.photo_urls[row.idx] = row.url;
  }
  for (const inc of state.incidents || []) {
    if (Array.isArray(inc.photo_urls)) inc.photo_urls = inc.photo_urls.filter(Boolean);
  }
  return { meta, state };
}

// Remove a draft and every chunk/photo doc that belongs to it. Throws on
// failure like every other delete — a draft that looks discarded but survives
// would resurface as a ghost "resume?" card.
export async function deleteReportDraft(id) {
  const snap = await getDocs(
    query(collection(db, REPORT_DRAFTS), where("draft_id", "==", id)),
  );
  for (const d of snap.docs) await trackWrite(deleteDoc(d.ref));
  await trackWrite(deleteDoc(doc(db, REPORT_DRAFTS, id)));
}

// ---- drivers -------------------------------------------------------------

// Throws on failure — a swallowed error here meant an add/edit/deactivate looked
// like it worked while the roster was never written, which is exactly the class
// of silent data loss this app has been bitten by. Callers must surface it.
// Read-modify-write the roster ATOMICALLY. The old pattern — every caller building
// a new array from its own (possibly minutes-stale) copy and overwriting the whole
// document — meant two people editing the roster at once silently erased each
// other: A adds a driver, B deactivates someone from a snapshot that predates the
// add, and A's driver is gone with both screens showing green. The mutator runs
// against the FRESH roster inside a transaction, so concurrent edits compose
// instead of clobbering. A mutator may throw (e.g. duplicate name) to abort.
export async function updateRoster(mutate) {
  const ref = doc(db, META, "drivers");
  const txn = runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data().drivers || [] : [];
    const next = mutate(current.slice());
    if (!Array.isArray(next)) throw new Error("roster mutator must return an array");
    tx.set(ref, { drivers: next });
    return next;
  });
  // Transactions need the server; offline they fail rather than queue. Bound the
  // wait so a dead connection reports honestly instead of spinning forever.
  return Promise.race([
    txn,
    new Promise((_, rej) =>
      setTimeout(
        () =>
          rej(
            new Error(
              "The server could not be reached, so this roster change was NOT saved. Check the connection and try again.",
            ),
          ),
        15_000,
      ),
    ),
  ]);
}

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
  await trackWrite(deleteDoc(doc(db, REPORTS, id)));
  for (const ref of await pdfDocRefs(id)) {
    await trackWrite(deleteDoc(ref));
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

  // Each month lands in its own transaction: records come from this import (a
  // deliberate wholesale replace), but source_records are re-read FRESH inside
  // the transaction so a rollup landing mid-import isn't erased by our stale
  // snapshot of it.
  for (const [ym, data] of Object.entries(touched)) {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, HISTORY, ym));
      const fresh = snap.exists() ? snap.data() : {};
      txSaveMonth(tx, ym, {
        records: data.records,
        source_records: replace
          ? fresh.source_records || {}
          : data.source_records || fresh.source_records || {},
      });
    });
  }
  onProgress?.({ done: records.length, total: records.length });
  return saved;
}

// Serialize one month's data for a transactional write, honoring the same size
// guard and delete-when-empty behavior as saveMonth.
function txSaveMonth(tx, ym, data) {
  // Reversal leaves rows at count 0 rather than removing them; a zero-count row
  // adds nothing to any reader and, left in place, keeps a fully-reversed month
  // document alive forever. Prune them so months can actually empty out.
  const prune = (m) =>
    Object.fromEntries(
      Object.entries(m || {}).filter(([, r]) => Number(r?.count) > 0),
    );
  const records = prune(data.records);
  const source_records = prune(data.source_records);
  if (!Object.keys(records).length && !Object.keys(source_records).length) {
    tx.delete(doc(db, HISTORY, ym));
    return;
  }
  const payload = { month: ym, records, source_records, updated_at: nowISO() };
  const size = jsonSize(payload);
  if (size > DOC_MAX) {
    throw new Error(
      `History for ${ym} is too large to save (${Math.round(size / 1024)} KB, limit ${Math.round(DOC_MAX / 1024)} KB).`,
    );
  }
  if (size > HISTORY_WARN) {
    console.warn(`History month ${ym} is unusually large: ${Math.round(size / 1024)} KB.`);
  }
  tx.set(doc(db, HISTORY, ym), payload);
}

// The rollup runs as ONE transaction over the contrib snapshot and every month it
// touches. The old read-apply-write ran on plain gets and full-document sets, so
// two reports rolled up at once for the same month read the same starting counts
// and the second write erased the first's — while BOTH contribution snapshots
// claimed to be included, so the idempotency machinery would then "reverse"
// counts that were never applied. In a transaction, contention retries with fresh
// reads and the snapshot can never disagree with the totals it describes.
//
// An EMPTY incident list is a real case, not a no-op: it reverses the report's
// prior contribution and deletes the snapshot. (It used to early-return, which is
// why deleting a report's last row — or the report itself — left its counts in
// history forever.)
//
// Throws on failure. A silently-skipped rollup is exactly the divergence between
// live views and Trends/history that this app must never allow — callers that can
// tolerate deferring it must catch deliberately and SAY so.
export async function rollupReportToHistory(incidents, reportId) {
  const contrib = computeContribution(incidents);
  const meta = driverMeta(incidents);
  const empty = !Object.keys(contrib.cat).length && !Object.keys(contrib.src).length;

  const result = await runTransaction(db, async (tx) => {
    // All reads first (Firestore requires reads before writes in a transaction).
    let prior = null;
    if (reportId) {
      const snap = await tx.get(doc(db, REPORT_CONTRIB, reportId));
      if (snap.exists()) {
        const d = snap.data();
        prior = { cat: d.cat || {}, src: d.src || {} };
      }
    }
    const priorByMonth = prior ? contribByMonth(prior) : {};
    const nextByMonth = contribByMonth(contrib);
    const months = [
      ...new Set([...Object.keys(priorByMonth), ...Object.keys(nextByMonth)]),
    ];
    const snaps = await Promise.all(
      months.map((ym) => tx.get(doc(db, HISTORY, ym))),
    );

    months.forEach((ym, i) => {
      const d = snaps[i].exists() ? snaps[i].data() : {};
      const data = { records: d.records || {}, source_records: d.source_records || {} };
      if (priorByMonth[ym]) applyContribution(data, priorByMonth[ym], -1);
      if (nextByMonth[ym]) applyContribution(data, nextByMonth[ym], +1, meta);
      txSaveMonth(tx, ym, data);
    });

    if (reportId) {
      if (empty) {
        // Nothing contributes any more — the snapshot must go with the counts,
        // or a later rollup would reverse a contribution that no longer exists.
        tx.delete(doc(db, REPORT_CONTRIB, reportId));
      } else {
        tx.set(doc(db, REPORT_CONTRIB, reportId), {
          report_id: reportId,
          cat: contrib.cat,
          src: contrib.src,
          updated_at: nowISO(),
        });
      }
    }
    return {
      updated: Object.keys(contrib.cat).length,
      source_updated: Object.keys(contrib.src).length,
      months: months.length,
    };
  });
  return result;
}

// Re-derive everything a report's edits can invalidate: its history rollup, its
// incident count and date bounds, and whether the stored PDF still matches. This
// is what makes a COMPLETED report editable — every add/remove/edit seam calls
// it (debounced below), so Trends and the Dashboard can never quietly diverge
// from what the report now contains. Throws on failure.
export async function resyncReportRollup(reportId) {
  if (!reportId) return null;
  const list = await getIncidentsForReport(reportId);
  const result = await rollupReportToHistory(list, reportId);
  const metaSnap = await getDoc(doc(db, REPORTS, reportId));
  if (metaSnap.exists()) {
    const meta = metaSnap.data();
    const patch = { incident_count: list.length };
    if (list.length) {
      const { starts_at, ends_at } = reportDateBounds(list);
      patch.starts_at = starts_at;
      patch.ends_at = ends_at;
      patch.range_label = reportSpanLabel({
        starts_at,
        ends_at,
        week_ending: meta.week_ending,
      });
    }
    // The stored PDF was rendered from the OLD contents; flag it rather than
    // silently serving a snapshot that no longer matches the report.
    if (meta.pdf_chunks || meta.pdf_data !== undefined) patch.pdf_stale = true;
    await trackWrite(setDoc(doc(db, REPORTS, reportId), patch, { merge: true }));
  }
  return result;
}

// Debounced per report, so five quick edits in a row cost one rollup, not five.
// Background failures are logged AND leave pdf_stale/history stale — the manual
// "Re-sync totals" button in Report Detail is the recovery path and surfaces
// errors properly.
const resyncTimers = new Map();
export function scheduleReportResync(reportId, delay = 1500) {
  if (!reportId) return;
  clearTimeout(resyncTimers.get(reportId));
  resyncTimers.set(
    reportId,
    setTimeout(() => {
      resyncTimers.delete(reportId);
      resyncReportRollup(reportId).catch((err) =>
        console.warn(
          `report ${reportId} resync failed — history may lag until re-synced from Report Detail:`,
          err.message,
        ),
      );
    }, delay),
  );
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

// Hidden reviews ------------------------------------------------------------
//
// Reviews come from the tracking portal and this app can only read them, so a bogus
// one (a test submission, a customer who reviewed the wrong carrier, a duplicate)
// can't be deleted at the source from here. It is suppressed instead: the id goes in
// dds_hidden_reviews and every count, chart, table and printed report skips it.
//
// In Firestore rather than localStorage on purpose — an invalid review is invalid for
// everyone, not just for the browser that noticed it. Nothing is destroyed: the row
// keeps its reason and who filed it, and un-hiding puts it straight back.
const HIDDEN_REVIEWS = "dds_hidden_reviews";

export async function getHiddenReviews() {
  try {
    const snap = await getDocs(collection(db, HIDDEN_REVIEWS));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getHiddenReviews failed:", err.message);
    return [];
  }
}

// `review` is the row being hidden — its driver / customer / rating are copied in so
// the hidden list is readable without re-joining it against the source.
export async function hideReview(review, reason = "") {
  const id = String(review?.id || "").trim();
  if (!id) throw new Error("hideReview: review has no id");
  await trackWrite(
    setDoc(doc(db, HIDDEN_REVIEWS, id), {
      review_id: id,
      reason: String(reason || "").slice(0, 500),
      rating: review.rating ?? null,
      driver: review.driverName || review.driver || "",
      customer: review.customer || "",
      submitted_at: review.submittedAt || "",
      hidden_at: nowISO(),
    }),
  );
}

export async function unhideReview(id) {
  await trackWrite(deleteDoc(doc(db, HIDDEN_REVIEWS, String(id))));
}
