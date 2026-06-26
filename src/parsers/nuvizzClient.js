/**
 * nuvizzClient.js
 * Client for the NuVizz Netlify proxy functions.
 *
 * Exports:
 *   fetchStopData(pro, { company })          – fetch stop + photos for one PRO
 *   fetchDocDataUri(guid, ext, company, retries) – fetch a single document as data URI
 *   fetchPhotosForProsBatch(pros, onProgress) – parallel fetch for many PROs
 */

const TRACK_URL = "/.netlify/functions/track";
const DOC_URL = "/.netlify/functions/doc";

// ---------------------------------------------------------------------------
// fetchStopData
// ---------------------------------------------------------------------------

/**
 * Fetch stop data and photos for a single PRO number.
 *
 * @param {string} pro        PRO number (9-digit "00xxxxxxx")
 * @param {object} [options]
 * @param {string} [options.company="ULINE"]  Carrier/company code
 * @returns {Promise<{photos, stop, exe, error, photoStatus}>}
 */
export async function fetchStopData(pro, { company = "ULINE" } = {}) {
  if (!pro) return { photos: [], error: "No PRO provided" };

  try {
    // --- Retry loop (up to 3 attempts) for the track endpoint ---
    let data = null;
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(
          `${TRACK_URL}?pro=${encodeURIComponent(pro)}&company=${encodeURIComponent(company)}`,
          { signal: controller.signal },
        );
        clearTimeout(timer);

        if (!res.ok) {
          lastError = `track ${res.status}`;
          if (attempt < 2) {
            await delay(700);
            continue;
          }
          return { photos: [], stop: null, exe: null, error: lastError };
        }

        const json = await res.json();
        if (json.error) {
          lastError = json.error;
          if (attempt < 2) {
            await delay(700);
            continue;
          }
          return { photos: [], stop: null, exe: null, error: json.error };
        }

        data = json;
        break;
      } catch (err) {
        lastError = err.message || "fetch failed";
        if (attempt < 2) {
          await delay(700);
          continue;
        }
        return { photos: [], stop: null, error: lastError };
      }
    }

    // --- Parse response ---
    const stopData = data.stop || {};
    const exeData = data.exe || {};
    const loadData = data.load || {};

    // Collect POD document descriptors from both "from" and "to" legs
    const docDescriptors = [];
    for (const side of ["from", "to"]) {
      for (const doc of exeData[side]?.podDoc || []) {
        docDescriptors.push({
          side: side === "from" ? "pickup" : "delivery",
          guid: doc.documentGuid,
          name: doc.documentName,
          path: doc.documentPath,
          extension: doc.extension,
          createdTime: doc.createdTime,
        });
      }
    }

    // Filter to image documents only
    const imageDocs = docDescriptors.filter(
      (d) => !d.extension || /jpg|jpeg|png|gif|webp|bmp/i.test(d.extension),
    );

    // Fetch image data URIs in batches of 3
    const retrieved = [];
    const failed = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < imageDocs.length; i += BATCH_SIZE) {
      const batch = imageDocs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (doc) => ({
          doc,
          dataUri: await fetchDocDataUri(
            doc.guid,
            doc.extension || "jpg",
            company,
            doc.path,
          ),
        })),
      );
      for (const { doc, dataUri } of results) {
        if (dataUri) {
          retrieved.push({ ...doc, dataUri, url: dataUri });
        } else {
          failed.push(doc);
        }
      }
    }

    // Build normalized stop summary
    const stop = {
      stopNbr: stopData.stopNbr,
      proNumber: pro,
      // NuVizz's field labels are misaligned for Davis's data: their "cartons"
      // are actually palettes (skids), their "pallets" are the total piece count,
      // and "volume" is the loose-piece count. Map to what they really represent.
      pieces: {
        skids: stopData.totalCartons ?? null,
        total: stopData.totalPallets ?? null,
        loose: stopData.volume ?? null,
      },
      driverName: loadData.driverName || null,
      driverId: loadData.driverId || null,
      driverEmail: loadData.driverEmail || null,
      vehicleNbr: loadData.vehicleNbr || null,
      loadNbr: loadData.loadNbr || null,
      routeName: loadData.routeName || null,
      stopStatus: exeData.stopStatus || null,
      exceptions: (exeData.exceptions || []).map((ex) => ({
        code: ex.exceptionCode,
        desc: ex.exceptionDesc,
        comment: ex.exceptionComment,
        addedBy: ex.addedByName,
        addedOn: ex.addedOn,
      })),
      exceptionPresent: !!exeData.exceptionPresent,
      to: {
        name:
          stopData.to?.address?.name ||
          stopData.to?.address?.addrName,
        city: stopData.to?.address?.city,
        state: stopData.to?.address?.state,
        zip: stopData.to?.address?.zip,
        etaDttm: exeData.to?.etaDttm,
        arrivalDTTM: exeData.to?.arrivalDTTM,
        departureDTTM: exeData.to?.departureDTTM,
        confirmedDTTM: exeData.to?.confirmedDTTM,
        plannedEtaDTTM: exeData.to?.plannedEtaDTTM,
      },
      from: {
        name:
          stopData.from?.address?.name ||
          stopData.from?.address?.addrName,
        city: stopData.from?.address?.city,
        etaDttm: exeData.from?.etaDttm,
        plannedEtaDTTM: exeData.from?.plannedEtaDTTM,
      },
    };

    return {
      photos: retrieved,
      stop,
      exe: exeData,
      error: null,
      photoStatus: {
        expected: imageDocs.length,
        retrieved: retrieved.length,
        failed: failed.length,
        noPhotosAvailable: imageDocs.length === 0,
      },
    };
  } catch (err) {
    return { photos: [], stop: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// fetchDocDataUri
// ---------------------------------------------------------------------------

/**
 * Fetch a single document from the doc proxy and return its data URI.
 * Tries the given company first, then the other (ULINE ↔ DAVIS fallback).
 *
 * @param {string} guid
 * @param {string} ext        File extension (e.g. "jpg")
 * @param {string} company    "ULINE" or "DAVIS"
 * @param {number} [retries=2]
 * @returns {Promise<string|null>} data URI string, or null on failure
 */
export async function fetchDocDataUri(guid, ext, company, path, retries = 2) {
  // Try primary company first, then fallback
  const order = company === "DAVIS" ? ["DAVIS", "ULINE"] : ["ULINE", "DAVIS"];

  for (const co of order) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(
          `${DOC_URL}?guid=${encodeURIComponent(guid)}&ext=${encodeURIComponent(ext)}&company=${encodeURIComponent(co)}${path ? `&path=${encodeURIComponent(path)}` : ""}`,
          { signal: controller.signal },
        );
        clearTimeout(timer);

        if (res.status === 404) break; // not found for this company; try next

        if (!res.ok) {
          if (attempt < retries) {
            await delay(500 * (attempt + 1));
            continue;
          }
          break;
        }

        const json = await res.json();
        if (json.dataUri) return json.dataUri;
        break;
      } catch {
        if (attempt < retries) {
          await delay(500 * (attempt + 1));
          continue;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// fetchPhotosForProsBatch
// ---------------------------------------------------------------------------

/**
 * Fetch stop data for an array of PRO numbers in parallel batches of 4.
 *
 * @param {string[]} pros
 * @param {function} [onProgress]  Called with { done, total, pro } after each PRO
 * @returns {Promise<Object>}  Map of pro → fetchStopData result
 */
export async function fetchPhotosForProsBatch(pros, onProgress = () => {}) {
  const results = {};
  let done = 0;
  const total = pros.length;
  const BATCH_SIZE = 4;

  for (let i = 0; i < pros.length; i += BATCH_SIZE) {
    const batch = pros.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((pro) => fetchStopData(pro).then((r) => ({ pro, r }))),
    );
    for (const { pro, r } of batchResults) {
      results[pro] = r;
      done++;
      onProgress({ done, total, pro });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
