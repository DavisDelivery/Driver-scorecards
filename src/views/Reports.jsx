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
import { OTHER_COLOR, categoriesFor, catLabel } from "../data/categories.js";
import { yearCapture, yearCompared } from "../data/companyMetrics.js";
import useCoverage from "./company/useCoverage.js";
import { historyCoverage } from "../data/liveHistoryBlend.js";
import { SOURCE_FROM, fmtYm, exclusionText } from "../data/coverage.js";
import { sourceLabel } from "../data/blend.js";
import { reportSpanLabel, reportWeekOf, reportWeekName, reportWeekTick } from "../reports/reportNaming.js";
import { useHashState } from "../data/hashState.js";
import { csvName } from "../data/csv.js";
import ReportDetail from "./ReportDetail.jsx";
import { AnalyticsGate, LoadError } from "./kit/LoadState.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import BarList from "./kit/charts/BarList.jsx";
import CardMenu from "./kit/CardMenu.jsx";
import { chartTable, peakSummary, toDate, rowTotal } from "./kit/shape.js";
import { BRAND, PRIOR } from "./kit/chartTheme.js";
import { currentYmET, nowET, toYMD, shiftYm } from "../data/period.js";

// The six stacked categories, bottom first, in the registry's order and colours. Every
// total on this page holds all six, Attempts (logged) included, as it always has.
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

// Signed delta vs a prior period. Down (fewer incidents) is good → green. Beside a
// period still in progress the number stays, but uncoloured and marked "to date": part
// of a month set against a whole one isn't an improvement.
// A change that isn't like-for-like (`notCompared`: the two years weren't captured the
// same way) keeps its raw number but is never a coloured arrow — the year chart above
// says those years hold different things.
function Delta({ value, toDate = false, notCompared = null, title = undefined }) {
  if (value === null || value === undefined) return <span className="delta flat" title={title}>—</span>;
  const text = value === 0 ? "±0" : `${value > 0 ? "▲" : "▼"} ${Math.abs(value)}`;
  if (toDate) {
    return (
      <span className="delta flat" title={title || "Still in progress: part of this period set against the whole one before it"}>
        {text} · to date
      </span>
    );
  }
  if (notCompared) {
    return (
      <span className="delta flat" title={notCompared}>
        {text} · not compared
      </span>
    );
  }
  if (value === 0) return <span className="delta flat" title={title}>±0</span>;
  return (
    <span className={`delta ${value > 0 ? "up" : "down"}`} title={title}>
      {text}
    </span>
  );
}

// A count in a table cell: the number, a counted zero as "0" in ink 2, and "—" where
// the category wasn't tracked — one placeholder each, never a lone "·".
function Count({ v, strong = false }) {
  if (v === null || v === undefined) return <span className="cell-none" title="Not tracked">—</span>;
  if (v === 0) return <span className="cell-zero">0</span>;
  return strong ? <strong>{v}</strong> : v;
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
    // Each report's change on the one before it (chronological order).
    const totals = rows.map((r) => r.count);
    rows.forEach((r, i) => {
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
    // Each column is named by its report's week (the Monday the table's "Week of"
    // names), so the ticks fall on a weekly grid and match the table below.
    return inYear.slice(-12).map((r) => ({
      name: reportSpanLabel(r.report),
      week: reportWeekOf(r.report),
      start: reportWeekTick(r.report),
      __head: `${reportWeekName(r.report)} · ${reportSpanLabel(r.report)}`,
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
  // The table's months and their change on the month before; the month in progress is
  // marked "to date" beside its change (display only).
  const monthlyRows = useMemo(() => {
    const rows = monthly.filter((m) => m.total > 0 || m.source !== "none");
    const nowYm = currentYmET();
    return rows.map((m) => {
      const realIdx = m.month - 1;
      const prior = realIdx > 0 ? monthly[realIdx - 1].total : null;
      return { ...m, toDate: ymOf(selectedYear, m.month) === nowYm, delta: prior === null ? null : m.total - prior };
    });
  }, [monthly, selectedYear]);

  // Which categories each history month tracked: an untracked one reads "—", not 0.
  const tracked = useMemo(() => historyCoverage(history, ANALYTICS_CATEGORY_IDS), [history]);
  // What each (month, category) cell covers (coverage.js), read once for the table's
  // "—", the chart, and the years' notes.
  const today = toYMD(nowET());
  const { cov } = useCoverage(today);
  // A month's cell that holds no count reads "—", never 0: a month with no data at all,
  // or a category the history serving it never tracked (and no live entry fills) — the
  // cells the chart's table has always left empty. A live month's counted 0 stays 0, even
  // before coverage says the category was captured (Attempts in Apr–May 2026): the hover
  // and the note say so, the number doesn't change (CLAUDE.md).
  const untracked = (ym, source, cat) =>
    source === "none" ||
    ((source === "history" || source === "mixed") && !tracked(ym).has(cat) && !blend.isLive(ym, cat));

  const monthlyChart = useMemo(() => {
    // A month with no data at all (no live rows, no history) is a gap in the chart and
    // "—" in its table, never a column or a line point at 0.
    return monthly.map((m) => {
      const prior = prevMonthly[m.month - 1];
      const ghost = !prior || prior.source === "none" ? null : prior.total;
      const ym0 = ymOf(selectedYear, m.month);
      const now = currentYmET();
      const row = {
        name: m.monthName,
        key: ym0,
        ghost,
        source: m.source,
        // Display only: a month still to come draws nothing; the month in progress is
        // faded and its hover says "to date".
        __future: ym0 > now,
        __partial: ym0 === now,
        __toDate: ym0 === now ? toDate({ key: ym0, start: `${ym0}-01`, end: `${ym0}-31` }, toYMD(nowET())) : null,
      };
      // A category history serves but never tracked reads "—": in a month that is part
      // live, part history (Jan 2026), one with no live entries the history didn't track.
      const ym = ymOf(selectedYear, m.month);
      const has = m.source === "history" || m.source === "mixed" ? tracked(ym) : null;
      const unc = [];
      for (const c of ANALYTICS_CATEGORIES) {
        const untracked = has && !has.has(c.id) && !blend.isLive(ym, c.id);
        row[c.id] = m.source === "none" || untracked ? null : m.byCat[c.id] || 0;
        // A counted 0 coverage says wasn't captured keeps its 0 (table, CSV, hover); the
        // hover adds why (display only).
        if (!row.__future && row[c.id] === 0 && cov.cell(ym, c.id).value === null) unc.push(c.label);
      }
      if (unc.length) row.__notes = [`Not captured: ${unc.join(", ")}`];
      return row;
    });
  }, [monthly, prevMonthly, tracked, blend, selectedYear, cov]);

  const yearly = useMemo(() => buildYearlyTotals(years, blend), [years, blend]);
  // Each year's change on the one before; the year in progress is marked "to date"
  // beside its change (display only).
  const thisYear = nowET().getFullYear();
  // A year captured differently from the one before (likeForLike, coverage.js) keeps its
  // raw change but says "not compared", with what differed in its title.
  const yearlyRows = useMemo(() => {
    return yearly.map((y, i) => {
      const cmp = i > 0 && y.year !== thisYear ? yearCompared(cov, y.year, ANALYTICS_CATEGORY_IDS) : null;
      return {
        ...y,
        toDate: y.year === thisYear,
        delta: i > 0 ? y.total - yearly[i - 1].total : null,
        notCompared:
          cmp && !cmp.compared
            ? `Not like-for-like: ${y.year} and ${y.year - 1} weren't captured the same way (${cmp.left
                .slice(0, 3)
                .map((e) => exclusionText(e))
                .join("; ")}${cmp.left.length > 3 ? `; ${cmp.left.length - 3} more` : ""}). Company History › Compare sets them side by side like-for-like.`
            : null,
      };
    });
  }, [yearly, thisYear, cov]);
  // Under each year's row in the chart: the categories it never tracked, and those it
  // held for part of the year only, so a short bar is never read as a quiet year.
  const lastYm = shiftYm(currentYmET(), -1);
  const yearNote = (year) => {
    const cap = yearCapture(cov, Number(year), ANALYTICS_CATEGORY_IDS, { lastYm });
    const parts = [];
    if (cap.none.length) parts.push(`Not tracked: ${cap.none.map(catLabel).join(", ")}`);
    if (cap.part.length) parts.push(`part of the year only: ${cap.part.map(catLabel).join(", ")}`);
    const line = parts.join(" · ");
    return line ? line.charAt(0).toUpperCase() + line.slice(1) : null;
  };
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
      <div className="page-title">Reports &amp; analytics</div>
      <h1 className="page-heading">
        Reports
        <span className="meta"><span className="meta-sep">· </span>{reports.length} weekly reports</span>
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
              {g.charAt(0).toUpperCase() + g.slice(1)}
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
          + New weekly report
        </button>
      </div>

      {noData ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              No reports yet. Click <strong>+ New weekly report</strong> to create one,
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
              untracked={untracked}
            />
          ) : (
            <YearlyView
              rows={yearlyRows}
              chart={yearlyChart}
              expandedKey={expandedKey}
              setExpandedKey={setExpandedKey}
              monthlyForYear={(y) => buildMonthlyTotals(y, blend).filter((m) => m.total > 0)}
              yearNote={yearNote}
              untracked={untracked}
              thisYear={thisYear}
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
  // The axis names each column by its report's week ("Sep 14", the Monday the table's
  // "Week of" names); the ticks the width can't hold are thinned (kit/shape.js), never
  // overlapped. Driver fault is a different measure from the stack, so it has a chart of
  // its own under it.
  const weekTotal = chart.reduce((a, r) => a + WEEK_SERIES.reduce((b, c) => b + (r[c.id] || 0), 0), 0);
  // The legend names only what the columns draw: a category with nothing in these weeks
  // has no segment, so it has no key either. The table view keeps every column.
  const weekSeries = WEEK_SERIES.filter((c) => chart.some((r) => (r[c.id] || 0) > 0));
  const tick = (r) => r.start || r.name;
  return (
    <>
      {chart.length === 0 ? (
        <div className="card chart-band">
          <div className="card-body">
            <div className="empty-state">No weeks in this period</div>
          </div>
        </div>
      ) : (
        <>
          <ChartCard
            className="chart-band"
            title="Incidents per week"
            subtitle={`${weekTotal.toLocaleString()} across the last ${chart.length} report${chart.length === 1 ? "" : "s"}, by category`}
            legend={weekSeries}
            table={chartTable({
              rows: chart,
              x: { key: "name", label: "Week" },
              series: WEEK_SERIES,
              lines: [WEEK_FAULT_LINE],
              total: true,
              source: "weekly report",
            })}
            csv={csvName("Reports weekly")}
            height={320}
          >
            <StackedColumns data={chart} xKey="name" tickLabel={tick} series={weekSeries} />
          </ChartCard>
          <ChartCard
            className="chart-band"
            title="Driver fault per week"
            subtitle={`${chart.reduce((a, r) => a + (r.fault || 0), 0).toLocaleString()} incidents set to the driver's fault`}
            table={chartTable({
              rows: chart,
              x: { key: "name", label: "Week" },
              series: [{ id: "fault", label: "Driver fault" }],
              source: "weekly report",
            })}
            csv={csvName("Reports weekly driver fault")}
            height={180}
          >
            <EmphasisBars data={chart} xKey="name" tickLabel={tick} valueKey="fault" valueName="Driver fault" color={BRAND} keyOf={(r) => r.name} />
          </ChartCard>
        </>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">No reports match this period</div>
      ) : (
        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              {/* One row per report: its week with its dates under it, the counts, its
                  change on the report before, and Delete behind the row's ⋯ (never a red
                  × on every row). On a phone each row is a card (.cards-on-phone). */}
              <table className="data analytics-table rp-table cards-on-phone">
                <thead>
                  <tr>
                    <th onClick={() => onSort("date")} className="sortable">Report{sortArrow("date")}</th>
                    <th onClick={() => onSort("incidents")} className="sortable num">Incidents{sortArrow("incidents")}</th>
                    <th className="num" title="Incidents against the report before it">vs previous</th>
                    <th onClick={() => onSort("driverFault")} className="sortable num">Driver fault{sortArrow("driverFault")}</th>
                    <th onClick={() => onSort("withPhotos")} className="sortable num">Photos{sortArrow("withPhotos")}</th>
                    {WEEK_COLS.map((c) => (
                      <th key={c.id} onClick={() => onSort(c.id)} className="sortable num">
                        <span className="th-swatch">
                          <i style={{ background: c.color }} aria-hidden="true" />
                          {c.label}{sortArrow(c.id)}
                        </span>
                      </th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.report.id}
                      className={`clickable ${i === kbIndex ? "kb-active" : ""}`}
                      onClick={() => onOpen(r.report.id)}
                    >
                      <td className="card-primary rp-name" title={r.report.name || undefined}>
                        <span className="rp-name-text">{reportWeekName(r.report)}</span>
                        <span className="rp-span">{reportSpanLabel(r.report)}</span>
                      </td>
                      <td className="num" data-label="Incidents"><Count v={r.count} /></td>
                      <td className="num" data-label="vs previous"><Delta value={r.delta} /></td>
                      <td className="num" data-label="Driver fault"><Count v={r.driverFault || 0} /></td>
                      <td className="num" data-label="Photos"><Count v={r.withPhotos || 0} /></td>
                      {WEEK_COLS.map((c) => (
                        <td key={c.id} className="num" data-label={c.label}><Count v={r.byCat[c.id] || 0} /></td>
                      ))}
                      <td className="row-menu-cell" onClick={(e) => e.stopPropagation()}>
                        <CardMenu
                          label={`Actions for ${r.report.name || "this report"}`}
                          className="row-menu"
                          fixed
                          items={[
                            { id: "open", label: "Open report", icon: "file-text", onSelect: () => onOpen(r.report.id) },
                            {
                              id: "delete",
                              label: "Delete report",
                              icon: "trash-2",
                              danger: true,
                              title: "Delete the report and its incidents",
                              onSelect: () => onDelete({ stopPropagation() {} }, r.report),
                            },
                          ]}
                        />
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
function MonthlyView({ year, rows, chart, expandedKey, setExpandedKey, reportsInMonth, onOpen, untracked }) {
  // Whether the columns carry their numbers at the width they're drawn (StackedColumns'
  // label plan): the subtitle names the peak only when they don't.
  const [plan, setPlan] = useState("none");
  const priorLine = { id: "ghost", label: `${year - 1} total`, color: PRIOR, line: true };
  const keys = SERIES.map((c) => c.id);
  const partial = chart.find((r) => r.__partial && r.__toDate && (rowTotal(r, keys) || 0) > 0);
  // Last year's months with nothing on file draw no tick; the note names them.
  const priorGaps = chart.filter((r) => r.ghost === null).map((r) => ymOf(year - 1, Number(r.key.slice(5, 7))));
  const anyPrior = priorGaps.length < chart.length;
  const notes = [];
  if (partial) notes.push(`Faded: ${partial.name} is to date (${partial.__toDate.days} of ${partial.__toDate.of} days)`);
  if (anyPrior && priorGaps.length) {
    const names = priorGaps.map((ym) => fmtYm(ym).slice(0, 3));
    const list = names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    notes.push(`${year - 1}: ${list} not on file`);
  }
  // Attempts (logged) began with the entry tabs: a month before that holds none.
  if (`${year}-01` < SOURCE_FROM.manual) notes.push(`Attempts (logged) begin ${fmtYm(SOURCE_FROM.manual)}; earlier months hold none`);
  return (
    <>
      {/* Last year's total is a 2px gray tick across each month's column, a little
          wider than it (a bullet chart's target), on the same axis — not a line through
          the bars (it sliced the segments and broke mid-bar where a month was missing).
          The columns stay centred on their months; a month with no column (still to
          come) gets no tick, and its last-year total stays in the hover and the table.
          Each column keeps its number over its own cap, lifted only past a tick that
          would cross it. */}
      <ChartCard
        className="chart-band"
        title={`Incidents by month · ${year}`}
        subtitle={[
          `${rows.reduce((a, m) => a + m.total, 0).toLocaleString()} total`,
          plan !== "all" && peakSummary(chart, { grain: "month", value: (r) => rowTotal(r, keys), partial: (r) => r.__partial }),
        ]
          .filter(Boolean)
          .join(" · ")}
        legend={anyPrior ? [...SERIES, priorLine] : SERIES}
        table={chartTable({
          rows: chart,
          x: { key: "name", label: "Month" },
          series: SERIES,
          lines: [priorLine],
          total: true,
          source: (r) => sourceLabel(r.source),
        })}
        csv={csvName("Reports monthly", year)}
        height={320}
        note={notes.length ? notes.join(" · ") : null}
      >
        <StackedColumns data={chart} xKey="key" grain="month" series={SERIES} marks={anyPrior ? [priorLine] : []} onLabelPlan={setPlan} />
      </ChartCard>

      {rows.length === 0 ? (
        <div className="empty-state">No data for {year}</div>
      ) : (
        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              {/* On a phone each month is a card (.cards-on-phone): nothing runs off the
                  screen. */}
              <table className="data analytics-table rp-table cards-on-phone">
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
                    const ym = ymOf(year, m.month);
                    return (
                      <FragmentRow key={key}>
                        <tr className="clickable" onClick={() => setExpandedKey(open ? null : key)}>
                          <td className="nowrap card-primary">
                            <span className="row-caret">{open ? "▾" : "▸"}</span>
                            {m.monthName} {year}
                          </td>
                          <td className="num" data-label="Total"><Count v={m.total} strong /></td>
                          <td className="num" data-label="vs prior"><Delta value={m.delta} toDate={m.toDate} /></td>
                          {ANALYTICS_CATEGORIES.map((c) => (
                            <td key={c.id} className="num" data-label={c.label}>
                              <Count v={untracked(ym, m.source, c.id) ? null : m.byCat[c.id] || 0} />
                            </td>
                          ))}
                          <td className="src-text" data-label="Source">{sourceLabel(m.source)}</td>
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
                                      <span className="mini-week-name">{reportWeekName(w.report)}</span>
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
function YearlyView({ rows, chart, expandedKey, setExpandedKey, monthlyForYear, yearNote, untracked, thisYear }) {
  const keys = SERIES.map((c) => c.id);
  const chartOf = new Map(chart.map((r) => [r.name, r]));
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
          subtitle={`${chart.length} years${chart.some((r) => Number(r.name) === thisYear) ? ` · ${thisYear} is to date` : ""}`}
          legend={SERIES}
          table={chartTable({
            rows: chart,
            x: { key: "name", label: "Year" },
            series: SERIES,
            total: true,
            source: (r) => r.source,
          })}
          csv={csvName("Reports yearly")}
          height="auto"
        >
          {/* One row per year, stacked by category, its total at the end; under it what
              the year never tracked — a short bar is never read as a quiet year. */}
          <BarList
            rows={chart.map((r) => ({ ...r, key: r.name, total: rowTotal(r, keys) || 0 }))}
            order="given"
            value={(r) => r.total}
            label={(r) => (Number(r.name) === thisYear ? `${r.name} to date` : r.name)}
            series={SERIES}
            faded={(r) => Number(r.name) === thisYear}
            size="lg"
            limit={0}
            note={(r) => yearNote(r.name)}
            rowTitle={(r) =>
              [`${r.name}: ${r.total} total`, ...SERIES.map((c) => `${c.label} ${r[c.id] === null ? "—" : r[c.id]}`)].join("\n")
            }
            ariaLabel="Year totals by category"
          />
        </ChartCard>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">No yearly data</div>
      ) : (
        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              <table className="data analytics-table rp-table cards-on-phone">
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
                    const cr = chartOf.get(String(y.year));
                    return (
                      <FragmentRow key={key}>
                        <tr className="clickable" onClick={() => setExpandedKey(open ? null : key)}>
                          <td className="nowrap card-primary">
                            <span className="row-caret">{open ? "▾" : "▸"}</span>
                            {y.year}
                          </td>
                          <td className="num" data-label="Total"><Count v={y.total} strong /></td>
                          <td className="num" data-label="YoY"><Delta value={y.delta} toDate={y.toDate} notCompared={y.notCompared} /></td>
                          {ANALYTICS_CATEGORIES.map((c) => (
                            <td key={c.id} className="num" data-label={c.label}>
                              <Count v={cr && cr[c.id] === null ? null : y.byCat[c.id] || 0} />
                            </td>
                          ))}
                        </tr>
                        {open && (
                          <tr className="expander-row">
                            <td colSpan={3 + ANALYTICS_CATEGORIES.length}>
                              {months.length === 0 ? (
                                <div className="drawer-muted" style={{ padding: 8 }}>No monthly data.</div>
                              ) : (
                                <div className="table-wrap">
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
                                            <td key={c.id} className="num">
                                              <Count v={untracked(ymOf(y.year, m.month), m.source, c.id) ? null : m.byCat[c.id] || 0} />
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
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

// Tiny helper to group a row + its expander without an extra DOM node.
function FragmentRow({ children }) {
  return <>{children}</>;
}
