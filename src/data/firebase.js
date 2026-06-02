// Data client for the Davis Driver Scorecard.
//
// NOTE: despite the filename, this does NOT talk to Firebase. It talks to the
// Netlify serverless functions backed by Netlify Blobs. The name is historical.
//
// Storage model (server side):
//   - Incidents use SPLIT-PHOTO storage: a light metadata blob (inc:{id}) plus a
//     separate photo-bytes blob (photos:{id}). The list endpoint returns light
//     records only (has_photos + photo_count, no photo bytes). Photos are fetched
//     lazily per incident via getIncidentPhotos(id).
//   - History uses a single blob (history:all) with optional query filtering.
//
// Every call mirrors results into localStorage (dds_* keys) as an offline cache /
// fallback so the UI degrades gracefully when the network or functions are down.

const API = {
  incidents: "/.netlify/functions/data-incidents",
  incidentsBatch: "/.netlify/functions/data-incidents/batch",
  incidentsPhotos: "/.netlify/functions/data-incidents/photos",
  drivers: "/.netlify/functions/data-drivers",
  reports: "/.netlify/functions/data-reports",
  history: "/.netlify/functions/data-history",
  historyBatch: "/.netlify/functions/data-history/batch",
  historyRollup: "/.netlify/functions/data-history/rollup-report",
  historyAll: "/.netlify/functions/data-history/all",
};

// ---- local cache helpers -------------------------------------------------
const CACHE_PREFIX = "dds_";
const cacheKey = (k) => `${CACHE_PREFIX}${k}`;

const readCache = (k) => {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(k)) || "[]");
  } catch {
    return [];
  }
};
const writeCache = (k, v) => {
  try {
    localStorage.setItem(cacheKey(k), JSON.stringify(v));
  } catch {
    /* quota / private mode — ignore */
  }
};

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${opts.method || "GET"} ${url} → ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

// Strip photo bytes from an incident to produce a light record for the cache.
function stripPhotos(incident) {
  if (!incident) return incident;
  const { photo_urls, photo_meta, ...rest } = incident;
  return {
    ...rest,
    has_photos: Array.isArray(photo_urls) && photo_urls.length > 0,
    photo_count: Array.isArray(photo_urls) ? photo_urls.length : 0,
  };
}

// Netlify request bodies must stay well under the function payload limit.
const MAX_BODY = 4 * 1024 * 1024;

// ---- incidents -----------------------------------------------------------

export async function saveIncident(incident) {
  try {
    const serialized = JSON.stringify(incident);
    // If the incident (with inline photos) is too large, persist metadata only;
    // photo bytes are managed separately by the batch / enrich paths.
    if (serialized.length > MAX_BODY) {
      const { photo_meta, ...light } = incident;
      const { incident: saved } = await apiFetch(API.incidents, {
        method: "PUT",
        body: JSON.stringify(light),
      });
      const cache = readCache("incidents");
      const i = cache.findIndex((x) => x.id === saved.id);
      if (i >= 0) cache[i] = saved;
      else cache.push(saved);
      writeCache("incidents", cache);
      return saved;
    }
    const { incident: saved } = await apiFetch(API.incidents, {
      method: "PUT",
      body: serialized,
    });
    const cache = readCache("incidents");
    const i = cache.findIndex((x) => x.id === saved.id);
    if (i >= 0) cache[i] = saved;
    else cache.push(saved);
    writeCache("incidents", cache);
    return saved;
  } catch (err) {
    console.warn("saveIncident cloud failed, falling back to local:", err.message);
    const local = {
      ...incident,
      id:
        incident.id ||
        `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      updated_at: new Date().toISOString(),
      created_at: incident.created_at || new Date().toISOString(),
    };
    const light = stripPhotos(local);
    const cache = readCache("incidents");
    const i = cache.findIndex((x) => x.id === light.id);
    if (i >= 0) cache[i] = light;
    else cache.push(light);
    writeCache("incidents", cache);
    return local;
  }
}

// Pack incidents into chunks that each stay under the body limit. Any single
// incident that exceeds the limit on its own gets its own chunk.
function chunkIncidents(incidents) {
  const chunks = [];
  let current = [];
  let size = 2; // brackets
  for (const inc of incidents) {
    const incSize = JSON.stringify(inc).length + 1;
    if (incSize > MAX_BODY) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
        size = 2;
      }
      chunks.push([inc]);
      continue;
    }
    if (size + incSize > MAX_BODY && current.length > 0) {
      chunks.push(current);
      current = [inc];
      size = 2 + incSize;
    } else {
      current.push(inc);
      size += incSize;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function saveIncidentsBatch(incidents, onProgress = null) {
  if (!incidents.length) return [];
  const chunks = chunkIncidents(incidents);
  const saved = [];
  let done = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const { incidents: out } = await apiFetch(API.incidentsBatch, {
        method: "POST",
        body: JSON.stringify({ incidents: chunk }),
      });
      saved.push(...out);
      done += chunk.length;
      onProgress?.({ done, total: incidents.length });
    } catch (err) {
      console.warn(
        `Batch chunk ${i + 1}/${chunks.length} failed (${chunk.length} incidents):`,
        err.message,
      );
      // Per-incident fallback so one bad record doesn't sink the whole chunk.
      for (const inc of chunk) {
        try {
          saved.push(await saveIncident(inc));
        } catch (e) {
          console.error(
            `Failed to save incident ${inc.pro_number || inc.id}:`,
            e.message,
          );
        }
        done++;
        onProgress?.({ done, total: incidents.length });
      }
    }
  }
  if (saved.length) {
    const cache = readCache("incidents");
    for (const s of saved) {
      const i = cache.findIndex((x) => x.id === s.id);
      if (i >= 0) cache[i] = s;
      else cache.push(s);
    }
    writeCache("incidents", cache);
  }
  return saved;
}

export async function getIncidents() {
  try {
    const { incidents } = await apiFetch(API.incidents);
    writeCache("incidents", incidents);
    return incidents;
  } catch (err) {
    console.warn("getIncidents cloud failed, using cache:", err.message);
    return readCache("incidents");
  }
}

export async function getIncidentPhotos(id) {
  if (!id) return { photo_urls: [], photo_meta: [] };
  try {
    const data = await apiFetch(
      `${API.incidentsPhotos}?id=${encodeURIComponent(id)}`,
    );
    return {
      photo_urls: data.photo_urls || [],
      photo_meta: data.photo_meta || [],
    };
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
    const { incidents } = await apiFetch(
      `${API.incidents}?report_id=${encodeURIComponent(reportId)}`,
    );
    return incidents;
  } catch (err) {
    console.warn("getIncidentsForReport cloud failed, using cache:", err.message);
    return readCache("incidents").filter((x) => x.report_id === reportId);
  }
}

export async function deleteIncidentsForReport(reportId) {
  try {
    await apiFetch(`${API.incidents}?report_id=${encodeURIComponent(reportId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("deleteIncidentsForReport cloud failed:", err.message);
  }
  writeCache(
    "incidents",
    readCache("incidents").filter((x) => x.report_id !== reportId),
  );
}

export async function deleteIncident(id) {
  try {
    await apiFetch(`${API.incidents}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("deleteIncident cloud failed:", err.message);
  }
  writeCache(
    "incidents",
    readCache("incidents").filter((x) => x.id !== id),
  );
}

export async function deleteIncidentsBatch(ids) {
  try {
    await apiFetch(API.incidentsBatch, {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
  } catch (err) {
    console.warn("deleteIncidentsBatch cloud failed:", err.message);
  }
  const set = new Set(ids);
  writeCache(
    "incidents",
    readCache("incidents").filter((x) => !set.has(x.id)),
  );
}

// ---- drivers -------------------------------------------------------------

export async function saveDrivers(drivers) {
  try {
    await apiFetch(API.drivers, {
      method: "PUT",
      body: JSON.stringify({ drivers }),
    });
    writeCache("drivers", drivers);
  } catch (err) {
    console.warn("saveDrivers cloud failed:", err.message);
    writeCache("drivers", drivers);
  }
}

export async function getDrivers() {
  try {
    const { drivers } = await apiFetch(API.drivers);
    if (drivers && drivers.length > 0) {
      writeCache("drivers", drivers);
      return drivers;
    }
    return readCache("drivers");
  } catch (err) {
    console.warn("getDrivers cloud failed, using cache:", err.message);
    return readCache("drivers");
  }
}

// ---- reports -------------------------------------------------------------

export async function saveReport(report) {
  try {
    const { report: saved } = await apiFetch(API.reports, {
      method: "PUT",
      body: JSON.stringify(report),
    });
    return saved;
  } catch (err) {
    console.warn("saveReport cloud failed, falling back to local:", err.message);
    const local = {
      ...report,
      id:
        report.id || `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      updated_at: new Date().toISOString(),
      created_at: report.created_at || new Date().toISOString(),
    };
    const cache = readCache("reports");
    const i = cache.findIndex((x) => x.id === local.id);
    if (i >= 0) cache[i] = local;
    else cache.push(local);
    writeCache("reports", cache);
    return local;
  }
}

export async function getReports() {
  try {
    const { reports } = await apiFetch(API.reports);
    return reports;
  } catch (err) {
    console.warn("getReports cloud failed, using cache:", err.message);
    return readCache("reports");
  }
}

export async function getReportWithPdf(id) {
  try {
    const { report } = await apiFetch(`${API.reports}?id=${encodeURIComponent(id)}`);
    return report;
  } catch (err) {
    console.warn("getReportWithPdf cloud failed, using cache:", err.message);
    return readCache("reports").find((r) => r.id === id) || null;
  }
}

export async function deleteReport(id) {
  try {
    await apiFetch(`${API.reports}?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("deleteReport cloud failed:", err.message);
  }
  writeCache(
    "reports",
    readCache("reports").filter((r) => r.id !== id),
  );
}

// ---- history -------------------------------------------------------------

export async function getHistory({ driverId, year, month } = {}) {
  const params = new URLSearchParams();
  if (driverId) params.set("driver_id", driverId);
  if (year) params.set("year", String(year));
  if (month) params.set("month", String(month));
  const qs = params.toString() ? `?${params}` : "";
  try {
    const { records } = await apiFetch(`${API.history}${qs}`);
    return records || [];
  } catch (err) {
    console.warn("getHistory cloud failed:", err.message);
    return [];
  }
}

export async function saveHistoryBatch(
  records,
  { replace = false, onProgress } = {},
) {
  if (!records.length) return [];
  const CHUNK = 150;
  const saved = [];
  let done = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    try {
      const { records: out } = await apiFetch(API.historyBatch, {
        method: "POST",
        body: JSON.stringify({ records: slice, replace }),
      });
      saved.push(...(out || []));
      done += slice.length;
      onProgress?.({ done, total: records.length });
    } catch (err) {
      console.warn(
        `History batch chunk ${i / CHUNK + 1} failed (${slice.length} records):`,
        err.message,
      );
      for (const rec of slice) {
        try {
          const { record } = await apiFetch(API.history, {
            method: "PUT",
            body: JSON.stringify(rec),
          });
          if (record) saved.push(record);
        } catch (e) {
          console.error(
            `Failed to save history record for ${rec.driver_name} ${rec.year}-${rec.month} ${rec.category}:`,
            e.message,
          );
        }
        done++;
        onProgress?.({ done, total: records.length });
      }
    }
  }
  return saved;
}

export async function rollupReportToHistory(incidents, reportId) {
  if (!incidents.length) return { updated: 0 };
  try {
    return await apiFetch(API.historyRollup, {
      method: "POST",
      body: JSON.stringify({ incidents, report_id: reportId }),
    });
  } catch (err) {
    console.warn("rollupReportToHistory failed:", err.message);
    return { updated: 0, error: err.message };
  }
}

export async function deleteAllHistory() {
  try {
    return await apiFetch(API.historyAll, { method: "DELETE" });
  } catch (err) {
    console.warn("deleteAllHistory failed:", err.message);
    return { deleted: 0, error: err.message };
  }
}
