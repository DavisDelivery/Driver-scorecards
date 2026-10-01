// One failed delivery, however many stop numbers dispatch gave it.
//
// A "-1" / "-2" stop is a DUPLICATE ORDER. Chad, 2026-10-01: "-1 and -2 are duplicate
// orders and have nothing to do with the original driver." It keeps the original's
// shipment number, so it carries the ATT marker too and the evening scan lists both.
// Two rules follow, and both are enforced here:
//   1. It is not a second attempt. The original and its duplicates are ONE row.
//   2. It never decides who is charged. The order's driver is the ORIGINAL stop's,
//      named or not — a duplicate's driver never stands in for it (v0.19.0; before,
//      a named duplicate could speak for an unnamed original). A duplicate listed
//      without its original stands alone, with only a driver of its own.
//
// Checked against the settled feed for 08/25–09/23: 99 rows, 40 unassigned, and 25
// of those 40 were the "-1" copy of an attempt already on the list — 21 of them
// already credited to the right driver on the original stop. So attempts are counted
// per ORDER: one per shipment per day, credited to whichever leg the morning plan
// named. The dispatch app keys its list by stop number and groups nothing, so its own
// totals still count every leg; the log shows each order's stops so the difference
// can be seen rather than guessed at.

const LEG_SUFFIX = /-\d+$/;

export const isRedeliveryLeg = (stopNbr) => LEG_SUFFIX.test(String(stopNbr ?? "").trim());

// "007174773-1" -> "007174773"
export const baseStopNbr = (stopNbr) => String(stopNbr ?? "").trim().replace(LEG_SUFFIX, "");

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const hasDriver = (r) => !!clean(r?.originalDriverName);

// Which leg speaks for the order: the ORIGINAL stop, whether or not it has a
// driver (rule 2 above). Only when the original isn't on the list does a duplicate
// speak — and then only for itself.
function pickPrimary(legs) {
  return legs.find((l) => !isRedeliveryLeg(l.stopNbr)) || legs[0];
}

// Collapse attempt rows into one entry per order per day. Each entry is the primary
// leg's row plus:
//   legRows  every stop on the order that day, original first
//   legs     how many there were (only set when more than one, as before)
// Rows with no shipment number can't be grouped and pass through alone. Order of
// first appearance is kept.
export function groupAttemptLegs(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const ship = String(r.shipmentNbr || "").trim().toUpperCase();
    const key = ship ? `${r.date || ""}|${ship}` : `stop|${r.date || ""}|${r.stopNbr}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map((legs) => {
    const legRows = legs
      .slice()
      .sort((a, b) => String(a.stopNbr).localeCompare(String(b.stopNbr)));
    const primary = pickPrimary(legRows);
    const out = { ...primary, legRows };
    if (legRows.length > 1) out.legs = legRows.length;
    else delete out.legs;
    return out;
  });
}

// Why an order has no driver, as a short code. null when it has one.
//
//   provisional  seen live on the board; the 8 PM scan hasn't attributed it yet
//   no_plan      no 8:30 AM route plan was captured that day
//   not_in_plan  the original stop was on no route in the 8:30 AM plan — it was put
//                on a route later in the day (or never)
//   copy_only    only the "-1" copy is on the list; the original stop isn't, so
//                there is no morning route to match against
export function unassignedReason(order) {
  if (!order || hasDriver(order)) return null;
  const legs = order.legRows || [order];
  if (legs.some((l) => l.provisional)) return "provisional";
  if (legs.some((l) => l.planMissing)) return "no_plan";
  if (legs.every((l) => isRedeliveryLeg(l.stopNbr))) return "copy_only";
  return "not_in_plan";
}

export const UNASSIGNED_REASON_TEXT = {
  provisional: "Seen live on the board — the 8 PM scan hasn't attributed it yet",
  no_plan: "No 8:30 AM route plan was captured that day",
  not_in_plan: "Not on any route in the 8:30 AM plan — routed later in the day",
  copy_only:
    "Only a duplicate order (-1/-2) is on the list, not the original stop — and a duplicate has nothing to do with the original's driver",
};

export const UNASSIGNED_REASON_SHORT = {
  provisional: "awaiting the 8 PM scan",
  no_plan: "no morning plan that day",
  not_in_plan: "not in the 8:30 AM plan",
  copy_only: "duplicate order (-1/-2) only",
};

// Who closed the original stop out, when the feed can say — the best lead there is
// for an order the morning plan missed. On the attempts that DID have a morning
// driver over 08/20–09/23, the driver who closed the stop out was that same driver
// on 24 of 26. So it is offered as a lead and never applied on its own.
//
// Only a CLOSED original stop counts. A stop that is scheduled again, and every "-1"
// copy, is carrying the redelivery — whoever is on it now is the next driver, not
// the one who attempted it.
export function closedOutBy(order) {
  for (const l of order?.legRows || (order ? [order] : [])) {
    if (isRedeliveryLeg(l.stopNbr)) continue;
    const status = String(l.currentStatus || "").toUpperCase();
    const who = clean(l.currentDriverName);
    if (who && (status === "DELIVERED" || status === "EXCEPTION")) return who;
  }
  return null;
}

// The dispatch app's nightly driver lookup (v1.102.5) reads at most 10 NuVizz
// timelines a night. When it could not read every attempt still without a driver —
// over the limit, no NuVizz id on file, a request that failed — the day's manifest
// says so (fill.needsAttention). Chad: "if it needs more it should throw a flag in
// the ui on the scorecard."
export const FILL_LEFT_REASON = {
  "over-cap": "over the nightly 10-call limit",
  "no-stopId": "no NuVizz id on file",
  "not-read": "the lookup failed",
};

// The days that need attention, newest first, and which stops each one left.
export function fillFlags(fills) {
  return (fills || [])
    .filter((f) => f && f.needsAttention && Number(f.left) > 0)
    .map((f) => ({
      date: f.date,
      left: Number(f.left),
      maxCalls: f.maxCalls ?? 10,
      requests: f.requests ?? null,
      stops: (f.leftStops || []).map((x) => ({ stopNbr: String(x.stopNbr), reason: x.reason })),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// "date|stopNbr" → why the nightly lookup left it, for tagging rows.
export function fillLeftIndex(fills) {
  const m = new Map();
  for (const f of fillFlags(fills)) for (const s of f.stops) m.set(`${f.date}|${s.stopNbr}`, s.reason);
  return m;
}
