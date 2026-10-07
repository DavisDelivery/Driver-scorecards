// Reassigning a feed attempt to a driver — one implementation for every screen that
// offers it, so a reassignment made from the log, the Unassigned list or anywhere
// later is saved, and counted, the same way.
//
// A reassignment is saved as an "attempts" incident keyed to the stop
// (attempt_stop_nbr). It does not add an attempt: buildAttemptRecords reads it as the
// attribution for the feed order and leaves it out of the count.
import { ATTEMPTS } from "./attemptRecords.js";
import { dayCache } from "./attemptsFeed.js";

// The saved reassignments for an order on its day, the primary stop's first.
//
// An attempt can span two stops (the original and dispatch's -1/-2 duplicate), and a
// reassignment saved before they were grouped may sit on either, so every stop on the
// order is checked. Scoped to the day: NuVizz stop numbers can repeat across days, so
// a reassignment saved on one day must not match another day's row.
export function overridesFor(order, date, incidents) {
  const stops = new Set((order?.legRows || [order]).map((l) => String(l?.stopNbr ?? "")));
  return (incidents || [])
    .filter(
      (i) =>
        i.category === ATTEMPTS &&
        stops.has(String(i.attempt_stop_nbr ?? "")) &&
        (i.delivered_date || "").slice(0, 10) === date,
    )
    .sort(
      (x, y) =>
        (String(y.attempt_stop_nbr) === String(order.stopNbr)) -
        (String(x.attempt_stop_nbr) === String(order.stopNbr)),
    );
}

// The incident a reassignment saves. Pure.
//
// The id is deterministic from the natural key, so two tabs reassigning the same stop
// on the same day converge on ONE document instead of each minting a random id and
// double-counting the attempt. An existing reassignment keeps its id, notes and
// stop, so changing the driver again edits it rather than adding a second.
export function reassignDoc({ order, date, driver, existing = null, now = new Date().toISOString() }) {
  const was = order.originalDriverName || "";
  return {
    id: existing?.id || `att_${date}_${order.stopNbr}`,
    pro_number: order.stopNbr,
    category: ATTEMPTS,
    fault: "driver",
    no_fault: false,
    driver_id: driver.id,
    driver_name: driver.name,
    // Who the feed said had it, kept so the correction can always be traced back.
    driver_raw: was,
    customer: order.businessName || "",
    to_city: order.city || "",
    to_state: order.state || "",
    delivered_date: date,
    reason: `Delivery attempt — reassigned from auto feed (was ${was || "Unknown"})`,
    notes: existing?.notes || "",
    attempt_stop_nbr: existing?.attempt_stop_nbr || order.stopNbr,
    shipment_nbr: order.shipmentNbr || "",
    sources: [],
    report_id: null,
    manual_entry: true,
    created_at: existing?.created_at || now,
    ingested_at: existing?.ingested_at || now,
    updated_at: now,
  };
}

// Reassign an order to `driver` (a roster entry), or clear it back to the feed's own
// driver with `driver` null. `save` / `remove` are firebase.js's saveIncident /
// deleteIncident, passed in so this file stays importable by the tests.
//
// Resolves { ok, pendingSync, error } and never throws: a failure comes back for the
// caller to show, never swallowed. `pendingSync` is a save the server hasn't
// confirmed — queued on this device only, which the caller must say. `onSaved` gets
// the same change notices the rest of the app uses, for each write that landed.
export async function reassignAttempt({
  order,
  date,
  driver,
  incidents,
  save,
  remove,
  onSaved,
  cache = dayCache,
}) {
  const [existing, ...extra] = overridesFor(order, date, incidents);
  try {
    // One attempt, one reassignment. A second one left on the order's other stop
    // would count the attempt twice on the Scorecard.
    for (const dup of driver ? extra : [existing, ...extra].filter(Boolean)) {
      await remove(dup.id);
      onSaved?.({ type: "delete", id: dup.id });
    }
    if (!driver) return { ok: true, pendingSync: false, error: null };
    const doc = reassignDoc({ order, date, driver, existing });
    const saved = await save(doc);
    onSaved?.({ type: "upsert", incident: saved || doc });
    return { ok: true, pendingSync: !!saved?._pendingSync, error: null };
  } catch (e) {
    return { ok: false, pendingSync: false, error: e?.message || String(e) };
  } finally {
    cache?.invalidate(date);
  }
}
