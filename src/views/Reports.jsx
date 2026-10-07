import { useState, useEffect, useMemo, useRef } from "react";
import {
  deleteIncidentsForReport,
  deleteReport,
  rollupReportToHistory,
} from "../data/firebase.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import {
  ANALYTICS_CATEGORIES,
  ANALYTICS_CATEGORY_IDS,
  MONTH_NAMES,
  buildMonthlyTotals,
  buildYearlyTotals,
  availableYears,
  aggregateReport,
  reportColumn,
  REPORT_OTHER,
} from "../data/analytics.js";
import { OTHER_COLOR, categoriesFor } from "../data/categories.js";
import { historyCoverage } from "../data/liveHistoryBlend.js";
import { reportSpanLabel, reportStartLabel } from "../reports/reportNaming.js";
import { useHashState } from "../data/hashState.js";
import { csvName } from "../data/csv.js";
import ReportDetail from "./ReportDetail.jsx";
import { AnalyticsGate, LoadError } from "./kit/LoadState.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import { chartTable } from "./kit/shape.js";
import { BRAND, PRIOR, axisTick } from "./kit/chartTheme.js";

// The six stacked categories, bottom first, in the registry's order and colours.
const SERIES = ANALYTICS_CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color }));
// A weekly column also stacks "other" — returns, traces, complaints — in the gray an
// uncharted category gets, so it adds up to the report's Inc.
const WEEK_SERIES = [...SERIES, { id: REPORT_OTHER, label: "Other", color: OTHER_COLOR }];
const GRANS = ["weekly", "monthly", "yearly"];
const ymOf = (year, month) => `${year}-${String(month).padStart(2, "0")}`;

// Weekly category columns surfaced in the dense table, in registry order.
const WEEK_COLS = categoriesFor(["damage", "misdelivery", "late", "missing"]);

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

// A category column header: a swatch beside ink, never coloured text.
function CatTh({ c }) {
  return (
    <th className="num">
      <span className="th-swatch">
        <i style={{ background: c.color }} aria-hidden="true" />
        {c.label}
      </span>
    </th>
  );
}

export default function Reports({
  drivers,
  onNewReport,
  initialReportId,
  onCleared,
}) {
  // Reports, incidents and history come from the shared analytics state: one read each,
  // a failed read shown as a failure, and the monthly/yearly totals from the same blend
  // the Scorecard and Trends count from.
  const data = useAnalytics();
  const { reports, incidents, history } = data;
  const [selectedId, setSelectedId] = useState(initialReportId || null);

  // Granularity, year and month live in the hash (rp.*), so they survive a tab switch
  // and travel with a link.
  const [granParam, setGran] = useHashState("rp.g", "weekly");
  const gran = GRANS.includes(granParam) ? granParam : "weekly";
  const [yearParam, setYearParam] = useHashState("rp.y", "");
  const [selectedMonth, setSelectedMonth] = useHashState("rp.m", "all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedKey, setExpandedKey] = useState(null);
  const [kbIndex, setKbIndex] = useState(-1);

  const searchRef = useRef(null);

  // After a delete or a re-sync: the report list, the incidents it took with it, and the
  // history its rollup changed.
  const refresh = async () => {
    await Promise.all([data.reload.reports?.(), data.reload.incidents?.(), data.refreshHistory()]);
  };

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

  // The year defaults to the latest available once data loads.
  const selectedYear = years.includes(Number(yearParam))
    ? Number(yearParam)
    : years.length > 0
      ? years[years.length - 1]
      : null;
  const setSelectedYear = (y) => setYearParam(String(y));

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
    return inYear.slice(-12).map((r) => ({
      name: reportSpanLabel(r.report),
      start: reportStartLabel(r.report),
      fault: r.driverFault,
      ...reportColumn(r.byCat, r.count),
    }));
  }, [weeklyAll, selectedYear]);

  // ── Monthly / Yearly models (the shared blend: reconcile with Trends + Dashboard) ──
  const blend = data.blend(null);
  const monthly = useMemo(
    () => (selectedYear ? buildMonthlyTotals(selectedYear, blend) : []),
    [selectedYear, blend],
  );
  const prevMonthly = useMemo(
    () => (selectedYear ? buildMonthlyTotals(selectedYear - 1, blend) : []),
    [selectedYear, blend],
  );
  const monthlyRows = useMemo(() => {
    const rows = monthly.filter((m) => m.total > 0 || m.source !== "none");
    return rows.map((m, idx) => {
      const realIdx = m.month - 1;
      const prior = realIdx > 0 ? monthly[realIdx - 1].total : null;
      return { ...m, delta: prior === null ? null : m.total - prior };
    });
  }, [monthly]);

  // Which categories each history month tracked: an untracked one reads "—", not 0.
  const tracked = useMemo(() => historyCoverage(history, ANALYTICS_CATEGORY_IDS), [history]);

  const monthlyChart = useMemo(() => {
    // A month with no data at all (no live rows, no history) is a gap in the chart and
    // "—" in its table, never a column or a line point at 0.
    return monthly.map((m) => {
      const prior = prevMonthly[m.month - 1];
      const ghost = !prior || prior.source === "none" ? null : prior.total;
      const row = { name: m.monthName, ghost, source: m.source };
      const has = m.source === "history" ? tracked(ymOf(selectedYear, m.month)) : null;
      for (const c of ANALYTICS_CATEGORIES) {
        row[c.id] = m.source === "none" || (has && !has.has(c.id)) ? null : m.byCat[c.id] || 0;
      }
      return row;
    });
  }, [monthly, prevMonthly, tracked, selectedYear]);

  const yearly = useMemo(() => buildYearlyTotals(years, blend), [years, blend]);
  const yearlyRows = useMemo(() => {
    return yearly.map((y, i) => ({
      ...y,
      delta: i > 0 ? y.total - yearly[i - 1].total : null,
    }));
  }, [yearly]);
  const yearlyChart = useMemo(
    () =>
      yearly.map((y) => {
        const row = { name: String(y.year), source: y.source };
        // A history-only year shows "—" for what none of its months tracked.
        const has = new Set();
        if (y.source === "history") for (let m = 1; m <= 12; m++) for (const c of tracked(ymOf(y.year, m))) has.add(c);
        for (const c of ANALYTICS_CATEGORIES) {
          row[c.id] = y.source === "history" && !has.has(c.id) ? null : y.byCat[c.id] || 0;
        }
        return row;
      }),
    [yearly, tracked],
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
    if (!confirm(`Delete "${report.name}" and all its incidents?`)) return;
    try {
      await deleteIncidentsForReport(report.id);
      // Reverse the report's history contribution — deleting used to leave its
      // counts in Trends forever.
      await rollupReportToHistory([], report.id);
      await deleteReport(report.id);
    } catch (err) {
      alert(`Delete did not complete: ${err.message}\n\nRe-open the report and try again.`);
    }
    await refresh();
    if (selectedId === report.id) setSelectedId(null);
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
    !data.historyLoading &&
    !data.blocking &&
    !(data.readErrors.reports && !data.readErrors.reports.stale) &&
    reports.length === 0 &&
    history.length === 0 &&
    incidents.length === 0;

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
      ) : gran === "weekly" ? (
        // The weekly list reads reports and live incidents only, so it still shows if
        // history failed; it doesn't without the reports themselves.
        <AnalyticsGate history={false}>
          {data.readErrors.reports && !data.readErrors.reports.stale ? (
            <LoadError what="reports" message={data.readErrors.reports.message} retry={data.reload.reports} />
          ) : (
            <WeeklyView
              rows={weeklyRows}
              chart={weeklyChart}
              kbIndex={kbIndex}
              onOpen={(id) => setSelectedId(id)}
              onDelete={handleDelete}
              onSort={onSort}
              sortArrow={sortArrow}
            />
          )}
        </AnalyticsGate>
      ) : data.historyLoading ? (
        <>
          <ChartSkeleton />
          <TableSkeleton rows={7} cols={4} />
        </>
      ) : (
        <AnalyticsGate>
          {gran === "monthly" ? (
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
              monthlyForYear={(y) => buildMonthlyTotals(y, blend).filter((m) => m.total > 0)}
            />
          )}
        </AnalyticsGate>
      )}
    </div>
  );
}

// ── WEEKLY ───────────────────────────────────────────────────────────────────
// The driver-fault count shares the incidents' count axis, so it can sit on the same
// chart as a line; a rate or a percentage never could.
const WEEK_FAULT_LINE = { id: "fault", label: "Driver fault", color: BRAND, line: true, dots: true };
function WeeklyView({ rows, chart, kbIndex, onOpen, onDelete, onSort, sortArrow }) {
  // The axis names each week by its first day; twelve whole spans ran into one smear at
  // phone width. Ticks that would still collide are skipped, never overlapped.
  const startOf = new Map(chart.map((r) => [r.name, r.start]));
  return (
    <>
      {chart.length === 0 ? (
        <div className="card chart-band">
          <div className="card-body">
            <div className="empty-state">No weeks in this period</div>
          </div>
        </div>
      ) : (
        <ChartCard
          className="chart-band"
          title="Incidents per week · stacked by category"
          legend={[...WEEK_SERIES, WEEK_FAULT_LINE]}
          table={chartTable({
            rows: chart,
            x: { key: "name", label: "Week" },
            series: WEEK_SERIES,
            lines: [WEEK_FAULT_LINE],
            total: true,
            source: "weekly report",
          })}
          csv={csvName("Reports weekly")}
          height={280}
        >
          <StackedColumns
            data={chart}
            xKey="name"
            series={WEEK_SERIES}
            lines={[WEEK_FAULT_LINE]}
            xAxis={{ tickFormatter: (name) => startOf.get(name) || name, interval: "preserveStartEnd", minTickGap: 6 }}
          />
        </ChartCard>
      )}

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
                        <span className="th-swatch">
                          <i style={{ background: c.color }} aria-hidden="true" />
                          {c.label}{sortArrow(c.id)}
                        </span>
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
  const priorLine = { id: "ghost", label: `${year - 1} total`, color: PRIOR, line: true };
  return (
    <>
      {/* Last year's total is a solid gray line: a dashed one reads as a projection. */}
      <ChartCard
        className="chart-band"
        title={`${year} · monthly trend (stacked) with prior-year line`}
        legend={[...SERIES, priorLine]}
        table={chartTable({
          rows: chart,
          x: { key: "name", label: "Month" },
          series: SERIES,
          lines: [priorLine],
          total: true,
          source: (r) => r.source,
        })}
        csv={csvName("Reports monthly", year)}
        height={280}
      >
        <StackedColumns data={chart} xKey="name" series={SERIES} lines={[priorLine]} />
      </ChartCard>

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
                      <CatTh key={c.id} c={c} />
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
      {chart.length === 0 ? (
        <div className="card chart-band">
          <div className="card-body">
            <div className="empty-state">No yearly data</div>
          </div>
        </div>
      ) : (
        <ChartCard
          className="chart-band"
          title="Year totals by category"
          legend={SERIES}
          table={chartTable({
            rows: chart,
            x: { key: "name", label: "Year" },
            series: SERIES,
            total: true,
            source: (r) => r.source,
          })}
          csv={csvName("Reports yearly")}
          height={280}
        >
          <StackedColumns data={chart} xKey="name" series={SERIES} xAxis={{ tick: { ...axisTick, fontSize: 12 } }} />
        </ChartCard>
      )}

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
                      <CatTh key={c.id} c={c} />
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
