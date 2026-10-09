// The Scorecard's windows and headline numbers, counted from the same blend cells as
// the leaderboards below them, so a tile and the charts can never describe two
// different populations.
//
// What the tiles counted before v0.22.0, and why each moved:
//   This Month      the selected month's raw live rows — returns, traces, unable-to-track
//                   and no-fault rows included — plus the history beside them. Now
//                   "Counted failures": the six failure categories (categories.js
//                   FAILURES), exactly what the failure leaderboards add up to.
//   Year to Date    every Scorecard category over the WHOLE picked year, attempts and
//                   compliments summed in with failures. Now failures only, January
//                   through the picked month.
//   Driver Fault /  the picked month's live rows, with an "Exonerated" that took the
//   Exonerated      customer but not the vendor (the PDF cover took the vendor but not
//                   the customer). Now faultGroups.js over the period's counted live
//                   failures, the same groups the PDF cover counts.
// Attempts (logged) and Compliments get tiles of their own: neither is a failure, and
// neither is ever added to one.
//
// The period also follows the month picker now. It counted back from this month
// whatever month was picked, so "Mar 2025 · This Mo" showed October 2026.
import { FAILURES, ATTEMPTS } from "./categories.js";
import { monthWindow, addDays, weekdayOfYmd, shiftYm, fmtDate } from "./period.js";
import { tally, tallyTotal } from "./blend.js";
import { incidentYm } from "./incidentDate.js";
import { faultSplit, FAULT_GROUP_LABEL } from "./faultGroups.js";
import { buildAttemptRecords } from "./attemptRecords.js";
import { FEED_EPOCH, NO_DATA_STATUSES, daysInRange, todayET } from "./attemptsFeed.js";

const pad2 = (n) => String(n).padStart(2, "0");
// A day in a sentence: "Jun 25, 2026" — never MM/DD (period.js fmtDate).
const fmtMDY = (ymd) => fmtDate(ymd, { year: true });
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

// The Scorecard's months, all counted back from the month picker (the anchor):
//   periodMonths  the preset's months (This Mo, 3M, a custom range …)
//   ytdMonths     January through the anchor month, in the anchor's year
//   scopeMonths   both together — the months a leaderboard lists a driver for
//   nested        the period lies inside the year to date, so the year's bar holds the
//                 period's as its solid part ("3 / 12")
// A 12M or custom period reaching back over Jan 1 is not nested: its bar is the period
// alone, and the year to date is a number beside it, not a part of it ("5 · YTD 2").
export function scorecardWindows({ preset, anchor, from, to }) {
  const period = monthWindow(preset, { anchor, from, to });
  const ytd = monthWindow("ytd", { anchor });
  const inYtd = new Set(ytd.months);
  return {
    periodMonths: period.months,
    periodLabel: period.label,
    ytdMonths: ytd.months,
    ytdLabel: ytd.label,
    ytdYear: Number(ytd.months[0].slice(0, 4)),
    scopeMonths: [...new Set([...period.months, ...ytd.months])].sort(),
    nested: period.months.every((ym) => inYtd.has(ym)),
  };
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtYm = (ym) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// A run of months in words: "Oct 2026", "Aug – Oct 2026", "Nov 2025 – Jan 2026".
export function monthSpanLabel(months) {
  const sorted = [...new Set(months || [])].sort();
  if (!sorted.length) return "";
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  if (a === b) return fmtYm(a);
  if (a.slice(0, 4) === b.slice(0, 4)) return `${MONTH_ABBR[Number(a.slice(5, 7)) - 1]} – ${fmtYm(b)}`;
  return `${fmtYm(a)} – ${fmtYm(b)}`;
}

// A count over months and categories, as the leaderboards and their drill-downs count
// it: every attributed cell the blend serves, inactive drivers and ids with no roster
// row included.
export const blendTotal = (blend, months, categoryIds) => tallyTotal(tally(blend, months, categoryIds));

// The live failures a period's fault tiles split: every row that counts (no-fault and
// unattributed rows never do) in a failure cell live entries serve. History has no
// fault field, so the cells it serves are named instead (historyMonths).
export function liveFailureRows(blend, months) {
  const want = new Set(FAILURES);
  return [...new Set(months)].flatMap((ym) => (blend.liveByYm[ym] || []).filter((inc) => want.has(inc.category)));
}

// The months of a span with failures only history can answer for — a whole history
// month, or the history cells of a part-live one (Jan 2026) — and how many failures
// those cells hold. The fault tiles can't split them; under Driver-fault scope they are
// "not tracked" and count nothing.
// Pass the all-fault blend: under Driver-fault scope history serves nothing to count.
export function historyFailureMonths(plain, months) {
  const out = { months: [], count: 0 };
  for (const ym of [...new Set(months)].sort()) {
    const cats = new Set(FAILURES.filter((cat) => plain.cellSource(ym, cat) === "history"));
    if (!cats.size) continue;
    out.months.push(ym);
    for (const e of plain.entries(ym)) if (cats.has(e.category)) out.count += e.n;
  }
  return out;
}

// Whether any failure cell of a span is live: something Driver-fault scope can count.
// A span with none, but with history, is wholly "not tracked" under that scope, and a
// tile says so with "—" rather than drawing a 0 that reads as none happened.
export function hasLiveFailures(plain, months) {
  return [...new Set(months)].some((ym) => FAILURES.some((cat) => plain.isLive(ym, cat)));
}

// The period's failures marked "do not fault driver". They count against nobody, so
// they are in no tile; the old Exonerated tile counted most of them (May 2026: 16 of
// its 17 carried the mark, 2 of those with no driver). Named under the tiles, so the
// drop has a reason on screen.
export function noFaultFailures(incidents, months) {
  const want = new Set(months);
  const ids = (incidents || [])
    .filter((inc) => inc?.no_fault && FAILURES.includes(inc.category) && want.has(incidentYm(inc)))
    .map((inc) => inc.id);
  return { n: ids.length, ids };
}

// Every headline number, for a window:
//   blend      the blend the leaderboards count from (Driver-fault scope or not)
//   plain      the all-fault blend: the fault split is over every counted live failure
//              whichever scope is on, since it is the split that explains the scope
//   incidents  every live incident, for the no-fault count
// → { failures: { period, ytd }, attempts: { period, ytd }, compliments: { period, ytd },
//     fault: faultSplit(...), history / historyYtd: historyFailureMonths(...) over the
//     period / the year to date, live: { period, ytd } (hasLiveFailures), noFault }
// A compliment has no fault (ManualEntry writes it with an empty one), so under
// Driver-fault scope it never counts: the tile says "not split by fault" rather than 0.
export function scorecardKpis({ blend, plain = blend, windows, incidents = [] }) {
  const { periodMonths, ytdMonths } = windows;
  const both = (cats) => ({
    period: blendTotal(blend, periodMonths, cats),
    ytd: blendTotal(blend, ytdMonths, cats),
  });
  return {
    failures: both(FAILURES),
    attempts: both([ATTEMPTS]),
    compliments: both(["compliment"]),
    fault: faultSplit(liveFailureRows(plain, periodMonths)),
    history: historyFailureMonths(plain, periodMonths),
    historyYtd: historyFailureMonths(plain, ytdMonths),
    live: { period: hasLiveFailures(plain, periodMonths), ytd: hasLiveFailures(plain, ytdMonths) },
    noFault: noFaultFailures(incidents, periodMonths),
  };
}

// Under Driver-fault scope, a span ("period" or "ytd") whose failures only history holds:
// nothing the scope can count, so its tile reads "—", as the fault tiles and the
// leaderboards' "Nothing tracked by fault" do — not a 0 that reads as none happened. A
// span with a live failure cell counts it, and names the history months it leaves out.
export function failuresNotTracked(kpis, span, fault) {
  const hist = span === "ytd" ? kpis.historyYtd : kpis.history;
  return !!fault && !kpis.live[span] && hist.months.length > 0;
}

// What each tile's number opens: a drawer state (drill.js) carrying the number shown,
// so the drawer can prove it counts the same thing. test/drill-reconcile.test.mjs
// resolves every one of them.
//   periodLabel  the period's name in the drawer ("Oct 2026")
//   vocab        the screen's categories, for a driver opened from the drawer
export function kpiDrills({ kpis, windows, fault = null, periodLabel, vocab }) {
  const scopes = (t) => [
    { label: periodLabel, months: windows.periodMonths, expected: t.period },
    { label: `YTD ${windows.ytdYear}`, months: windows.ytdMonths, expected: t.ytd },
  ];
  const cats = (categoryIds, t, scope = 0, title) => ({
    spec: { kind: "blend", categoryIds, fault, ...(title ? { title } : {}) },
    scopes: scopes(t),
    scope,
    vocab,
  });
  // An explicit list of live entries, headed by what they are.
  const list = (ids, title) => ({
    spec: { kind: "incidents", ids, categoryIds: FAILURES, months: windows.periodMonths, title, label: periodLabel },
    expected: ids.length,
  });
  // A fault group: its live failures, as an explicit list. Driver fault is the
  // Driver-fault blend itself, so its drawer marks the history it can't count. It is
  // the period as the drawer's one scope, as the other tiles' are: a driver opened
  // from inside it (drill.js driverFromDrawer) takes their months from the scopes, and
  // a spec carrying its own months left that driver with none — an empty record.
  const group = (g) => {
    if (g === "driver") {
      return {
        spec: { kind: "blend", categoryIds: FAILURES, fault: "driver", title: FAULT_GROUP_LABEL.driver },
        scopes: [{ label: periodLabel, months: windows.periodMonths, expected: kpis.fault.groups.driver.n }],
        scope: 0,
        vocab,
      };
    }
    return list(kpis.fault.groups[g].ids, FAULT_GROUP_LABEL[g]);
  };
  return {
    failures: cats(FAILURES, kpis.failures, 0, "Counted failures"),
    failuresYtd: cats(FAILURES, kpis.failures, 1, "Counted failures"),
    attempts: cats([ATTEMPTS], kpis.attempts),
    compliments: cats(["compliment"], kpis.compliments),
    noFault: list(kpis.noFault.ids, "Marked do not fault driver"),
    group,
  };
}

// ── The dispatch feed beside "Attempts (logged)" ──────────────────────────────
//
// Chad hasn't decided which attempts the Scorecard should count (10/07: "let's circle
// back to this"): the ones somebody logged or reassigned, or every attempted order the
// dispatch feed saw. So the tile shows both, each labelled. The feed's number is read
// from the days the shared feed cache already holds — the Attempts tab and the card
// below fill it — and never fetched for the tile on its own: landing on the Scorecard
// must not set off a 45-day load. A period the cache only partly covers says so.

// The feed days a span of months covers: from the feed's first day, through yesterday
// (today is never cached, and before 8 PM it has no scan).
export function feedSpan(months, { today = todayET() } = {}) {
  const sorted = [...new Set(months)].sort();
  if (!sorted.length) return null;
  const start = `${sorted[0]}-01` < FEED_EPOCH ? FEED_EPOCH : `${sorted[0]}-01`;
  const last = monthEnd(sorted[sorted.length - 1]);
  const yesterday = addDays(today, -1);
  const end = last < yesterday ? last : yesterday;
  return start > end ? null : { start, end };
}

// The orders the feed saw over a span, from the cache alone:
//   { of, loaded, withData, orders, start, end }
//   of        feed days in the span
//   loaded    of those, the days the cache holds
//   withData  of those, the days with a scan to read (a night with no scan is loaded,
//             but says nothing)
//   orders    attempted orders on them, one per order (attemptRecords.js)
//   beforeFeed  the whole span is before the feed began (no days to load, ever)
//   sinceFeed   the span starts before the feed began: `of` counts only the days since,
//               so the line says so — "saw 98 orders" beside a six-month Attempts
//               (logged) read as the same six months
export function cachedDispatch(months, { cache, today = todayET(), now = Date.now() } = {}) {
  const span = feedSpan(months, { today });
  if (!span) {
    const last = [...new Set(months)].sort().pop();
    const beforeFeed = !last || monthEnd(last) < FEED_EPOCH;
    return { of: 0, loaded: 0, withData: 0, orders: 0, start: null, end: null, beforeFeed, sinceFeed: false };
  }
  const sinceFeed = `${[...new Set(months)].sort()[0]}-01` < FEED_EPOCH;
  const days = new Map();
  let of = 0;
  for (const d of daysInRange(span.start, span.end, 4000)) {
    of++;
    const hit = cache?.get(d, { today, now });
    if (hit) days.set(d, hit);
  }
  const withData = [...days.values()].filter((e) => !NO_DATA_STATUSES.has(e.status)).length;
  const orders = buildAttemptRecords({ feedDays: days, incidents: [] }).records.length;
  return { of, loaded: days.size, withData, orders, beforeFeed: false, sinceFeed, ...span };
}

// The next block of days to load when asked: the newest `chunk` days ending at the
// latest day the cache doesn't hold. null when every day is in.
export function nextFeedChunk({ start, end }, { isCached, chunk = 45 } = {}) {
  if (!start || !end) return null;
  let e = end;
  while (e >= start && isCached(e)) e = addDays(e, -1);
  if (e < start) return null;
  const s = addDays(e, -(chunk - 1));
  return [s < start ? start : s, e];
}

// The line under "Attempts (logged)": what the dispatch feed saw, with how much of the
// period it is from — short enough for a tile's two lines ("feed: 4 orders on 1 of 105
// days"; "feed from Jun 25: …" when the period starts before the feed). null when
// nothing is loaded yet (the tile offers to count instead). A loaded day with no scan
// to read says nothing, so days that are all like that are never drawn as "0 orders".
export function dispatchText(d) {
  if (!d) return null;
  if (!d.of) return d.beforeFeed ? `dispatch feed starts ${fmtMDY(FEED_EPOCH)}` : "feed: no evening scan yet";
  if (!d.loaded) return null;
  const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
  if (!d.withData) return `feed: no evening scan on the ${d.loaded === 1 ? "day" : days(d.loaded)} loaded`;
  const orders = `${d.orders} order${d.orders === 1 ? "" : "s"}`;
  const lead = d.sinceFeed ? `feed from ${fmtDate(FEED_EPOCH, { year: false })}` : "feed";
  if (d.loaded === d.of && d.withData === d.of) return `${lead}: ${orders}`;
  return `${lead}: ${orders} on ${d.withData} of ${days(d.of)}`;
}

// ── The Attempts card's day ───────────────────────────────────────────────────
//
// The card shows one day, and that day belongs to the month picker: it is a day of the
// picked month. Unless one is picked it is the month's last business day whose evening
// scan ran — not yesterday, which on a Monday is an empty Sunday, and not today, which
// is empty until 8 PM. These are the days to try, newest first: Mon–Fri, from today (or
// the month's last day) back, never before the feed began. A handful at most, one
// request each, so the Scorecard never loads a period to find one.
//
// The current month walks on into the month before. On its first business day, before
// that evening's scan, it has no day with one yet: the last business day that has one
// is in the month before (Mon 11/02 opens on Fri 10/30), and the card shows that day
// rather than nothing.
export function attemptsDayCandidates(anchorYm, { today = todayET(), max = 10 } = {}) {
  if (!/^\d{4}-\d{2}$/.test(anchorYm || "")) return [];
  const first = anchorYm === today.slice(0, 7) ? `${shiftYm(anchorYm, -1)}-01` : `${anchorYm}-01`;
  const lastDay = monthEnd(anchorYm);
  const floor = first < FEED_EPOCH ? FEED_EPOCH : first;
  const out = [];
  for (let d = lastDay < today ? lastDay : today; d >= floor && out.length < max; d = addDays(d, -1)) {
    const wd = weekdayOfYmd(d);
    if (wd >= 1 && wd <= 5) out.push(d);
  }
  return out;
}

// The day the card can show for a month: a picked day inside it (no later than today,
// no earlier than the feed), or null. Picking another month drops the old day.
//   → { min, max } as well, for the date input
export function attemptsDayBounds(anchorYm, { today = todayET() } = {}) {
  if (!/^\d{4}-\d{2}$/.test(anchorYm || "")) return null;
  const first = `${anchorYm}-01`;
  const last = monthEnd(anchorYm);
  const min = first < FEED_EPOCH ? FEED_EPOCH : first;
  const max = last < today ? last : today;
  return min > max ? null : { min, max };
}

export function pickedAttemptsDay(day, anchorYm, opts) {
  const b = attemptsDayBounds(anchorYm, opts);
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return null;
  return day >= b.min && day <= b.max ? day : null;
}

// Why the card has no day to show, from the days it actually tried
// (attemptsFeed.js lastScannedDay's `tried`, newest first). Only for a month the feed
// covers: before it, the card says when the feed starts.
//   only today, before its 8 PM scan  → "No evening scan yet in Nov 2026 — …"
//   otherwise                         → how many business days, and which
export function noScanText(tried, monthLabel) {
  if (!tried?.length) return `No business day of ${monthLabel} to show yet.`;
  if (tried.every((t) => t.status === "pending")) {
    return `No evening scan yet in ${monthLabel} — today's 8 PM scan hasn't run.`;
  }
  const newest = fmtMDY(tried[0].day);
  const oldest = fmtMDY(tried[tried.length - 1].day);
  return tried.length === 1
    ? `No evening scan to show for ${newest}.`
    : `No evening scan to show for any of the ${tried.length} business days from ${oldest} to ${newest}.`;
}
