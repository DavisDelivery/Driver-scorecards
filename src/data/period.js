// Period selector shared by the manual-entry analytics panel (ManualEntryAnalytics)
// and its detail log (ManualEntry). Kept in one place so the pills, the charts,
// and the log all resolve the same window.
//
// A "window" is { start, end, bucket, months }:
//   - start / end : inclusive YYYY-MM-DD bounds (string-comparable)
//   - bucket      : "day" | "week" | "month" — how a trend should be bucketed
//   - months      : YYYY-MM keys, only for the "month" bucket

// Sentence case: the label heads the log, the charts' subtitles and the printout
// ("Last 30 days · 3"); the buttons say it shorter (PeriodBar PRESET_TEXT).
export const PERIODS = [
  ["thisWeek", "This week"],
  ["lastWeek", "Last week"],
  ["30d", "Last 30 days"],
  ["this", "This month"],
  ["last", "Last month"],
  ["3", "3M"],
  ["6", "6M"],
  ["12", "12M"],
  ["range", "Range"],
];

const pad2 = (n) => String(n).padStart(2, "0");
export const toYMD = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ymKey = (y, m) => `${y}-${pad2(m)}`;

// The business-timezone (America/New_York) calendar day a timestamp falls on.
//
// A review submitted at 8pm in Georgia is stored as the NEXT day in UTC, so reading
// the first ten characters of the timestamp — which is what the reviews period filter
// used to do — files that review under tomorrow. It then vanishes from "this week"
// while still showing yesterday's date on screen, because the screen formatted it in
// the browser's timezone instead. Screen, filter and print now agree on one answer.
//
// A bare YYYY-MM-DD is already a calendar day and comes back untouched: putting it
// through Date() would read it as UTC midnight and shift it BACK a day in ET, which
// is exactly the trap CLAUDE.md warns about.
export function etDay(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const bare = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (bare) return bare[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  try {
    // en-CA formats as YYYY-MM-DD, which is what every window compares against.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return s.slice(0, 10);
  }
}

// "Now" anchored to the business timezone (America/New_York), returned as a
// local Date whose year/month/day equal the ET calendar day. Entries are dated
// in ET (todayET), so windows MUST be computed in ET too — otherwise a viewer
// in another timezone resolves "today"/"this week" to a different day than the
// day an entry was filed under, and the entry falls outside the window. Using
// this everywhere makes the period identical for every viewer, anywhere on
// earth. (Falls back to local time only if Intl timezone data is unavailable.)
export function nowET() {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return new Date(get("year"), get("month") - 1, get("day"));
  } catch {
    return new Date();
  }
}

// US MM/DD/YYYY from a YYYY-MM-DD string, parsed directly (no tz shift).
const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10);
};

// YYYY-MM strings covered by a calendar-month selection (relative to now).
function periodMonths(sel) {
  const now = nowET();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  if (sel === "this") return [ymKey(y, m)];
  if (sel === "last") {
    const d = new Date(Date.UTC(y, m - 2, 1));
    return [ymKey(d.getUTCFullYear(), d.getUTCMonth() + 1)];
  }
  const n = Number(sel) || 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(ymKey(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return out;
}

// Inclusive day count between two local YYYY-MM-DD strings, built from explicit
// y/m/d components rather than Date.parse(string), so a DST transition can't
// shift the count.
export function daysBetween(startYMD, endYMD) {
  const [sy, sm, sd] = startYMD.split("-").map(Number);
  const [ey, em, ed] = endYMD.split("-").map(Number);
  const a = new Date(sy, sm - 1, sd);
  const b = new Date(ey, em - 1, ed);
  return Math.round((b - a) / 86400000) + 1;
}

// Calendar-month keys (YYYY-MM) touched by [start, end], inclusive, with a sanity
// cap so a typo'd year can't spin out an unbounded array.
function monthsBetween(startYMD, endYMD) {
  let [y, m] = startYMD.split("-").map(Number);
  const [ey, em] = endYMD.split("-").map(Number);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(ymKey(y, m));
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length >= 400) break; // ~33 years
  }
  return out;
}

// Monday (local) of the week containing ymd, as a YYYY-MM-DD string.
export function mondayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return toYMD(dt);
}

// Resolve the selected period into a window (see file header). "30d" and
// "lastWeek" are rolling/calendar-week windows; "range" is a user-picked span
// bucketed by size; every other option is whole calendar months.
export function periodWindow(sel, rangeFrom, rangeTo) {
  if (sel === "30d") {
    const now = nowET();
    const start = new Date(now);
    start.setDate(start.getDate() - 29); // trailing 30 days, inclusive of today
    return { start: toYMD(start), end: toYMD(now), bucket: "day", months: [] };
  }
  if (sel === "thisWeek") {
    // Current calendar week so far: this Monday through today, inclusive.
    const now = nowET();
    const sinceMonday = (now.getDay() + 6) % 7;
    const start = new Date(now);
    start.setDate(start.getDate() - sinceMonday);
    return { start: toYMD(start), end: toYMD(now), bucket: "day", months: [] };
  }
  if (sel === "lastWeek") {
    // Previous calendar week, Monday-Sunday.
    const now = nowET();
    const sinceMonday = (now.getDay() + 6) % 7;
    const thisMonday = new Date(now);
    thisMonday.setDate(thisMonday.getDate() - sinceMonday);
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - 7);
    const end = new Date(thisMonday);
    end.setDate(end.getDate() - 1);
    return { start: toYMD(start), end: toYMD(end), bucket: "day", months: [] };
  }
  if (sel === "range") {
    // Require both endpoints; otherwise fall back to the default (30d).
    if (!rangeFrom || !rangeTo) {
      const now = nowET();
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { start: toYMD(start), end: toYMD(now), bucket: "day", months: [] };
    }
    // Auto-swap a reversed pick — downstream consumers assume start <= end.
    const start = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
    const end = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    const span = daysBetween(start, end);
    if (span <= 60) return { start, end, bucket: "day", months: [] };
    if (span <= 180) return { start, end, bucket: "week", months: [] };
    return { start, end, bucket: "month", months: monthsBetween(start, end) };
  }
  const months = [...periodMonths(sel)].sort();
  const first = months[0];
  const last = months[months.length - 1];
  const [ly, lm] = last.split("-").map(Number);
  const lastDay = new Date(ly, lm, 0).getDate(); // day 0 of next month = last day
  return {
    start: `${first}-01`,
    end: `${last}-${pad2(lastDay)}`,
    bucket: months.length <= 1 ? "day" : "month",
    months,
  };
}

// Human label for the current selection, for headers like "Log · Last week".
export function periodLabel(sel, rangeFrom, rangeTo) {
  if (sel === "range") {
    if (!rangeFrom || !rangeTo) return "Last 30 days";
    const a = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
    const b = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    return fmtDateRange(a, b);
  }
  const found = PERIODS.find(([v]) => v === sel);
  return found ? found[1] : "";
}

// ── Month grain and calendar helpers ─────────────────────────────────────────
// The Scorecard picks whole months; the manual-entry tabs pick days. Both live here so
// there is one ET-safe vocabulary, and nothing in it ever puts a YYYY-MM-DD through
// new Date(ymd) — that reads a bare date as UTC midnight, which in Eastern time is the
// PREVIOUS day. Every day below is read from the string's own year/month/day.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymdParts = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const fromUTC = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmtYm = (ym) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Weekday of a calendar day, 0 = Sun … 6 = Sat; null for anything that isn't a date.
export function weekdayOfYmd(ymd) {
  const p = ymdParts(ymd);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : null;
}

// A calendar day moved by k days (k may be negative). UTC arithmetic, so no DST.
export function addDays(ymd, k) {
  const p = ymdParts(ymd);
  return p ? fromUTC(Date.UTC(p[0], p[1] - 1, p[2] + k)) : "";
}

// "YYYY-MM" moved by k months (k may be negative), across year ends.
export function shiftYm(ym, k) {
  const [y, m] = String(ym).split("-").map(Number);
  const i = y * 12 + (m - 1) + k;
  return ymKey(Math.floor(i / 12), (((i % 12) + 12) % 12) + 1);
}

// The current month in Eastern time, as YYYY-MM.
export const currentYmET = () => {
  const now = nowET();
  return ymKey(now.getFullYear(), now.getMonth() + 1);
};

// Mon–Fri days in a month, counting only days up to `throughDay` when given (a day
// number, or a YYYY-MM-DD in that month) — so a month still in progress is compared
// on the days it has had. Holidays are not removed: there is no holiday calendar.
export function workdaysInMonth(ym, { throughDay } = {}) {
  const [y, m] = String(ym).split("-").map(Number);
  let last = daysIn(y, m);
  if (throughDay != null) {
    const day = typeof throughDay === "string" ? ymdParts(throughDay)?.[2] : Number(throughDay);
    if (Number.isFinite(day)) last = Math.max(0, Math.min(last, day));
  }
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd >= 1 && wd <= 5) n++;
  }
  return n;
}

// Month-grain presets, as the Scorecard shows them.
export const MONTH_PRESETS = [
  ["this", "This Mo"],
  ["last", "Last Mo"],
  ["3", "3M"],
  ["6", "6M"],
  ["12", "12M"],
  ["custom", "Custom"],
];
const MONTH_PRESET_LABEL = {
  this: "This Mo",
  last: "Last Mo",
  3: "Last 3 Mo",
  6: "Last 6 Mo",
  12: "Last 12 Mo",
};

// Resolve a month-grain preset into { months, label }, months ascending (YYYY-MM).
//   anchor      the month the preset counts back from (default: this month, ET)
//   from / to   YYYY-MM bounds for "custom"
// "ytd" is January through the anchor. A custom range missing either end, or picked
// backwards, falls back to the anchor month, and is capped at 36 months — exactly what
// the Scorecard's own month list did before it moved here.
export function monthWindow(preset, { anchor, from, to } = {}) {
  const a = /^\d{4}-\d{2}$/.test(anchor || "") ? anchor : currentYmET();
  const span = (first, n) => Array.from({ length: n }, (_, i) => shiftYm(first, i));
  if (preset === "this") return { months: [a], label: MONTH_PRESET_LABEL.this };
  if (preset === "last") return { months: [shiftYm(a, -1)], label: MONTH_PRESET_LABEL.last };
  if (preset === "ytd") {
    const n = Number(a.slice(5, 7));
    return { months: span(`${a.slice(0, 4)}-01`, n), label: `YTD ${a.slice(0, 4)}` };
  }
  if (preset === "custom") {
    const ok = (s) => /^\d{4}-\d{2}$/.test(s || "");
    if (!ok(from) || !ok(to) || from > to) return { months: [a], label: fmtYm(a) };
    const months = [];
    for (let ym = from; ym <= to && months.length < 36; ym = shiftYm(ym, 1)) months.push(ym);
    const label =
      months.length === 1 ? fmtYm(months[0]) : `${fmtYm(months[0])} – ${fmtYm(months[months.length - 1])}`;
    return { months, label };
  }
  const n = Number(preset) || 1;
  return {
    months: span(shiftYm(a, -(n - 1)), n),
    label: MONTH_PRESET_LABEL[n] || `Last ${n} Mo`,
  };
}

const monthStart = (ym) => `${ym}-01`;
const monthEnd = (ym) => `${ym}-${pad2(daysIn(Number(ym.slice(0, 4)), Number(ym.slice(5, 7))))}`;

// The window to compare a window against, in the same shape.
//   "prior"  the same length immediately before it
//   "yoy"    the same months (or days) one year earlier; Feb 29 falls back to Feb 28
// Works for month windows ({ months }) and day windows ({ start, end }).
export function comparisonWindow(win, mode = "prior") {
  if (win && Array.isArray(win.months) && win.months.length && !win.start) {
    const months =
      mode === "yoy"
        ? win.months.map((ym) => shiftYm(ym, -12))
        : win.months.map((ym) => shiftYm(ym, -win.months.length));
    return { months, label: mode === "yoy" ? "Same months last year" : `Prior ${months.length} mo` };
  }
  const p = ymdParts(win?.start);
  const q = ymdParts(win?.end);
  if (!p || !q) return null;
  // A day window that is whole calendar months (This Mo, 6M) compares month for month,
  // and its days are rebuilt from those months so the two can't disagree. Counting
  // 184 days back from May 1 lands on Oct 29, three days outside the prior six months;
  // a year back from Feb 28, 2025 would miss Feb 29, 2024.
  const ms = win.months || [];
  if (ms.length && win.start === monthStart(ms[0]) && win.end === monthEnd(ms[ms.length - 1])) {
    const months = ms.map((ym) => shiftYm(ym, mode === "yoy" ? -12 : -ms.length));
    return { ...win, start: monthStart(months[0]), end: monthEnd(months[months.length - 1]), months };
  }
  let start;
  let end;
  if (mode === "yoy") {
    const back = ([y, m, d]) => fromUTC(Date.UTC(y - 1, m - 1, Math.min(d, daysIn(y - 1, m))));
    start = back(p);
    end = back(q);
  } else {
    const len = daysBetween(win.start, win.end);
    end = addDays(win.start, -1);
    start = addDays(end, -(len - 1));
  }
  // A part-month range keeps its days; its months are whichever those days touch.
  return { ...win, start, end, months: ms.length ? monthsBetween(start, end) : [] };
}

// ── Dates as people read them ───────────────────────────────────────────────────
// Every date a screen shows goes through these: "Oct 8", with the year when it isn't
// this year (ET) — "Dec 30, 2025" — so no date is ambiguous and none is MM/DD. Read from
// the string's parts, never through new Date(ymd), so a day can't shift by timezone.
// (CSV exports, the log's search and the printouts keep their own formats.)
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
//   year     "auto" (only when not this year), true, or false
//   weekday  lead with the weekday: "Wed, Oct 7"
export function fmtDate(s, { year = "auto", weekday = false, today = null } = {}) {
  const p = ymdParts(String(s || "").slice(0, 10));
  if (!p) return String(s || "");
  const thisYear = Number((today || toYMD(nowET())).slice(0, 4));
  const showYear = year === true || (year === "auto" && p[0] !== thisYear);
  const wd = weekday ? `${WEEKDAY_ABBR[weekdayOfYmd(String(s).slice(0, 10))]}, ` : "";
  return `${wd}${MONTH_ABBR[p[1] - 1]} ${p[2]}${showYear ? `, ${p[0]}` : ""}`;
}

// A span of days: "Sep 9 – Oct 8", "Sep 14–18", "Dec 29, 2025 – Jan 2, 2026"; one day
// reads as fmtDate. The year shows when the span isn't all this year.
export function fmtDateRange(a, b, { year = "auto", today = null } = {}) {
  const pa = ymdParts(String(a || "").slice(0, 10));
  const pb = ymdParts(String(b || "").slice(0, 10));
  if (!pa || !pb) return [a, b].filter(Boolean).map((x) => fmtDate(x, { year, today })).join(" – ");
  if (String(a).slice(0, 10) === String(b).slice(0, 10)) return fmtDate(a, { year, today });
  const thisYear = Number((today || toYMD(nowET())).slice(0, 4));
  const showYear = year === true || (year === "auto" && (pa[0] !== thisYear || pb[0] !== thisYear));
  if (pa[0] !== pb[0]) return `${fmtDate(a, { year: true })} – ${fmtDate(b, { year: true })}`;
  const tail = showYear ? `, ${pb[0]}` : "";
  if (pa[1] === pb[1]) return `${MONTH_ABBR[pa[1] - 1]} ${pa[2]}–${pb[2]}${tail}`;
  return `${MONTH_ABBR[pa[1] - 1]} ${pa[2]} – ${MONTH_ABBR[pb[1] - 1]} ${pb[2]}${tail}`;
}
