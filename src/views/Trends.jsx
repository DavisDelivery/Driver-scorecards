import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { getHistory } from "../data/firebase.js";
import { INCIDENT_CATEGORIES } from "../data/drivers.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CATEGORY_IDS = ["damage", "missing", "misdelivery", "forgotten_freight", "late", "attempts"];

function getCategoryMeta(id) {
  return INCIDENT_CATEGORIES.find((c) => c.id === id) || { label: id, color: "#94a3b8" };
}

export default function Trends({ drivers }) {
  const [history, setHistory] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [mode, setMode] = React.useState("overview");
  const [selectedDriver, setSelectedDriver] = React.useState(null);
  const [selectedYear, setSelectedYear] = React.useState(null);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      const records = await getHistory();
      setHistory(records);
      const years = [...new Set(records.map((r) => r.year))].sort();
      if (years.length > 0) setSelectedYear(years[years.length - 1]);
      setLoading(false);
    })();
  }, []);

  const availableYears = React.useMemo(
    () => [...new Set(history.map((r) => r.year))].sort(),
    [history],
  );

  // Overview: monthly data for selected year
  const overviewData = React.useMemo(() => {
    if (!selectedYear) return [];
    const monthly = {};
    for (let m = 1; m <= 12; m++) {
      monthly[m] = { month: MONTHS[m - 1] };
      for (const cat of CATEGORY_IDS) monthly[m][cat] = 0;
    }
    for (const rec of history) {
      if (rec.year === selectedYear && monthly[rec.month] && CATEGORY_IDS.includes(rec.category)) {
        monthly[rec.month][rec.category] += rec.count;
      }
    }
    return Object.values(monthly);
  }, [history, selectedYear]);

  // Year-over-Year: totals per year per category
  const yoyData = React.useMemo(() => {
    const byYear = {};
    for (const rec of history) {
      if (!CATEGORY_IDS.includes(rec.category)) continue;
      const yr = String(rec.year);
      if (!byYear[yr]) {
        byYear[yr] = { year: yr };
        for (const cat of CATEGORY_IDS) byYear[yr][cat] = 0;
      }
      byYear[yr][rec.category] += rec.count;
    }
    return Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year));
  }, [history]);

  // Leaderboard: drivers sorted by total incidents for selected year
  const leaderboardData = React.useMemo(() => {
    if (!selectedYear) return [];
    const byDriver = {};
    for (const rec of history) {
      if (rec.year === selectedYear && CATEGORY_IDS.includes(rec.category)) {
        if (!byDriver[rec.driver_id]) {
          byDriver[rec.driver_id] = {
            driver_id: rec.driver_id,
            driver_name: rec.driver_name || "(unknown)",
            total: 0,
          };
          for (const cat of CATEGORY_IDS) byDriver[rec.driver_id][cat] = 0;
        }
        byDriver[rec.driver_id][rec.category] += rec.count;
        byDriver[rec.driver_id].total += rec.count;
      }
    }
    return Object.values(byDriver).sort((a, b) => b.total - a.total);
  }, [history, selectedYear]);

  // Per-driver: monthly timeline for selected driver
  const driverTimeline = React.useMemo(() => {
    if (!selectedDriver) return [];
    const rows = [];
    const driverRecords = history.filter((r) => r.driver_id === selectedDriver.id);
    const driverYears = [...new Set(driverRecords.map((r) => r.year))].sort();
    for (const yr of driverYears) {
      for (let m = 1; m <= 12; m++) {
        const entry = { label: `${MONTHS[m - 1]} ${String(yr).slice(2)}`, year: yr, month: m };
        for (const cat of CATEGORY_IDS) entry[cat] = 0;
        for (const rec of driverRecords) {
          if (rec.year === yr && rec.month === m && CATEGORY_IDS.includes(rec.category)) {
            entry[rec.category] += rec.count;
          }
        }
        rows.push(entry);
      }
    }
    return rows;
  }, [history, selectedDriver]);

  // Per-driver: lifetime totals
  const driverLifetime = React.useMemo(() => {
    if (!selectedDriver) return {};
    const totals = { total: 0 };
    for (const cat of CATEGORY_IDS) totals[cat] = 0;
    for (const rec of history) {
      if (rec.driver_id === selectedDriver.id && CATEGORY_IDS.includes(rec.category)) {
        totals[rec.category] += rec.count;
        totals.total += rec.count;
      }
    }
    return totals;
  }, [history, selectedDriver]);

  if (loading) {
    return <div className="empty-state">Loading history...</div>;
  }

  if (history.length === 0) {
    return (
      <div>
        <div className="page-title">Trends</div>
        <h1 className="page-heading">No historical data yet</h1>
        <div className="empty-state">
          <p>
            Upload historical DRIVER_PERFORMANCE.xlsx files on the{" "}
            <strong>History Import</strong> tab to populate this view, or save a new weekly report
            — it will automatically roll up into the history table.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title">Trends</div>
      <h1 className="page-heading">
        Historical Performance
        <span className="meta">· {history.length} monthly rollup records</span>
      </h1>

      {/* Mode toggle + year selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button className={`btn ${mode === "overview" ? "" : "ghost"}`} onClick={() => setMode("overview")}>
          Overview
        </button>
        <button className={`btn ${mode === "driver" ? "" : "ghost"}`} onClick={() => setMode("driver")}>
          Per Driver
        </button>
        <button className={`btn ${mode === "leaderboard" ? "" : "ghost"}`} onClick={() => setMode("leaderboard")}>
          Leaderboard
        </button>
        <button className={`btn ${mode === "yoy" ? "" : "ghost"}`} onClick={() => setMode("yoy")}>
          Year-over-Year
        </button>

        {(mode === "overview" || mode === "leaderboard") && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-2)" }}>
              YEAR:
            </span>
            {availableYears.map((yr) => (
              <button
                key={yr}
                className={`btn ${selectedYear === yr ? "" : "ghost"} sm`}
                onClick={() => setSelectedYear(yr)}
              >
                {yr}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Overview mode: monthly line chart */}
      {mode === "overview" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">Monthly incidents by category — {selectedYear}</div>
          </div>
          <div className="card-body" style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overviewData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke="var(--text-2)" style={{ fontSize: 11 }} />
                <YAxis stroke="var(--text-2)" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border)" }} />
                <Legend />
                {CATEGORY_IDS.map((cat) => {
                  const meta = getCategoryMeta(cat);
                  return (
                    <Line
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      name={meta.label}
                      stroke={meta.color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Year-over-Year mode: bar chart */}
      {mode === "yoy" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">Year-over-year totals by category</div>
          </div>
          <div className="card-body" style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yoyData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="year" stroke="var(--text-2)" style={{ fontSize: 12 }} />
                <YAxis stroke="var(--text-2)" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border)" }} />
                <Legend />
                {CATEGORY_IDS.map((cat) => {
                  const meta = getCategoryMeta(cat);
                  return <Bar key={cat} dataKey={cat} name={meta.label} fill={meta.color} />;
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Leaderboard mode: table */}
      {mode === "leaderboard" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">Most incidents — {selectedYear}</div>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>{leaderboardData.length} drivers</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Total</th>
                  {CATEGORY_IDS.map((cat) => (
                    <th key={cat} style={{ color: getCategoryMeta(cat).color }}>
                      {getCategoryMeta(cat).label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {leaderboardData.map((row, idx) => (
                  <tr key={row.driver_id}>
                    <td style={{ color: "var(--text-2)", fontFamily: "var(--mono)" }}>{idx + 1}</td>
                    <td>
                      <strong>{row.driver_name}</strong>
                    </td>
                    <td style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{row.total}</td>
                    {CATEGORY_IDS.map((cat) => (
                      <td
                        key={cat}
                        style={{
                          fontFamily: "var(--mono)",
                          color: row[cat] > 0 ? getCategoryMeta(cat).color : "var(--text-2)",
                        }}
                      >
                        {row[cat] || "·"}
                      </td>
                    ))}
                    <td>
                      <button
                        className="btn ghost sm"
                        onClick={() => {
                          const driver = drivers.find((d) => d.id === row.driver_id);
                          if (driver) {
                            setSelectedDriver(driver);
                            setMode("driver");
                          }
                        }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per Driver mode */}
      {mode === "driver" && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">Select a driver</div>
            </div>
            <div className="card-body">
              <select
                value={selectedDriver?.id || ""}
                onChange={(e) => {
                  const driver = drivers.find((d) => d.id === e.target.value);
                  setSelectedDriver(driver || null);
                }}
                style={{ width: "100%", maxWidth: 400 }}
              >
                <option value="">— Pick a driver —</option>
                {drivers
                  .filter((d) => history.some((r) => r.driver_id === d.id))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {selectedDriver && (
            <>
              <div className="kpi-grid" style={{ marginBottom: 16 }}>
                <div className="kpi">
                  <div className="kpi-label">lifetime total</div>
                  <div className="kpi-value">{driverLifetime.total}</div>
                </div>
                {CATEGORY_IDS.map((cat) => {
                  const meta = getCategoryMeta(cat);
                  return (
                    <div key={cat} className="kpi">
                      <div className="kpi-label">{meta.label.toLowerCase()}</div>
                      <div
                        className="kpi-value"
                        style={{ color: driverLifetime[cat] > 0 ? meta.color : "var(--text-2)" }}
                      >
                        {driverLifetime[cat] || 0}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div className="card-title">{selectedDriver.name} — monthly timeline</div>
                </div>
                <div className="card-body" style={{ height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={driverTimeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        stroke="var(--text-2)"
                        style={{ fontSize: 10 }}
                        interval={2}
                      />
                      <YAxis stroke="var(--text-2)" style={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border)" }} />
                      <Legend />
                      {CATEGORY_IDS.map((cat) => {
                        const meta = getCategoryMeta(cat);
                        return (
                          <Line
                            key={cat}
                            type="monotone"
                            dataKey={cat}
                            name={meta.label}
                            stroke={meta.color}
                            strokeWidth={2}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
