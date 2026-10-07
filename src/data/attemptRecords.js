// One definition of an attempt, for every screen that counts them.
//
// This used to be built inline in the Attempts tab (ManualEntry.jsx), and anything
// else that wanted attempts would have had to copy it and drift. The rules:
//
//   - One record per ORDER: a shipment on one ET day, however many stops dispatch
//     gave it (groupAttemptLegs). A "-1"/"-2" stop is a duplicate order — counted
//     once with the original and never charged to the original's driver.
//   - The driver is a saved reassignment if there is one (an operator correcting the
//     feed), else the feed's morning-plan driver matched to the roster — so
//     "Ben  Paintsil" and "Ben Paintsil" are one driver — else the feed's raw name.
//     An order with no name stays nameless rather than being guessed onto someone.
//   - Reassignment rows are not counted. Each is the attribution for a feed order,
//     and counting it as well would count that attempt twice.
//   - Hand-logged attempts count alongside the feed, dated by incidentDateStr —
//     except one logged for an order the feed already has on the same day.
import { groupAttemptLegs, baseStopNbr, isRedeliveryLeg } from "./attemptLegs.js";
import { matchDriver } from "./driverMatch.js";
import { incidentDateStr } from "./incidentDate.js";

export const ATTEMPTS = "attempts";

// Where an order's driver came from. plan / holder / timeline are the dispatch app's
// own `attributedFrom` (v1.99.0+). Rows scanned before that carry nothing — 79 of the
// 162 rows 09/01–10/06 — so they read "unknown" rather than passing for one of them.
// Short, because it rides in the log's driver dropdown beside the name.
export const ATTRIBUTED_BY_TEXT = {
  plan: "8:30 plan",
  holder: "all-day record",
  timeline: "NuVizz history",
  unknown: "source n/a",
  override: "reassigned by ops",
  hand: "hand-logged",
};

export function feedAttribution(row) {
  const v = row?.attributedFrom;
  return v === "plan" || v === "holder" || v === "timeline" ? v : "unknown";
}

// A PRO as its base 9-digit stop number: the shipment's ATT marker and a -1/-2 suffix
// dropped, digits zero-padded the way Uline PROs are. "ATT007138914", "007138914-1"
// and "7138914" are all "007138914". Another carrier's alphanumeric number passes
// through uppercased.
export function normPro(x) {
  const s = baseStopNbr(String(x ?? "").trim().toUpperCase().replace(/^ATT/, ""));
  return /^\d+$/.test(s) ? s.padStart(9, "0") : s;
}

// The feed writes Georgia as both "GA" and "GEORGIA" (27 of 386 rows the long way).
const STATE_ABBR = {
  GEORGIA: "GA",
  ALABAMA: "AL",
  FLORIDA: "FL",
  TENNESSEE: "TN",
  "SOUTH CAROLINA": "SC",
  "NORTH CAROLINA": "NC",
};
export function normState(s) {
  const v = String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return STATE_ABBR[v] || v;
}

const words = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

// The same customer however a row spells it: business name plus 5-digit zip. With no
// zip, city and state stand in. Takes a feed order (businessName, zip, city, state) or
// an incident (customer, zip_code, to_city, to_state). The feed's own customerMatchKey
// would be better, but it is null on every row sampled.
export function customerKey(x) {
  const name = words(x?.businessName || x?.customer);
  if (!name) return null;
  const zip5 = String(x?.zip || x?.zip_code || "").match(/\d{5}/)?.[0];
  if (zip5) return `${name}|${zip5}`;
  return `${name}|${words(x?.city || x?.to_city)}|${normState(x?.state || x?.to_state)}`;
}

// What happened to the order after the attempt, as the 8 PM scan last saw it:
// delivered | rescheduled | unplanned | other.
//
// A duplicate (-1/-2) carries the redelivery, so when there is one it decides. On 25
// of the 36 split orders 09/01–10/06 the original reads DELIVERED — closed out when
// the driver got there — while its duplicate is still UNPLANNED. This never decides
// a driver.
export function attemptOutcome(order) {
  if (!order) return null;
  const legs = order.legRows || [order];
  const copies = legs.filter((l) => isRedeliveryLeg(l.stopNbr));
  const leg = copies.length ? copies[copies.length - 1] : legs[0];
  const status = String(leg?.currentStatus || "").toUpperCase();
  if (status === "DELIVERED") return "delivered";
  if (status === "UNPLANNED" || leg?.currentlyUnplanned) return "unplanned";
  if (status === "SCHEDULED") return "rescheduled";
  return "other";
}

// Who a record is counted under: the roster id, else the name it carries, else
// nobody. An id with no roster row keeps its own key — unknown must not mean
// invisible.
export function driverKey(r) {
  if (r?.driver_id) return r.driver_id;
  const name = r?.driver_name || r?.driver_raw || "";
  return name ? `name:${name}` : "unassigned";
}

// Saved reassignments by "stopNbr|date". Walked newest-first, so where two sit on one
// stop and day the earliest saved wins — the rule the Attempts tab has always
// counted by. Reassigning removes the extra one (attemptReassign.js).
export function overrideIndex(incidents) {
  const m = new Map();
  const rows = (incidents || [])
    .filter((i) => i && i.category === ATTEMPTS && i.attempt_stop_nbr)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  for (const i of rows) {
    m.set(`${i.attempt_stop_nbr}|${(i.delivered_date || "").slice(0, 10)}`, i);
  }
  return m;
}

// One feed order (a groupAttemptLegs entry, stamped with its day) as a record. The
// incident-shaped fields are what the charts, the by-driver list and the printed
// handout read; `order` is the order itself, for opening and reassigning it.
export function feedRecord(order, { overrides, drivers = [] }) {
  const a = order;
  // Any stop on the order: a reassignment saved before the legs were grouped may sit
  // on the duplicate. The primary stop's is checked first.
  const ov = [a, ...(a.legRows || [])]
    .map((l) => overrides?.get(`${l.stopNbr}|${a.date}`))
    .find(Boolean);
  const matched = ov ? null : matchDriver(a.originalDriverName || "", drivers);
  const driverName = ov?.driver_name || matched?.name || a.originalDriverName || "";
  const rec = {
    id: `feed:${a.date}:${a.stopNbr}`,
    pro_number: a.shipmentNbr || a.stopNbr,
    category: ATTEMPTS,
    driver_id: ov?.driver_id || matched?.id || null,
    driver_name: driverName,
    driver_raw: a.originalDriverName || "",
    customer: a.businessName || "",
    to_city: a.city || "",
    to_state: a.state || "",
    delivered_date: a.date,
    created_at: a.detectedAt || a.date,
    notes: a.note || "",
    from_feed: true,
    date: a.date,
    pro: normPro(a.stopNbr),
    order: a,
    customerKey: customerKey(a),
    outcome: attemptOutcome(a),
    overridden: !!ov,
    attributedBy: ov ? "override" : driverName ? feedAttribution(a) : null,
  };
  rec.key = driverKey(rec);
  return rec;
}

// A hand-logged "attempts" incident as a record: the incident itself, plus the same
// fields a feed record carries.
export function handRecord(inc) {
  const rec = {
    ...inc,
    date: incidentDateStr(inc).slice(0, 10),
    pro: normPro(inc.pro_number),
    order: null,
    customerKey: customerKey(inc),
    outcome: null,
    overridden: false,
    attributedBy: "hand",
  };
  rec.key = driverKey(rec);
  return rec;
}

// Every PRO on the feed's orders, by "date|PRO" — each stop and each shipment number
// — pointing at its order. What a hand-logged attempt is checked against.
export function feedOrderIndex(orders) {
  const m = new Map();
  for (const o of orders || []) {
    for (const l of o.legRows || [o]) {
      for (const p of [normPro(l.stopNbr), normPro(l.shipmentNbr)]) {
        if (p && !m.has(`${o.date}|${p}`)) m.set(`${o.date}|${p}`, o);
      }
    }
  }
  return m;
}

// The feed order a hand-logged attempt duplicates — same PRO, same day — or null.
// Only the same day: a PRO attempted again on a later day is a later attempt.
export function feedOrderFor(inc, index) {
  const pro = normPro(inc?.pro_number);
  if (!pro) return null;
  return index?.get(`${incidentDateStr(inc).slice(0, 10)}|${pro}`) || null;
}

// Every attempt the feed days and the incidents hold.
//
//   feedDays   Map(date → { rows, status }) — fetchAttemptsRange's `days`. Only days
//              with data have rows, so a day with no data adds nothing (and is not a
//              zero: its status says so).
//   incidents  all incidents; the "attempts" ones are read
//   drivers    the roster, for matching feed names
//
// Returns:
//   records     feed orders first (in day order), then hand-logged rows newest first
//   folded      feed rows folded into another stop's order — what dispatch's own
//               per-stop total counts on top of these
//   copies      -1/-2 rows seen
//   duplicates  hand-logged rows left out because the feed has the same order on the
//               same day (feedOrderFor). Without this the one failure counts twice:
//               once from the feed and once by hand. The order counts under the
//               feed's driver; the day log tags the hand-logged row to say so.
export function buildAttemptRecords({ feedDays, incidents, drivers = [] } = {}) {
  const rows = [];
  for (const day of feedDays?.values?.() || []) rows.push(...(day?.rows || []));
  const orders = groupAttemptLegs(rows);
  const overrides = overrideIndex(incidents);
  const feed = orders.map((o) => feedRecord(o, { overrides, drivers }));

  const onFeed = feedOrderIndex(orders);
  const hand = [];
  const duplicates = [];
  const logged = (incidents || [])
    .filter((i) => i && i.category === ATTEMPTS && !i.attempt_stop_nbr)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  for (const i of logged) {
    const rec = handRecord(i);
    if (feedOrderFor(i, onFeed)) duplicates.push(rec);
    else hand.push(rec);
  }
  return {
    records: [...feed, ...hand],
    folded: rows.length - orders.length,
    copies: rows.filter((r) => isRedeliveryLeg(r.stopNbr)).length,
    duplicates,
  };
}
