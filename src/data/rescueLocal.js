// Rescue tool: pull incident entries stranded in THIS browser's localStorage
// into Firestore.
//
// Background: before the Firestore migration, a save that couldn't reach the
// old backend was quietly written only to this browser's localStorage cache
// (key "dds_incidents") while the UI said "Saved". Those rows never reached the
// shared store, so nobody else ever saw them — and the migration couldn't copy
// them either. This finds them and imports them.
//
// Usage, from the browser console on the machine/browser the entries were
// typed on:
//
//   await window.__ddsRescueLocal(console.log)                  // DRY RUN: list only
//   await window.__ddsRescueLocal(console.log, { commit: true })// import them
//
// Safety:
// - Dry-run by default; nothing is written until { commit: true }.
// - Only rows that do NOT already exist in Firestore (by id) are candidates.
// - Only manual entries (manual_entry === true) are considered, so a stale
//   cached copy of some long-deleted report incident can't be resurrected.
//   Pass { all: true } to consider every missing row (review carefully).
// - Photo bytes were never kept in the local cache, so rescued entries come
//   back without their photos (the entry itself, driver, dates, notes survive).
import { getIncidents, saveIncident } from "./firebase.js";

const CACHE_KEY = "dds_incidents";

export async function rescueLocalEntries(log = () => {}, opts = {}) {
  const { commit = false, all = false } = opts;

  let local;
  try {
    local = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
  } catch {
    local = [];
  }
  if (!Array.isArray(local) || local.length === 0) {
    log("No old local cache found in this browser — nothing to rescue here.");
    return { localRows: 0, candidates: 0, imported: 0 };
  }
  log(`Old local cache found: ${local.length} rows. Checking against Firestore…`);

  const cloud = await getIncidents();
  const cloudIds = new Set(cloud.map((x) => x.id));

  const missing = local.filter((r) => r && r.id && !cloudIds.has(r.id));
  const candidates = all
    ? missing
    : missing.filter((r) => r.manual_entry === true);

  if (missing.length > candidates.length) {
    log(
      `(${missing.length - candidates.length} non-manual cached rows are missing from the cloud — ` +
        `likely deleted on purpose, so they are NOT included. Use { all: true } to see them.)`,
    );
  }
  if (candidates.length === 0) {
    log("Nothing stranded: every manual entry in this browser's cache already exists in Firestore.");
    return { localRows: local.length, candidates: 0, imported: 0 };
  }

  log(`Found ${candidates.length} entr${candidates.length === 1 ? "y" : "ies"} in this browser that never reached the shared store:`);
  candidates.forEach((r, i) => {
    log(
      `  ${i + 1}. [${r.category}] PRO ${r.pro_number || "?"} — ${r.driver_name || "unassigned"} — ` +
        `incident ${r.delivered_date || "?"} — entered ${(r.created_at || "").slice(0, 10) || "?"}`,
    );
  });

  if (!commit) {
    log("DRY RUN — nothing imported. Re-run with { commit: true } to import these into Firestore.");
    return { localRows: local.length, candidates: candidates.length, imported: 0 };
  }

  let imported = 0;
  for (const row of candidates) {
    const { _pendingSync, photo_urls, photo_meta, ...clean } = row;
    try {
      await saveIncident({
        ...clean,
        has_photos: false,
        photo_count: 0,
        rescued_from_local: true,
      });
      imported++;
      log(`  imported ${imported}/${candidates.length}: PRO ${clean.pro_number || "?"}`);
    } catch (e) {
      log(`  FAILED PRO ${row.pro_number || "?"} (${row.id}): ${e.message}`);
    }
  }
  log(`RESCUE COMPLETE: ${imported} of ${candidates.length} imported. Refresh the page to see them.`);
  return { localRows: local.length, candidates: candidates.length, imported };
}
