// The numbers behind the manual-entry tabs' analytics (Forgotten Freight, Unable to
// Track, Mis-Deliveries, Compliments and Attempts), decided without a browser so they
// can be tested.
//
// Every tab counts one list of records over one window:
//   - an incident tab counts its category's incidents
//   - Attempts counts attempt records (attemptRecords.js): one per order, the feed's
//     plus the hand-logged ones
// and every record is dated by incidentDateStr — the date the Scorecard files it
// under. The tabs used to date by delivered_date || created_at, which put a
// report-ingested trace or return under the day its report was loaded rather than the
// day it happened.
//
// Picking a driver ("the focus") re-scopes the panel: the tiles count that driver's
// records and the charts draw them against the rest of the fleet. Totals never move
// with it, and a deactivated driver is never offered as one — they still count in
// every total, they're just not someone being managed (CLAUDE.md).
import { incidentDateStr, incidentYm } from "./incidentDate.js";
import { weekdayOfYmd, addDays, shiftYm, comparisonWindow } from "./period.js";
import { driverKey, customerKey, normPro } from "./attemptRecords.js";
import { peerSet, rankOf } from "./people.js";
import { matchDriver } from "./driverMatch.js";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The ET day a record is filed under.
export const recordDate = (r) => incidentDateStr(r).slice(0, 10);

// Who a record counts under — the key attemptRecords.js gives an attempt, and the same
// rule for an incident: the roster id, else the name it carries, else "unassigned".
export const keyOf = (r) => r?.key || driverKey(r);

export function inWindow(records, win) {
  if (!win?.start || !win?.end) return [];
  return (records || []).filter((r) => {
    const d = recordDate(r);
    return d && d >= win.start && d <= win.end;
  });
}

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const utcDay = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));

// Whole days from `a` to `b` (both YYYY-MM-DD): 0 for the same day. Read from the strings.
export function dayDiff(a, b) {
  if (!isDay(a) || !isDay(b)) return null;
  return Math.round((utcDay(b) - utcDay(a)) / 86_400_000);
}

const mondayOfYmd = (ymd) => addDays(ymd, -((weekdayOfYmd(ymd) + 6) % 7));
const lastOfMonth = (ym) =>
  `${ym}-${String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
const mmdd = (ymd) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;
export const fmtMonthShort = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;

// ── Focus ────────────────────────────────────────────────────────────────────

// The focus as the screen should use it: a deactivated roster driver can't be one (a
// stale link may still name them), so they read as no focus. Any other key — an id
// with no roster row, a feed name, Unassigned — is kept: unknown is never invisible.
export function activeFocus(focus, drivers = []) {
  if (!focus) return null;
  const d = (drivers || []).find((x) => x && x.id === focus);
  return d && d.active === false ? null : focus;
}

export function countsByKey(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyOf(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// The drivers the focus picker offers: every active roster driver, with their count in
// the period (zero included — "no entries" is an answer), plus every key in the
// period's rows that has no roster row: a feed name the roster doesn't match, an id
// that has lost its roster row, Unassigned. Inactive drivers are left out (CLAUDE.md:
// pickers). Sorted by name, Unassigned last.
//
// A row can carry only a name that IS a roster driver's (an imported entry nobody
// linked): it still counts under the name, not the driver, so it is its own option —
// "not linked to the roster", not "no roster match", which would be untrue (`linked`).
//
//   nameOf    (row) => the name a row's driver goes by
//   nameNote  what a name with no roster row is called: on Attempts it is the dispatch
//             feed's; on an entry tab, the name typed or imported on the entry
export function focusOptions(
  rows,
  { drivers = [], nameOf = (r) => r.driver_name || "", nameNote = "feed name" } = {},
) {
  const counts = countsByKey(rows);
  const onRoster = new Set();
  const out = [];
  for (const d of drivers || []) {
    if (!d || !d.id) continue;
    onRoster.add(d.id);
    if (d.active === false) continue;
    out.push({
      key: d.id,
      name: d.name,
      label: d.role === "loader" ? `${d.name} (loader)` : d.name,
      count: counts.get(d.id) || 0,
      kind: "roster",
    });
  }
  const seen = new Set();
  for (const r of rows || []) {
    const key = keyOf(r);
    if (onRoster.has(key) || seen.has(key)) continue;
    seen.add(key);
    const kind = key === "unassigned" ? "unassigned" : key.startsWith("name:") ? "feed" : "unknown";
    const name = kind === "unassigned" ? "Unassigned" : nameOf(r) || key;
    const linked = kind === "feed" && !!matchDriver(name, drivers || []);
    out.push({
      key,
      name,
      label:
        kind === "feed"
          ? `${name} (${linked ? "not linked to the roster" : nameNote})`
          : kind === "unknown"
            ? `${name} (not on roster)`
            : name,
      count: counts.get(key) || 0,
      kind,
      linked,
    });
  }
  return out.sort(
    (a, b) => (a.kind === "unassigned") - (b.kind === "unassigned") || a.name.localeCompare(b.name),
  );
}

// ── By driver ────────────────────────────────────────────────────────────────

// One bar per driver key, most first. Deactivated drivers' rows leave the chart and
// are said as a count (`hiddenCount`); every total keeps them.
export function byDriver(rows, { hidden = new Set(), nameOf = (r) => r.driver_name || "" } = {}) {
  const m = new Map();
  let hiddenCount = 0;
  for (const r of rows || []) {
    if (r.driver_id && hidden.has(r.driver_id)) {
      hiddenCount++;
      continue;
    }
    const key = keyOf(r);
    if (!m.has(key)) m.set(key, { key, id: r.driver_id || null, name: nameOf(r), count: 0 });
    m.get(key).count += 1;
  }
  return {
    rows: [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    hiddenCount,
  };
}

// Who can hold a rank: a driver id, active. Unassigned isn't a person, and a feed name
// the roster doesn't match may be a misspelling of someone already ranked.
export const rankable = (key, hidden = new Set()) =>
  !!key && key !== "unassigned" && !key.startsWith("name:") && !hidden.has(key);

// Where the focus stands among the drivers with at least one record in the period:
//   { drivers }                              no focus: how many drivers that is
//   { drivers, rank, tied, of, count }       a rankable focus with records
//   { drivers, rank: null, reason }          'unassigned' | 'unmatched' | 'none'
export function focusRank(rows, focus, { hidden = new Set() } = {}) {
  const counts = countsByKey(rows);
  const values = [...counts].filter(([k, n]) => n > 0 && rankable(k, hidden)).map(([, n]) => n);
  const out = { drivers: values.length };
  if (!focus) return out;
  if (!rankable(focus, hidden)) {
    return { ...out, rank: null, reason: focus === "unassigned" ? "unassigned" : "unmatched" };
  }
  const n = counts.get(focus) || 0;
  if (!n) return { ...out, rank: null, reason: "none" };
  return { ...out, ...rankOf(values, n), count: n };
}

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// The fleet's top driver by name, as the leader tile has always shown it: deactivated
// drivers and rows with no driver at all left out, first to the top count wins.
export function topDriver(rows, { hidden = new Set(), nameOf = (r) => r.driver_name || "" } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    if (r.driver_id && hidden.has(r.driver_id)) continue;
    if (!r.driver_id && !r.driver_name && !r.driver_raw) continue;
    const n = nameOf(r);
    m.set(n, (m.get(n) || 0) + 1);
  }
  let best = null;
  for (const [name, count] of m) if (!best || count > best.count) best = { name, count };
  return best;
}

// Entries per active roster driver in a role group ("driver": everyone but loaders):
// only rows charged to one of them count, so Unassigned rows, feed names and
// deactivated drivers don't inflate the benchmark.
export function fleetMean(rows, { drivers = [], group = "driver" } = {}) {
  const peers = new Set(peerSet(drivers, [], group));
  if (!peers.size) return null;
  const counted = (rows || []).filter((r) => r.driver_id && peers.has(r.driver_id)).length;
  return { mean: counted / peers.size, peers: peers.size, counted };
}

// ── Charts ───────────────────────────────────────────────────────────────────
// Every chart row carries `count` (the focus's value, or the fleet's with no focus),
// `fleet` and `rest` (fleet − count), so one row draws either a single series or the
// driver against the rest of the fleet.

// Mon–Fri always; Sat and Sun only when the fleet has any.
export function weekdaySeries(rows, focus = null) {
  const fleet = Array(7).fill(0);
  const mine = Array(7).fill(0);
  for (const r of rows || []) {
    const w = weekdayOfYmd(recordDate(r));
    if (w === null) continue;
    fleet[w]++;
    if (focus && keyOf(r) === focus) mine[w]++;
  }
  const order = [1, 2, 3, 4, 5];
  if (fleet[6]) order.push(6);
  if (fleet[0]) order.unshift(0);
  return order.map((w) => {
    const count = focus ? mine[w] : fleet[w];
    return { key: String(w), wd: w, label: WEEKDAY_LABELS[w], count, fleet: fleet[w], rest: fleet[w] - count };
  });
}

// The busiest weekday in a weekday series (first of a tie, in the series' order).
export function busiest(series) {
  const top = (series || []).reduce((a, b) => (b.count > a.count ? b : a), { label: "—", count: -1 });
  return top.count > 0 ? top : null;
}

// Feed-day statuses that mean the count is not the whole story. A day the feed has no
// data for is never drawn as a zero.
export const GAP_STATUSES = new Set(["no_manifest", "fetch_not_ok", "failed", "not_loaded", "before_feed", "pending"]);
export const GAP_SHORT = {
  no_manifest: "no scan",
  fetch_not_ok: "scan failed",
  failed: "not reached",
  not_loaded: "not loaded",
  before_feed: "before feed",
  pending: "scan pending",
};

// The trend: by day, week or month as the window says (period.js). Days are
// zero-filled up to today (a day still to come is neither a zero nor a gap, so it isn't
// drawn); weeks and months are zero-filled across the window. Each bucket keeps its
// own [start, end] inside the window, which is what a click filters the log to, and
// how many of the fleet's were Unassigned.
//
//   statusOf  (ymd) => feed-day status (Attempts only). A day with no feed data gets
//             `gap` (its status) and keeps only what was hand-logged; a week or month
//             counts its gap days in `gapDays` — of them, the ones not loaded yet in
//             `unloaded` and the ones before the feed started in `beforeFeed` — out of
//             its `days` so far (bucketGap says what that means for the column).
export function trendSeries(rows, win, { focus = null, today = null, statusOf = null } = {}) {
  if (!win?.start || !win?.end) return [];
  const buckets = [];
  if (win.bucket === "week") {
    for (let wk = mondayOfYmd(win.start); wk <= win.end; wk = addDays(wk, 7)) {
      const end = addDays(wk, 6);
      buckets.push({ key: wk, label: mmdd(wk), start: wk < win.start ? win.start : wk, end: end > win.end ? win.end : end });
    }
  } else if (win.bucket === "month") {
    for (const ym of win.months || []) {
      const s = `${ym}-01`;
      const e = lastOfMonth(ym);
      buckets.push({ key: ym, label: fmtMonthShort(ym), start: s < win.start ? win.start : s, end: e > win.end ? win.end : e });
    }
  } else {
    const last = today && today < win.end ? today : win.end;
    for (let d = win.start; d <= last && buckets.length < 400; d = addDays(d, 1)) {
      buckets.push({ key: d, label: mmdd(d), start: d, end: d });
    }
  }
  const out = buckets.map((b) => ({
    ...b,
    count: 0,
    fleet: 0,
    rest: 0,
    unassigned: 0,
    gap: null,
    gapDays: 0,
    unloaded: 0,
    beforeFeed: 0,
    days: 0,
  }));
  // Rows land in the bucket whose span holds their day. Buckets are in order and don't
  // overlap, so a binary search finds it.
  const find = (d) => {
    let lo = 0;
    let hi = out.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (d < out[mid].start) hi = mid - 1;
      else if (d > out[mid].end) lo = mid + 1;
      else return out[mid];
    }
    return null;
  };
  for (const r of rows || []) {
    const b = find(recordDate(r));
    if (!b) continue;
    b.fleet++;
    const k = keyOf(r);
    if (k === "unassigned") b.unassigned++;
    if (!focus || k === focus) b.count++;
  }
  for (const b of out) {
    b.rest = b.fleet - b.count;
    if (!statusOf) continue;
    for (let d = b.start; d <= b.end && (!today || d <= today); d = addDays(d, 1)) {
      b.days++;
      const s = statusOf(d);
      if (GAP_STATUSES.has(s)) {
        b.gapDays++;
        if (s === "not_loaded") b.unloaded++;
        if (s === "before_feed") b.beforeFeed++;
        if (b.start === b.end) b.gap = s;
      }
    }
  }
  return out;
}

// What a trend bucket's column can't show, as the short label drawn on it and the line
// its hover adds, or null when it shows everything:
//   a day          its own feed status ("no scan", "not loaded", "before feed" …)
//   a week, month  "hand-logged only" when none of its days has feed data (before the
//                  feed, not loaded yet, no scan), "part not loaded" or "part before
//                  feed" when some of them are; a day or two without a scan, among
//                  days that have one, is said in the hover only
// `empty` is true when the column holds no feed data at all: a 0 in it is not a count.
export function bucketGap(b) {
  if (!b) return null;
  if (b.gap) return { short: GAP_SHORT[b.gap] || "no data", status: b.gap, empty: true, note: null };
  if (!b.days || !b.gapDays) return null;
  const parts = [
    b.unloaded ? `${b.unloaded} not loaded yet` : null,
    b.beforeFeed ? `${b.beforeFeed} before the feed started` : null,
    b.gapDays - b.unloaded - b.beforeFeed ? `${b.gapDays - b.unloaded - b.beforeFeed} with no feed data` : null,
  ].filter(Boolean);
  const note = `${b.gapDays} of ${b.days} days without feed data (${parts.join(", ")}) — hand-logged attempts only on those`;
  if (b.gapDays === b.days) return { short: "hand-logged only", status: null, empty: true, note };
  if (b.unloaded) return { short: "part not loaded", status: null, empty: false, note };
  if (b.beforeFeed) return { short: "part before feed", status: null, empty: false, note };
  return { short: null, status: null, empty: false, note };
}

export const NOT_SET = "__not_set";

// A classification field tallied: most first, "Not set" last.
export function classBreakdown(rows, field) {
  if (!field) return [];
  const m = new Map();
  for (const r of rows || []) {
    const v = String(r?.[field] ?? "").trim();
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m]
    .map(([v, count]) => ({ key: v || NOT_SET, value: v, label: v || "Not set", count, notSet: !v }))
    .sort((a, b) => a.notSet - b.notSet || b.count - a.count || a.label.localeCompare(b.label));
}

// ── Attempts ─────────────────────────────────────────────────────────────────

// What happened after the attempt, as the 8 PM scan last saw it, resolved to
// unresolved (attemptRecords.js attemptOutcome). The blues are the validated ordinal
// ramp (#2e7abd → #0a2744, light end 4.53:1 on white); anything else folds into a gray
// "Other".
export const OUTCOMES = [
  { id: "delivered", label: "Delivered later", color: "#2e7abd" },
  { id: "rescheduled", label: "Rescheduled", color: "#234294" },
  { id: "unplanned", label: "Still unplanned", color: "#0a2744" },
  { id: "other", label: "Other", color: "#cbd5e1" },
];
export const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.id, o.label]));

// Still open when the scan ran: rescheduled, or still unplanned.
export const isOpenAtScan = (r) => r?.outcome === "unplanned" || r?.outcome === "rescheduled";

// Whole percents that add up to 100 (largest remainder), so the labels on a 100% bar
// never read 99 or 101.
export function wholePercents(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((n) => (n * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (counts[i] > 0) {
      out[i]++;
      left--;
    }
  }
  return out;
}

// The outcome bar: each outcome's count and share of the records the scan saw.
// Hand-logged attempts have no scan status; they're counted in `unscanned`.
export function outcomeMix(rows) {
  const n = new Map();
  let scanned = 0;
  for (const r of rows || []) {
    if (!r?.outcome) continue;
    scanned++;
    n.set(r.outcome, (n.get(r.outcome) || 0) + 1);
  }
  const counts = OUTCOMES.map((o) => n.get(o.id) || 0);
  const pct = wholePercents(counts);
  return {
    parts: OUTCOMES.map((o, i) => ({ ...o, count: counts[i], pct: pct[i] })),
    scanned,
    unscanned: (rows || []).length - scanned,
  };
}

const custOf = (r) => (r?.customerKey !== undefined ? r.customerKey : customerKey(r));

// The records whose customer comes up at least twice in the same list.
export function repeatCustomerRows(rows) {
  const n = new Map();
  for (const r of rows || []) {
    const k = custOf(r);
    if (k) n.set(k, (n.get(k) || 0) + 1);
  }
  return (rows || []).filter((r) => {
    const k = custOf(r);
    return k && n.get(k) >= 2;
  });
}

// Records per day they happened on: { value, days }.
export function perActiveDay(rows) {
  const days = new Set((rows || []).map(recordDate).filter(Boolean)).size;
  return { value: days ? (rows || []).length / days : 0, days };
}

// The narrowing an attempts drill-down applies inside its window and driver
// (drill.js), so a tile's drawer counts exactly what the tile did:
//   weekday   0..6        repeat   true: customers seen twice or more in `pool`
//   outcomes  [id, …]     customer a customerKey
//
// "Repeat" belongs to the list the tile counted, not to whatever a drawer has narrowed
// it to: an order at a customer that comes up again elsewhere in the tile's list is a
// repeat even once the drawer is down to its own driver or month. So `pool` is the
// tile's whole list (drill.js: the window's orders, scoped by `filter.within`), and
// the rows are kept when they are repeats in it.
export function filterAttempts(rows, filter = null, { pool = rows } = {}) {
  if (!filter) return rows || [];
  let out = rows || [];
  if (filter.repeat) {
    const repeats = new Set(repeatCustomerRows(pool));
    out = out.filter((r) => repeats.has(r));
  }
  return out.filter(
    (r) =>
      (filter.weekday === undefined || filter.weekday === null || weekdayOfYmd(recordDate(r)) === filter.weekday) &&
      (!filter.outcomes || filter.outcomes.includes(r.outcome)) &&
      (!filter.customer || custOf(r) === filter.customer),
  );
}

// "Customer pattern": two or more different drivers attempted the same customer within
// `days` days up to a record's own day, so the customer, not the driver, may be the
// story. Map(record id → how many drivers). Unassigned orders name nobody, so they
// don't add a driver.
export function customerPatterns(records, { days = 30 } = {}) {
  const groups = new Map();
  for (const r of records || []) {
    const k = custOf(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      const day = recordDate(r);
      const from = addDays(day, -(days - 1));
      const who = new Set();
      for (const x of list) {
        const d = recordDate(x);
        if (d >= from && d <= day && keyOf(x) !== "unassigned") who.add(keyOf(x));
      }
      if (who.size >= 2) out.set(r.id, who.size);
    }
  }
  return out;
}

// Late incidents by PRO, so an attempted order can say it was also reported late: the
// order's base stop number is the Uline PRO (normPro drops ATT and -1/-2).
export function lateByPro(incidents) {
  const m = new Map();
  for (const i of incidents || []) {
    if (!i || i.category !== "late") continue;
    const p = normPro(i.pro_number);
    if (!p) continue;
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(i);
  }
  return m;
}

// Days old, from the day it happened to today: 0 is today.
export const ageDays = (date, today) => dayDiff(date, today);

// The unassigned queue, oldest first (or newest with dir "newest").
export function sortQueue(rows, dir = "oldest") {
  const s = dir === "newest" ? -1 : 1;
  return [...(rows || [])].sort(
    (a, b) =>
      s * String(recordDate(a)).localeCompare(String(recordDate(b))) ||
      String(a.pro_number).localeCompare(String(b.pro_number)),
  );
}

// The change against the same number of days just before, for the attempts tile.
// Shown only when it compares like with like (the spec's rule): every day of the
// earlier span loaded with feed data, and the window itself loaded. A window that
// runs to today compares through yesterday while today's scan is still pending.
//
//   statusOf  (ymd) => feed-day status
// → { delta, current, previous, days, throughYesterday } or { delta: null, reason, days }
//   reason: 'not_loaded' (earlier days not loaded yet) | 'no_data' (the feed has none for
//   some of them) | 'before_feed'
export function priorDelta(records, win, { focus = null, today, statusOf }) {
  if (!win?.start || !win?.end || !today) return null;
  let end = win.end < today ? win.end : today;
  let throughYesterday = false;
  if (end === today && statusOf(today) !== "ok") {
    end = addDays(today, -1);
    throughYesterday = true;
  }
  if (end < win.start) return null;
  const cur = { start: win.start, end };
  const prior = comparisonWindow(cur, "prior");
  const days = dayDiff(cur.start, cur.end) + 1;
  for (let d = cur.start; d <= cur.end; d = addDays(d, 1)) {
    if (statusOf(d) === "not_loaded") return { delta: null, reason: "window_not_loaded", days };
  }
  let worst = null;
  for (let d = prior.start; d <= prior.end; d = addDays(d, 1)) {
    const s = statusOf(d);
    if (s === "ok") continue;
    if (s === "before_feed") return { delta: null, reason: "before_feed", days };
    if (s === "not_loaded") worst = "not_loaded";
    else if (!worst) worst = "no_data";
  }
  if (worst) return { delta: null, reason: worst, days };
  const mine = (rows) => (focus ? rows.filter((r) => keyOf(r) === focus) : rows).length;
  const current = mine(inWindow(records, cur));
  const previous = mine(inWindow(records, prior));
  return { delta: current - previous, current, previous, days, throughYesterday };
}

export const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// The six Attempts tiles, each with the drill-down spec (drill.js) that lists exactly
// what it counted and the number the drawer must show (`expected`).
//
//   rows     the window's attempt records (R)        records  every loaded record
//   focus    a driver key or null                     hidden   deactivated driver ids
//   statusOf / today  for the Δ (priorDelta); omitted, there is no Δ
//
// With a focus, F is that driver's records; without one, F = R.
//   orders    |F|, and |R| beside it                  rank     where F stands (focusRank)
//   busiest   F's busiest weekday                     perDay   |F| per day with any
//   repeat    F's orders at a customer seen twice     open     F still open at the scan —
//             or more in F                                     or, with no focus, R's
//                                                              Unassigned orders
export function attemptTiles({ rows, records = rows, win, focus = null, hidden = new Set(), statusOf = null, today = null }) {
  const F = focus ? rows.filter((r) => keyOf(r) === focus) : rows;
  const base = { kind: "attempts", start: win.start, end: win.end, ...(focus ? { driverKey: focus } : {}) };
  const top = busiest(weekdaySeries(rows, focus));
  const repeat = repeatCustomerRows(F);
  const open = F.filter(isOpenAtScan);
  const unassigned = rows.filter((r) => keyOf(r) === "unassigned");
  return {
    orders: {
      value: F.length,
      fleet: rows.length,
      delta: statusOf && today ? priorDelta(records, win, { focus, today, statusOf }) : null,
      drill: base,
      expected: F.length,
    },
    rank: { ...focusRank(rows, focus, { hidden }), drill: { kind: "attempts", start: win.start, end: win.end }, expected: rows.length },
    busiest: top
      ? { ...top, drill: { ...base, filter: { weekday: top.wd }, label: WEEKDAY_PLURAL[top.wd] }, expected: top.count }
      : null,
    perDay: { ...perActiveDay(F), drill: base, expected: F.length },
    repeat: {
      value: repeat.length,
      // `within`: the list the repeats were found in (F), whatever the drawer narrows to.
      drill: { ...base, filter: { repeat: true, within: focus || null }, label: "Repeat customers" },
      expected: repeat.length,
    },
    open: focus
      ? {
          value: open.length,
          drill: { ...base, filter: { outcomes: ["rescheduled", "unplanned"] }, label: "Still open at the scan" },
          expected: open.length,
        }
      : {
          value: unassigned.length,
          drill: { kind: "attempts", start: win.start, end: win.end, driverKey: "unassigned" },
          expected: unassigned.length,
        },
  };
}

// "Driver detail" on an incident tab (and its tiles): the focused driver's entries in
// the window, as an explicit list, so the drawer's total is the tile's.
//   who    the heading when the focus has no driver id (a feed name, Unassigned)
//   label  what the list is ("Last 30 Days · Mondays"), for the drawer's sub-line
export function entriesDrill(rows, focus, { category, who = "", label = "" } = {}) {
  const mine = focus ? rows.filter((r) => keyOf(r) === focus) : rows;
  const spec = { kind: "incidents", ids: mine.map((r) => r.id), categoryIds: [category] };
  if (focus && !focus.startsWith("name:") && focus !== "unassigned") spec.driverId = focus;
  else if (who) spec.who = who;
  if (label) spec.label = label;
  return { spec, expected: mine.length };
}

// Which days to ask the feed for. The 45 most recent days of the window load first
// (the feed's own per-request cap); each `extra` reaches 45 days further back, past the
// window's start if that's where it goes (the earlier days are what the tile's Δ
// compares against), never before the feed started.
//   → { start, end, chunks: [[start, end], …] newest first, more }
//     `more` is true while there are earlier feed days to load.
export const FEED_CHUNK = 45;
export function feedLoadPlan(win, { today, epoch, extra = 0, chunk = FEED_CHUNK } = {}) {
  const end = win?.end && win.end < today ? win.end : today;
  if (!win?.start || !end || end < epoch || win.start > end) return { start: null, end: null, chunks: [], more: false };
  let start = addDays(end, -(chunk - 1));
  if (win.start > start) start = win.start;
  if (extra > 0) start = addDays(start, -chunk * extra);
  if (start < epoch) start = epoch;
  const chunks = [];
  for (let e = end; e >= start; e = addDays(e, -chunk)) {
    const s = addDays(e, -(chunk - 1));
    chunks.push([s < start ? start : s, e]);
  }
  return { start, end, chunks, more: start > epoch };
}

// ── Driver card ──────────────────────────────────────────────────────────────

// Twelve months ending `endYm`, counted by `cellOf(ym)`; `sourceOf(ym)` says where a
// month's number comes from (sparkSource: live, history, not_tracked, none). A month
// with no source to count from has no number (`n` null), so it draws no bar rather
// than a zero.
export function monthSpark({ endYm, months = 12, cellOf, sourceOf = () => "live" }) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = shiftYm(endYm, -i);
    const source = sourceOf(ym);
    const counted = source !== "not_tracked" && source !== "none";
    out.push({ ym, label: fmtMonthShort(ym), n: counted ? cellOf(ym) || 0 : null, source });
  }
  return out;
}

// The month logging started in the app for the manual-entry categories (Forgotten
// Freight, Mis-Deliveries, Attempts, Compliments): before it they weren't captured
// live, which is not the same as none happening (Chad, 2026-10-07).
export const MANUAL_SINCE = "2026-06";

// Where a driver-card month's number comes from, for one category: the blend's month
// source, except that a month which never captured the category isn't a zero —
//   a history month whose records hold none of it            not_tracked
//   a live month before MANUAL_SINCE with none of it logged  not_tracked
// (A live month before then that does hold some — Jan 2026's back-dated forgotten
// freight — is counted, as the Scorecard counts it.)
export function sparkSource(blend, ym, category, { since = MANUAL_SINCE } = {}) {
  const src = blend.monthSource(ym);
  if (src === "history") {
    return blend.historyCategories(ym, { attributedOnly: false }).has(category) ? "history" : "not_tracked";
  }
  if (src === "live" && ym < since && !blend.companyCell(ym, category)) return "not_tracked";
  return src;
}

// A live-only monthly count of rows, for what the blend doesn't hold (Unable to Track,
// a driver with no roster id).
export function liveMonthCounts(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const ym = incidentYm(r);
    if (ym) m.set(ym, (m.get(ym) || 0) + 1);
  }
  return m;
}

// Weekly counts over [start, end] (Mondays), for the attempts card: the feed is only
// loaded a few weeks at a time, so its trend is weekly over what's loaded. A week with
// any day lacking feed data is marked `partial`.
export function weekSpark(rows, { start, end, statusOf = null }) {
  if (!isDay(start) || !isDay(end) || start > end) return [];
  const out = [];
  for (let wk = mondayOfYmd(start); wk <= end; wk = addDays(wk, 7)) {
    const s = wk < start ? start : wk;
    const e = addDays(wk, 6) > end ? end : addDays(wk, 6);
    let partial = s !== wk || e !== addDays(wk, 6);
    if (statusOf && !partial) {
      for (let d = s; d <= e; d = addDays(d, 1)) if (GAP_STATUSES.has(statusOf(d))) partial = true;
    }
    out.push({ key: wk, label: mmdd(wk), start: s, end: e, n: 0, partial });
  }
  for (const r of rows || []) {
    const d = recordDate(r);
    const w = out.find((b) => d >= b.start && d <= b.end);
    if (w) w.n++;
  }
  return out;
}

// ── Chips: what a click on a chart narrows the table or log to ─────────────────
//
// { bucket?: { start, end, label }, weekday?: { wd, label }, outcome?: { id, label },
//   cls?: { value, label }, customer?: { key, label } } — every chip set must hold.
export function applyChips(rows, chips = {}, { classifyField = null } = {}) {
  const { bucket, weekday, outcome, cls, customer } = chips || {};
  if (!bucket && !weekday && !outcome && !cls && !customer) return rows || [];
  return (rows || []).filter((r) => {
    const d = recordDate(r);
    if (bucket && !(d >= bucket.start && d <= bucket.end)) return false;
    if (weekday && weekdayOfYmd(d) !== weekday.wd) return false;
    if (outcome && r.outcome !== outcome.id) return false;
    if (cls && classifyField && String(r[classifyField] ?? "").trim() !== cls.value) return false;
    if (customer && custOf(r) !== customer.key) return false;
    return true;
  });
}

// The period a printout is labelled with. When the rows on screen were narrowed past
// the period and the driver — a chart chip, a search — it says by what, and how many
// of the driver's period that leaves, so a handout of six Tuesdays can't read as the
// driver's whole period: "Last 30 Days · Tuesdays only (6 of 10)".
//   narrowing  labels of what narrowed the rows      shown / of  printed / the period's
export function printPeriodLabel(periodLabel, { narrowing = [], shown = null, of = null } = {}) {
  const what = (narrowing || []).filter(Boolean);
  if (!what.length) return periodLabel;
  let text = what.join(", ");
  if (text.length > 48) text = `${text.slice(0, 47)}…`;
  return `${periodLabel} · ${text} only${shown !== null && of !== null ? ` (${shown} of ${of})` : ""}`;
}

// ── The period table of attempted orders ─────────────────────────────────────

const routeText = (r) => [r.order?.originalLoadNbr, r.order?.routeName].filter(Boolean).join(" ");

// Search across shipment, stop, customer, city, zip, route and driver.
export function searchOrders(rows, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows || [];
  return (rows || []).filter((r) => {
    const o = r.order || {};
    return [
      r.pro_number,
      o.shipmentNbr,
      ...(o.legRows || [o]).map((l) => l.stopNbr),
      r.customer,
      o.businessName,
      o.city || r.to_city,
      o.zip || r.zip_code,
      o.routeName,
      o.originalLoadNbr,
      r.driver_name,
      r.driver_raw,
    ].some((f) => String(f || "").toLowerCase().includes(q));
  });
}

const OUTCOME_RANK = Object.fromEntries(OUTCOMES.map((o, i) => [o.id, i]));
const SORTS = {
  date: (r) => recordDate(r),
  shipment: (r) => String(r.pro_number || ""),
  customer: (r) => String(r.customer || "").toUpperCase(),
  route: (r) => routeText(r).toUpperCase(),
  status: (r) => (r.outcome ? OUTCOME_RANK[r.outcome] ?? 9 : 10),
  driver: (r) => String(r.driver_name || "~").toUpperCase(),
  by: (r) => String(r.attributedBy || "~"),
};

// Sorted by one column, ties newest first then by shipment, so the order is stable.
export function sortOrders(rows, { key = "date", dir = "desc" } = {}) {
  const get = SORTS[key] || SORTS.date;
  const s = dir === "asc" ? 1 : -1;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...(rows || [])].sort(
    (a, b) =>
      s * cmp(get(a), get(b)) ||
      -cmp(recordDate(a), recordDate(b)) ||
      cmp(String(a.pro_number || ""), String(b.pro_number || "")),
  );
}
