import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// Analytics panel for a manual-entry category (Forgotten Freight / Mis-Deliveries
// / Attempts). Tracks the work week (Mon–Fri) plus a trend, over a period that
// defaults to the current month and can go back further. Built for an operator
// who wants more than a flat list — counts by weekday, a trend, and quick KPIs.
const PERIODS = [
  ["lastWeek", "Last Week"],
  ["30d", "Last 30 Days"],
  ["this", "This Mo"],
  ["last", "Last Mo"],
  ["3", "3M"],
  ["6", "6M"],
  ["12", "12M"],
  ["range", "Range"],
];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ymKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

// YYYY-MM strings covered by the selected period (relative to the current month).
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

const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Inclusive day count between two local YYYY-MM-DD strings, built from explicit
// y/m/d components rather than Date.parse(string), so a DST transition can't
// shift the count.
function daysBetween(startYMD, endYMD) {
  const [sy, sm, sd] = startYMD.split("-").map(Number);
  const [ey, em, ed] = endYMD.split("-").map(Number);
  const a = new Date(sy, sm - 1, sd);
  const b = new Date(ey, em - 1, ed);
  return Math.round((b - a) / 86400000) + 1;
}

// Calendar-month keys (YYYY-MM) touched by [start, end], inclusive. Mirrors
// Dashboard.jsx's own "custom" period while-loop, including a sanity cap so a
// typo'd year can't spin out an unbounded array.
function monthsBetween(startYMD, endYMD) {
  let [y, m] = startYMD.split("-").map(Number);
  const [ey, em] = endYMD.split("-").map(Number);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(ymKey(y, m));
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length >= 400) break; // sanity cap (~33 years)
  }
  return out;
}

// Monday (local) of the week containing ymd, as a YYYY-MM-DD string.
function mondayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return toYMD(dt);
}

// Resolve the selected period into an inclusive [start, end] YYYY-MM-DD window
// plus how to render the trend (day / week / month bucket) and, for calendar-
// month windows, the month keys. "30d" and "lastWeek" are rolling/calendar-week
// windows; "range" is a user-picked span bucketed by size; every other option is
// whole calendar months, matching the existing behavior.
function periodWindow(sel, rangeFrom, rangeTo) {
  if (sel === "30d") {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29); // trailing 30 days, inclusive of today
    return { start: toYMD(start), end: toYMD(now), bucket: "day", months: [] };
  }
  if (sel === "lastWeek") {
    // Previous calendar week, Monday-Sunday — follows this file's own "Last Mo"
    // convention (previous calendar unit) rather than "Last 30 Days"'s explicit
    // trailing-N-days convention.
    const now = new Date();
    const sinceMonday = (now.getDay() + 6) % 7; // days since *this* week's Monday
    const thisMonday = new Date(now);
    thisMonday.setDate(thisMonday.getDate() - sinceMonday);
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - 7);
    const end = new Date(thisMonday);
    end.setDate(end.getDate() - 1);
    return { start: toYMD(start), end: toYMD(end), bucket: "day", months: [] };
  }
  if (sel === "range") {
    // Require both endpoints, exactly Dashboard.jsx's own custom-range fallback
    // rule. Incomplete range silently uses this component's ordinary default.
    if (!rangeFrom || !rangeTo) {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { start: toYMD(start), end: toYMD(now), bucket: "day", months: [] };
    }
    // Auto-swap a reversed pick rather than blocking — every downstream consumer
    // assumes start <= end, and honoring whatever two dates were picked (in
    // either order) is less surprising than silently discarding the input.
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

// Weekday (0=Sun..6=Sat) from a YYYY-MM-DD string, parsed as UTC (no tz shift).
function weekdayOf(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
}

function Stat({ label, value, color }) {
  return (
    <div className="me-stat">
      <div className="me-stat-num" style={color ? { color } : undefined}>{value}</div>
      <div className="me-stat-lbl">{label}</div>
    </div>
  );
}

export default function ManualEntryAnalytics({ title, color, records, drivers }) {
  const [periodSel, setPeriodSel] = React.useState("30d");
  // Day-precision (YYYY-MM-DD) custom range, distinct from Dashboard.jsx's
  // month-precision customFrom/customTo — different formats, deliberately
  // different names. Persist across pill switches (not reset), matching
  // Dashboard's own custom-range fields.
  const [rangeFrom, setRangeFrom] = React.useState("");
  const [rangeTo, setRangeTo] = React.useState("");

  const dateOf = (r) => (r.delivered_date || r.created_at || "").slice(0, 10);
  const driverName = (r) =>
    r.driver_name ||
    drivers.find((d) => d.id === r.driver_id)?.name ||
    r.driver_raw ||
    "Unassigned";

  const win = React.useMemo(
    () => periodWindow(periodSel, rangeFrom, rangeTo),
    [periodSel, rangeFrom, rangeTo],
  );

  const inPeriod = React.useMemo(
    () =>
      records.filter((r) => {
        const d = dateOf(r);
        return d && d >= win.start && d <= win.end;
      }),
    [records, win],
  );

  // Trend: by day for a single month / rolling 30-day / last-week window, by
  // week for a mid-size custom range, by month for multi-month ranges.
  const bucket = win.bucket;
  const trend = React.useMemo(() => {
    const map = new Map();
    if (bucket === "day") {
      for (const r of inPeriod) {
        const d = dateOf(r);
        if (d) map.set(d, (map.get(d) || 0) + 1);
      }
      return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, count]) => ({ label: `${d.slice(5, 7)}/${d.slice(8, 10)}`, count }));
    }
    if (bucket === "week") {
      let cursor = mondayOf(win.start);
      const lastMonday = mondayOf(win.end);
      while (cursor <= lastMonday) {
        map.set(cursor, 0);
        const [y, m, d] = cursor.split("-").map(Number);
        cursor = toYMD(new Date(y, m - 1, d + 7));
      }
      for (const r of inPeriod) {
        const d = dateOf(r);
        if (!d) continue;
        const wk = mondayOf(d);
        if (map.has(wk)) map.set(wk, map.get(wk) + 1);
      }
      return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([wk, count]) => ({ label: `${wk.slice(5, 7)}/${wk.slice(8, 10)}`, count }));
    }
    for (const ym of win.months) map.set(ym, 0);
    for (const r of inPeriod) {
      const ym = dateOf(r).slice(0, 7);
      if (map.has(ym)) map.set(ym, map.get(ym) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, count]) => ({ label: `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`, count }));
  }, [inPeriod, win, bucket]);

  // Workday distribution — Mon–Fri always, weekend only if it has any.
  const weekday = React.useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const r of inPeriod) {
      const w = weekdayOf(dateOf(r));
      if (w != null) counts[w] += 1;
    }
    const order = [1, 2, 3, 4, 5];
    if (counts[6]) order.push(6);
    if (counts[0]) order.unshift(0);
    return order.map((w) => ({ label: WD[w], count: counts[w] }));
  }, [inPeriod]);

  // KPIs.
  const total = inPeriod.length;
  const topWeekday =
    weekday.reduce((a, b) => (b.count > a.count ? b : a), { label: "—", count: -1 });
  const activeDays = bucket === "day" ? trend.length : new Set(inPeriod.map((r) => dateOf(r))).size;
  const avg = activeDays ? (total / activeDays).toFixed(1) : "0";
  const topDriver = React.useMemo(() => {
    const m = new Map();
    for (const r of inPeriod) {
      const n = driverName(r);
      m.set(n, (m.get(n) || 0) + 1);
    }
    let best = "—";
    let bestN = 0;
    for (const [n, c] of m) if (c > bestN) { best = n; bestN = c; }
    return bestN ? `${best} (${bestN})` : "—";
  }, [inPeriod, drivers]);

  const todayYMD = toYMD(new Date());

  return (
    <>
      <div className="me-analytics-head">
        <div className="section-head" style={{ margin: 0 }}>
          {title} · Analytics
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="month-picker" style={{ margin: 0 }}>
            {PERIODS.map(([val, label]) => (
              <button
                key={val}
                className={`month-btn ${periodSel === val ? "active" : ""}`}
                onClick={() => setPeriodSel(val)}
              >
                {label}
              </button>
            ))}
          </div>
          {periodSel === "range" && (
            <div className="custom-range">
              <input
                type="date"
                value={rangeFrom}
                max={todayYMD}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-2)" }}>
                to
              </span>
              <input
                type="date"
                value={rangeTo}
                max={todayYMD}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="me-stat-row">
            <Stat label="Total this period" value={total} color={color} />
            <Stat label="Busiest workday" value={topWeekday.count > 0 ? topWeekday.label : "—"} />
            <Stat label="Avg / active day" value={avg} />
            <Stat label="Top driver" value={topDriver} />
          </div>

          {total === 0 ? (
            <div className="empty-state">No records in this period.</div>
          ) : (
            <div className="me-chart-grid">
              <div>
                <div className="me-chart-title">By workday</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={weekday} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                    <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="me-chart-title">
                  {bucket === "day" ? "By day" : bucket === "week" ? "By week" : "By month"}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trend} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                    <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
