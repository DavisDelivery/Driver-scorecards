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
  ["30d", "Last 30 Days"],
  ["this", "This Mo"],
  ["last", "Last Mo"],
  ["3", "3M"],
  ["6", "6M"],
  ["12", "12M"],
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

// Resolve the selected period into an inclusive [start, end] YYYY-MM-DD window plus
// how to render the trend (by day vs by month) and, for month windows, the month
// keys. "30d" is a rolling 30-day window; every other option is whole calendar
// months, matching the existing behavior.
function periodWindow(sel) {
  if (sel === "30d") {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29); // trailing 30 days, inclusive of today
    return { start: toYMD(start), end: toYMD(now), byDay: true, months: [] };
  }
  const months = [...periodMonths(sel)].sort();
  const first = months[0];
  const last = months[months.length - 1];
  const [ly, lm] = last.split("-").map(Number);
  const lastDay = new Date(ly, lm, 0).getDate(); // day 0 of next month = last day
  return {
    start: `${first}-01`,
    end: `${last}-${pad2(lastDay)}`,
    byDay: months.length <= 1,
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

  const dateOf = (r) => (r.delivered_date || r.created_at || "").slice(0, 10);
  const driverName = (r) =>
    r.driver_name ||
    drivers.find((d) => d.id === r.driver_id)?.name ||
    r.driver_raw ||
    "Unassigned";

  const win = React.useMemo(() => periodWindow(periodSel), [periodSel]);

  const inPeriod = React.useMemo(
    () =>
      records.filter((r) => {
        const d = dateOf(r);
        return d && d >= win.start && d <= win.end;
      }),
    [records, win],
  );

  // Trend: by day for a single month / the rolling 30-day window, by month for
  // multi-month ranges.
  const byDay = win.byDay;
  const trend = React.useMemo(() => {
    const map = new Map();
    if (byDay) {
      for (const r of inPeriod) {
        const d = dateOf(r);
        if (d) map.set(d, (map.get(d) || 0) + 1);
      }
      return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, count]) => ({ label: `${d.slice(5, 7)}/${d.slice(8, 10)}`, count }));
    }
    for (const ym of win.months) map.set(ym, 0);
    for (const r of inPeriod) {
      const ym = dateOf(r).slice(0, 7);
      if (map.has(ym)) map.set(ym, map.get(ym) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, count]) => ({ label: `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`, count }));
  }, [inPeriod, win, byDay]);

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
  const activeDays = byDay ? trend.length : new Set(inPeriod.map((r) => dateOf(r))).size;
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
  }, [inPeriod]);

  return (
    <>
      <div className="me-analytics-head">
        <div className="section-head" style={{ margin: 0 }}>
          {title} · Analytics
        </div>
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
                <div className="me-chart-title">{byDay ? "By day" : "By month"}</div>
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
