// Client for the dispatch app's automated attempts feed (CORS, read-only, no auth).
// A delivery "attempt" is a stop a driver couldn't complete; CS prepends "ATT" to
// the shipment and unplans it. The feed computes who ORIGINALLY had each attempt
// from that morning's routed-plan snapshot. Data is keyed by America/New_York day.
//
// TWO SOURCES, deliberately:
//
//   ATTEMPTS_FEED_URL   the dispatch app's SETTLED attempts list. Written once a day
//                       by its 8:00pm-ET scan, which joins each ATT stop back to the
//                       8:30am routed-plan snapshot — the only place the ORIGINAL
//                       driver survives after the stop is unplanned and re-routed.
//                       Authoritative, but it does not exist for today until 8pm.
//
//   STOP_INDEX_URL      the dispatch app's per-day stop index, refreshed every ~15
//                       minutes all day. Reading it costs ZERO NuVizz calls (it is
//                       served straight from Firestore) and it already carries
//                       `shipmentNbr`, so today's attempts can be DETECTED from it
//                       hours before the evening scan attributes them.
//
// Why both: "Run scan" used to re-read the settled list only, so before 8pm it
// re-read an empty document and the button looked broken — the day's attempts were
// plainly visible in dispatch while the scorecard said "No attempts". Detection now
// comes from the stop index straight away; attribution still waits for the evening
// scan, and rows are flagged `provisional` until it lands so a re-delivery driver is
// never silently blamed for someone else's attempt.
export const ATTEMPTS_FEED_URL =
  "https://dd-dispatch-map.netlify.app/.netlify/functions/nuvizz-attempts";
export const STOP_INDEX_URL =
  "https://dd-dispatch-map.netlify.app/.netlify/functions/nuvizz-pull-today-stops";

// Today as YYYY-MM-DD in America/New_York (the feed's day boundary).
export function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Fetch the attempts feed for a day. Optional driver filter; pass an AbortSignal
// to cancel. Throws on transport / { ok:false } errors.
export async function fetchAttempts(date, { driver, signal } = {}) {
  const url =
    `${ATTEMPTS_FEED_URL}?date=${encodeURIComponent(date)}` +
    (driver ? `&driver=${encodeURIComponent(driver)}` : "");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.ok === false) throw new Error(j?.error || "Feed error");
  return j;
}

// The dispatch app's one authoritative test for "this stop was attempted": customer
// service prepends ATT to the SHIPMENT number (never the stop number), which is what
// its own `isAttemptShipment` checks and what the portal's saved search matches.
export const isAttemptShipment = (shipmentNbr) =>
  /^att/i.test(String(shipmentNbr ?? "").trim());

// Shift a YYYY-MM-DD by whole days. Built from the string's own components rather
// than new Date(str), so it can never land a day off through timezone parsing.
export function shiftDay(date, delta) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + delta));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Yesterday in the business timezone — the most useful day on the attempts log,
// since its 8pm scan has already run and attributed every attempt to a driver.
export const yesterdayET = () => shiftDay(todayET(), -1);

// Is this ET day recent enough that the dispatch app's stop index still covers it?
// Differenced on the date strings themselves (never through new Date()) so the answer
// can't shift a day with the viewer's timezone.
export function isRecentDay(date, withinDays = 2) {
  const asDays = (s) => {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000 : null;
  };
  const d = asDays(date);
  const today = asDays(todayET());
  return d !== null && today !== null && today - d >= 0 && today - d <= withinDays;
}

// Which ET day a stop was DUE on, which is what makes it that day's attempt.
//
// This is the whole difference between "attempted today" and "failed earlier and still
// being redelivered". A stop that fails is re-planned onto a later day's route, so it
// keeps appearing on the board for days — but the vendor does NOT roll its estimated
// arrival forward, and the evening scan's saved search filters on arrival = today. So
// arrival day is the field that decides.
//
// `plannedEtaDTTM` is the vendor's own estimated arrival and is checked FIRST because
// it reproduces the evening scan's result exactly. The other two candidates do not:
//   - `boardDate` is arrival-OR-requested date, then re-stamped with the board's day.
//     Checked on 08-11 it wrongly claims stop 007159137 (vendor arrival 08-10, already
//     recorded as an 08-10 attempt) as an 08-11 attempt — the scan excluded it.
//   - `scheduledDate` is stamped by the dispatch app with the board's own date, so it
//     always equals the day being viewed and would match every row.
// Both are kept only as fallbacks for a stop carrying no vendor arrival at all, where
// dropping the row would hide a genuine attempt.
//
// Verified against 2026-08-11: filtering on plannedEtaDTTM reproduces the scan's ten
// recorded stops with no false positives and no false negatives; boardDate adds one.
const arrivalDay = (s) =>
  String(s?.plannedEtaDTTM || "").slice(0, 10) ||
  s?.boardDate ||
  String(s?.scheduledDate || "").slice(0, 10);

// Customer service writes why a delivery failed into the order's instructions, and
// the vendor concatenates that with Uline's own boilerplate into one semicolon-joined
// string. The note is whatever ISN'T boilerplate.
//
// Matching on the "ATT:" prefix alone is not enough — CS is inconsistent about it
// ("ATT:", "Att:", "Attempted:", "ATTEMPTED @ 4:20PM.") and a third of the notes carry
// no marker at all ("PER SERCURITY NO ROOM FOR RECEIVING NOT ABLE TO TAKE"). So the
// boilerplate is dropped and the rest kept, then a leading marker is trimmed for
// display. Checked against a full day's stops: this finds a note on every one, where
// a prefix rule found two thirds.
const NOTE_BOILERPLATE = /^\s*(SPL-INSTR-TEXT\s*:|TOTAL-AMOUNT\s*:|PO\s*:|APPT\s*#)/i;
const NOTE_LEAD_MARKER = /^\s*att(?:empt(?:ed)?)?\s*[:.\-]\s*/i;

export function attemptNote(stop) {
  const raw = String(stop?.orderInstructions || "");
  if (!raw.trim()) return "";
  const kept = raw
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x && !NOTE_BOILERPLATE.test(x));
  return kept.join("; ").replace(NOTE_LEAD_MARKER, "").trim();
}

// Detect the day's attempts from the Firestore-backed stop index. NO NuVizz traffic:
// the endpoint serves the pre-scanned index (its `live=1` debug mode would scan the
// vendor, so it is deliberately never passed here).
//
// Attribution is deliberately left EMPTY. By the time a stop is re-planned, the
// driver on it is whoever is re-delivering it — not who attempted it — so filling
// `originalDriverName` from the index would blame the wrong person. These rows carry
// the current driver as context only; the evening scan supplies the real attribution,
// and until then the row's driver dropdown lets an operator attribute it by hand.
export async function fetchDerivedAttempts(date, { signal } = {}) {
  const res = await fetch(
    `${STOP_INDEX_URL}?date=${encodeURIComponent(date)}`,
    { signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j || j.ok === false) throw new Error(j?.error || "Stop index error");
  const detectedAt = j.generated || j.lastScannedAt || new Date().toISOString();
  const attStops = (Array.isArray(j.stops) ? j.stops : []).filter(
    (s) => s && s.stopNbr && isAttemptShipment(s.shipmentNbr),
  );
  // Due TODAY. Without this every unresolved ATT stop from previous days — still on
  // the board awaiting redelivery, still ATT-marked — reads as a fresh attempt, and
  // the same failure is re-reported every day until it finally gets delivered.
  const dueToday = attStops.filter((s) => arrivalDay(s) === date);
  const rows = dueToday
    .map((s) => ({
      stopNbr: String(s.stopNbr),
      shipmentNbr: s.shipmentNbr ?? null,
      orderNbr: s.orderNbr ?? null,
      originalDriverName: null,
      originalDriverUserName: null,
      originalLoadNbr: null,
      routeName: s.routeName ?? null,
      businessName: s.businessName ?? null,
      addr1: s.addr1 ?? null,
      city: s.city ?? null,
      state: s.state ?? null,
      zip: s.zip ?? null,
      currentDriverName: s.driverName ?? null,
      currentDriverUserName: s.driverUserName ?? null,
      currentStatus: s.normalizedStatus ?? s.status ?? null,
      currentlyUnplanned: !!s.isUnplanned,
      matched: false,
      detectedAt,
      // Why CS said the delivery failed.
      note: attemptNote(s),
      // Detected from the live board, not yet attributed by the evening scan.
      provisional: true,
    }));
  // CS notes for EVERY ATT stop on the board that day, not just the ones due today —
  // the settled list carries no notes of its own, so this map is what supplies them
  // for rows that came from the evening scan.
  const notes = new Map();
  for (const s of attStops) {
    const note = attemptNote(s);
    if (note) notes.set(String(s.stopNbr), note);
  }
  // Earlier days' failures still sitting on today's board awaiting redelivery. Not
  // today's attempts — but worth reporting a count for, so an empty log reads as
  // "nothing failed today" rather than as the feed being broken.
  return { rows, notes, carriedOver: attStops.length - dueToday.length };
}

// Flag the rows that are two legs of ONE delivery rather than two failures.
//
// When a stop looks wrong, dispatch duplicates it — the copy gets a "-1" stop number
// but keeps the original's shipment number, so both legs carry the ATT marker and both
// land in the log looking like separate attempts against the same PRO. (One of them
// says so in its own note: "DUPPED SINCE ORIGINAL STOP SEEMED BUGGED".) The dispatch
// app stores attempts keyed by stop number and groups nothing, so its own totals count
// these twice; rather than quietly diverge from the numbers it reports, the rows are
// marked so a reader can see WHY the same PRO appears more than once.
function markSplitLegs(rows) {
  const byShipment = new Map();
  for (const r of rows) {
    const k = String(r.shipmentNbr || "").trim().toUpperCase();
    if (!k) continue;
    byShipment.set(k, (byShipment.get(k) || 0) + 1);
  }
  return rows.map((r) => {
    const k = String(r.shipmentNbr || "").trim().toUpperCase();
    const legs = k ? byShipment.get(k) || 1 : 1;
    return legs > 1 ? { ...r, legs } : r;
  });
}

// The attempts log for one day: the settled list, plus (when asked) anything the
// live stop index has detected that the settled list doesn't know about yet.
//
// Settled rows always WIN on stopNbr — they carry the real morning-driver
// attribution, so a provisional row must never displace one. `derive` is opt-in
// because the stop index is a multi-megabyte payload: the caller pays for it on an
// explicit "Run scan", or when the settled list is empty for a recent day (exactly
// the before-8pm case that made the button look broken), and never when simply
// browsing settled history.
//
// `derive`: true forces detection, false never detects, "auto" detects only when the
// settled list is empty for a day recent enough for the index to still hold it.
export async function fetchAttemptsForDay(
  date,
  { derive = false, notes = false, signal } = {},
) {
  const settled = await fetchAttempts(date, { signal });
  const rows = Array.isArray(settled.attempts) ? settled.attempts.slice() : [];
  const wantDerive =
    derive === true || (derive === "auto" && rows.length === 0 && isRecentDay(date));
  // The index is one fetch that serves BOTH detection and notes, so asking for notes
  // on a day we were already going to detect on costs nothing extra.
  if (!wantDerive && !notes) {
    return {
      ...settled,
      attempts: markSplitLegs(rows),
      provisionalCount: 0,
      derived: false,
    };
  }
  let provisionalCount = 0;
  let carriedOver = 0;
  let deriveError = null;
  try {
    const seen = new Set(rows.map((a) => String(a.stopNbr)));
    const derivedResult = await fetchDerivedAttempts(date, { signal });
    carriedOver = derivedResult.carriedOver;
    // Settled rows have no notes of their own — attach them from the board.
    for (let i = 0; i < rows.length; i++) {
      const note = derivedResult.notes.get(String(rows[i].stopNbr));
      if (note) rows[i] = { ...rows[i], note };
    }
    if (wantDerive) {
      for (const row of derivedResult.rows) {
        if (seen.has(row.stopNbr)) continue;
        seen.add(row.stopNbr);
        rows.push(row);
        provisionalCount++;
      }
    }
  } catch (err) {
    // Detection is a bonus on top of the settled list — surface that it failed
    // rather than throwing away the settled rows we did get.
    if (err?.name === "AbortError") throw err;
    deriveError = err?.message || "stop index unavailable";
  }
  return {
    ...settled,
    attempts: markSplitLegs(rows),
    count: rows.length,
    provisionalCount,
    carriedOver,
    deriveError,
    derived: true,
  };
}

// The portal's Activity Timeline for ONE stop: Stop Planned / Dispatched / Updated /
// Unplanned, each with the time, the person who did it, their company, and the route.
// This is the only place that says who actually had an order before it was unplanned
// and re-routed, which is exactly what an unattributed attempt needs.
//
// Unlike everything else in this file it is NOT free — the dispatch app answers it with
// a live vendor lookup. It is therefore only ever called for a single order the user has
// explicitly opened, never in a loop and never on render.
export const STOP_EVENTS_URL =
  "https://dd-dispatch-map.netlify.app/.netlify/functions/nuvizz-stop-events";

// "8/13/26 04:21 PM" -> a sortable key, built from the string's own parts so no
// timezone conversion can shift the day.
export function eventSortKey(dttm) {
  const m = String(dttm || "").match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (!m) return "";
  let h = Number(m[4]);
  const ap = (m[6] || "").toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  const p = (n) => String(n).padStart(2, "0");
  return `${yr}-${p(m[1])}-${p(m[2])}T${p(h)}:${m[5]}`;
}

export async function fetchStopEvents(stopNbr, { stopId, signal } = {}) {
  const qs = new URLSearchParams();
  if (stopNbr) qs.set("stopNbr", String(stopNbr));
  if (stopId) qs.set("stopId", String(stopId));
  const res = await fetch(`${STOP_EVENTS_URL}?${qs}`, { signal });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || j.ok === false) {
    throw new Error(j?.reason || `HTTP ${res.status}`);
  }
  // Newest first, matching every other log in the app.
  const events = (Array.isArray(j.events) ? j.events : [])
    .map((e) => ({ ...e, _k: eventSortKey(e.dttm) }))
    .sort((a, b) => b._k.localeCompare(a._k));
  return { events, source: j.source || "" };
}

// Events only a DRIVER can produce — they happen out on the road, at the stop.
// Planning, unplanning, creating and updating a stop are dispatcher actions and are
// deliberately NOT in here: a dispatcher who plans an order never had it, and listing
// them as though they did is exactly the wrong answer to "who had this?".
const DROVE_IT = /(arrival|depart|confirmation|dispatched|delivered|delivery|pod|signature|exception)/i;

// Everyone in a stop's timeline, split by whether they actually handled the order.
// `drove` is the "who had this" answer — the driver on the pickup/dispatch events,
// which survives even after the stop is unplanned away from them and re-routed.
export function actorsFromEvents(events) {
  const seen = new Map();
  for (const e of events) {
    const name = String(e.user || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, {
        name,
        company: e.company || "",
        ours: /davis/i.test(e.company || ""),
        routes: new Set(),
        last: e.dttm,
        actions: 0,
        drove: false,
      });
    }
    const a = seen.get(key);
    a.actions++;
    if (e.routeName) a.routes.add(e.routeName);
    if (DROVE_IT.test(String(e.name || ""))) a.drove = true;
  }
  return [...seen.values()].map((a) => ({ ...a, routes: [...a.routes] }));
}

// Remove one auto-detected attempt from the feed (by ET day + stopNbr).
export async function deleteAttempt(date, stopNbr, { signal } = {}) {
  const url =
    `${ATTEMPTS_FEED_URL}?date=${encodeURIComponent(date)}` +
    `&stopNbr=${encodeURIComponent(stopNbr)}`;
  const res = await fetch(url, { method: "DELETE", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({ ok: true }));
}
