import React, { useMemo } from "react";
import { CategoryLeaderboard } from "./leaderboard.jsx";
import AttemptsScorecardCard from "./AttemptsScorecardCard.jsx";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { driverBuckets } from "../data/blend.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { driverDrill } from "../data/drill.js";
import { nameOf } from "../data/people.js";
import { incidentDateStr } from "../data/incidentDate.js";
import { COUNTED8, categoriesFor } from "../data/categories.js";
import { MONTH_PRESETS, monthWindow, currentYmET } from "../data/period.js";
import { useHashState } from "../data/hashState.js";
import PeriodBar, { usePeriodState } from "./kit/PeriodBar.jsx";
import StatTile from "./kit/StatTile.jsx";
import { AnalyticsGate, RosterGate, HistoryRefresh } from "./kit/LoadState.jsx";
import { openDrill } from "./kit/drillNav.js";

// Month names used throughout the scorecard.
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Scorecard chart categories: the eight the history rollup tracks, in the registry's
// order and colours (categories.js), with the plural chart titles.
const CHART_CATEGORIES = categoriesFor(COUNTED8).map(({ id, title, color }) => ({ id, title, color }));

const CHART_CAT_IDS = CHART_CATEGORIES.map((c) => c.id);

const PERIOD_LABELS = { this: "MO", last: "LMO", 3: "3M", 6: "6M", 12: "12M", custom: "SEL" };

// ─── Dashboard (default export) ──────────────────────────────────────────────
export default function Dashboard() {
  // Incidents, the roster and history come from the shared analytics state, and every
  // count below from its blend — the same one each drill-down resolves against.
  const data = useAnalytics();
  const { incidents, drivers, history } = data;
  // The month picker, the period and the fault scope live in the URL hash under sc.*,
  // so they survive a tab switch and a link opens the same view. The default month is
  // the current month in Eastern time, so it doesn't jump ahead on the last evening of
  // the month.
  const [monthParam, setSelectedMonth] = useHashState("sc.m", currentYmET());
  const selectedMonth = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentYmET();
  const [faultParam, setFaultFilter] = useHashState("sc.fault", "all");
  const faultFilter = faultParam === "driver" ? "driver" : "all";
  const [period, setPeriod] = usePeriodState("sc", MONTH_PRESETS, "this");
  const { p: periodSel, from: customFrom, to: customTo } = period;

  const selectedYear = selectedMonth.slice(0, 4);

  // Build the sorted-descending list of available months from both history and
  // live incidents, always including the currently-selected month.
  const availableMonths = useMemo(() => {
    const set = new Set();
    for (const rec of history) {
      if (!rec.year || !rec.month) continue;
      set.add(`${rec.year}-${String(rec.month).padStart(2, "0")}`);
    }
    for (const inc of incidents) {
      const dateStr = incidentDateStr(inc);
      if (dateStr) set.add(dateStr.slice(0, 7));
    }
    set.add(selectedMonth);
    return Array.from(set).sort().reverse();
  }, [incidents, history, selectedMonth]);

  // Live incidents that fall in the selected month.
  const monthIncidents = useMemo(
    () =>
      incidents.filter((inc) => incidentDateStr(inc).startsWith(selectedMonth)),
    [incidents, selectedMonth],
  );

  // If no live incidents exist for this month, fall back to historical rollup.
  const isHistorical = monthIncidents.length === 0;

  // Historical rollup records for the selected month.
  const monthHistory = useMemo(() => {
    const [yr, mo] = selectedMonth.split("-").map(Number);
    return history.filter((r) => r.year === yr && r.month === mo);
  }, [history, selectedMonth]);

  // Per-driver tallies from the blend (blend.js): for every month, live incidents win
  // when any that count exist; otherwise the historical rollup fills in. Under
  // Driver-fault scope the blend applies today's rule — a month qualifies on driver-fault
  // rows — and the leaderboards and every drill-down get it from the same blend.
  const blend = data.blend(faultFilter === "driver" ? "driver" : null);
  const scorecardData = useMemo(() => {
    // The period still counts back from THIS month, not the picked one, exactly as
    // before; anchoring it to the month picker is a number change and ships on its own.
    const periodMonths = monthWindow(periodSel, {
      anchor: currentYmET(),
      from: customFrom,
      to: customTo,
    }).months;
    // Year to date means the year being looked at — the month picker's year. This used
    // to take the year of the OLDEST month in the trailing period, so any period reaching
    // back over Jan 1 moved YTD to the previous year: with 12M selected in September
    // 2026, "Year to Date" was quietly reporting 2025.
    const ytdYear = Number(selectedYear);
    const ytdMonths = monthsOfYear(ytdYear);
    // month = the selected month; ytd = whole selected year; period = trailing N.
    const rows = driverBuckets({
      blend,
      drivers,
      buckets: { month: [selectedMonth], period: periodMonths, ytd: ytdMonths },
      categoryIds: CHART_CAT_IDS,
      nameOf: (id) => nameOf(data.people, id),
    });
    return { rows, periodMonths, ytdYear, ytdMonths };
  }, [blend, drivers, data.people, selectedMonth, selectedYear, periodSel, customFrom, customTo]);

  const driverTotals = scorecardData.rows;

  const hiddenDrivers = data.hidden;

  // Build sorted chart data for a single category. Deactivated drivers are
  // filtered out HERE, at the display layer, rather than out of driverTotals —
  // totalYtd is derived from driverTotals, and retiring a driver must not
  // retroactively change a reported total.
  const inRoleGroup = (e, roleGroup) => {
    const role = e.driver.role || "driver";
    return roleGroup === "loader" ? role === "loader" : role !== "loader";
  };

  // Sorted by the SELECTED PERIOD first, then YTD. It used to sort by YTD alone, so
  // on "This Mo" the top eight were the year's heaviest names — most sitting at 0 this
  // month — and the drivers who actually had incidents this month were pushed below
  // "Show all". Trends already sorted this way; the Scorecard was the odd one out.
  const chartDataFor = (categoryId, roleGroup) =>
    driverTotals
      .filter((e) => {
        if (hiddenDrivers.has(e.driver.id)) return false;
        return (
          inRoleGroup(e, roleGroup) &&
          ((e.period[categoryId] || 0) > 0 || (e.ytd[categoryId] || 0) > 0)
        );
      })
      .map((e) => ({
        driverId: e.driver.id,
        name: e.driver.name,
        month: e.period[categoryId] || 0,
        ytd: e.ytd[categoryId] || 0,
      }))
      .sort(
        (a, b) => b.month - a.month || b.ytd - a.ytd || String(a.name).localeCompare(String(b.name)),
      );

  // A chart's own totals, INCLUDING deactivated drivers — CLAUDE.md: retiring a
  // driver hides their row but must never change a total.
  const chartTotalsFor = (categoryId, roleGroup) => {
    let period = 0;
    let ytd = 0;
    for (const e of driverTotals) {
      if (!inRoleGroup(e, roleGroup)) continue;
      period += e.period[categoryId] || 0;
      ytd += e.ytd[categoryId] || 0;
    }
    return { period, ytd };
  };

  // What the drill-downs need to rebuild a chart's numbers exactly: the period and the
  // year, each with the number the card showed for it.
  const periodLabelText =
    {
      this: "This Mo",
      last: "Last Mo",
      3: "Last 3 Mo",
      6: "Last 6 Mo",
      12: "Last 12 Mo",
      custom: "Custom range",
    }[periodSel] || "Period";
  const fault = faultFilter === "driver" ? "driver" : null;
  const scopesFor = (period, ytd) => [
    { label: periodLabelText, months: scorecardData.periodMonths, expected: period },
    { label: `YTD ${scorecardData.ytdYear}`, months: scorecardData.ytdMonths, expected: ytd },
  ];
  // A chart's title: every incident behind it, in its role group.
  const openChart = (cat, roleGroup) => {
    const t = chartTotalsFor(cat.id, roleGroup);
    openDrill({
      spec: { kind: "blend", categoryIds: [cat.id], roleGroup, fault },
      scopes: scopesFor(t.period, t.ytd),
      vocab: CHART_CAT_IDS,
    });
  };
  // A row: the driver's record over the same period and year, opened on the chart's
  // category with the row's two numbers, so the breadcrumb can step out to all of them.
  const openRow = (id, cat) => {
    const e = driverTotals.find((t) => t.driver.id === id);
    const sum = (b) => CHART_CAT_IDS.reduce((n, c) => n + (e?.[b][c] || 0), 0);
    openDrill(
      driverDrill(
        id,
        { categoryIds: CHART_CAT_IDS, fault, scopes: scopesFor(sum("period"), sum("ytd")) },
        { category: cat, x: [e?.period[cat] || 0, e?.ytd[cat] || 0] },
      ),
    );
  };

  // KPI: total incidents this month.
  const totalThisMonth = useMemo(
    () =>
      isHistorical
        ? monthHistory.reduce((sum, r) => sum + (r.count || 0), 0)
        : incidents.filter(
            (inc) =>
              incidentDateStr(inc).startsWith(selectedMonth) &&
              (faultFilter !== "driver" || inc.fault === "driver"),
          ).length,
    [isHistorical, monthHistory, incidents, selectedMonth, faultFilter],
  );

  // KPI: YTD total across all categories.
  const totalYtd = useMemo(() => {
    let sum = 0;
    for (const entry of driverTotals)
      for (const cat of CHART_CATEGORIES) sum += entry.ytd[cat.id] || 0;
    return sum;
  }, [driverTotals]);

  // KPI: driver-fault incidents this month (null when historical).
  const driverFaultCount = useMemo(
    () =>
      isHistorical
        ? null
        : monthIncidents.filter((inc) => inc.fault === "driver" && !inc.no_fault).length,
    [isHistorical, monthIncidents],
  );

  // KPI: exonerated incidents this month (null when historical).
  const exoneratedCount = useMemo(
    () =>
      isHistorical
        ? null
        : monthIncidents.filter(
            (inc) =>
              inc.fault === "exonerated" ||
              inc.fault === "preload" ||
              inc.fault === "warehouse" ||
              inc.fault === "customer",
          ).length,
    [isHistorical, monthIncidents],
  );

  const monthLabel =
    MONTH_NAMES[parseInt(selectedMonth.slice(5, 7), 10) - 1] +
    " " +
    selectedMonth.slice(0, 4);

  // Nothing to badge while the numbers can't be shown (AnalyticsGate says why).
  const dataBadge = data.blocking ? null : isHistorical ? (
    <span
      style={{
        fontSize: 10,
        fontFamily: "var(--mono)",
        color: "var(--text-2)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      · historical rollup
    </span>
  ) : (
    <span
      style={{
        fontSize: 10,
        fontFamily: "var(--mono)",
        color: "var(--accent-green)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      · live data
    </span>
  );

  return (
    <div>
      <div className="page-title">Performance Dashboard</div>
      <h1 className="page-heading">
        Driver Scorecard{" "}
        <span className="meta">· {monthLabel}</span>{" "}
        {dataBadge}
      </h1>

      <div className="toolbar">
        <PeriodBar
          grain="month"
          presets={MONTH_PRESETS}
          value={period}
          onChange={setPeriod}
          anchor={{
            value: selectedMonth,
            onChange: setSelectedMonth,
            label: "Month",
            options: availableMonths.map((ym) => {
              const [yr, mo] = ym.split("-");
              return { value: ym, label: `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${yr}` };
            }),
          }}
          fault={{
            value: faultFilter,
            onChange: setFaultFilter,
            disabled: isHistorical,
            title: isHistorical ? "Fault filter unavailable for historical rollup data" : "",
          }}
        />
        <div className="toolbar-spacer" />
        <HistoryRefresh />
      </div>

      <AnalyticsGate>
        {/* Plain tiles: none of these numbers is a status, so none wears a status
            colour — the old amber and red rules sat beside Late's and Damage's hues. */}
        <div className="kpi-grid">
          <StatTile label="This Month" value={totalThisMonth} sub="Total incidents" />
          <StatTile label="Year to Date" value={totalYtd} sub={`${selectedYear} cumulative`} />
          <StatTile
            label="Driver Fault (Month)"
            value={driverFaultCount === null ? "—" : driverFaultCount}
            sub={driverFaultCount === null ? "Not tracked in history" : "Attributed to drivers"}
          />
          <StatTile
            label="Exonerated (Month)"
            value={exoneratedCount === null ? "—" : exoneratedCount}
            sub={exoneratedCount === null ? "Not tracked in history" : "Preload / warehouse / vendor"}
          />
        </div>

        <div className="section-head">
          Drivers
          <span className="section-hint">Click a chart for every incident behind it · click a name for that driver</span>
        </div>
        {/* The Drivers / Loaders split and the hidden inactive rows need the roster. */}
        <RosterGate>
          <div className="chart-grid">
            {CHART_CATEGORIES.map((cat) => (
              <CategoryLeaderboard
                key={cat.id}
                title={cat.title}
                color={cat.color}
                data={chartDataFor(cat.id, "driver")}
                totals={chartTotalsFor(cat.id, "driver")}
                onSelect={(id) => openRow(id, cat.id)}
                onOpen={() => openChart(cat, "driver")}
                periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
              />
            ))}
          </div>
        </RosterGate>

        <AttemptsScorecardCard />

        {!data.rosterBlocking && (
          <>
            <div className="section-head" style={{ marginTop: 26 }}>Loaders</div>
            <div className="chart-grid">
              {CHART_CATEGORIES.filter(
                (cat) => chartDataFor(cat.id, "loader").length > 0,
              ).map((cat) => (
                <CategoryLeaderboard
                  key={cat.id}
                  title={cat.title}
                  color={cat.color}
                  data={chartDataFor(cat.id, "loader")}
                  totals={chartTotalsFor(cat.id, "loader")}
                  onSelect={(id) => openRow(id, cat.id)}
                  onOpen={() => openChart(cat, "loader")}
                  periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
                />
              ))}
              {CHART_CATEGORIES.every(
                (cat) => chartDataFor(cat.id, "loader").length === 0,
              ) && <div className="empty-state">No loader incidents on record.</div>}
            </div>
          </>
        )}

        {incidents.length === 0 && history.length === 0 && (
          <div style={{ marginTop: 30 }} className="card">
            <div className="card-body">
              <div className="empty-state">
                No data yet. Upload historical spreadsheets on the{" "}
                <strong>History Import</strong> tab, or create your first weekly
                report on <strong>New Report</strong>.
              </div>
            </div>
          </div>
        )}
      </AnalyticsGate>
    </div>
  );
}
