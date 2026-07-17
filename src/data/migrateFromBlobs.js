// One-time migration: copy existing data out of the OLD Netlify Blobs store
// (still served by the Netlify functions on this same origin) into Firestore.
//
// Run it ONCE, after the Firestore project is configured and the app is live,
// from the browser console on the production site:
//
//     await window.__ddsMigrate(console.log)
//
// It is safe to re-run (writes upsert by id / replace history), though it will
// re-copy everything each time. Photos and report PDFs are pulled and re-stored.
//
// Caveat: the history endpoint only exposes flat records, not the per-report
// contribution snapshots, so migrated history has correct counts but a later
// re-drop of an already-counted report can't self-reverse. Re-rolling reports
// after migration rebuilds those snapshots.
import {
  saveIncidentsBatch,
  saveDrivers,
  saveReport,
  saveHistoryBatch,
} from "./firebase.js";

const API = {
  incidents: "/.netlify/functions/data-incidents",
  incidentsPhotos: "/.netlify/functions/data-incidents/photos",
  drivers: "/.netlify/functions/data-drivers",
  reports: "/.netlify/functions/data-reports",
  history: "/.netlify/functions/data-history",
};

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export async function migrateBlobsToFirestore(log = () => {}) {
  const summary = {};

  // Drivers -----------------------------------------------------------------
  const { drivers = [] } = await get(API.drivers);
  await saveDrivers(drivers);
  summary.drivers = drivers.length;
  log(`drivers migrated: ${drivers.length}`);

  // Incidents (+ inline their photos so the photo docs come across too) -------
  const { incidents = [] } = await get(API.incidents);
  for (const inc of incidents) {
    if (inc.has_photos) {
      try {
        const p = await get(
          `${API.incidentsPhotos}?id=${encodeURIComponent(inc.id)}`,
        );
        inc.photo_urls = p.photo_urls || [];
        inc.photo_meta = p.photo_meta || [];
      } catch (e) {
        log(`  photo fetch failed for ${inc.id}: ${e.message}`);
      }
    }
  }
  await saveIncidentsBatch(incidents, ({ done, total }) =>
    log(`incidents migrated: ${done}/${total}`),
  );
  summary.incidents = incidents.length;

  // Reports (+ their PDFs) --------------------------------------------------
  const { reports = [] } = await get(API.reports);
  let rdone = 0;
  for (const r of reports) {
    try {
      const full = await get(`${API.reports}?id=${encodeURIComponent(r.id)}`);
      await saveReport(full.report || r);
    } catch {
      await saveReport(r);
    }
    log(`reports migrated: ${++rdone}/${reports.length}`);
  }
  summary.reports = reports.length;

  // History -----------------------------------------------------------------
  const { records = [] } = await get(API.history);
  await saveHistoryBatch(records, {
    replace: true,
    onProgress: ({ done, total }) => log(`history migrated: ${done}/${total}`),
  });
  summary.history = records.length;

  log(`MIGRATION COMPLETE: ${JSON.stringify(summary)}`);
  return summary;
}
