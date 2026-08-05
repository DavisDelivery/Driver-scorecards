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
  return (Array.isArray(j.stops) ? j.stops : [])
    .filter((s) => s && s.stopNbr && isAttemptShipment(s.shipmentNbr))
    .map((s) => ({
      stopNbr: String(s.stopNbr),
      shipmentNbr: s.shipmentNbr ?? null,
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
      // Detected from the live board, not yet attributed by the evening scan.
      provisional: true,
    }));
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
export async function fetchAttemptsForDay(date, { derive = false, signal } = {}) {
  const settled = await fetchAttempts(date, { signal });
  const rows = Array.isArray(settled.attempts) ? settled.attempts.slice() : [];
  const wantDerive =
    derive === true || (derive === "auto" && rows.length === 0 && isRecentDay(date));
  if (!wantDerive) {
    return { ...settled, attempts: rows, provisionalCount: 0, derived: false };
  }
  let provisionalCount = 0;
  let deriveError = null;
  try {
    const seen = new Set(rows.map((a) => String(a.stopNbr)));
    for (const row of await fetchDerivedAttempts(date, { signal })) {
      if (seen.has(row.stopNbr)) continue;
      seen.add(row.stopNbr);
      rows.push(row);
      provisionalCount++;
    }
  } catch (err) {
    // Detection is a bonus on top of the settled list — surface that it failed
    // rather than throwing away the settled rows we did get.
    if (err?.name === "AbortError") throw err;
    deriveError = err?.message || "stop index unavailable";
  }
  return {
    ...settled,
    attempts: rows,
    count: rows.length,
    provisionalCount,
    deriveError,
    derived: true,
  };
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
