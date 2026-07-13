// Period selector shared by the manual-entry analytics panel (ManualEntryAnalytics)
// and its detail log (ManualEntry). Kept in one place so the pills, the charts,
// and the log all resolve the same window.
//
// A "window" is { start, end, bucket, months }:
//   - start / end : inclusive YYYY-MM-DD bounds (string-comparable)
//   - bucket      : "day" | "week" | "month" — how a trend should be bucketed
//   - months      : YYYY-MM keys, only for the "month" bucket

export const PERIODS = [
  ["lastWeek", "Last Week"],
  ["30d", "Last 30 Days"],
  ["this", "This Mo"],
  ["last", "Last Mo"],
  ["3", "3M"],
  ["6", "6M"],
  ["12", "12M"],
  ["range", "Range"],
];

const pad2 = (n) => String(n).padStart(2, "0");
export const toYMD = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ymKey = (y, m) => `${y}-${pad2(m)}`;

// US MM/DD/YYYY from a YYYY-MM-DD string, parsed directly (no tz shift).
const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10);
};

// YYYY-MM strings covered by a calendar-month selection (relative to now).
function periodMonths(sel) {
  const now = new Date();
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
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29); // trailing 30 days, inclusive of today
    return { start: toYMD(start), end: toYMD(now), bucket: "day", months: [] };
  }
  if (sel === "lastWeek") {
    // Previous calendar week, Monday-Sunday.
    const now = new Date();
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
      const now = new Date();
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

// Human label for the current selection, for headers like "Log · Last Week".
export function periodLabel(sel, rangeFrom, rangeTo) {
  if (sel === "range") {
    if (!rangeFrom || !rangeTo) return "Last 30 Days";
    const a = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
    const b = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
    return `${fmtMDY(a)} – ${fmtMDY(b)}`;
  }
  const found = PERIODS.find(([v]) => v === sel);
  return found ? found[1] : "";
}
