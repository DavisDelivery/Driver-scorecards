import React from "react";
import {
  PERIODS,
  periodWindow,
  periodLabel,
  toYMD,
  mondayOf,
  nowET,
  weekdayOfYmd,
} from "../data/period.js";
import { hiddenDriverIds } from "../data/drivers.js";
import { csvName } from "../data/csv.js";
import PeriodBar, { usePeriodState } from "./kit/PeriodBar.jsx";
import StatTile from "./kit/StatTile.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import { chartTable } from "./kit/shape.js";

// Analytics panel for a manual-entry category (Forgotten Freight / Mis-Deliveries
// / Attempts). Tracks the work week (Mon–Fri) plus a trend, over a period that
// defaults to the current month and can go back further. Built for an operator
// who wants more than a flat list — counts by weekday, a trend, and quick KPIs.
// The period lives in the URL hash under the tab's own namespace (useTabPeriod), so
// the parent's detail log reads the very same period, it survives a tab switch, and a
// link carries it.
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One tab's period — its pill, custom range, resolved window and label — read from the
// hash (`${ns}.p`, `${ns}.from`, `${ns}.to`). The analytics panel and the parent's log
// both call this, so they cannot disagree about the window.
export function useTabPeriod(ns) {
  const [period, setPeriod] = usePeriodState(ns, PERIODS, "30d");
  const { p, from, to } = period;
  const win = React.useMemo(() => periodWindow(p, from, to), [p, from, to]);
  const label = periodLabel(p, from, to);
  return { period, setPeriod, win, label };
}

// `ns` is the tab's hash namespace (ff, utt, mis, att, cmp) and `sourceLabel` names
// where the records come from, for the table views.
//
// Two optional props for a tab whose records come partly from a feed (Attempts):
//   statusLine  rendered directly under the period row, above the numbers it qualifies
//   feedGap     set when the period has no feed data to count at all (not loaded,
//               unreachable, every day without data). The numbers are then the
//               hand-logged entries alone, so the tiles say so and an empty period
//               shows this sentence — never a bare 0 over "No records".
export default function ManualEntryAnalytics({
  title,
  color,
  records,
  drivers,
  ns,
  sourceLabel = "logged entries",
  leaderLabel = "Top driver",
  statusLine = null,
  feedGap = null,
}) {
  // The custom range is day-precision (YYYY-MM-DD) and persists across pill switches.
  const { period, setPeriod, win } = useTabPeriod(ns);

  const dateOf = (r) => (r.delivered_date || r.created_at || "").slice(0, 10);
  const driverName = (r) =>
    r.driver_name ||
    drivers.find((d) => d.id === r.driver_id)?.name ||
    r.driver_raw ||
    "Unassigned";

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
      const w = weekdayOfYmd(dateOf(r));
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
  // Excludes deactivated drivers — a retired driver should not be named as the
  // current worst offender. Excludes rows with no driver at all for the same reason:
  // "Unassigned" isn't a person, and it topped this tile on Attempts. `total` above
  // is untouched, so the period count is still the true number of entries, and
  // Unassigned keeps its bar on the by-driver chart.
  const topDriver = React.useMemo(() => {
    const hidden = hiddenDriverIds(drivers);
    const m = new Map();
    for (const r of inPeriod) {
      if (r.driver_id && hidden.has(r.driver_id)) continue;
      if (!r.driver_id && !r.driver_name && !r.driver_raw) continue;
      const n = driverName(r);
      m.set(n, (m.get(n) || 0) + 1);
    }
    let best = "—";
    let bestN = 0;
    for (const [n, c] of m) if (c > bestN) { best = n; bestN = c; }
    return bestN ? `${best} (${bestN})` : "—";
  }, [inPeriod, drivers]);

  const todayYMD = toYMD(nowET());
  const tableOf = (rows, xLabel) =>
    chartTable({
      rows,
      x: { key: "label", label: xLabel },
      series: [{ id: "count", label: title }],
      source: sourceLabel,
    });
  const trendTitle = bucket === "day" ? "By day" : bucket === "week" ? "By week" : "By month";

  return (
    <>
      <div className="me-analytics-head">
        <div className="section-head" style={{ margin: 0 }}>
          {title} · Analytics
        </div>
        {/* min-width:0 so this group can shrink inside the head instead of
            forcing it wider than the cards below. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <PeriodBar className="end" grain="day" presets={PERIODS} value={period} onChange={setPeriod} max={todayYMD} />
        </div>
      </div>

      {statusLine}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="me-stat-row">
            <StatTile
              compact
              label={feedGap ? "Hand-logged only" : "Total this period"}
              value={feedGap && !total ? "—" : total}
            />
            <StatTile compact label="Busiest workday" value={topWeekday.count > 0 ? topWeekday.label : "—"} />
            <StatTile compact label="Avg / active day" value={feedGap && !total ? "—" : avg} />
            <StatTile compact label={leaderLabel} value={topDriver} />
          </div>

          {total === 0 ? (
            <div className="empty-state">{feedGap || "No records in this period."}</div>
          ) : (
            <div className="me-chart-grid">
              <ChartCard
                inset
                title="By workday"
                table={tableOf(weekday, "Weekday")}
                csv={csvName(title, "by workday")}
                height={200}
              >
                <EmphasisBars data={weekday} valueName={title} color={color} />
              </ChartCard>
              <ChartCard
                inset
                title={trendTitle}
                table={tableOf(trend, bucket === "month" ? "Month" : bucket === "week" ? "Week of" : "Day")}
                csv={csvName(title, trendTitle)}
                height={200}
              >
                <EmphasisBars
                  data={trend}
                  valueName={title}
                  color={color}
                  xAxis={{ interval: "preserveStartEnd" }}
                />
              </ChartCard>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
