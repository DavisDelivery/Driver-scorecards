import React, { useState, useEffect, useMemo } from "react";
import { INCIDENT_CATEGORIES } from "../data/drivers.js";
import { getHistory } from "../data/firebase.js";
import DriverModal from "./DriverModal.jsx";
import { CategoryLeaderboard } from "./leaderboard.jsx";
import AttemptsScorecardCard from "./AttemptsScorecardCard.jsx";

// Month names used throughout the scorecard.
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Scorecard chart categories — derived from INCIDENT_CATEGORIES, using the
// display titles that appear in the bundle (bundle wins on text).  Only the 8
// categories that have chart panels are included here.
const CHART_CATEGORIES = [
  { id: "forgotten_freight", title: "Forgotten Freight", color: "#fb923c" },
  { id: "damage",            title: "Damages",           color: "#dc3545" },
  { id: "missing",           title: "Lost / Missing",    color: "#a855f7" },
  { id: "misdelivery",       title: "Misdeliveries",     color: "#f472b6" },
  { id: "attempts",          title: "Attempts",          color: "#14b8a6" },
  { id: "late",              title: "Lates",             color: "#facc15" },
  { id: "complaint",         title: "Complaints",        color: "#ef4444" },
  { id: "compliment",        title: "Compliments",       color: "#22c55e" },
];

// Validate ids against INCIDENT_CATEGORIES to stay in sync with the shared vocabulary.
// (Runtime check only — does not affect bundle output.)
const _validIds = new Set(INCIDENT_CATEGORIES.map((c) => c.id));
CHART_CATEGORIES.forEach((c) => {
  if (!_validIds.has(c.id)) {
    console.warn(`Dashboard: category id "${c.id}" not found in INCIDENT_CATEGORIES`);
  }
});


// List of YYYY-MM strings for the selected comparison period.
function computePeriodMonths(sel, from, to) {
  const now = new Date();
  const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const cur = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  if (sel === "this") return [ym(cur)];
  if (sel === "last") {
    return [ym(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, 1)))];
  }
  if (sel === "custom") {
    if (!from || !to) return [ym(cur)];
    let [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    const out = [];
    while (fy < ty || (fy === ty && fm <= tm)) {
      out.push(`${fy}-${String(fm).padStart(2, "0")}`);
      fm++;
      if (fm > 12) { fm = 1; fy++; }
      if (out.length >= 36) break; // sanity cap
    }
    return out.length ? out : [ym(cur)];
  }
  const n = Number(sel) || 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(ym(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1))));
  }
  return out;
}

const PERIOD_LABELS = { this: "MO", last: "LMO", 3: "3M", 6: "6M", 12: "12M", custom: "SEL" };

// ─── Dashboard (default export) ──────────────────────────────────────────────
export default function Dashboard({ incidents, drivers }) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.toISOString().slice(0, 7));
  const [faultFilter, setFaultFilter] = useState("all");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState(null);
  const [periodSel, setPeriodSel] = useState("this"); // this|last|3|6|12|custom
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Load all history records on mount.
  useEffect(() => {
    (async () => {
      setLoading(true);
      const records = await getHistory();
      setHistory(records || []);
      setLoading(false);
    })();
  }, []);

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
      const dateStr =
        inc.delivered_date ||
        inc.actual_delivery ||
        inc.return_date ||
        inc.trace_date ||
        inc.ship_date ||
        inc.week_ending ||
        inc.ingested_at ||
        "";
      if (dateStr) set.add(dateStr.slice(0, 7));
    }
    set.add(selectedMonth);
    return Array.from(set).sort().reverse();
  }, [incidents, history, selectedMonth]);

  // Live incidents that fall in the selected month.
  const monthIncidents = useMemo(
    () =>
      incidents.filter((inc) =>
        (
          inc.delivered_date ||
          inc.actual_delivery ||
          inc.return_date ||
          inc.trace_date ||
          inc.ship_date ||
          inc.week_ending ||
          inc.ingested_at ||
          ""
        ).startsWith(selectedMonth),
      ),
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
  const driverTotals = useMemo(() => {
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

    // The window of months we need: the selected year (for YTD) plus enough
    // months before the selected month to cover the trailing period.
    const periodMonths = computePeriodMonths(periodSel, customFrom, customTo);
    const ytdYear = Number(
      (periodMonths[periodMonths.length - 1] || new Date().toISOString().slice(0, 7)).slice(0, 4),
    );
    const months = new Set(periodMonths);
    for (let m = 1; m <= 12; m++) months.add(`${ytdYear}-${String(m).padStart(2, "0")}`);

    // Live incidents grouped by month (all years).
    const liveByYm = {};
    for (const inc of incidents) {
      const dateStr =
        inc.delivered_date || inc.actual_delivery || inc.return_date ||
        inc.trace_date || inc.ship_date || inc.week_ending || inc.ingested_at || "";
      const ym = dateStr.slice(0, 7);
      if (!months.has(ym)) continue;
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
          if (
            (faultFilter === "driver" && inc.fault !== "driver") ||
            inc.no_fault || !inc.driver_id ||
            !CHART_CATEGORIES.some((c) => c.id === inc.category)
          ) continue;
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

    return Array.from(map.values());
  }, [drivers, incidents, history, selectedMonth, periodSel, customFrom, customTo, faultFilter]);

  // Build sorted chart data for a single category.
  const chartDataFor = (categoryId, roleGroup) =>
    driverTotals
      .filter((e) => {
        const role = e.driver.role || "driver";
        const inGroup =
          roleGroup === "loader" ? role === "loader" : role !== "loader";
        return inGroup && (e.month[categoryId] > 0 || e.ytd[categoryId] > 0);
      })
      .map((e) => ({
        driverId: e.driver.id,
        name: e.driver.name,
        month: e.period[categoryId] || 0,
        ytd: e.ytd[categoryId] || 0,
      }))
      .sort((a, b) => b.ytd - a.ytd || b.month - a.month);

  // KPI: total incidents this month.
  const totalThisMonth = useMemo(
    () =>
      isHistorical
        ? monthHistory.reduce((sum, r) => sum + (r.count || 0), 0)
        : incidents.filter(
            (inc) =>
              (
                inc.delivered_date ||
                inc.actual_delivery ||
                inc.return_date ||
                inc.trace_date ||
                inc.ship_date ||
                inc.week_ending ||
                inc.ingested_at ||
                ""
              ).startsWith(selectedMonth) &&
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
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          style={{ width: 180 }}
        >
          {availableMonths.map((ym) => {
            const [yr, mo] = ym.split("-");
            return (
              <option key={ym} value={ym}>
                {MONTH_NAMES[parseInt(mo, 10) - 1]} {yr}
              </option>
            );
          })}
        </select>

        <div className="month-picker">
          {[
            ["this", "This Mo"],
            ["last", "Last Mo"],
            ["3", "3M"],
            ["6", "6M"],
            ["12", "12M"],
            ["custom", "Custom"],
          ].map(([val, label]) => (
            <button
              key={val}
              className={`month-btn ${periodSel === val ? "active" : ""}`}
              onClick={() => setPeriodSel(val)}
            >
              {label}
            </button>
          ))}
        </div>
        {periodSel === "custom" && (
          <div className="custom-range">
            <input type="month" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="meta">to</span>
            <input type="month" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}

        <div className="month-picker">
          <button
            className={`month-btn ${faultFilter === "all" ? "active" : ""}`}
            onClick={() => setFaultFilter("all")}
          >
            All Incidents
          </button>
          <button
            className={`month-btn ${faultFilter === "driver" ? "active" : ""}`}
            onClick={() => setFaultFilter("driver")}
            disabled={isHistorical}
            title={isHistorical ? "Fault filter unavailable for historical rollup data" : ""}
          >
            Driver Fault Only
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">This Month</div>
          <div className="kpi-value">{totalThisMonth}</div>
          <div className="kpi-delta">Total incidents</div>
        </div>
        <div className="kpi amber">
          <div className="kpi-label">Year to Date</div>
          <div className="kpi-value">{totalYtd}</div>
          <div className="kpi-delta">{selectedYear} cumulative</div>
        </div>
        <div className="kpi red">
          <div className="kpi-label">Driver Fault (Month)</div>
          <div className="kpi-value">{driverFaultCount === null ? "—" : driverFaultCount}</div>
          <div className="kpi-delta">
            {driverFaultCount === null ? "Not tracked in history" : "Attributed to drivers"}
          </div>
        </div>
        <div className="kpi green">
          <div className="kpi-label">Exonerated (Month)</div>
          <div className="kpi-value">{exoneratedCount === null ? "—" : exoneratedCount}</div>
          <div className="kpi-delta">
            {exoneratedCount === null ? "Not tracked in history" : "Preload / warehouse / vendor"}
          </div>
        </div>
      </div>

      <div className="section-head">Drivers</div>
      <div className="chart-grid">
        {CHART_CATEGORIES.map((cat) => (
          <CategoryLeaderboard
            key={cat.id}
            title={cat.title}
            color={cat.color}
            data={chartDataFor(cat.id, "driver")}
            onSelect={setFocusId}
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
            onSelect={setFocusId}
            periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
          />
        ))}
        {CHART_CATEGORIES.every(
          (cat) => chartDataFor(cat.id, "loader").length === 0,
        ) && <div className="empty-state">No loader incidents on record.</div>}
      </div>

      {focusId && (
        <DriverModal
          driver={
            drivers.find((d) => d.id === focusId) || {
              id: focusId,
              name: focusId,
              role: "driver",
            }
          }
          incidents={incidents.filter((inc) => inc.driver_id === focusId)}
          onClose={() => setFocusId(null)}
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
