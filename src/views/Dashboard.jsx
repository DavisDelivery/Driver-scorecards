import React, { useState, useEffect, useMemo } from "react";
import { hiddenDriverIds } from "../data/drivers.js";
import { getHistory } from "../data/firebase.js";
import DriverModal from "./DriverModal.jsx";
import CategoryDetail from "./CategoryDetail.jsx";
import { CategoryLeaderboard } from "./leaderboard.jsx";
import AttemptsScorecardCard from "./AttemptsScorecardCard.jsx";
import { countsTowardCharts } from "../data/liveHistoryBlend.js";
import { incidentDateStr } from "../data/incidentDate.js";
import { COUNTED8, categoriesFor } from "../data/categories.js";
import { MONTH_PRESETS, monthWindow, currentYmET } from "../data/period.js";
import { useHashState } from "../data/hashState.js";
import PeriodBar, { usePeriodState } from "./kit/PeriodBar.jsx";
import StatTile from "./kit/StatTile.jsx";

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
export default function Dashboard({ incidents, drivers }) {
  // The month picker, the period and the fault scope live in the URL hash under sc.*,
  // so they survive a tab switch and a link opens the same view. The default month is
  // the current month in Eastern time, so it doesn't jump ahead on the last evening of
  // the month.
  const [monthParam, setSelectedMonth] = useHashState("sc.m", currentYmET());
  const selectedMonth = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentYmET();
  const [faultParam, setFaultFilter] = useHashState("sc.fault", "all");
  const faultFilter = faultParam === "driver" ? "driver" : "all";
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  // Drill-downs. `focus` is a driver opened from a chart (scoped to that chart's
  // category); `openCat` is a whole chart opened for its full detail.
  const [focus, setFocus] = useState(null); // { id, category }
  const [openCat, setOpenCat] = useState(null); // { category, roleGroup }
  const [period, setPeriod] = usePeriodState("sc", MONTH_PRESETS, "this");
  const { p: periodSel, from: customFrom, to: customTo } = period;

  // Load all history records on mount.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const records = await getHistory();
      setHistory(records || []);
      setLoading(false);
    })();
  }, []);

  // Escape closes the top-most drill-down: the driver popup if one is open on top of
  // a chart's detail, otherwise the chart's detail.
  useEffect(() => {
    if (!focus && !openCat) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (focus) setFocus(null);
      else setOpenCat(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, openCat]);

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

  // All historical rollup records for the selected year (for YTD blending).
  const yearHistory = useMemo(() => {
    const yr = Number(selectedYear);
    return history.filter((r) => r.year === yr);
  }, [history, selectedYear]);

  // Per-driver tallies from a blended monthly map: for every (year-month),
  // live incidents win when any exist for that month; otherwise the historical
  // rollup fills in. "period" = trailing N months ending at the selected month.
  const scorecardData = useMemo(() => {
    const map = new Map();
    const blankCounts = () =>
      Object.fromEntries(CHART_CATEGORIES.map((c) => [c.id, 0]));

    for (const drv of drivers) {
      map.set(drv.id, { driver: drv, month: blankCounts(), period: blankCounts(), ytd: blankCounts() });
    }
    const getOrCreate = (driverId, driverName) => {
      let entry = map.get(driverId);
      if (!entry) {
        entry = {
          driver: { id: driverId, name: driverName || "(unknown)", role: "driver" },
          month: blankCounts(), period: blankCounts(), ytd: blankCounts(),
        };
        map.set(driverId, entry);
      }
      return entry;
    };

    // The window of months we need: the selected year (for YTD) plus the period. The
    // period still counts back from THIS month, not the picked one, exactly as before;
    // anchoring it to the month picker is a number change and ships on its own.
    const periodMonths = monthWindow(periodSel, {
      anchor: currentYmET(),
      from: customFrom,
      to: customTo,
    }).months;
    // Year to date means the year being looked at — the month picker's year, which is
    // what selectedYear and yearHistory already use. This used to take the year of the
    // OLDEST month in the trailing period, so any period reaching back over Jan 1 moved
    // YTD to the previous year: with 12M selected in September 2026, "Year to Date"
    // was quietly reporting 2025.
    const ytdYear = Number(selectedYear);
    const months = new Set(periodMonths);
    for (let m = 1; m <= 12; m++) months.add(`${ytdYear}-${String(m).padStart(2, "0")}`);

    // Live incidents grouped by month (all years).
    //
    // ONLY incidents that actually count are grouped here, because the presence of a
    // month in this map is what makes live data supersede the rolled-up history for
    // it. Grouping every incident meant a single row that contributes nothing — a
    // compliment, an unable-to-track entry, a no-fault row, or (with the driver-fault
    // filter on) anyone else's fault — silently replaced that month's entire history
    // with nothing, and the month read as zero.
    const liveByYm = {};
    for (const inc of incidents) {
      const ym = incidentDateStr(inc).slice(0, 7);
      if (!months.has(ym)) continue;
      if (!countsTowardCharts(inc, { categoryIds: CHART_CAT_IDS, faultFilter })) continue;
      if (!liveByYm[ym]) liveByYm[ym] = [];
      liveByYm[ym].push(inc);
    }

    // blend[ym] = Map("driverId|cat" -> count)
    const blend = {};
    for (const ym of months) {
      const cell = new Map();
      const live = liveByYm[ym] || [];
      if (live.length > 0) {
        for (const inc of live) {
          // Already filtered by counts() when liveByYm was built.
          const k = `${inc.driver_id}|${inc.category}`;
          cell.set(k, (cell.get(k) || 0) + 1);
          getOrCreate(inc.driver_id, inc.driver_name || inc.driver_raw);
        }
      } else {
        const [y, m] = ym.split("-").map(Number);
        for (const rec of history) {
          if (rec.year !== y || rec.month !== m || !rec.driver_id) continue;
          if (!CHART_CATEGORIES.some((c) => c.id === rec.category)) continue;
          const k = `${rec.driver_id}|${rec.category}`;
          cell.set(k, (cell.get(k) || 0) + (rec.count || 0));
          getOrCreate(rec.driver_id, rec.driver_name);
        }
      }
      blend[ym] = cell;
    }

    const addInto = (bucketName, ym) => {
      for (const [k, n] of blend[ym] || []) {
        const [did, cat] = k.split("|");
        const entry = map.get(did);
        if (entry) entry[bucketName][cat] = (entry[bucketName][cat] || 0) + n;
      }
    };

    // month = the selected month; ytd = whole selected year; period = trailing N.
    addInto("month", selectedMonth);
    for (let m = 1; m <= 12; m++) addInto("ytd", `${ytdYear}-${String(m).padStart(2, "0")}`);
    for (const ym of periodMonths) addInto("period", ym);

    // The drill-downs read liveByYm/periodMonths/ytdYear straight from here, so the
    // detail behind a chart is built from the very months that produced its numbers.
    return { rows: Array.from(map.values()), liveByYm, periodMonths, ytdYear };
  }, [drivers, incidents, history, selectedMonth, periodSel, customFrom, customTo, faultFilter]);

  const driverTotals = scorecardData.rows;

  const hiddenDrivers = useMemo(() => hiddenDriverIds(drivers), [drivers]);

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

  // What the drill-downs need to rebuild a chart's numbers exactly.
  const periodLabelText =
    {
      this: "This Mo",
      last: "Last Mo",
      3: "Last 3 Mo",
      6: "Last 6 Mo",
      12: "Last 12 Mo",
      custom: "Custom range",
    }[periodSel] || "Period";
  const scorecardCtx = {
    liveByYm: scorecardData.liveByYm,
    history,
    periodMonths: scorecardData.periodMonths,
    ytdYear: scorecardData.ytdYear,
    periodLabel: periodLabelText,
    categories: CHART_CATEGORIES,
    categoryIds: CHART_CAT_IDS,
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

  if (loading && incidents.length === 0) {
    return <div className="empty-state">Loading...</div>;
  }

  const dataBadge = isHistorical ? (
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
      </div>

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
      <div className="chart-grid">
        {CHART_CATEGORIES.map((cat) => (
          <CategoryLeaderboard
            key={cat.id}
            title={cat.title}
            color={cat.color}
            data={chartDataFor(cat.id, "driver")}
            totals={chartTotalsFor(cat.id, "driver")}
            onSelect={(id) => setFocus({ id, category: cat.id })}
            onOpen={() => setOpenCat({ category: cat, roleGroup: "driver" })}
            periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
          />
        ))}
      </div>

      <AttemptsScorecardCard />

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
            onSelect={(id) => setFocus({ id, category: cat.id })}
            onOpen={() => setOpenCat({ category: cat, roleGroup: "loader" })}
            periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
          />
        ))}
        {CHART_CATEGORIES.every(
          (cat) => chartDataFor(cat.id, "loader").length === 0,
        ) && <div className="empty-state">No loader incidents on record.</div>}
      </div>

      {openCat && (
        <CategoryDetail
          category={openCat.category}
          roleGroup={openCat.roleGroup}
          scorecard={scorecardCtx}
          drivers={drivers}
          hiddenDrivers={hiddenDrivers}
          onSelectDriver={(id, category) => setFocus({ id, category })}
          onClose={() => setOpenCat(null)}
        />
      )}

      {/* Rendered after the chart detail so a driver opened from inside it sits on top. */}
      {focus && (
        <DriverModal
          driver={
            drivers.find((d) => d.id === focus.id) ||
            (() => {
              // A driver_id with no roster row is still shown — CLAUDE.md: unknown
              // must never mean invisible. Use the name the data carries for it.
              const e = driverTotals.find((t) => t.driver.id === focus.id);
              return { id: focus.id, name: e?.driver.name || focus.id, role: "driver" };
            })()
          }
          incidents={incidents.filter((inc) => inc.driver_id === focus.id)}
          history={history.filter((r) => r.driver_id === focus.id)}
          scorecard={scorecardCtx}
          initialCategory={focus.category}
          onClose={() => setFocus(null)}
        />
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
    </div>
  );
}
