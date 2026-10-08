import React, { useMemo } from "react";
import { CategoryLeaderboard } from "./leaderboard.jsx";
import AttemptsScorecardCard, { useAttemptsDay } from "./AttemptsScorecardCard.jsx";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { driverBuckets } from "../data/blend.js";
import { driverDrill } from "../data/drill.js";
import { nameOf } from "../data/people.js";
import { incidentDateStr } from "../data/incidentDate.js";
import { COUNTED8, ATTEMPTS, FAILURES, categoriesFor } from "../data/categories.js";
import { MONTH_PRESETS, currentYmET, daysBetween } from "../data/period.js";
import { NOT_DRIVER_FAULTS } from "../data/faultGroups.js";
import {
  scorecardWindows,
  scorecardKpis,
  kpiDrills,
  failuresNotTracked,
  monthSpanLabel,
  cachedDispatch,
  dispatchText,
  nextFeedChunk,
  feedSpan,
} from "../data/scorecardKpis.js";
import { dayCache, fetchAttemptsRange } from "../data/attemptsFeed.js";
import { useHashState, writeHash } from "../data/hashState.js";
import PeriodBar, { usePeriodState } from "./kit/PeriodBar.jsx";
import StatTile from "./kit/StatTile.jsx";
import { AnalyticsGate, RosterGate, HistoryRefresh } from "./kit/LoadState.jsx";
import { openDrill } from "./kit/drillNav.js";

// Month names used throughout the scorecard.
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Scorecard chart categories: the eight the history rollup tracks, in the registry's
// order and colours (categories.js), with the plural chart titles. Attempts are the
// ones somebody logged or reassigned, said so in the title: the dispatch feed sees far
// more (the Attempts tile below shows both).
const CHART_CATEGORIES = categoriesFor(COUNTED8).map(({ id, title, color }) => ({
  id,
  title: id === ATTEMPTS ? "Attempts (logged)" : title,
  color,
}));

const CHART_CAT_IDS = CHART_CATEGORIES.map((c) => c.id);

const PERIOD_LABELS = { this: "MO", last: "LMO", 3: "3M", 6: "6M", 12: "12M", custom: "SEL" };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ─── Dashboard (default export) ──────────────────────────────────────────────
export default function Dashboard() {
  // Incidents, the roster and history come from the shared analytics state, and every
  // count below from its blend — the same one each drill-down resolves against.
  const data = useAnalytics();
  const { incidents, drivers, history } = data;
  // The month picker, the period and the fault scope live in the URL hash under sc.*,
  // so they survive a tab switch and a link opens the same view. The default month is
  // the current month in Eastern time, so it doesn't jump ahead on the last evening of
  // the month.
  const [monthParam] = useHashState("sc.m", currentYmET());
  const selectedMonth = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentYmET();
  // Another month drops the Attempts day picked in the old one: the day belongs to the
  // month (AttemptsScorecardCard.jsx).
  const setSelectedMonth = (ym) =>
    writeHash({ "sc.m": ym === currentYmET() ? null : ym, "sc.day": null });
  const [faultParam, setFaultFilter] = useHashState("sc.fault", "all");
  const faultFilter = faultParam === "driver" ? "driver" : "all";
  const fault = faultFilter === "driver" ? "driver" : null;
  const [period, setPeriod] = usePeriodState("sc", MONTH_PRESETS, "this");
  const { p: periodSel, from: customFrom, to: customTo } = period;
  const [dayParam, setDay] = useHashState("sc.day", "");

  // Every window counts back from the month picker: the period (This Mo is the picked
  // month), the year to date (January through it), and both together for the bars.
  const win = useMemo(
    () => scorecardWindows({ preset: periodSel, anchor: selectedMonth, from: customFrom, to: customTo }),
    [periodSel, selectedMonth, customFrom, customTo],
  );
  const periodSpan = monthSpanLabel(win.periodMonths);
  const ytdSpan = monthSpanLabel(win.ytdMonths);

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

  // Per-driver tallies from the blend (blend.js): each category of each month is served
  // by live incidents when any that count exist, otherwise by the historical rollup.
  // Under Driver-fault scope a cell history serves is not tracked — history has no
  // fault — and counts nothing, in the tiles, the leaderboards and every drill-down
  // alike. `plain` is the all-fault blend: the fault split is taken over all of it.
  const blend = data.blend(fault);
  const plain = data.blend(null);
  const driverTotals = useMemo(
    () =>
      driverBuckets({
        blend,
        drivers,
        buckets: { period: win.periodMonths, ytd: win.ytdMonths, scope: win.scopeMonths },
        categoryIds: CHART_CAT_IDS,
        nameOf: (id) => nameOf(data.people, id),
      }),
    [blend, drivers, data.people, win],
  );
  const kpis = useMemo(
    () => scorecardKpis({ blend, plain, windows: win, incidents }),
    [blend, plain, win, incidents],
  );

  const hiddenDrivers = data.hidden;

  // Build sorted chart data for a single category. Deactivated drivers are
  // filtered out HERE, at the display layer, rather than out of driverTotals —
  // every total is derived from driverTotals, and retiring a driver must not
  // retroactively change a reported total.
  const inRoleGroup = (e, roleGroup) => {
    const role = e.driver.role || "driver";
    return roleGroup === "loader" ? role === "loader" : role !== "loader";
  };

  // Sorted by the SELECTED PERIOD first, then YTD. It used to sort by YTD alone, so
  // on "This Mo" the top eight were the year's heaviest names — most sitting at 0 this
  // month — and the drivers who actually had incidents this month were pushed below
  // "Show all". Trends already sorted this way; the Scorecard was the odd one out.
  // A row is listed when it has anything in the period or the year to date (`scope`);
  // how its bar is drawn is leaderboard.jsx's (kit/shape.js leaderBar).
  const chartDataFor = (categoryId, roleGroup) =>
    driverTotals
      .filter((e) => {
        if (hiddenDrivers.has(e.driver.id)) return false;
        return inRoleGroup(e, roleGroup) && (e.scope[categoryId] || 0) > 0;
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

  // Under Driver-fault scope, the months of a chart's span that only history could
  // answer for: they count nothing, and the card says so rather than reading as zero.
  // A compliment carries no fault at all (ManualEntry writes it with an empty one), so
  // under that scope its chart is never anyone's to count, live or history.
  const notTrackedMonths = (categoryIds) =>
    win.scopeMonths.filter((ym) => categoryIds.some((c) => blend.cellSource(ym, c) === "not_tracked")).length;
  const notTrackedNote = (categoryId) => {
    if (!fault) return null;
    if (categoryId === "compliment") return "⊘ Compliments carry no fault — shown under All incidents";
    const n = notTrackedMonths([categoryId]);
    return n ? `⊘ ${plural(n, "history month")} not tracked — history has no fault` : null;
  };

  // What the drill-downs need to rebuild a chart's numbers exactly: the period and the
  // year, each with the number the card showed for it.
  const periodLabelText = periodSpan || win.periodLabel;
  const scopesFor = (period, ytd) => [
    { label: periodLabelText, months: win.periodMonths, expected: period },
    { label: `YTD ${win.ytdYear}`, months: win.ytdMonths, expected: ytd },
  ];
  // A chart's title: every incident behind it, in its role group.
  const openChart = (cat, roleGroup) => {
    const t = chartTotalsFor(cat.id, roleGroup);
    openDrill({
      spec: { kind: "blend", categoryIds: [cat.id], roleGroup, fault },
      scopes: scopesFor(t.period, t.ytd),
      vocab: CHART_CAT_IDS,
    });
  };
  // A row: the driver's record over the same period and year, opened on the chart's
  // category with the row's two numbers, so the breadcrumb can step out to all of them.
  const openRow = (id, cat) => {
    const e = driverTotals.find((t) => t.driver.id === id);
    const sum = (b) => CHART_CAT_IDS.reduce((n, c) => n + (e?.[b][c] || 0), 0);
    openDrill(
      driverDrill(
        id,
        { categoryIds: CHART_CAT_IDS, fault, scopes: scopesFor(sum("period"), sum("ytd")) },
        { category: cat, x: [e?.period[cat] || 0, e?.ytd[cat] || 0] },
      ),
    );
  };

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  // Each tile's number opens the drawer on exactly what it counted, with the number it
  // showed (scorecardKpis.js kpiDrills; the period and the year to date are the
  // drawer's two scopes).
  const drills = kpiDrills({ kpis, windows: win, fault, periodLabel: periodLabelText, vocab: CHART_CAT_IDS });
  const openGroup = (g) => openDrill(drills.group(g));

  // Under Driver-fault scope a span only history answers for reads "—" (scorecardKpis.js).
  const notTracked = (span) => failuresNotTracked(kpis, span, fault);
  const faultSub = (label, hist) =>
    hist.months.length
      ? `${label} · driver fault · ${plural(hist.months.length, "history month")} not tracked`
      : `${label} · driver fault`;

  // Where the period's failures come from, for the first tile's sub-line.
  const failuresSub = (() => {
    const hist = kpis.history;
    if (notTracked("period")) return `${periodSpan} · not tracked in history`;
    if (fault) return faultSub(periodSpan, hist);
    if (hist.count) {
      const live = kpis.failures.period - hist.count;
      return live > 0 ? `${periodSpan} · ${live} live · ${hist.count} history` : `${periodSpan} · imported history`;
    }
    // Nothing from history: live entries, or nothing on record at all (a month before
    // the history import and with no live failure, Dec 2025).
    const onRecord = win.periodMonths.some((ym) => plain.monthSource(ym, FAILURES) !== "none");
    return onRecord ? `${periodSpan} · live entries` : `${periodSpan} · nothing on record`;
  })();
  const ytdSub = notTracked("ytd")
    ? `${ytdSpan} · not tracked in history`
    : fault
      ? faultSub(ytdSpan, kpis.historyYtd)
      : ytdSpan;

  const split = kpis.fault;
  const reviewedPct = split.total ? Math.round((split.reviewed / split.total) * 100) : 0;
  const noFaultData = split.total === 0;
  const historyMonths = kpis.history.months.length;

  // The dispatch feed beside "Attempts (logged)", read from the feed cache only — the
  // Attempts tab and the card below fill it. `feedTick` re-reads it when they do.
  const [feedTick, setFeedTick] = React.useState(0);
  const [counting, setCounting] = React.useState(false);
  // The last count's failure: days the feed couldn't be reached for (never cached, so
  // they are offered again), or the whole request. Said under the tile until a count
  // goes through, rather than the button quietly coming back.
  const [countError, setCountError] = React.useState(null);
  const dispatch = useMemo(
    () => cachedDispatch(win.periodMonths, { cache: dayCache }),
    [win, feedTick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nextChunk = nextFeedChunk(feedSpan(win.periodMonths) || {}, { isCached: (d) => !!dayCache.get(d) });
  React.useEffect(() => setCountError(null), [win]);
  const countDispatch = async () => {
    if (!nextChunk || counting) return;
    setCounting(true);
    setCountError(null);
    try {
      const r = await fetchAttemptsRange(nextChunk[0], nextChunk[1]);
      if (r.failed) setCountError(`Couldn't reach the dispatch feed for ${plural(r.failed, "day")} — try again.`);
    } catch (e) {
      setCountError(`Couldn't reach the dispatch feed${e?.message ? ` (${e.message})` : ""} — try again.`);
    } finally {
      setCounting(false);
      setFeedTick((t) => t + 1);
    }
  };

  // The Attempts card's day: picked in the filter row, inside the picked month.
  const attemptsDay = useAttemptsDay(selectedMonth, dayParam);
  React.useEffect(() => {
    if (attemptsDay.status === "ready") setFeedTick((t) => t + 1);
  }, [attemptsDay.status, attemptsDay.day]);

  // A period with no live cell at all is history only, which has no fault to filter.
  const noLiveCells = !win.periodMonths.some((ym) => CHART_CAT_IDS.some((c) => plain.isLive(ym, c)));
  const loaderNotTracked = fault ? notTrackedMonths(CHART_CAT_IDS) : 0;
  const scopeLive = win.scopeMonths.some((ym) => CHART_CAT_IDS.some((c) => plain.isLive(ym, c)));

  // The badge says what the period's numbers are made of: live rows, imported history,
  // or both (Jan 2026 alone is both). Nothing to badge while the numbers can't be shown
  // (AnalyticsGate says why).
  const sources = new Set(
    win.periodMonths.map((ym) => plain.monthSource(ym, CHART_CAT_IDS)).filter((s) => s !== "none"),
  );
  const badgeText =
    data.blocking || !sources.size
      ? null
      : sources.size === 1 && sources.has("live")
        ? "live data"
        : sources.size === 1 && sources.has("history")
          ? "historical rollup"
          : "live + history";
  const dataBadge = badgeText && (
    <span
      style={{
        fontSize: 10,
        fontFamily: "var(--mono)",
        color: badgeText === "historical rollup" ? "var(--text-2)" : "var(--accent-green)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      · {badgeText}
    </span>
  );

  const monthLabel = MONTH_NAMES[parseInt(selectedMonth.slice(5, 7), 10) - 1] + " " + selectedMonth.slice(0, 4);

  // The fault split's remainder: what is neither tile, each clickable.
  const restOfSplit = ["late_reason", "other", "not_reviewed"].filter((g) => split.groups[g].n > 0);

  return (
    <div>
      <div className="page-title">Performance Dashboard</div>
      <h1 className="page-heading sc-heading">
        Driver Scorecard{" "}
        <span className="meta">· {periodSpan}</span>{" "}
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
          day={
            attemptsDay.bounds && {
              label: "Attempts day",
              value: attemptsDay.day || "",
              // The current month's first days show the month before's last scanned
              // day until their own scan runs: the input can hold it.
              min: attemptsDay.day && attemptsDay.day < attemptsDay.bounds.min ? attemptsDay.day : attemptsDay.bounds.min,
              max: attemptsDay.bounds.max,
              onChange: (v) => setDay(v || ""),
              title: `The day the Delivery Attempts card shows: a day of ${monthLabel}`,
            }
          }
          fault={{
            value: faultFilter,
            onChange: setFaultFilter,
            disabled: noLiveCells && faultFilter !== "driver",
            title: noLiveCells ? "Fault filter unavailable: this period is all imported history, which has no fault" : "",
          }}
        />
        <div className="toolbar-spacer" />
        <HistoryRefresh />
      </div>

      <AnalyticsGate>
        {/* Plain tiles: none of these numbers is a status, so none wears a status
            colour — the old amber and red rules sat beside Late's and Damage's hues. */}
        <div className="kpi-grid">
          <StatTile
            label="Counted failures"
            value={notTracked("period") ? "—" : kpis.failures.period}
            sub={failuresSub}
            title={
              "Damage, forgotten freight, misdelivery, late, lost/missing and complaints — the cells the " +
              "failure charts below add up to. No-fault entries, attempts and compliments are not failures."
            }
            onClick={notTracked("period") ? null : () => openDrill(drills.failures)}
          />
          <StatTile
            label="Failures YTD"
            value={notTracked("ytd") ? "—" : kpis.failures.ytd}
            sub={ytdSub}
            title={`Counted failures from January through ${monthLabel}`}
            onClick={notTracked("ytd") ? null : () => openDrill(drills.failuresYtd)}
          />
          <StatTile
            label="Driver fault"
            value={noFaultData && historyMonths ? "—" : split.groups.driver.n}
            sub={
              noFaultData
                ? historyMonths
                  ? "Not tracked in history"
                  : "No counted live failures"
                : `of ${split.total} counted live · ${reviewedPct}% reviewed`
            }
            title="Live failures whose fault is set to the driver. History has no fault field."
            onClick={noFaultData ? null : () => openGroup("driver")}
          />
          <StatTile
            label="Not driver's fault"
            value={noFaultData && historyMonths ? "—" : split.groups.not_driver.n}
            sub={noFaultData && historyMonths ? "Not tracked in history" : NOT_DRIVER_FAULTS.join(" · ")}
            title="Live failures set to exonerated, preload, warehouse, customer or vendor — the same set the weekly PDF counts"
            onClick={noFaultData ? null : () => openGroup("not_driver")}
          />
          <StatTile
            label="Attempts (logged)"
            value={kpis.attempts.period}
            sub={dispatchText(dispatch)}
            title={
              "Attempts somebody logged or reassigned, as the Attempts chart counts them. " +
              "The dispatch feed's attempted orders are a separate count, shown beside it."
            }
            onClick={() => openDrill(drills.attempts)}
          >
            {countError && (
              <div className="kpi-delta kpi-error" role="alert">
                {countError}
              </div>
            )}
            {dispatch.of > 0 && nextChunk && (
              <button type="button" className="kpi-action" onClick={countDispatch} disabled={counting}>
                {counting
                  ? "Counting dispatch orders…"
                  : dispatch.loaded
                    ? `Load ${plural(daysBetween(nextChunk[0], nextChunk[1]), "more day")}`
                    : "Count dispatch orders"}
              </button>
            )}
          </StatTile>
          {/* A compliment has no fault, so Driver-fault scope never counts one: "—",
              not a 0 that reads as no compliments. */}
          <StatTile
            label="Compliments"
            value={fault ? "—" : kpis.compliments.period}
            sub={fault ? "Not split by fault — compliments carry none" : `${kpis.compliments.ytd} YTD · credit, never netted`}
            title="Compliments are a credit: never added to or netted against failures"
            onClick={fault ? null : () => openDrill(drills.compliments)}
          />
        </div>

        {/* The rest of the fault split — what neither fault tile counts — what history
            can't split at all, and the entries marked "do not fault driver", which count
            against nobody. */}
        {(restOfSplit.length > 0 || kpis.noFault.n > 0 || (historyMonths > 0 && split.total > 0)) && (
          <div className="kpi-note">
            {restOfSplit.length > 0 && (
              <>
                Of {split.total} counted live failures:{" "}
                {restOfSplit.map((g, i) => (
                  <React.Fragment key={g}>
                    {i > 0 && " · "}
                    <button type="button" className="kpi-note-n" onClick={() => openGroup(g)}>
                      {split.groups[g].n}
                    </button>{" "}
                    {g === "late_reason"
                      ? "late with a reason (reviewed, not split by fault)"
                      : g === "other"
                        ? "with a fault typed in"
                        : "not reviewed"}
                  </React.Fragment>
                ))}
                .{" "}
              </>
            )}
            {kpis.noFault.n > 0 && (
              <>
                <button type="button" className="kpi-note-n" onClick={() => openDrill(drills.noFault)}>
                  {kpis.noFault.n}
                </button>{" "}
                marked &ldquo;do not fault driver&rdquo; count against nobody.{" "}
              </>
            )}
            {historyMonths > 0 && split.total > 0 && (
              <>{plural(historyMonths, "history month")} not split by fault — history has no fault field.</>
            )}
          </div>
        )}

        <div className="section-head">
          Drivers
          <span className="section-hint">Click a chart for every incident behind it · click a name for that driver</span>
        </div>
        {/* The Drivers / Loaders split and the hidden inactive rows need the roster. */}
        <RosterGate>
          <div className="chart-grid">
            {CHART_CATEGORIES.map((cat) => (
              <CategoryLeaderboard
                key={cat.id}
                title={cat.title}
                color={cat.color}
                data={chartDataFor(cat.id, "driver")}
                totals={chartTotalsFor(cat.id, "driver")}
                onSelect={(id) => openRow(id, cat.id)}
                onOpen={() => openChart(cat, "driver")}
                periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
                nested={win.nested}
                note={notTrackedNote(cat.id)}
                emptyText={
                  fault && cat.id === "compliment"
                    ? "Not split by fault"
                    : notTrackedNote(cat.id)
                      ? "Nothing tracked by fault"
                      : "No incidents"
                }
              />
            ))}
          </div>
        </RosterGate>

        <AttemptsScorecardCard day={attemptsDay} monthLabel={monthLabel} />

        {!data.rosterBlocking && (
          <>
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
                  onSelect={(id) => openRow(id, cat.id)}
                  onOpen={() => openChart(cat, "loader")}
                  periodLabel={PERIOD_LABELS[periodSel] || "SEL"}
                  nested={win.nested}
                  note={notTrackedNote(cat.id)}
                />
              ))}
              {CHART_CATEGORIES.every(
                (cat) => chartDataFor(cat.id, "loader").length === 0,
              ) && (
                <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
                  {/* Under Driver-fault scope, history's loader entries are not tracked
                      rather than absent. */}
                  {loaderNotTracked
                    ? `${scopeLive ? "No loader incidents at fault in the live months" : "Nothing tracked by fault"} · ⊘ ${plural(loaderNotTracked, "history month")} not tracked — history has no fault.`
                    : "No loader incidents on record."}
                </div>
              )}
            </div>
          </>
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
      </AnalyticsGate>
    </div>
  );
}
