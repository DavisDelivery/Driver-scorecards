import { useState, useEffect, useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  getReports,
  getHistory,
  deleteIncidentsForReport,
  deleteReport,
} from "../data/firebase.js";
import {
  ANALYTICS_CATEGORIES,
  ANALYTICS_CATEGORY_IDS,
  MONTH_NAMES,
  buildMonthlyTotals,
  buildYearlyTotals,
  availableYears,
  aggregateReport,
  incidentDate,
  relativeTime,
} from "../data/analytics.js";
import { reportSpanLabel } from "../reports/reportNaming.js";
import ReportDetail from "./ReportDetail.jsx";

const DRIVER_FAULT_COLOR = "#1e5b92";

// Weekly category columns surfaced in the dense table.
const WEEK_COLS = [
  { id: "damage", label: "Damage" },
  { id: "misdelivery", label: "Misdeliv" },
  { id: "missing", label: "Lost" },
  { id: "late", label: "Late" },
];

// ── small presentational helpers ─────────────────────────────────────────────

function Skeleton({ w = "100%", h = 14, style }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}

function TableSkeleton({ rows = 6, cols = 6 }) {
  return (
    <div className="card">
      <div className="card-body">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="skeleton-row">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} h={12} w={c === 0 ? "26%" : "12%"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="card chart-band">
      <div className="card-body">
        <Skeleton h={220} />
      </div>
    </div>
  );
}

// Signed delta vs a prior period. Down (fewer incidents) is good → green.
function Delta({ value }) {
  if (value === null || value === undefined) return <span className="delta flat">—</span>;
  if (value === 0) return <span className="delta flat">±0</span>;
  const up = value > 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}
    </span>
  );
}

// Lightweight inline SVG sparkline (one per row — no recharts overhead).
function Sparkline({ values, width = 76, height = 22 }) {
  if (!values || values.length < 2) return <span className="spark-empty">—</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const stroke = last > prev ? "#dc3545" : last < prev ? "#16a34a" : "#6b7280";
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

// Shared recharts tooltip styling.
const TT_STYLE = {
  background: "#fff",
  border: "1px solid #dde3ec",
  borderRadius: 6,
  fontFamily: "JetBrains Mono",
  fontSize: 11,
  boxShadow: "0 2px 8px rgba(17,24,39,0.1)",
};
const LEGEND_STYLE = {
  fontFamily: "JetBrains Mono",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export default function Reports({
  drivers,
  incidents = [],
  onNewReport,
  initialReportId,
  onCleared,
}) {
  const [reports, setReports] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialReportId || null);

  const [gran, setGran] = useState("weekly");
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedKey, setExpandedKey] = useState(null);
  const [kbIndex, setKbIndex] = useState(-1);

  const searchRef = useRef(null);

  const refresh = async () => {
    setLoading(true);
    const [reps, hist] = await Promise.all([getReports(), getHistory()]);
    setReports(reps);
    setHistory(hist || []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (initialReportId) {
      setSelectedId(initialReportId);
      onCleared?.();
    }
  }, [initialReportId]);

  const years = useMemo(
    () => availableYears(incidents, history),
    [incidents, history],
  );

  // Default the year to the latest available once data loads.
  useEffect(() => {
    if (selectedYear == null && years.length > 0) {
      setSelectedYear(years[years.length - 1]);
    }
  }, [years, selectedYear]);

  // ── Weekly model: one row per report, enriched from live incidents ──────────
  const weeklyAll = useMemo(() => {
    const rows = reports.map((r) => {
      const agg = aggregateReport(r.id, incidents);
      const date = r.starts_at || r.ends_at || r.week_ending || r.created_at || "";
      return {
        report: r,
        date,
        count: agg.count || r.incident_count || 0,
        byCat: agg.byCat,
        driverFault: agg.driverFault,
        withPhotos: agg.withPhotos,
      };
    });
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    // Trailing sparkline series + vs-prior delta (chronological order).
    const totals = rows.map((r) => r.count);
    rows.forEach((r, i) => {
      r.spark = totals.slice(Math.max(0, i - 7), i + 1);
      r.delta = i > 0 ? r.count - totals[i - 1] : null;
    });
    return rows;
  }, [reports, incidents]);

  const weeklyRows = useMemo(() => {
    let rows = weeklyAll.filter((r) => {
      if (!selectedYear) return true;
      const yr = Number(String(r.date).slice(0, 4));
      if (yr !== selectedYear) return false;
      if (selectedMonth !== "all") {
        const mo = Number(String(r.date).slice(5, 7));
        if (mo !== Number(selectedMonth)) return false;
      }
      return true;
    });
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.report.name || "").toLowerCase().includes(q) ||
          reportSpanLabel(r.report).toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (r) => {
      switch (sortCol) {
        case "name": return (r.report.name || "").toLowerCase();
        case "incidents": return r.count;
        case "driverFault": return r.driverFault;
        case "withPhotos": return r.withPhotos;
        case "damage": case "misdelivery": case "missing": case "late":
          return r.byCat[sortCol] || 0;
        default: return r.date;
      }
    };
    return rows.slice().sort((a, b) => {
      const av = key(a), bv = key(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [weeklyAll, selectedYear, selectedMonth, search, sortCol, sortDir]);

  // Weekly chart: last 12 weeks (chronological) within the year filter.
  const weeklyChart = useMemo(() => {
    const inYear = weeklyAll.filter(
      (r) => !selectedYear || Number(String(r.date).slice(0, 4)) === selectedYear,
    );
    return inYear.slice(-12).map((r) => {
      const row = { name: reportSpanLabel(r.report), fault: r.driverFault };
      for (const c of ANALYTICS_CATEGORIES) row[c.id] = r.byCat[c.id] || 0;
      return row;
    });
  }, [weeklyAll, selectedYear]);

  // ── Monthly / Yearly models (reconcile with Trends + Dashboard) ─────────────
  const monthly = useMemo(
    () => (selectedYear ? buildMonthlyTotals(selectedYear, incidents, history) : []),
    [selectedYear, incidents, history],
  );
  const prevMonthly = useMemo(
    () => (selectedYear ? buildMonthlyTotals(selectedYear - 1, incidents, history) : []),
    [selectedYear, incidents, history],
  );
  const monthlyRows = useMemo(() => {
    const rows = monthly.filter((m) => m.total > 0 || m.source !== "none");
    return rows.map((m, idx) => {
      const realIdx = m.month - 1;
      const prior = realIdx > 0 ? monthly[realIdx - 1].total : null;
      return { ...m, delta: prior === null ? null : m.total - prior };
    });
  }, [monthly]);

  const monthlyChart = useMemo(() => {
    return monthly.map((m) => {
      const ghost = prevMonthly[m.month - 1]?.total ?? 0;
      const row = { name: m.monthName, ghost };
      for (const c of ANALYTICS_CATEGORIES) row[c.id] = m.byCat[c.id] || 0;
      return row;
    });
  }, [monthly, prevMonthly]);

  const yearly = useMemo(
    () => buildYearlyTotals(incidents, history),
    [incidents, history],
  );
  const yearlyRows = useMemo(() => {
    return yearly.map((y, i) => ({
      ...y,
      delta: i > 0 ? y.total - yearly[i - 1].total : null,
    }));
  }, [yearly]);
  const yearlyChart = useMemo(
    () =>
      yearly.map((y) => {
        const row = { name: String(y.year) };
        for (const c of ANALYTICS_CATEGORIES) row[c.id] = y.byCat[c.id] || 0;
        return row;
      }),
    [yearly],
  );

  // Reports whose representative date falls in a given year+month (for expanders).
  const reportsInMonth = (year, month) =>
    weeklyAll
      .filter((r) => {
        const yr = Number(String(r.date).slice(0, 4));
        const mo = Number(String(r.date).slice(5, 7));
        return yr === year && mo === month;
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // ── keyboard: j/k move selection, Enter opens (weekly table) ────────────────
  useEffect(() => {
    if (selectedId || gran !== "weekly") return;
    function onKey(e) {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "j") {
        setKbIndex((i) => Math.min((i < 0 ? -1 : i) + 1, weeklyRows.length - 1));
        e.preventDefault();
      } else if (e.key === "k") {
        setKbIndex((i) => Math.max((i < 0 ? 0 : i) - 1, 0));
        e.preventDefault();
      } else if (e.key === "Enter" && kbIndex >= 0 && weeklyRows[kbIndex]) {
        setSelectedId(weeklyRows[kbIndex].report.id);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, gran, weeklyRows, kbIndex]);

  useEffect(() => {
    setKbIndex(-1);
    setExpandedKey(null);
  }, [gran, selectedYear, selectedMonth]);

  async function handleDelete(e, report) {
    e.stopPropagation();
    if (confirm(`Delete "${report.name}" and all its incidents?`)) {
      await deleteIncidentsForReport(report.id);
      await deleteReport(report.id);
      await refresh();
      if (selectedId === report.id) setSelectedId(null);
    }
  }

  const onSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir(col === "name" || col === "date" ? "asc" : "desc");
    }
  };
  const sortArrow = (col) =>
    sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // ── DETAIL: full-width, with back button (no split pane) ────────────────────
  const selected = reports.find((r) => r.id === selectedId);
  if (selectedId) {
    if (selected) {
      return (
        <ReportDetail
          report={selected}
          drivers={drivers}
          onBack={() => setSelectedId(null)}
          onDeleted={async () => {
            await refresh();
            setSelectedId(null);
          }}
          onReportUpdated={refresh}
        />
      );
    }
    return (
      <div>
        <button className="btn ghost sm" onClick={() => setSelectedId(null)}>
          ← Back to Reports
        </button>
        <div className="empty-state" style={{ marginTop: 20 }}>
          Report not found.
        </div>
      </div>
    );
  }

  const noData =
    !loading && reports.length === 0 && history.length === 0 && incidents.length === 0;

  return (
    <div>
      <div className="page-title">Reports &amp; Analytics</div>
      <h1 className="page-heading">
        Reports
        <span className="meta">· {reports.length} weekly reports</span>
      </h1>

      {/* Granularity switcher + period controls + search */}
      <div className="toolbar" style={{ alignItems: "center" }}>
        <div className="month-picker" style={{ margin: 0 }}>
          {["weekly", "monthly", "yearly"].map((g) => (
            <button
              key={g}
              className={`month-btn ${gran === g ? "active" : ""}`}
              onClick={() => setGran(g)}
            >
              {g}
            </button>
          ))}
        </div>

        {gran !== "yearly" && (
          <select
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            style={{ width: 110 }}
            aria-label="Year"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
        {gran === "weekly" && (
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{ width: 140 }}
            aria-label="Month"
          >
            <option value="all">All months</option>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        )}
        {gran === "weekly" && (
          <input
            ref={searchRef}
            type="text"
            placeholder="Search reports…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 260 }}
          />
        )}

        <div className="toolbar-spacer" />
        <button className="btn" onClick={onNewReport}>
          + New Weekly Report
        </button>
      </div>

      {noData ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              No reports yet. Click <strong>+ New Weekly Report</strong> to create one,
              or import history on the <strong>History Import</strong> tab.
            </div>
          </div>
        </div>
      ) : loading ? (
        <>
          <ChartSkeleton />
          <TableSkeleton rows={7} cols={gran === "weekly" ? 9 : 4} />
        </>
      ) : gran === "weekly" ? (
        <WeeklyView
          rows={weeklyRows}
          chart={weeklyChart}
          kbIndex={kbIndex}
          onOpen={(id) => setSelectedId(id)}
          onDelete={handleDelete}
          onSort={onSort}
          sortArrow={sortArrow}
        />
      ) : gran === "monthly" ? (
        <MonthlyView
          year={selectedYear}
          rows={monthlyRows}
          chart={monthlyChart}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          reportsInMonth={reportsInMonth}
          onOpen={(id) => setSelectedId(id)}
        />
      ) : (
        <YearlyView
          rows={yearlyRows}
          chart={yearlyChart}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          monthlyForYear={(y) =>
            buildMonthlyTotals(y, incidents, history).filter((m) => m.total > 0)
          }
        />
      )}
    </div>
  );
}

// ── WEEKLY ───────────────────────────────────────────────────────────────────
function WeeklyView({ rows, chart, kbIndex, onOpen, onDelete, onSort, sortArrow }) {
  return (
    <>
      <div className="card chart-band">
        <div className="card-header">
          <div className="card-title">Incidents per week · stacked by category</div>
          <div className="chart-legend-note">line = driver-fault</div>
        </div>
        <div className="card-body" style={{ height: 260 }}>
          {chart.length === 0 ? (
            <div className="empty-state">No weeks in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#6b7280" }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#6b7280" }} />
                <Tooltip contentStyle={TT_STYLE} cursor={{ fill: "rgba(30,91,146,0.06)" }} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {ANALYTICS_CATEGORIES.map((c) => (
                  <Bar key={c.id} dataKey={c.id} name={c.label} stackId="a" fill={c.color} />
                ))}
                <Line type="monotone" dataKey="fault" name="Driver fault" stroke={DRIVER_FAULT_COLOR} strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">No reports match this period</div>
      ) : (
        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              <table className="data analytics-table">
                <thead>
                  <tr>
                    <th onClick={() => onSort("name")} className="sortable">Name{sortArrow("name")}</th>
                    <th onClick={() => onSort("date")} className="sortable">Date span{sortArrow("date")}</th>
                    <th onClick={() => onSort("incidents")} className="sortable num">Inc.{sortArrow("incidents")}</th>
                    <th onClick={() => onSort("driverFault")} className="sortable num">Drv-fault{sortArrow("driverFault")}</th>
                    <th onClick={() => onSort("withPhotos")} className="sortable num">Photos{sortArrow("withPhotos")}</th>
                    {WEEK_COLS.map((c) => (
                      <th key={c.id} onClick={() => onSort(c.id)} className="sortable num">
                        {c.label}{sortArrow(c.id)}
                      </th>
                    ))}
                    <th className="num">Trend</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.report.id}
                      className={`clickable ${i === kbIndex ? "kb-active" : ""}`}
                      onClick={() => onOpen(r.report.id)}
                    >
                      <td>
                        <strong style={{ color: "var(--davis-blue)" }}>
                          {r.report.name || "Untitled Report"}
                        </strong>
                      </td>
                      <td>{reportSpanLabel(r.report)}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{r.driverFault || "·"}</td>
                      <td className="num">{r.withPhotos || "·"}</td>
                      {WEEK_COLS.map((c) => (
                        <td key={c.id} className="num">{r.byCat[c.id] || "·"}</td>
                      ))}
                      <td className="num">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Sparkline values={r.spark} />
                          <Delta value={r.delta} />
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn ghost sm"
                          onClick={(e) => onDelete(e, r.report)}
                          title="Delete report and its incidents"
                          style={{ color: "var(--accent-red)" }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── MONTHLY ──────────────────────────────────────────────────────────────────
function MonthlyView({ year, rows, chart, expandedKey, setExpandedKey, reportsInMonth, onOpen }) {
  return (
    <>
      <div className="card chart-band">
        <div className="card-header">
          <div className="card-title">{year} · monthly trend (stacked) with prior-year line</div>
        </div>
        <div className="card-body" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#6b7280" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT_STYLE} cursor={{ fill: "rgba(30,91,146,0.06)" }} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {ANALYTICS_CATEGORIES.map((c) => (
                <Bar key={c.id} dataKey={c.id} name={c.label} stackId="a" fill={c.color} />
              ))}
              <Line type="monotone" dataKey="ghost" name={`${year - 1} total`} stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">No data for {year}</div>
      ) : (
        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              <table className="data analytics-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Total</th>
                    <th className="num">vs prior</th>
                    {ANALYTICS_CATEGORIES.map((c) => (
                      <th key={c.id} className="num" style={{ color: c.color }}>{c.label}</th>
                    ))}
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const key = `m${m.month}`;
                    const open = expandedKey === key;
                    const weeks = open ? reportsInMonth(year, m.month) : [];
                    return (
                      <FragmentRow key={key}>
                        <tr className="clickable" onClick={() => setExpandedKey(open ? null : key)}>
                          <td>
                            <span className="row-caret">{open ? "▾" : "▸"}</span>
                            <strong>{m.monthName} {year}</strong>
                          </td>
                          <td className="num"><strong>{m.total}</strong></td>
                          <td className="num"><Delta value={m.delta} /></td>
                          {ANALYTICS_CATEGORIES.map((c) => (
                            <td key={c.id} className="num">{m.byCat[c.id] || "·"}</td>
                          ))}
                          <td><span className={`src-badge ${m.source}`}>{m.source}</span></td>
                        </tr>
                        {open && (
                          <tr className="expander-row">
                            <td colSpan={3 + ANALYTICS_CATEGORIES.length + 1}>
                              {weeks.length === 0 ? (
                                <div className="drawer-muted" style={{ padding: 8 }}>
                                  No weekly reports recorded in this month (historical rollup).
                                </div>
                              ) : (
                                <div className="mini-week-list">
                                  {weeks.map((w) => (
                                    <button
                                      key={w.report.id}
                                      className="mini-week"
                                      onClick={() => onOpen(w.report.id)}
                                    >
                                      <span className="mini-week-name">{w.report.name}</span>
                                      <span className="mini-week-meta">
                                        {reportSpanLabel(w.report)} · {w.count} inc.
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── YEARLY ───────────────────────────────────────────────────────────────────
function YearlyView({ rows, chart, expandedKey, setExpandedKey, monthlyForYear }) {
  return (
    <>
      <div className="card chart-band">
        <div className="card-header">
          <div className="card-title">Year totals by category</div>
        </div>
        <div className="card-body" style={{ height: 260 }}>
          {chart.length === 0 ? (
            <div className="empty-state">No yearly data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 10, right: 16, left: -8, bottom: 4 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fontFamily: "JetBrains Mono", fill: "#6b7280" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#6b7280" }} />
                <Tooltip contentStyle={TT_STYLE} cursor={{ fill: "rgba(30,91,146,0.06)" }} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {ANALYTICS_CATEGORIES.map((c) => (
                  <Bar key={c.id} dataKey={c.id} name={c.label} stackId="a" fill={c.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">No yearly data</div>
      ) : (
        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              <table className="data analytics-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="num">Total</th>
                    <th className="num">YoY</th>
                    {ANALYTICS_CATEGORIES.map((c) => (
                      <th key={c.id} className="num" style={{ color: c.color }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((y) => {
                    const key = `y${y.year}`;
                    const open = expandedKey === key;
                    const months = open ? monthlyForYear(y.year) : [];
                    return (
                      <FragmentRow key={key}>
                        <tr className="clickable" onClick={() => setExpandedKey(open ? null : key)}>
                          <td>
                            <span className="row-caret">{open ? "▾" : "▸"}</span>
                            <strong>{y.year}</strong>
                          </td>
                          <td className="num"><strong>{y.total}</strong></td>
                          <td className="num"><Delta value={y.delta} /></td>
                          {ANALYTICS_CATEGORIES.map((c) => (
                            <td key={c.id} className="num">{y.byCat[c.id] || "·"}</td>
                          ))}
                        </tr>
                        {open && (
                          <tr className="expander-row">
                            <td colSpan={3 + ANALYTICS_CATEGORIES.length}>
                              {months.length === 0 ? (
                                <div className="drawer-muted" style={{ padding: 8 }}>No monthly data.</div>
                              ) : (
                                <table className="data analytics-subtable">
                                  <thead>
                                    <tr>
                                      <th>Month</th>
                                      <th className="num">Total</th>
                                      {ANALYTICS_CATEGORIES.map((c) => (
                                        <th key={c.id} className="num">{c.label}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {months.map((m) => (
                                      <tr key={m.month}>
                                        <td>{m.monthName}</td>
                                        <td className="num">{m.total}</td>
                                        {ANALYTICS_CATEGORIES.map((c) => (
                                          <td key={c.id} className="num">{m.byCat[c.id] || "·"}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Tiny helper to group a row + its expander without an extra DOM node.
function FragmentRow({ children }) {
  return <>{children}</>;
}
