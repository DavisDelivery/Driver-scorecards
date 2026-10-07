import React from "react";
import { getHistory } from "../data/firebase.js";
import DriverModal from "./DriverModal.jsx";
import { CategoryLeaderboard, LeaderRow } from "./leaderboard.jsx";
import { countsTowardCharts, historyCoverage } from "../data/liveHistoryBlend.js";
import { incidentDateStr } from "../data/incidentDate.js";
import { CHARTED6, categoriesFor } from "../data/categories.js";
import { nowET } from "../data/period.js";
import { useHashState } from "../data/hashState.js";
import { csvName } from "../data/csv.js";
import ChartCard from "./kit/ChartCard.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import { chartTable } from "./kit/shape.js";
import { BRAND } from "./kit/chartTheme.js";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// The six charted categories, in the registry's validated stack order and colours.
const CATS = categoriesFor(CHARTED6).map(({ id, title, color }) => ({ id, title, color }));
const CAT_IDS = CATS.map((c) => c.id);
const SERIES = CATS.map((c) => ({ id: c.id, label: c.title, color: c.color }));

// The shared month rule, so Trends files every incident under the same month as the
// Scorecard and the driver detail.
const incidentYm = (inc) => incidentDateStr(inc).slice(0, 7);

const VIEWS = ["overview", "yoy", "leaders", "driver"];

export default function Trends({ drivers, incidents = [] }) {
  const [history, setHistory] = React.useState([]);
  // Sub-tab, year and the Per Driver pick live in the hash (tr.*), so they survive a
  // tab switch and travel with a link.
  const thisYear = nowET().getFullYear();
  const [viewParam, setTab] = useHashState("tr.view", "overview");
  const tab = VIEWS.includes(viewParam) ? viewParam : "overview";
  const [yearParam, setYearParam] = useHashState("tr.y", String(thisYear));
  const year = Number(yearParam) || thisYear;
  const setYear = (y) => setYearParam(String(y));
  const [focusId, setFocusId] = React.useState(null);
  const [driverQuery, setDriverQuery] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    getHistory().then((r) => alive && setHistory(Array.isArray(r) ? r : [])).catch(() => {});
    return () => { alive = false; };
  }, [incidents]);

  // Blended cube: ym -> Map("driverId|cat" -> count). Live months win over
  // history; live respects the "Do not fault driver" toggle.
  const cube = React.useMemo(() => {
    // ONLY incidents that actually count are grouped here, because the presence of a
    // month in this map is what makes live data supersede the rolled-up history for
    // it (see "live supersedes" below). Grouping every incident meant a single row
    // that contributes nothing — a compliment, an unable-to-track entry, a no-fault
    // row — silently replaced that month's entire history with nothing, and the month
    // read as zero.
    const liveByYm = {};
    for (const inc of incidents) {
      const ym = incidentYm(inc);
      if (!ym || ym.length !== 7) continue;
      if (!countsTowardCharts(inc, { categoryIds: CAT_IDS })) continue;
      (liveByYm[ym] = liveByYm[ym] || []).push(inc);
    }
    const cells = {};
    const names = new Map();
    // Which source served each month — shown in the table views, never used to count.
    const sourceByYm = {};
    const ensure = (ym) => (cells[ym] = cells[ym] || new Map());
    for (const [ym, list] of Object.entries(liveByYm)) {
      const cell = ensure(ym);
      sourceByYm[ym] = "live";
      for (const inc of list) {
        // Already filtered by countsTowardCharts() when liveByYm was built.
        const k = `${inc.driver_id}|${inc.category}`;
        cell.set(k, (cell.get(k) || 0) + 1);
        if (!names.has(inc.driver_id)) names.set(inc.driver_id, inc.driver_name || inc.driver_raw || inc.driver_id);
      }
    }
    for (const rec of history) {
      if (!rec.driver_id || !CAT_IDS.includes(rec.category)) continue;
      const ym = `${rec.year}-${String(rec.month).padStart(2, "0")}`;
      if (liveByYm[ym]) continue; // live supersedes
      const cell = ensure(ym);
      sourceByYm[ym] = "history";
      const k = `${rec.driver_id}|${rec.category}`;
      cell.set(k, (cell.get(k) || 0) + (rec.count || 0));
      if (!names.has(rec.driver_id)) names.set(rec.driver_id, rec.driver_name || rec.driver_id);
    }
    for (const d of drivers) names.set(d.id, d.name);
    return { cells, names, sourceByYm, tracked: historyCoverage(history, CAT_IDS) };
  }, [incidents, history, drivers]);

  const years = React.useMemo(() => {
    const ys = new Set(Object.keys(cube.cells).map((ym) => Number(ym.slice(0, 4))));
    ys.add(thisYear);
    return [...ys].sort();
  }, [cube, thisYear]);

  // ---- Overview: monthly stacked totals for the selected year ----
  const monthly = React.useMemo(() => {
    return MONTHS.map((label, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      const row = { month: label, source: cube.sourceByYm[ym] || "none" };
      let total = 0;
      for (const c of CATS) row[c.id] = 0;
      for (const [k, n] of cube.cells[ym] || []) {
        const cat = k.split("|")[1];
        row[cat] = (row[cat] || 0) + n;
        total += n;
      }
      row.total = total;
      // A month neither live nor in history is a gap in the chart and "—" in its table.
      if (row.source === "none") for (const c of CATS) row[c.id] = null;
      // So is a category a history month never tracked (2023 holds lost/missing only):
      // its 0 would read as "none happened".
      if (row.source === "history") {
        const tracked = cube.tracked(ym);
        for (const c of CATS) if (!tracked.has(c.id)) row[c.id] = null;
      }
      return row;
    });
  }, [cube, year]);

  // ---- YoY: per-year stacked totals ----
  const yoy = React.useMemo(() => {
    const byYear = {};
    const srcByYear = {};
    const trackedByYear = {};
    for (const [ym, cell] of Object.entries(cube.cells)) {
      const y = ym.slice(0, 4);
      byYear[y] = byYear[y] || Object.fromEntries(CATS.map((c) => [c.id, 0]));
      (srcByYear[y] = srcByYear[y] || new Set()).add(cube.sourceByYm[ym]);
      const tracked = (trackedByYear[y] = trackedByYear[y] || new Set());
      for (const c of cube.tracked(ym)) tracked.add(c);
      for (const [k, n] of cell) {
        const cat = k.split("|")[1];
        byYear[y][cat] += n;
      }
    }
    return Object.entries(byYear)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([y, cats]) => {
        const sources = [...srcByYear[y]].sort().reverse();
        const row = { year: y, ...cats, source: sources.join(" + ") };
        // A history-only year shows "—" for what none of its months tracked.
        if (sources.length === 1 && sources[0] === "history") {
          for (const c of CATS) if (!trackedByYear[y].has(c.id)) row[c.id] = null;
        }
        return row;
      });
  }, [cube]);

  // ---- Leaderboards: per-category, selected year vs all-time ----
  const leaderData = React.useMemo(() => {
    const out = {};
    for (const c of CATS) out[c.id] = new Map();
    for (const [ym, cell] of Object.entries(cube.cells)) {
      const inYear = ym.startsWith(String(year));
      for (const [k, n] of cell) {
        const [did, cat] = k.split("|");
        if (!out[cat]) continue;
        const rec = out[cat].get(did) || { driverId: did, name: cube.names.get(did) || did, month: 0, ytd: 0 };
        rec.ytd += n;            // all-time (faded)
        if (inYear) rec.month += n; // selected year (solid)
        out[cat].set(did, rec);
      }
    }
    const final = {};
    for (const c of CATS) {
      final[c.id] = [...out[c.id].values()].sort((a, b) => b.month - a.month || b.ytd - a.ytd);
    }
    return final;
  }, [cube, year]);

  // ---- Per-driver: pick driver → monthly trend + category rows ----
  // Deactivated drivers are not offered here — this picker is for reviewing
  // people currently being managed.
  const filteredDrivers = React.useMemo(() => {
    const q = driverQuery.toLowerCase();
    return drivers
      .filter((d) => d.active !== false)
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [drivers, driverQuery]);

  // The pick comes from the hash, so a link can name anyone. A deactivated driver is
  // treated as no pick, like the picker; an id with no roster row still shows.
  const [driverParam, setPerDriverId] = useHashState("tr.driver", "");
  const perDriverId = drivers.some((d) => d.id === driverParam && d.active === false) ? "" : driverParam;
  const perDriverName = cube.names.get(perDriverId) || perDriverId;
  const perDriver = React.useMemo(() => {
    if (!perDriverId) return null;
    const byMonth = MONTHS.map((label, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      let n = 0;
      for (const [k, v] of cube.cells[ym] || []) {
        if (k.startsWith(`${perDriverId}|`)) n += v;
      }
      const source = cube.sourceByYm[ym] || "none";
      return { month: label, count: source === "none" ? null : n, source };
    });
    const cats = CATS.map((c) => {
      let yr = 0, all = 0;
      for (const [ym, cell] of Object.entries(cube.cells)) {
        const n = cell.get(`${perDriverId}|${c.id}`) || 0;
        all += n;
        if (ym.startsWith(String(year))) yr += n;
      }
      return { ...c, yr, all };
    });
    return { byMonth, cats };
  }, [cube, perDriverId, year]);

  const TABS = [
    ["overview", "Overview"],
    ["yoy", "Year over Year"],
    ["leaders", "Leaderboards"],
    ["driver", "Per Driver"],
  ];

  return (
    <div>
      <div className="page-title">Performance Trends</div>
      <h1 className="page-heading">
        Trends <span className="meta">· live + 3-yr history blend</span>
      </h1>

      <div className="toolbar">
        <div className="month-picker">
          {TABS.map(([id, label]) => (
            <button key={id} className={`month-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="month-picker">
          {years.map((y) => (
            <button key={y} className={`month-btn ${year === y ? "active" : ""}`} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <ChartCard
          title={`Monthly Incidents · ${year}`}
          count={`${monthly.reduce((a, r) => a + r.total, 0)} total`}
          legend={SERIES}
          table={chartTable({
            rows: monthly,
            x: { key: "month", label: "Month" },
            series: SERIES,
            total: true,
            source: (r) => r.source,
          })}
          csv={csvName("Trends monthly", year)}
          height={300}
        >
          <StackedColumns data={monthly} xKey="month" series={SERIES} />
        </ChartCard>
      )}

      {tab === "yoy" && (
        <ChartCard
          title="Year over Year"
          count={`${yoy.length} years`}
          legend={SERIES}
          table={chartTable({
            rows: yoy,
            x: { key: "year", label: "Year" },
            series: SERIES,
            total: true,
            source: (r) => r.source,
          })}
          csv={csvName("Trends year over year")}
          height={300}
        >
          <StackedColumns data={yoy} xKey="year" series={SERIES} />
        </ChartCard>
      )}

      {tab === "leaders" && (
        <div className="chart-grid">
          {CATS.map((c) => (
            <CategoryLeaderboard
              key={c.id}
              title={c.title}
              color={c.color}
              data={leaderData[c.id] || []}
              onSelect={setFocusId}
              periodLabel={String(year)}
              totalLabel="ALL"
            />
          ))}
        </div>
      )}

      {tab === "driver" && (
        <div>
          <div className="toolbar">
            <input
              type="text"
              placeholder="Search driver…"
              value={driverQuery}
              onChange={(e) => setDriverQuery(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <select value={perDriverId} onChange={(e) => setPerDriverId(e.target.value)}>
              <option value="">— Select driver —</option>
              {/* A linked pick the search doesn't list (history only, or filtered out) */}
              {perDriverId && !filteredDrivers.some((d) => d.id === perDriverId) && (
                <option value={perDriverId}>{perDriverName}</option>
              )}
              {filteredDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {perDriverId && (
              <button className="btn primary" onClick={() => setFocusId(perDriverId)}>
                View Incidents
              </button>
            )}
          </div>
          {perDriver && (
            <>
              <ChartCard
                className="chart-band"
                title={`${perDriverName} · Monthly · ${year}`}
                count={`${perDriver.byMonth.reduce((a, r) => a + r.count, 0)} in ${year}`}
                table={chartTable({
                  rows: perDriver.byMonth,
                  x: { key: "month", label: "Month" },
                  series: [{ id: "count", label: "Incidents" }],
                  source: (r) => r.source,
                })}
                csv={csvName(perDriverName, "monthly", year)}
                height={220}
              >
                <EmphasisBars data={perDriver.byMonth} xKey="month" valueName="Incidents" color={BRAND} />
              </ChartCard>
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Category Breakdown</div>
                  <div className="cc-count">
                    <span className="cc-key"><i style={{ background: "#234294" }} /> {year}</span>
                    <span className="cc-key"><i className="cc-key-ytd" style={{ background: "#234294" }} /> ALL</span>
                  </div>
                </div>
                <div className="lb-body">
                  {perDriver.cats.map((c, i) => (
                    <LeaderRow
                      key={c.id}
                      rank={i + 1}
                      row={{ driverId: perDriverId, name: c.title, month: c.yr, ytd: c.all }}
                      color={c.color}
                      max={Math.max(1, ...perDriver.cats.map((x) => x.all))}
                      onSelect={() => setFocusId(perDriverId)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
          {!perDriver && <div className="empty-state">Pick a driver to see their trend.</div>}
        </div>
      )}

      {focusId && (
        <DriverModal
          driver={drivers.find((d) => d.id === focusId) || { id: focusId, name: cube.names.get(focusId) || focusId, role: "driver" }}
          incidents={incidents.filter((i) => i.driver_id === focusId)}
          // Without the history, anyone whose numbers here come from rolled-up
          // months opened to "No detailed incidents on file".
          history={history.filter((r) => r.driver_id === focusId)}
          onClose={() => setFocusId(null)}
        />
      )}
    </div>
  );
}
