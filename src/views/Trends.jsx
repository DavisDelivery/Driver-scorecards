import React from "react";
import { CategoryLeaderboard, LeaderRow } from "./leaderboard.jsx";
import { historyCoverage } from "../data/liveHistoryBlend.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { blendCube, tally, tallyTotal, sourceLabel } from "../data/blend.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { driverDrill } from "../data/drill.js";
import { nameOf } from "../data/people.js";
import { CHARTED6, categoriesFor } from "../data/categories.js";
import { nowET } from "../data/period.js";
import { useHashState } from "../data/hashState.js";
import { csvName } from "../data/csv.js";
import ChartCard from "./kit/ChartCard.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import { chartTable } from "./kit/shape.js";
import { BRAND } from "./kit/chartTheme.js";
import { AnalyticsGate, RosterGate, HistoryRefresh } from "./kit/LoadState.jsx";
import { openDrill } from "./kit/drillNav.js";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// The six charted categories, in the registry's validated stack order and colours.
const CATS = categoriesFor(CHARTED6).map(({ id, title, color }) => ({ id, title, color }));
const CAT_IDS = CATS.map((c) => c.id);
const SERIES = CATS.map((c) => ({ id: c.id, label: c.title, color: c.color }));

const VIEWS = ["overview", "yoy", "leaders", "driver"];

export default function Trends() {
  // Every count here comes from the shared blend (blend.js), the one the Scorecard and
  // Reports count from and every drill-down resolves against.
  const data = useAnalytics();
  const { drivers, history } = data;
  // Sub-tab, year and the Per Driver pick live in the hash (tr.*), so they survive a
  // tab switch and travel with a link.
  const thisYear = nowET().getFullYear();
  const [viewParam, setTab] = useHashState("tr.view", "overview");
  const tab = VIEWS.includes(viewParam) ? viewParam : "overview";
  const [yearParam, setYearParam] = useHashState("tr.y", String(thisYear));
  const year = Number(yearParam) || thisYear;
  const setYear = (y) => setYearParam(String(y));
  const [driverQuery, setDriverQuery] = React.useState("");

  // Blended cube: ym -> Map("driverId|cat" -> count), from the shared blend. A category
  // with live entries in a month is counted from them, every other one from history, on
  // the Scorecard's rule (blend.js).
  const blend = data.blend(null);
  const cube = React.useMemo(
    () => ({ ...blendCube(blend, CAT_IDS), tracked: historyCoverage(history, CAT_IDS) }),
    [blend, history],
  );
  const allMonths = React.useMemo(() => Object.keys(cube.cells).sort(), [cube]);
  const nameFor = (id) => nameOf(data.people, id);

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
      // So is a category history serves but never tracked (2023 holds lost/missing only):
      // its 0 would read as "none happened". In a month that is part live, part history
      // (Jan 2026), that is a category with no live entries the history didn't track.
      if (row.source === "history" || row.source === "mixed") {
        const tracked = cube.tracked(ym);
        for (const c of CATS) if (!blend.isLive(ym, c.id) && !tracked.has(c.id)) row[c.id] = null;
      }
      return row;
    });
  }, [cube, blend, year]);

  // ---- YoY: per-year stacked totals ----
  const yoy = React.useMemo(() => {
    const byYear = {};
    const srcByYear = {};
    const trackedByYear = {};
    for (const [ym, cell] of Object.entries(cube.cells)) {
      const y = ym.slice(0, 4);
      byYear[y] = byYear[y] || Object.fromEntries(CATS.map((c) => [c.id, 0]));
      // A month that is part live, part history is both, for the year's source.
      const src = cube.sourceByYm[ym];
      const sources = (srcByYear[y] = srcByYear[y] || new Set());
      for (const s of src === "mixed" ? ["live", "history"] : [src]) sources.add(s);
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
  // Deactivated drivers leave the rows, never the totals: each card is handed its real
  // totals, everyone included (CLAUDE.md).
  const yearMonths = React.useMemo(() => monthsOfYear(year), [year]);
  const leaderData = React.useMemo(() => {
    const yr = tally(blend, yearMonths, CAT_IDS);
    const ever = tally(blend, allMonths, CAT_IDS);
    const final = {};
    const totals = {};
    for (const c of CATS) {
      const rows = [];
      for (const [id, cats] of ever) {
        if (!cats.has(c.id) || data.hidden.has(id)) continue;
        rows.push({ driverId: id, name: nameOf(data.people, id), month: yr.get(id)?.get(c.id) || 0, ytd: cats.get(c.id) });
      }
      final[c.id] = rows.sort(
        (a, b) => b.month - a.month || b.ytd - a.ytd || String(a.name).localeCompare(String(b.name)),
      );
      totals[c.id] = {
        period: tallyTotal(yr, { categoryIds: [c.id] }),
        ytd: tallyTotal(ever, { categoryIds: [c.id] }),
      };
    }
    return { rows: final, totals, yr, ever };
  }, [blend, yearMonths, allMonths, data.hidden, data.people]);

  // A driver's drawer over the selected year and all time, optionally opened on one
  // category with the two numbers its row showed.
  const openDriver = (id, then = null) =>
    openDrill(
      driverDrill(
        id,
        {
          categoryIds: CAT_IDS,
          scopes: [
            { label: String(year), months: yearMonths, expected: tallyTotal(leaderData.yr, { driverId: id }) },
            { label: "All time", months: allMonths, expected: tallyTotal(leaderData.ever, { driverId: id }) },
          ],
        },
        then,
      ),
    );

  // ---- Per-driver: pick driver → monthly trend + category rows ----
  // Deactivated drivers are not offered here — this picker is for reviewing
  // people currently being managed. Every active driver is listed: it used to stop at
  // 30, so anyone past the 30th name could only be found by searching.
  const filteredDrivers = React.useMemo(() => {
    const q = driverQuery.toLowerCase();
    return drivers
      .filter((d) => d.active !== false)
      .filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [drivers, driverQuery]);

  // The pick comes from the hash, so a link can name anyone. A deactivated driver is
  // treated as no pick, like the picker; an id with no roster row still shows.
  const [driverParam, setPerDriverId] = useHashState("tr.driver", "");
  const perDriverId = drivers.some((d) => d.id === driverParam && d.active === false) ? "" : driverParam;
  const perDriverName = nameFor(perDriverId);
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
        <div className="toolbar-spacer" />
        <HistoryRefresh />
      </div>

      <AnalyticsGate>
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
              source: (r) => sourceLabel(r.source),
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

        {/* Leaderboards hide inactive drivers and the picker lists the active roster:
            both wait for the roster rather than show everyone. */}
        {tab === "leaders" && (
          <RosterGate>
            <div className="chart-grid">
              {CATS.map((c) => (
                <CategoryLeaderboard
                  key={c.id}
                  title={c.title}
                  color={c.color}
                  data={leaderData.rows[c.id] || []}
                  totals={leaderData.totals[c.id]}
                  onSelect={(id) => {
                    const row = leaderData.rows[c.id].find((r) => r.driverId === id);
                    openDriver(id, { category: c.id, x: [row?.month || 0, row?.ytd || 0] });
                  }}
                  periodLabel={String(year)}
                  totalLabel="ALL"
                />
              ))}
            </div>
          </RosterGate>
        )}

        {tab === "driver" && (
          <RosterGate>
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
                  <button className="btn primary" onClick={() => openDriver(perDriverId)}>
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
                      source: (r) => sourceLabel(r.source),
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
                          onSelect={() => openDriver(perDriverId, { category: c.id, x: [c.yr, c.all] })}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
              {!perDriver && <div className="empty-state">Pick a driver to see their trend.</div>}
            </div>
          </RosterGate>
        )}
      </AnalyticsGate>
    </div>
  );
}
