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
import { PERIODS, periodWindow, periodLabel, toYMD, mondayOf } from "../data/period.js";

// Analytics panel for a manual-entry category (Forgotten Freight / Mis-Deliveries
// / Attempts). Tracks the work week (Mon–Fri) plus a trend, over a period that
// defaults to the current month and can go back further. Built for an operator
// who wants more than a flat list — counts by weekday, a trend, and quick KPIs.
// The period selector lives here but its resolved window is reported up via
// onPeriodChange so the parent's detail log can follow the same period.
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

export default function ManualEntryAnalytics({ title, color, records, drivers, onPeriodChange, leaderLabel = "Top driver" }) {
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

  // Report the resolved window + label up so the parent's detail log can scope
  // itself to the same period the charts are showing.
  React.useEffect(() => {
    onPeriodChange?.({ win, label: periodLabel(periodSel, rangeFrom, rangeTo) });
  }, [win, periodSel, rangeFrom, rangeTo, onPeriodChange]);

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
            <Stat label={leaderLabel} value={topDriver} />
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
