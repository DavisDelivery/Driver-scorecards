import React, { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { INCIDENT_CATEGORIES } from "../data/drivers.js";
import { getHistory } from "../data/firebase.js";

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

// ─── Monthly chart card (internal sub-component) ─────────────────────────────
function MonthlyChartCard({ title, data, monthColor }) {
  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div className="chart-card-title">{title}</div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-2)" }}>
          {data.length} driver{data.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="chart-card-body">
        {data.length === 0 ? (
          <div className="empty-state">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 10, right: 20, left: 0, bottom: 80 }}
            >
              <XAxis
                dataKey="name"
                angle={-55}
                textAnchor="end"
                height={80}
                interval={0}
                tick={{ fill: "#6b7280", fontSize: 9, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: "#dde3ec" }}
                tickLine={{ stroke: "#dde3ec" }}
              />
              <YAxis
                tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: "#dde3ec" }}
                tickLine={{ stroke: "#dde3ec" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #dde3ec",
                  borderRadius: 6,
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                  boxShadow: "0 2px 8px rgba(17, 24, 39, 0.1)",
                }}
                labelStyle={{ color: "#111827" }}
                cursor={{ fill: "rgba(30, 91, 146, 0.08)" }}
              />
              <Legend
                wrapperStyle={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              />
              <Bar dataKey="month" name="Month" fill={monthColor} radius={[2, 2, 0, 0]} />
              <Bar dataKey="ytd"   name="YTD"   fill="#cbd5e1"   radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard (default export) ──────────────────────────────────────────────
export default function Dashboard({ incidents, drivers }) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.toISOString().slice(0, 7));
  const [faultFilter, setFaultFilter] = useState("all");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Per-driver month + YTD tallies, blending live data and historical rollup.
  const driverTotals = useMemo(() => {
    const map = new Map();
    const blankCounts = () =>
      Object.fromEntries(CHART_CATEGORIES.map((c) => [c.id, 0]));

    // Seed from the known driver list.
    for (const drv of drivers) {
      map.set(drv.id, { driver: drv, month: blankCounts(), ytd: blankCounts() });
    }

    const getOrCreate = (driverId, driverName) => {
      let entry = map.get(driverId);
      if (!entry) {
        entry = {
          driver: { id: driverId, name: driverName || "(unknown)", role: "driver" },
          month: blankCounts(),
          ytd: blankCounts(),
        };
        map.set(driverId, entry);
      }
      return entry;
    };

    // ── Month counts ──
    if (isHistorical) {
      for (const rec of monthHistory) {
        if (!rec.driver_id || !CHART_CATEGORIES.some((c) => c.id === rec.category)) continue;
        const entry = getOrCreate(rec.driver_id, rec.driver_name);
        entry.month[rec.category] = (entry.month[rec.category] || 0) + (rec.count || 0);
      }
    } else {
      for (const inc of monthIncidents) {
        if (
          (faultFilter === "driver" && inc.fault !== "driver") ||
          !inc.driver_id ||
          !CHART_CATEGORIES.some((c) => c.id === inc.category)
        )
          continue;
        const entry = getOrCreate(inc.driver_id, inc.driver_name || inc.driver_raw);
        entry.month[inc.category] = (entry.month[inc.category] || 0) + 1;
      }
    }

    // ── YTD counts: blend live months with historical rollup for months with
    //    no live data yet. ──
    const liveByMonth = {};
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
      if (!dateStr.startsWith(selectedYear)) continue;
      const ym = dateStr.slice(0, 7);
      if (!liveByMonth[ym]) liveByMonth[ym] = [];
      liveByMonth[ym].push(inc);
    }

    for (let mo = 1; mo <= 12; mo++) {
      const pad = String(mo).padStart(2, "0");
      const ym = `${selectedYear}-${pad}`;
      if (liveByMonth[ym] && liveByMonth[ym].length > 0) {
        for (const inc of liveByMonth[ym]) {
          if (
            (faultFilter === "driver" && inc.fault !== "driver") ||
            !inc.driver_id ||
            !CHART_CATEGORIES.some((c) => c.id === inc.category)
          )
            continue;
          const entry = getOrCreate(inc.driver_id, inc.driver_name || inc.driver_raw);
          entry.ytd[inc.category] = (entry.ytd[inc.category] || 0) + 1;
        }
      } else {
        const rollupRecs = yearHistory.filter((r) => r.month === mo);
        for (const rec of rollupRecs) {
          if (!rec.driver_id || !CHART_CATEGORIES.some((c) => c.id === rec.category)) continue;
          const entry = getOrCreate(rec.driver_id, rec.driver_name);
          entry.ytd[rec.category] = (entry.ytd[rec.category] || 0) + (rec.count || 0);
        }
      }
    }

    return Array.from(map.values());
  }, [drivers, incidents, monthIncidents, monthHistory, yearHistory, isHistorical, selectedYear, faultFilter]);

  // Build sorted chart data for a single category.
  const chartDataFor = (categoryId) =>
    driverTotals
      .filter((e) => e.month[categoryId] > 0 || e.ytd[categoryId] > 0)
      .map((e) => ({
        name: e.driver.name,
        month: e.month[categoryId] || 0,
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
        : monthIncidents.filter((inc) => inc.fault === "driver").length,
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

      <div className="chart-grid">
        {CHART_CATEGORIES.map((cat) => (
          <MonthlyChartCard
            key={cat.id}
            title={cat.title}
            data={chartDataFor(cat.id)}
            monthColor={cat.color}
          />
        ))}
      </div>

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
