import React from "react";
import { CategoryLeaderboard } from "./leaderboard.jsx";
import { DriverFocus } from "./ManualEntryAnalytics.jsx";
import { historyCoverage } from "../data/liveHistoryBlend.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { blendCube, tally, tallyTotal, sourceLabel } from "../data/blend.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { driverDrill } from "../data/drill.js";
import { nameOf } from "../data/people.js";
import { CHARTED6, categoriesFor, catLabel, catTitle } from "../data/categories.js";
import { nowET, shiftYm, currentYmET, toYMD } from "../data/period.js";
import { yearCapture } from "../data/companyMetrics.js";
import { SOURCE_FROM, fmtYm } from "../data/coverage.js";
import useCoverage from "./company/useCoverage.js";
import { useHashState, writeHash } from "../data/hashState.js";
import { csvName } from "../data/csv.js";
import ChartCard from "./kit/ChartCard.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import BarList from "./kit/charts/BarList.jsx";
import { chartTable, peakSummary, toDate, rowTotal } from "./kit/shape.js";
import { BRAND } from "./kit/chartTheme.js";
import { AnalyticsGate, RosterGate, HistoryRefresh } from "./kit/LoadState.jsx";
import { openDrill } from "./kit/drillNav.js";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// The six charted categories, in the registry's validated stack order and colours. The
// stack and every total here hold all six, Attempts (logged) included, as they always
// have; Company History is where failures are counted alone.
const CATS = categoriesFor(CHARTED6).map(({ id, label, color }) => ({ id, label, color }));
const CAT_IDS = CATS.map((c) => c.id);
const SERIES = CATS.map((c) => ({ id: c.id, label: c.label, color: c.color }));
// The exports keep the headers they always had ("Damages", "Lost / Missing"), so a sheet
// that reads these files by column name still matches; the screen uses the short label.
const TABLE_SERIES = SERIES.map((s) => ({ ...s, csvLabel: catTitle(s.id) }));
// The first month Attempts were logged (the entry tabs began then): before it a month's
// Attempts count is 0 because nothing was logged, which the chart's note says.
const ATTEMPTS_FROM = SOURCE_FROM.manual;

const VIEWS = ["overview", "yoy", "leaders", "driver"];

// What a month's column is on the chart, beside its numbers (display only): a month still
// to come draws nothing, the month in progress is faded and says "to date".
function monthSlot(ym) {
  const now = currentYmET();
  const end = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  return {
    key: ym,
    __future: ym > now,
    __partial: ym === now,
    __toDate: ym === now ? toDate({ key: ym, start: `${ym}-01`, end: `${ym}-${String(end).padStart(2, "0")}` }, toYMD(nowET())) : null,
  };
}

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
  // Whether the monthly columns carry their numbers at the width they're drawn
  // (StackedColumns' label plan): the subtitle names the peak only when they don't.
  const [monthlyPlan, setMonthlyPlan] = React.useState("none");

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

  // What each (month, category) cell covers (coverage.js): the monthly table's "—" and
  // the years' notes.
  const today = toYMD(nowET());
  const { cov } = useCoverage(today);

  // ---- Overview: monthly stacked totals for the selected year ----
  const monthly = React.useMemo(() => {
    return MONTHS.map((label, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      const row = { month: label, ...monthSlot(ym), source: cube.sourceByYm[ym] || "none" };
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
      // A live month before a category was captured (Attempts in Apr–May 2026, the entry
      // tabs from Jun 2026) keeps its counted 0 in the table, the CSV and the hover, as it
      // always has; the hover only adds that coverage says it wasn't captured (display
      // only — see "A visual change never redefines a number", CLAUDE.md).
      if (!row.__future) {
        const unc = CATS.filter((c) => row[c.id] === 0 && cov.cell(ym, c.id).value === null);
        if (unc.length) row.__notes = [`Not captured: ${unc.map((c) => c.label).join(", ")}`];
      }
      return row;
    });
  }, [cube, blend, year, cov]);

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

  // ---- YoY: what each year's total holds ----
  // Under each year's row, the categories it never tracked and those it held for part
  // of the year only, so a short bar is never read as a quiet year. Display only: the
  // totals and the table are the stack's own.
  const lastYm = shiftYm(currentYmET(), -1);
  const yearNote = (y) => {
    const cap = yearCapture(cov, Number(y), CAT_IDS, { lastYm });
    const parts = [];
    if (cap.none.length) parts.push(`Not tracked: ${cap.none.map(catLabel).join(", ")}`);
    if (cap.part.length) parts.push(`part of the year only: ${cap.part.map(catLabel).join(", ")}`);
    const line = parts.join(" · ");
    return line ? line.charAt(0).toUpperCase() + line.slice(1) : null;
  };

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
  // people currently being managed. Every active driver is listed, in one search box
  // (the manual-entry tabs' picker); two drivers with one name are told apart.
  const driverOptions = React.useMemo(() => {
    const active = drivers.filter((d) => d.active !== false);
    const seen = new Map();
    for (const d of active) seen.set(d.name.toLowerCase(), (seen.get(d.name.toLowerCase()) || 0) + 1);
    return active.map((d) => ({
      key: d.id,
      name: d.name,
      label: seen.get(d.name.toLowerCase()) > 1 ? `${d.name} (${d.id})` : d.name,
      hint: d.role && d.role !== "driver" ? d.role : "",
    }));
  }, [drivers]);

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
      return { month: label, ...monthSlot(ym), count: source === "none" ? null : n, source };
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

  // Company History with its Range set to the year picked here: the whole year, or this
  // year through the last complete month.
  const openCompany = () => {
    const last = shiftYm(currentYmET(), -1);
    const to = year < thisYear ? `${year}-12` : last >= `${year}-01` ? last : `${year}-01`;
    writeHash(
      { tab: "company", drill: null, "co.sub": null, "co.r": "custom", "co.from": `${year}-01`, "co.to": to },
      { push: true },
    );
  };

  const TABS = [
    ["overview", "Overview"],
    ["yoy", "Year over year"],
    ["leaders", "Leaderboards"],
    ["driver", "Per driver"],
  ];

  return (
    <div>
      <div className="page-title">Performance trends</div>
      <h1 className="page-heading">
        Trends <span className="meta"><span className="meta-sep">· </span>live + 3-yr history blend</span>
      </h1>

      {/* Company History carries this tab's Overview and Year over Year forward, with
          what each month covers; the link opens it on the year picked here. */}
      <div className="card co-link-card">
        <div className="card-body">
          <span>
            Company trends with coverage — what every month on file actually captured, and like-for-like
            comparisons — now live in <b>Company History</b>. It counts failures only; the totals here include
            Attempts (logged).
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={openCompany}
          >
            Open {year} in Company History →
          </button>
        </div>
      </div>

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
            className="chart-band"
            title={`Monthly incidents · ${year}`}
            subtitle={[
              `${monthly.reduce((a, r) => a + r.total, 0).toLocaleString()} total`,
              // With a number on every column the plot already says where the peak is.
              monthlyPlan !== "all" &&
                peakSummary(monthly, { grain: "month", value: (r) => rowTotal(r, CAT_IDS), partial: (r) => r.__partial }),
            ]
              .filter(Boolean)
              .join(" · ")}
            legend={SERIES}
            table={chartTable({
              rows: monthly,
              x: { key: "month", label: "Month" },
              series: TABLE_SERIES,
              total: true,
              source: (r) => sourceLabel(r.source),
            })}
            csv={csvName("Trends monthly", year)}
            height={320}
            note={(() => {
              const parts = [];
              const p = monthly.find((r) => r.__partial && r.total > 0);
              if (p && p.__toDate) parts.push(`Faded: ${p.month} to date (${p.__toDate.days} of ${p.__toDate.of} days)`);
              // Attempts (logged) began with the entry tabs: a month before that holds none.
              if (`${year}-01` < ATTEMPTS_FROM) parts.push(`Attempts logged from ${fmtYm(ATTEMPTS_FROM)}`);
              return parts.length ? parts.join(" · ") : null;
            })()}
          >
            <StackedColumns data={monthly} xKey="key" grain="month" series={SERIES} onLabelPlan={setMonthlyPlan} />
          </ChartCard>
        )}

        {tab === "yoy" && (
          <ChartCard
            title="Year over year"
            subtitle={`${yoy.length} years · ${thisYear} is to date`}
            legend={SERIES}
            table={chartTable({
              rows: yoy,
              x: { key: "year", label: "Year" },
              series: TABLE_SERIES,
              total: true,
              source: (r) => r.source,
            })}
            csv={csvName("Trends year over year")}
            height="auto"
          >
            {/* One row per year, stacked by category, the total at the end; the year in
                progress is faded and named so. Under each row: what its total leaves
                out. */}
            <BarList
              rows={yoy.map((r) => ({ ...r, key: r.year, total: rowTotal(r, CAT_IDS) || 0 }))}
              order="given"
              value={(r) => r.total}
              label={(r) => (Number(r.year) === thisYear ? `${r.year} to date` : r.year)}
              series={SERIES}
              faded={(r) => Number(r.year) === thisYear}
              size="lg"
              limit={0}
              note={(r) => yearNote(r.year)}
              rowTitle={(r) =>
                [
                  `${r.year}${Number(r.year) === thisYear ? " to date" : ""}: ${r.total} total`,
                  ...SERIES.map((c) => `${c.label} ${r[c.id] === null ? "—" : r[c.id]}`),
                ].join("\n")
              }
              ariaLabel="Incidents, year over year"
            />
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
                  title={c.label}
                  color={c.color}
                  data={leaderData.rows[c.id] || []}
                  totals={leaderData.totals[c.id]}
                  onSelect={(id) => {
                    const row = leaderData.rows[c.id].find((r) => r.driverId === id);
                    openDriver(id, { category: c.id, x: [row?.month || 0, row?.ytd || 0] });
                  }}
                  periodLabel={String(year)}
                  totalLabel="All time"
                />
              ))}
            </div>
          </RosterGate>
        )}

        {tab === "driver" && (
          <RosterGate>
            <div>
              <div className="me-filter-row tr-driver-row">
                <DriverFocus
                  ns="tr"
                  options={driverOptions}
                  focus={perDriverId || null}
                  focusLabel={perDriverName}
                  onFocus={(k) => setPerDriverId(k || "")}
                  hint="Pick a driver: their months and categories follow"
                />
                {perDriverId && (
                  <button type="button" className="btn ghost sm" onClick={() => openDriver(perDriverId)}>
                    View incidents
                  </button>
                )}
              </div>
              {perDriver && (
                <>
                  <ChartCard
                    className="chart-band"
                    title={`${perDriverName} · by month · ${year}`}
                    subtitle={`${perDriver.byMonth.reduce((a, r) => a + r.count, 0)} in ${year}`}
                    table={chartTable({
                      rows: perDriver.byMonth,
                      x: { key: "month", label: "Month" },
                      series: [{ id: "count", label: "Incidents" }],
                      source: (r) => sourceLabel(r.source),
                    })}
                    csv={csvName(perDriverName, "monthly", year)}
                    height={220}
                  >
                    <EmphasisBars data={perDriver.byMonth} xKey="key" grain="month" valueName="Incidents" color={BRAND} />
                  </ChartCard>
                  {(() => {
                    // Each category's share of the driver's year: one of three draws a
                    // third of the track (spec §9), largest first. All time is in the
                    // hover and the table; a click opens the same drawer as before.
                    const yrTotal = perDriver.cats.reduce((a, c) => a + c.yr, 0);
                    const allTotal = perDriver.cats.reduce((a, c) => a + c.all, 0);
                    return (
                      <ChartCard
                        className="chart-band"
                        title="By category"
                        subtitle={`${yrTotal.toLocaleString()} in ${year} · ${allTotal.toLocaleString()} all time`}
                        table={chartTable({
                          rows: perDriver.cats.map((c) => ({ ...c, name: catLabel(c.id) })),
                          x: { key: "name", label: "Category" },
                          series: [
                            { id: "yr", label: String(year) },
                            { id: "all", label: "All time" },
                          ],
                          source: "live + history blend",
                        })}
                        csv={csvName(perDriverName, "by category", year)}
                        height="auto"
                      >
                        <BarList
                          rows={perDriver.cats}
                          keyOf={(c) => c.id}
                          label={(c) => catLabel(c.id)}
                          value={(c) => c.yr}
                          colorOf={(c) => c.color}
                          order="value"
                          limit={0}
                          share
                          shareOf={yrTotal}
                          scaleTo={yrTotal || "max"}
                          noun="categories"
                          rowTitle={(c) => `${catLabel(c.id)}: ${c.yr} in ${year} · ${c.all} all time`}
                          onMark={(c) => openDriver(perDriverId, { category: c.id, x: [c.yr, c.all] })}
                          ariaLabel={`${perDriverName} by category`}
                        />
                      </ChartCard>
                    );
                  })()}
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
