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
// Whether to detect the day's attempts from the live board on top of the settled list.
//
// "auto" detects when the settled list is empty — or when the day's evening scan has not run yet
// (no manifest). The second half exists because the dispatch app's Mark-as-attempt button writes a
// row straight onto the settled list during the day: with only "empty", one marked order before
// 8 PM would hide every other ATT order the board already shows. Settled rows still win on stopNbr,
// so a marked order is never listed twice.
export function shouldDetect(derive, rows, manifest, date) {
  if (derive === true) return true;
  if (derive !== "auto" || !isRecentDay(date)) return false;
  return (rows?.length ?? 0) === 0 || !manifest;
}

export async function fetchAttemptsForDay(
  date,
  { derive = false, notes = false, signal } = {},
) {
  const settled = await fetchAttempts(date, { signal });
  const planMissing = !!settled.manifest?.planMissing;
  const rows = (Array.isArray(settled.attempts) ? settled.attempts : []).map((a) => ({
    ...a,
    planMissing,
  }));
  const wantDerive = shouldDetect(derive, rows, settled.manifest, date);
  // The index is one fetch that serves BOTH detection and notes, so asking for notes
  // on a day we were already going to detect on costs nothing extra.
  if (!wantDerive && !notes) {
    return {
      ...settled,
      attempts: rows,
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
    attempts: rows,
    count: rows.length,
    provisionalCount,
    carriedOver,
    deriveError,
    derived: true,
  };
}

// Every day in [start, end] inclusive, as YYYY-MM-DD.
export function daysInRange(start, end, cap = 400) {
  const out = [];
  let d = start;
  while (d <= end && out.length < cap) {
    out.push(d);
    d = shiftDay(d, 1);
  }
  return out;
}

// The first day the feed covers. Its manifests begin with 06/24 and 06/25 (written
// the next morning, no attempts) and the evening scan proper on 06/26; every day
// before has no manifest at all. So earlier days aren't asked for, and read as
// "hand-logged attempts only" rather than as a run of nights with no scan.
export const FEED_EPOCH = "2026-06-25";

// What one day of the feed can say, so a day with no data is never shown as a day
// with no attempts. Checked against every manifest from 09/01 to 10/06:
//
//   ok            the evening scan ran. Zero orders is then a real zero — that
//                 includes weekends and holidays, which come back planMissing with
//                 counts of 0 (09/13) or with a plan of a few dozen stops (09/12: 22).
//                 A day WITH orders is ok whatever its counts say: 09/04 and 09/11
//                 carry no counts at all but list 9 and 10 orders.
//   pending       today, before the 8 PM scan has written anything
//   no_manifest   no scan that night (09/02)
//   fetch_not_ok  the scan ran but couldn't read NuVizz (09/08: fetchOk false)
//   failed        the request itself failed
//   before_feed   before FEED_EPOCH: there was no feed yet, so not a missed scan
export const DAY_STATUS_TEXT = {
  ok: "loaded",
  pending: "today's 8 PM scan hasn't run yet",
  no_manifest: "no evening scan that night",
  fetch_not_ok: "the evening scan couldn't read NuVizz",
  failed: "couldn't reach the feed",
  before_feed: "before the feed started",
};

// The statuses that mean "we don't know", as opposed to "nothing happened".
export const NO_DATA_STATUSES = new Set(["no_manifest", "fetch_not_ok", "failed"]);

export function classifyDay(j, { date, today = todayET() } = {}) {
  if (Array.isArray(j?.attempts) && j.attempts.length) return "ok";
  if (date && date < FEED_EPOCH) return "before_feed";
  const m = j?.manifest;
  // A day after today can't have had its scan either. fetchAttemptsRange never asks
  // for one, so "pending" in a period only ever means today.
  if (!m) return date && date >= today ? "pending" : "no_manifest";
  if (m.fetchOk === false) return "fetch_not_ok";
  return "ok";
}

// One day of the feed as every view keeps it.
function dayEntry(date, j, today) {
  // planMissing rides along on each row: it is the one reason an attempt can have no
  // driver that the row itself can't show (see attemptLegs.js).
  const planMissing = !!j?.manifest?.planMissing;
  return {
    status: classifyDay(j, { date, today }),
    rows: (j?.attempts || []).map((a) => ({ ...a, date, planMissing })),
    // The scan's own tallies (candidates is the 8:30 plan's size). Kept for later
    // use; nothing reads them yet, because dispatch hasn't confirmed what they mean.
    counts: j?.manifest?.counts || null,
    // The dispatch app's nightly driver lookup reports here what it could not read
    // (over its 10-call limit, no NuVizz id on file, a request that failed).
    fill: j?.manifest?.fill || null,
  };
}

const BEFORE_FEED = Object.freeze({ status: "before_feed", rows: [], counts: null, fill: null });

// One cache of feed days for every view, so moving between periods — or leaving
// the tab and coming back — refetches only what it hasn't got.
//
// Dispatch revises settled days after the fact: September's manifests carry a
// backfilledAt / lastEditedAt of 10/01, weeks after their scans. So:
//   - today is never cached; its 8 PM scan hasn't run, or has only just run;
//   - the trailing RECENT_DAYS are kept for RECENT_TTL_MS, then read again. That
//     covers yesterday too, whose late-night driver lookup can still fill names in;
//   - older days are kept for the session;
//   - a failed request is never kept, so the next look tries again.
export const RECENT_DAYS = 14;
export const RECENT_TTL_MS = 10 * 60_000;

export function createDayCache({ recentDays = RECENT_DAYS, ttlMs = RECENT_TTL_MS } = {}) {
  const store = new Map(); // date -> { entry, at }
  return {
    get(date, { today = todayET(), now = Date.now() } = {}) {
      const hit = store.get(date);
      if (!hit || date >= today) return null;
      if (date >= shiftDay(today, -recentDays) && now - hit.at >= ttlMs) {
        store.delete(date);
        return null;
      }
      return hit.entry;
    },
    set(date, entry, { today = todayET(), now = Date.now() } = {}) {
      if (date >= today || !entry || entry.status === "failed") return;
      store.set(date, { entry, at: now });
    },
    // Called after anything that changes a day: deleting an attempt from the feed,
    // or reassigning one.
    invalidate(date) {
      store.delete(date);
    },
    has(date) {
      return store.has(date);
    },
    clear() {
      store.clear();
    },
  };
}

export const dayCache = createDayCache();

// The settled attempts for a whole PERIOD, by asking for each day.
//
// The feed is per-day by design, so a period means N requests — but each one is a
// small Firestore read (no vendor traffic), and 30 days comes back in a few seconds
// at this concurrency. It is capped anyway: a 3M/6M/12M window would be hundreds of
// requests, so past `maxDays` nothing is asked for and `capped` is reported, so the
// caller can say the range is too wide rather than quietly showing a partial answer.
//
// Only the feed's own days are asked for, and only they count toward the cap: from
// FEED_EPOCH (earlier days are marked before_feed) up to today. Days after today are
// left out altogether — they have no scan to read, and "This Mo" used to ask for
// every one of them on each load.
//
// `days` maps each of those days to { status, rows, counts, fill } (see
// DAY_STATUS_TEXT), so a caller can tell a day with no attempts from a day it has no
// data for. `totalDays` is how many feed days the range holds. Only the
// nuvizz-attempts GET is ever called from here.
export async function fetchAttemptsRange(
  start,
  end,
  {
    signal,
    maxDays = 45,
    concurrency = 6,
    cache = dayCache,
    today = todayET(),
    now = Date.now(),
  } = {},
) {
  const days = new Map();
  const feedDays = [];
  for (const d of daysInRange(start, end > today ? today : end)) {
    if (d < FEED_EPOCH) days.set(d, BEFORE_FEED);
    else feedDays.push(d);
  }
  const capped = feedDays.length > maxDays;
  const want = capped ? [] : feedDays;
  const fills = [];
  let failed = 0;
  for (let i = 0; i < want.length; i += concurrency) {
    const slice = want.slice(i, i + concurrency);
    const got = await Promise.all(
      slice.map(async (d) => {
        const hit = cache?.get(d, { today, now });
        if (hit) return [d, hit];
        try {
          const entry = dayEntry(d, await fetchAttempts(d, { signal }), today);
          cache?.set(d, entry, { today, now });
          return [d, entry];
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          failed++;
          return [
            d,
            { status: "failed", rows: [], counts: null, fill: null, error: err?.message || "" },
          ];
        }
      }),
    );
    for (const [d, entry] of got) {
      days.set(d, entry);
      if (entry.fill) fills.push({ ...entry.fill, date: entry.fill.date || d });
    }
  }
  return {
    rows: [...days.values()].flatMap((e) => e.rows),
    days,
    fills,
    totalDays: feedDays.length,
    capped,
    failed,
  };
}

// One feed day, from the shared cache when it holds it: the same { status, rows,
// counts, fill } a period load keeps, and the same caching rules. A failed request
// comes back as a "failed" day (with the error) rather than throwing, so a caller can
// say the feed couldn't be reached for that day.
export async function loadFeedDay(date, { signal, cache = dayCache, today = todayET(), now = Date.now() } = {}) {
  if (date < FEED_EPOCH) return BEFORE_FEED;
  const hit = cache?.get(date, { today, now });
  if (hit) return hit;
  try {
    const entry = dayEntry(date, await fetchAttempts(date, { signal }), today);
    cache?.set(date, entry, { today, now });
    return entry;
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return { status: "failed", rows: [], counts: null, fill: null, error: err?.message || "" };
  }
}

// The latest of `candidates` (newest first) whose evening scan ran: one request per
// day, newest first, stopping at the first day with a manifest — so the Scorecard can
// open on the last day there is something to show without loading a whole period. On
// a Monday, yesterday is a Sunday with nothing on it; before 8 PM, today has no scan.
// A request that fails stops the walk: the feed being unreachable is the answer, not a
// reason to try older days.
//
// A weekday holiday's scan runs as usual and finds nothing (Labor Day 09/07: a plan of
// 21 stops, 0 attempts), and there is no holiday calendar (period.js). So a scanned day
// with no orders doesn't stop the walk while older candidates remain; it is the answer
// only when none of them has orders either. A real weekday can scan none too (10/05:
// a plan of 610, 0 attempts), so `tried` keeps each day's count and the card names the
// days it stepped over.
// → { day, entry, tried: [{ day, status, n }] } (day null when no candidate had a scan)
export async function lastScannedDay(candidates, opts = {}) {
  const tried = [];
  let empty = null;
  for (const day of candidates || []) {
    const entry = await loadFeedDay(day, opts);
    tried.push({ day, status: entry.status, n: entry.rows.length });
    if (entry.status === "failed" || (entry.status === "ok" && entry.rows.length)) return { day, entry, tried };
    if (entry.status === "ok" && !empty) empty = { day, entry };
  }
  return { ...(empty || { day: null, entry: null }), tried };
}

// The feed's days inside [start, end], summed up for one line of status text:
//   of          days the feed should cover (from FEED_EPOCH; today only once scanned)
//   loaded      of those, the ones with data
//   noData      [{ date, status }] — the days to name, oldest first
//   pending     today is in the window and its 8 PM scan hasn't run
//   todayFailed today is in the window and its request failed. Kept out of `of` like
//               a pending today: before 8 PM there is nothing to miss yet.
//   beforeFeed  days before FEED_EPOCH, which only hand-logged attempts can cover
export function feedCoverage(days, start, end, { today = todayET() } = {}) {
  const out = {
    of: 0,
    loaded: 0,
    noData: [],
    pending: false,
    todayFailed: false,
    beforeFeed: 0,
  };
  for (const [d, e] of days || []) {
    if (d < start || d > end) continue;
    if (e.status === "before_feed") out.beforeFeed++;
    else if (e.status === "pending") out.pending = true;
    else if (e.status === "failed" && d >= today) out.todayFailed = true;
    else {
      out.of++;
      if (NO_DATA_STATUSES.has(e.status)) out.noData.push({ date: d, status: e.status });
      else out.loaded++;
    }
  }
  out.noData.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// feedCoverage's noData, for one line of text rather than a list: grouped by why,
// in order of each reason's first day, with back-to-back days run together. A month
// the feed was unreachable is one run of 30 days, not 30 dates.
//   → [{ status, days, runs: [{ from, to, days }] }]
export function noDataRuns(noData) {
  const groups = new Map();
  for (const { date, status } of [...(noData || [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (!groups.has(status)) groups.set(status, { status, days: 0, runs: [] });
    const g = groups.get(status);
    const last = g.runs[g.runs.length - 1];
    if (last && shiftDay(last.to, 1) === date) {
      last.to = date;
      last.days++;
    } else {
      g.runs.push({ from: date, to: date, days: 1 });
    }
    g.days++;
  }
  return [...groups.values()];
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

// Remove one auto-detected attempt from the feed (by ET day + stopNbr). The day is
// dropped from the cache whether or not the delete went through, so the period's
// charts read it again rather than keep counting a deleted attempt.
export async function deleteAttempt(date, stopNbr, { signal, cache = dayCache } = {}) {
  const url =
    `${ATTEMPTS_FEED_URL}?date=${encodeURIComponent(date)}` +
    `&stopNbr=${encodeURIComponent(stopNbr)}`;
  try {
    const res = await fetch(url, { method: "DELETE", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json().catch(() => ({ ok: true }));
  } finally {
    cache?.invalidate(date);
  }
}
