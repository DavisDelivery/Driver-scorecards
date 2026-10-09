import React from "react";
import { PERIODS, periodWindow, periodLabel, toYMD, nowET } from "../data/period.js";
import { DAY_STATUS_TEXT } from "../data/attemptsFeed.js";
import { bucketGap, WEEKDAY_FULL, trendSlot, UNCAPTURED_SHORT, MANUAL_SINCE } from "../data/manualAnalytics.js";
import { OTHER_COLOR } from "../data/categories.js";
import { csvName } from "../data/csv.js";
import PeriodBar, { usePeriodState } from "./kit/PeriodBar.jsx";
import StatTile, { TileStrip } from "./kit/StatTile.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import BarList from "./kit/charts/BarList.jsx";
import Icon from "./kit/Icon.jsx";
import useSize from "./kit/useSize.js";
import {
  chartTable,
  businessDays,
  chartForm,
  chooseGrain,
  peakSummary,
  fmtHead,
  slotLabel,
  toDate,
  displayName,
  labelPlan,
  barGeometry,
  shadedReasons,
  sparkWidth,
  gridRows,
} from "./kit/shape.js";
import { monthsText } from "../data/coverage.js";
import { DEEMPH, WASH, ZERO, PARTIAL_OPACITY } from "./kit/chartTheme.js";

// Analytics panel for a manual-entry tab (Forgotten Freight, Unable to Track,
// Mis-Deliveries, Compliments, Attempts): headline tiles, the trend over the period, the
// work week and what the entries were. The numbers are computed by the tab
// (ManualEntry.jsx, from manualAnalytics.js) and drawn here.
//
// One card: the tile strip, a hairline, then a 12-column grid — the trend across the
// full width (the time axis needs the room), then By workday beside the breakdown. A
// period with nothing in it is one empty state; one with fewer than 10 entries is a
// sentence over the log, not five charts of ones.
//
// Picking a driver — in the box beside the period, by clicking their bar, or with
// #<ns>.driver= in a link — re-scopes the tiles and the charts to that driver: the
// charts plot the driver's own values, with the fleet's in the hover. Clicking a bar
// narrows the tab's table or log to it, behind a chip, and the list's count is the bar's.
//
// The period lives in the URL hash under the tab's own namespace (useTabPeriod), so the
// parent's log reads the very same period, it survives a tab switch, and a link carries
// it.

// One tab's period — its pill, custom range, resolved window and label — read from the
// hash (`${ns}.p`, `${ns}.from`, `${ns}.to`). The analytics panel and the parent's log
// both call this, so they cannot disagree about the window.
export function useTabPeriod(ns) {
  const [period, setPeriod] = usePeriodState(ns, PERIODS, "30d");
  const { p, from, to } = period;
  const win = React.useMemo(() => periodWindow(p, from, to), [p, from, to]);
  const label = periodLabel(p, from, to);
  return { period, setPeriod, win, label };
}

// Why a feed day or bucket has no data, in full, for the tooltip and the table view.
const GAP_TEXT = {
  ...DAY_STATUS_TEXT,
  not_loaded: "not loaded yet (hand-logged attempts only)",
  before_feed: "before the dispatch feed started (hand-logged attempts only)",
};

// The period in a sentence: "in the last 30 days", "this week".
const PERIOD_PHRASE = {
  thisWeek: "this week",
  lastWeek: "last week",
  "30d": "in the last 30 days",
  this: "this month",
  last: "last month",
  3: "in the last 3 months",
  6: "in the last 6 months",
  12: "in the last 12 months",
};
const GRAIN_WORD = { day: "day", week: "week", month: "month" };
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A bar list's takeaway for its card's subtitle: "Most on Tuesday · 42 of 167", "Skid
// most · 107 of 167"; a tie is named as one ("Most on Mon and Tue · 4 each"). Rows that
// aren't ranked (Not set) never lead. null when nothing is above zero.
function leadText(rows, { name, short = name, count = (r) => r.count, lead = "Most on" } = {}) {
  const ranked = (rows || []).filter((r) => !r.notSet && (count(r) || 0) > 0);
  if (!ranked.length) return null;
  const max = Math.max(...ranked.map(count));
  const top = ranked.filter((r) => count(r) === max);
  const sum = (rows || []).reduce((a, r) => a + (count(r) || 0), 0);
  if (top.length === 1) {
    const who = name(top[0]);
    return lead ? `${lead} ${who} · ${max} of ${sum}` : `${who} most · ${max} of ${sum}`;
  }
  const names = listWords(top.slice(0, 3).map(short)) + (top.length > 3 ? ` and ${top.length - 3} more` : "");
  return lead ? `${lead} ${names} · ${max} each` : `${names} tied · ${max} each`;
}

// Props:
//   title, color, ns, sourceLabel     the tab, its category colour, its hash namespace,
//                                     where its records come from (table views)
//   noun                              what a record is: "entries" | "attempts"
//   statusLine                        rendered under the filter row (the feed coverage)
//   notice                            one line under it (months only in history)
//   feedGap                           { why, empty } when there is no feed data to count at
//                                     all: the numbers are the hand-logged rows alone, and an
//                                     empty period says `empty` rather than "No records"
//   pending                           the period is still loading (Attempts' feed)
//   total                             the fleet's count for the period
//   driversCount                      drivers with a record this period (the quiet-period
//                                     sentence)
//   focus, focusLabel, focusOptions, onFocus       the picked driver (a driver key)
//   focusBlocked                      why no driver can be picked (the roster failed to load)
//   print                             { label, title, onClick, disabled } — secondary
//   tiles                             [{ label, value, sub, title, onClick }] — every one
//                                     shown in every form (a quiet or empty period too)
//   weekday, trend, trendWeek, bucket chart rows (manualAnalytics.js); trendWeek is the
//                                     same period by week, for a day axis too narrow to read
//   chips, onWeekday, onBucket        what the charts' clicks set
//   classify                          { label, field, rows, onPick } or null
//   outcome                           outcomeMix() result, with onPick, or null
//   chipBar                           what the clicks narrowed, shown under the charts
//   historyMonths                     Map(ym → n): months only imported history holds,
//                                     shaded on a by-month chart rather than drawn as 0
//   uncaptured                        Map(ym → why) (uncapturedMonths): months the tab
//                                     wasn't capturing or has nothing on file for, shaded
//   wide                              the trend and By workday side by side (Compliments)
export default function ManualEntryAnalytics({
  title,
  color,
  ns,
  noun = "entries",
  sourceLabel = "logged entries",
  statusLine = null,
  notice = null,
  feedGap = null,
  pending = false,
  total,
  driversCount = null,
  focus = null,
  focusLabel = "",
  focusOptions = [],
  focusBlocked = null,
  onFocus,
  print = null,
  tiles = [],
  weekday = [],
  trend = [],
  trendWeek = null,
  bucket = "day",
  chips = {},
  onWeekday,
  onBucket,
  classify = null,
  outcome = null,
  chipBar = null,
  historyMonths = null,
  uncaptured = null,
  wide = false,
}) {
  const { period, setPeriod, win, label: periodText } = useTabPeriod(ns);
  // A quiet period reads as a sentence; its charts open on request.
  const [showFew, setShowFew] = React.useState(false);
  const todayYMD = toYMD(nowET());
  const [cellRef, cell] = useSize();

  // ── The trend: its grain at this width, its rows, what each slot can't show ─────────
  const historyServed = !!historyMonths && [...historyMonths.keys()].some((ym) => ym >= win.start.slice(0, 7) && ym <= win.end.slice(0, 7));
  const fine = cell.width ? chooseGrain(win, Math.max(0, cell.width - 40), { historyServed }) : bucket;
  const grain = fine === "week" && bucket === "day" && trendWeek ? "week" : bucket;
  const source = grain === "week" && bucket === "day" ? trendWeek : trend;
  const histOf = (b) => (grain === "month" && historyMonths ? historyMonths.get(b.key) || 0 : 0);
  const shortWeek = grain === "day" && win.start && win.end && win.start.slice(0, 7) === win.end.slice(0, 7) && Number(win.end.slice(8)) - Number(win.start.slice(8)) < 7;
  const trendRows = (source || []).map((b) => {
    const gap = bucketGap(b);
    const hist = histOf(b);
    // What the slot draws and reads (manualAnalytics.js trendSlot): a month only
    // imported history holds is an outlined bar at history's total — never a filled one,
    // and never in the tab's total — and one the tab wasn't capturing is shaded; the
    // hover reads the 0 its table row lists, with why (and history's total beside it).
    // The table keeps what it always showed (a feed gap blank, those months' 0 beside
    // their note), and the tab's totals stay what it can list.
    const slot = trendSlot(b, { hist, uncaptured });
    const notes = [];
    if (b.gap) notes.push(`No feed data: ${GAP_TEXT[b.gap] || b.gap}`);
    else if (gap?.note) notes.push(gap.note);
    if (hist) notes.push(`A monthly total only: no ${noun} to list here`);
    if (slot.why === UNCAPTURED_SHORT.not_captured) notes.push(`Not captured: logging here began ${slotLabel(MANUAL_SINCE, "month", { withYear: true })}`);
    if (slot.why === UNCAPTURED_SHORT.no_data) notes.push("No data on file for this month");
    if (focus) notes.push(`Fleet: ${b.fleet}`);
    else if (b.unassigned) notes.push(`${b.unassigned} Unassigned`);
    const td = toDate(b, todayYMD);
    const today = grain === "day" && b.key === todayYMD;
    return {
      ...b,
      ...(gap?.empty ? { count: b.count || null, rest: b.rest || null } : {}),
      __draw: slot.draw,
      __tip: slot.tip,
      // The outline is the company's history total: with a driver picked the columns
      // are the driver's own, so the month stays shaded ("only in imported history").
      __hist: focus ? null : (slot.hist ?? null),
      __gap: gap?.empty ? gap.short : slot.why,
      __partial: !!td || today || (!!gap && !gap.empty && !!gap.short && b.count > 0),
      __toDate: td,
      __head: fmtHead(b.key, grain, { toDate: td }) + (today ? " · so far today" : ""),
      __notes: notes,
    };
  });
  // Empty weekends leave a day axis: they're not slots anyone works. Display only — the
  // table, the CSV and every total keep every calendar day.
  const drawn = grain === "day" ? businessDays(trendRows, { series: ["count", "fleet"], gapKey: "__gap" }) : trendRows;
  const trendSum = trendRows.reduce((a, r) => a + (r.count || 0), 0);
  // The quiet-period rule reads the scope on screen: with a driver picked, the driver's
  // own count — two attempts are a sentence, not two full-height columns among twenty
  // empty slots.
  const scopeTotal = focus ? trendSum : total;
  const form = pending ? "pending" : chartForm({ slots: drawn.length, total: scopeTotal, lowVolume: true });
  const trendForm = drawn.length < 7 ? "rows" : "columns";
  const plotW = Math.max(0, cell.width - 40);
  // The same decision the chart makes (labelPlan): with a number on every column the
  // subtitle needn't name the peak.
  const labelsAll =
    trendForm === "columns" &&
    labelPlan({ n: drawn.length, slot: drawn.length ? plotW / drawn.length : 0, values: drawn.map((r) => r.__draw ?? r.__hist) }) === "all";
  const peak = peakSummary(drawn, { grain, value: (r) => r.__draw, partial: (r) => r.__partial });
  // History's months are outlined, never in the tab's total: the subtitle says how many
  // more history holds, so the outlines never read as part of it.
  const histMore = drawn.reduce((a, r) => a + (r.__draw === null && r.__hist ? r.__hist : 0), 0);
  const trendSub = [
    `${trendSum.toLocaleString()} ${noun}${focus ? ` by ${displayName(focusLabel)}` : ""}`,
    histMore ? `${histMore.toLocaleString()} more in imported history` : null,
    !labelsAll && peak,
  ]
    .filter(Boolean)
    .join(" · ");
  const series = [{ id: "__draw", tip: "__tip", label: focus ? displayName(focusLabel) : title, color }];
  // A month only imported history holds has no entries to list: it opens nothing.
  const onTrend = onBucket ? (b) => (b.__draw === null && b.__hist ? undefined : onBucket(b)) : null;
  const trendTitle = `${cap(noun)} by ${GRAIN_WORD[grain] || grain}`;
  const trendSource = (b) =>
    b.gap
      ? `no feed data — ${GAP_TEXT[b.gap] || b.gap}`
      : b.gapDays
        ? `${sourceLabel}; ${bucketGap(b).note}`
        : histOf(b)
          ? `${sourceLabel}; imported history holds ${histOf(b)} (monthly total only)`
          : // A month not captured, or with nothing on file, keeps the Source it always
            // had: why it reads "—" on the chart is in its hover and the note under it.
            sourceLabel;
  // The table views keep the columns they always had: the driver and the rest of the
  // fleet, with their total, when a driver is picked.
  const tableSeries = focus
    ? [
        { id: "count", label: focusLabel },
        { id: "rest", label: "Rest of fleet" },
      ]
    : [{ id: "count", label: title }];
  // The table view and CSV keep the period's own grain: a day axis drawn by week at this
  // width (chooseGrain) still exports days, so one link exports the same table anywhere.
  const tableRows =
    grain === bucket
      ? trendRows
      : (trend || []).map((b) => {
          const gap = bucketGap(b);
          return {
            ...b,
            ...(gap?.empty ? { count: b.count || null, rest: b.rest || null } : {}),
            __gap: gap?.empty ? gap.short : trendSlot(b, { uncaptured }).why,
          };
        });
  const tableTitle = `${cap(noun)} by ${GRAIN_WORD[bucket] || bucket}`;
  // The table on screen names each slot whole ("Wed, Sep 9, 2026"); the CSV keeps the
  // first column it has always had (the bucket's own label, "09/09" / "Nov 25"), so
  // anything that reads these files sees the same text.
  const trendBase = chartTable({
    rows: tableRows.map((r) => ({ ...r, __x: slotLabel(r.key, bucket, { withYear: true }) })),
    x: { key: "__x", label: bucket === "month" ? "Month" : bucket === "week" ? "Week of" : "Day" },
    series: tableSeries,
    total: !!focus,
    source: trendSource,
  });
  const trendTable = {
    columns: trendBase.columns.map((c) => (c.key === "__x" ? { ...c, value: (row) => row.__csvX } : c)),
    rows: trendBase.rows.map((row, i) => ({ ...row, __csvX: tableRows[i].label ?? tableRows[i].key })),
  };
  // The note under the trend: only the states the chart has, each with its swatch.
  const noteItems = [];
  // Why a shaded slot holds no number, in the note's words, each said once.
  const shadedWhy = (r) =>
    r.__gap === "history only"
      ? "only in imported history"
      : r.__gap === UNCAPTURED_SHORT.not_captured || r.__gap === UNCAPTURED_SHORT.no_data
        ? r.__gap
        : "no feed data";
  // History's months are outlined bars, a mark of their own; every other slot with no
  // count is shaded, and the note says which band is which ("no data on file (Dec
  // 2025), not captured (May 2026)") — each reason once, its months named.
  const outlined = drawn.filter((r) => r.__draw === null && r.__hist);
  if (outlined.length) {
    const histSum = outlined.reduce((a, r) => a + r.__hist, 0);
    noteItems.push(
      <span key="outline" title={`${monthsText(outlined.map((r) => r.key))}: ${histSum.toLocaleString()} in imported history, a monthly total with no ${noun} to list here — the Scorecard counts them`}>
        <i className="cc-note-swatch hollow" style={{ borderColor: color }} />
        Outlined: imported history only, not in the {trendSum.toLocaleString()}
      </span>,
    );
  }
  const shaded = drawn.filter((r) => r.__gap && r.__draw === null && !r.__hist);
  if (shaded.length && trendForm === "rows") {
    // As rows, a slot with no count reads "—": one line names each, with why.
    const slotsText = (keys) => (grain === "month" ? monthsText(keys) : keys.map((k) => slotLabel(k, grain)).join(", "));
    const since = slotLabel(MANUAL_SINCE, "month", { withYear: true });
    noteItems.push(
      <span key="nocount">
        {shadedReasons(shaded, { why: shadedWhy })
          .map((x) => `${slotsText(x.keys)}: ${x.why}${x.why === UNCAPTURED_SHORT.not_captured ? ` (logging here began ${since})` : ""}`)
          .join("; ")}
      </span>,
    );
  }
  if (shaded.length && trendForm !== "rows") {
    const reasons = shadedReasons(shaded, { why: shadedWhy });
    // "May 2026" never breaks between month and year.
    const named = (x) => (grain === "month" && x.keys.length <= 3 ? `${x.why} (${monthsText(x.keys).replace(/ (\d{4})/g, "\u00a0$1")})` : x.why);
    noteItems.push(
      <span key="band">
        <i className="cc-note-swatch" style={{ background: WASH, boxShadow: `inset 0 0 0 1px ${ZERO}` }} />
        Shaded: {reasons.map(named).join(", ")}
      </span>,
    );
  }
  const partialRow = drawn.find((r) => r.__partial && r.count > 0);
  if (partialRow) {
    noteItems.push(
      <span key="faded">
        <i className="cc-note-swatch" style={{ background: color, opacity: PARTIAL_OPACITY }} />
        Faded:{" "}
        {partialRow.__toDate
          ? `${slotLabel(partialRow.key, grain).replace(/^Week of /, "week of ")} to date (${partialRow.__toDate.days} of ${partialRow.__toDate.of} days)`
          : partialRow.key === todayYMD
            ? "today so far"
            : "part of it isn't loaded"}
      </span>,
    );
  }

  // ── The cells of the grid, packed into rows of 12 ─────────────────────────────────
  const cells = [];
  const showWeekday = drawn.length > 0 && !(grain === "day" && shortWeek) && weekday.length > 0;
  cells.push({
    id: "trend",
    span: trendForm === "rows" ? 6 : wide ? 8 : 12,
    node: (
      <ChartCard
        inset
        title={trendTitle}
        subtitle={trendSub}
        table={trendTable}
        csv={csvName(title, focus ? focusLabel : "", tableTitle)}
        height={trendForm === "rows" ? "auto" : cell.width && cell.width < 600 ? 180 : 220}
        note={noteItems.length ? noteItems : null}
      >
        {trendForm === "rows" ? (
          <BarList
            rows={drawn}
            order="given"
            // As rows, a slot draws what it does as a column: a count is a bar, a month
            // only imported history holds an outlined bar of history's total, and a slot
            // with no count (not captured, no data on file, no feed data) no bar at all.
            value={(r) => (r.__draw === null && r.__hist ? r.__hist : r.__draw || 0)}
            hollow={(r) => r.__draw === null && !!r.__hist}
            label={(r) => slotLabel(r.key, grain, { withYear: false })}
            // A row's number is its count; a slot with no count reads "—" in ink 2, never
            // the 0 its table row keeps — its hover and the note under the list say why,
            // so every row keeps one height. History's total is in ink 2 too.
            valueText={(r) =>
              r.__draw === null && r.__hist
                ? r.__hist.toLocaleString()
                : r.__draw === null || r.count === null || r.count === undefined
                  ? "—"
                  : r.count.toLocaleString()
            }
            muted={(r) => r.__draw === null}
            color={color}
            limit={0}
            faded={(r) => r.__partial}
            highlightKey={chips.bucket ? chips.bucket.key : null}
            onMark={onTrend}
            rowTitle={(r) => [r.__head, `${r.count === null ? "—" : r.count} ${noun}`, ...r.__notes].join("\n")}
            ariaLabel={trendTitle}
          />
        ) : (
          <StackedColumns
            data={drawn}
            xKey="key"
            grain={grain}
            series={series}
            outline={{ id: "__hist", label: "Imported history", color }}
            onMark={onTrend}
            selectedKey={chips.bucket ? chips.bucket.key : null}
          />
        )}
      </ChartCard>
    ),
  });
  if (showWeekday) {
    cells.push({
      id: "weekday",
      span: wide && trendForm !== "rows" ? 4 : 6,
      node: (
        <ChartCard
          inset
          title="By workday"
          subtitle={[
            focus ? displayName(focusLabel) : null,
            leadText(weekday, { name: (r) => WEEKDAY_FULL[r.wd] || r.label, short: (r) => r.label }),
          ]
            .filter(Boolean)
            .join(" · ")}
          table={chartTable({
            rows: weekday,
            x: { key: "label", label: "Weekday" },
            series: tableSeries,
            total: !!focus,
            source: sourceLabel,
          })}
          csv={csvName(title, focus ? focusLabel : "", "by workday")}
          height="auto"
        >
          <BarList
            rows={weekday}
            order="given"
            value={(r) => r.count}
            color={color}
            limit={0}
            highlightKey={chips.weekday ? chips.weekday.key : null}
            onMark={onWeekday}
            rowTitle={(r) => `${r.label}: ${r.count} ${noun}${focus ? ` · fleet ${r.fleet}` : ""}`}
            ariaLabel="By workday"
          />
        </ChartCard>
      ),
    });
  }
  if (classify?.rows?.length > 0) {
    cells.push({
      id: "classify",
      span: 6,
      node: (
        <ChartCard
          inset
          title={classify.label}
          subtitle={[focus ? displayName(focusLabel) : null, leadText(classify.rows, { name: (r) => r.label, lead: null })]
            .filter(Boolean)
            .join(" · ")}
          table={chartTable({
            rows: classify.rows,
            x: { key: "label", label: classify.label },
            series: [{ id: "count", label: title }],
            source: sourceLabel,
          })}
          csv={csvName(title, focus ? focusLabel : "", classify.label)}
          height="auto"
        >
          <BarList
            rows={classify.rows}
            value={(r) => r.count}
            color={color}
            colorOf={(r) => (r.notSet ? OTHER_COLOR : color)}
            share
            highlightKey={chips.cls ? chips.cls.key : null}
            onMark={classify.onPick}
            noun="items"
            ariaLabel={classify.label}
          />
        </ChartCard>
      ),
    });
  }
  if (outcome) {
    cells.push({ id: "outcome", span: 6, node: <OutcomeList mix={outcome} color={color} focusLabel={focus ? focusLabel : ""} selected={chips.outcome?.key} /> });
  }
  // One grid for every period, packed so every row fills its 12 columns (kit/shape.js
  // gridRows, from the grid's measured width): the trend full width as columns (beside
  // By workday on Compliments), or as rows half width beside By workday; then the lists.
  // A list left alone in a row never sits beside an empty hole — it joins the row above
  // as three thirds when a third is wide enough, or spans its row.
  const rows = gridRows(cells, cell.width);

  const phrase = PERIOD_PHRASE[period.p] || `from ${periodText}`;
  const nounOne = noun === "entries" ? "entry" : noun.replace(/s$/, "");
  const who = focus ? ` by ${displayName(focusLabel)}` : "";
  // A quiet period in words: how many, by whom, and — when there are few enough to
  // read — when ("Tue, Sep 15 and Tue, Sep 29").
  const withEntries = trendRows.filter((r) => r.count > 0);
  const when =
    withEntries.length > 0 && withEntries.length <= 4 && grain !== "month"
      ? `: ${listWords(withEntries.map((r) => `${slotLabel(r.key, grain).replace(/^(\w{3}), /, "$1 ")}${r.count > 1 && scopeTotal > withEntries.length ? ` (${r.count})` : ""}`))}`
      : "";
  const whereList = noun === "attempts" ? "order table" : "log";

  return (
    <>
      <div className="me-analytics-head stacked">
        <div className="section-head" style={{ margin: 0 }}>
          {title} analytics
        </div>
        {/* The one filter row, left-aligned above everything it scopes. */}
        <div className="me-filter-row">
          <PeriodBar grain="day" presets={PERIODS} value={period} onChange={setPeriod} max={todayYMD} />
          <DriverFocus
            ns={ns}
            options={focusOptions}
            focus={focus}
            focusLabel={focusLabel}
            onFocus={onFocus}
            blocked={focusBlocked}
          />
          {print && (
            <button type="button" className="btn ghost sm" onClick={print.onClick} disabled={print.disabled} title={print.title}>
              <Icon name="printer" />
              {print.label}
            </button>
          )}
        </div>
      </div>

      {statusLine}
      {notice && <div className="me-notice">{notice}</div>}

      <div className="card an-card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          {/* Every tile stays in a quiet period (a picked driver's rank and "of N" with
              them); only the charts give way. An empty period keeps its total alone — a
              row of "0 · — · 0 · — · 0" over the empty state would only say it again. */}
          <TileStrip className="an-tiles">
            {(form === "empty" ? tiles.slice(0, 1) : tiles).map((t) => (
              <StatTile key={t.label} {...t} />
            ))}
          </TileStrip>
          <hr className="an-rule" />
          {form === "empty" ? (
            <div className="an-empty">
              <div className="an-empty-main">{feedGap?.empty || `No ${title.toLowerCase()}${who} ${phrase}`}</div>
              {period.p !== "12" && (
                <div className="an-empty-next">
                  Widen the period
                  {period.p !== "3" && period.p !== "6" && (
                    <button type="button" className="btn ghost sm" onClick={() => setPeriod({ p: "3" })}>
                      3M
                    </button>
                  )}
                  <button type="button" className="btn ghost sm" onClick={() => setPeriod({ p: "12" })}>
                    12M
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {form === "pending" ? (
                <div className="an-empty" aria-busy="true">
                  <div className="an-empty-next">Loading the period…</div>
                </div>
              ) : form === "few" && !showFew ? (
                <p className="an-few">
                  {scopeTotal} {scopeTotal === 1 ? nounOne : noun}
                  {who} {phrase}
                  {!focus && driversCount ? `, by ${driversCount} driver${driversCount === 1 ? "" : "s"}` : ""}
                  {when}. {scopeTotal === 1 ? "It is" : scopeTotal === 2 ? "Both are" : "All of them are"} in the {whereList} below.{" "}
                  {/* The charts, their tables and CSVs are still a click away. */}
                  <button type="button" className="text-link" onClick={() => setShowFew(true)}>
                    Show the charts
                  </button>
                </p>
              ) : (
                <div className="an-grid" ref={cellRef}>
                  {rows.flat().map((c) => (
                    <div key={c.id} className="an-cell" style={{ "--span": c.span }}>
                      {c.node}
                    </div>
                  ))}
                </div>
              )}
              {chipBar}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// The driver picker, the same on every screen that re-scopes to a driver (the
// manual-entry tabs, Trends › Per Driver): type to search every name offered (no cap),
// pick one to focus the page on them. The box's own clear (×) goes back to the fleet.
// options [{ key, label, name, count?, hint? }] — the list's hint is `hint`, or "N this
// period" when the option has a count.
//
// The box shows the picked option's whole label ("GARRY PITTS (not linked to the
// roster)"), not just the name: the bare name can also be a roster driver's, and
// pressing Enter on it would swap the pick for them.
export function DriverFocus({ ns, options, focus, focusLabel, onFocus, blocked = null, placeholder = "Pick a driver…", hint = "Pick a driver: the tiles and charts follow them" }) {
  const listId = `${ns}-driver-focus`;
  const shown = focus ? options.find((o) => o.key === focus)?.label || focusLabel : "";
  const [text, setText] = React.useState(shown);
  React.useEffect(() => setText(shown), [shown]);
  const byText = React.useMemo(() => {
    const m = new Map();
    for (const o of options) {
      m.set(o.label.toLowerCase(), o.key);
      if (!m.has(o.name.toLowerCase())) m.set(o.name.toLowerCase(), o.key);
    }
    return m;
  }, [options]);
  const pick = (v) => {
    const s = v.trim().toLowerCase();
    if (!s) return onFocus(null);
    const k = byText.get(s);
    if (k) onFocus(k);
  };
  if (blocked) {
    return (
      <div className="me-focus">
        <input type="search" disabled placeholder="Roster not loaded" aria-label="Focus on a driver" title={blocked} />
      </div>
    );
  }
  return (
    <div className="me-focus">
      <input
        type="search"
        list={listId}
        value={text}
        placeholder={placeholder}
        aria-label="Focus on a driver"
        title={hint}
        onChange={(e) => {
          setText(e.target.value);
          // A pick from the list arrives as the whole label.
          if (!e.target.value || byText.has(e.target.value.trim().toLowerCase())) pick(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && pick(text)}
        onBlur={() => setText(shown)}
      />
      {focus && (
        <button type="button" className="me-focus-clear" onClick={() => onFocus(null)} title="Back to the whole fleet" aria-label="Clear the driver">
          <Icon name="x" />
        </button>
      )}
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.key} value={o.label}>
            {o.hint ?? (o.count !== undefined ? `${o.count} this period` : "")}
          </option>
        ))}
      </datalist>
    </div>
  );
}

// What happened after the attempt: one row per outcome, its count and its share of the
// scanned orders. Clicking a row narrows the order table to it.
function OutcomeList({ mix, color, focusLabel, selected }) {
  const title = "What happened after the attempt";
  const parts = mix.parts.filter((p) => p.count > 0);
  const pct = new Map(mix.parts.map((p) => [p.id, p.pct]));
  return (
    <ChartCard
      inset
      title={title}
      subtitle={focusLabel ? displayName(focusLabel) : `${mix.scanned.toLocaleString()} scanned orders`}
      table={chartTable({
        rows: mix.parts.map((p) => ({ label: p.label, count: p.count, pct: p.pct })),
        x: { key: "label", label: "After the attempt" },
        series: [
          { id: "count", label: "Orders" },
          { id: "pct", label: "% of scanned" },
        ],
        source: "dispatch feed, status at the 8 PM scan",
      })}
      height="auto"
    >
      {mix.scanned === 0 ? (
        <div className="empty-state">No scanned orders in this period.</div>
      ) : (
        <BarList
          rows={parts}
          keyOf={(p) => p.id}
          value={(p) => p.count}
          label={(p) => p.label}
          order="given"
          color={color}
          colorOf={(p) => (p.id === "other" ? OTHER_COLOR : color)}
          valueText={(p) => `${p.count.toLocaleString()} · ${pct.get(p.id)}%`}
          scaleTo={mix.scanned}
          rowTitle={(p) => `${p.label}: ${p.count} of ${mix.scanned} (${pct.get(p.id)}%)`}
          limit={0}
          highlightKey={selected || null}
          onMark={(p) => mix.onPick?.(p)}
          sub={`Status at the 8 PM scan, not live${mix.unscanned ? ` · ${mix.unscanned} hand-logged without a scan status` : ""}`}
          ariaLabel={title}
        />
      )}
    </ChartCard>
  );
}

// The picked driver at a glance, under the Drivers chart: their count and rank, a
// trend, what their entries were, and the way into the detail and the printout.
//
//   name, sub        who, and a qualifier (loader, feed name, not on the roster)
//   stats            [{ label, value }]
//   spark            { title, rows: [{ key, label, n, source?, faint? }] }
//   breakdown        { title, rows: [{ label, count }] }
//   notes            strings
//   recent           { title, rows: [{ key, date, pro, item }] }
export function DriverCard({ name, sub, color, stats = [], spark = null, breakdown = null, notes = [], recent = null, onDetail, onPrint, printLabel, printing, onClear }) {
  return (
    <div className="dc" aria-label={`${name} this period`}>
      <div className="dc-head">
        <div>
          <div className="dc-name">{displayName(name)}</div>
          {sub && <div className="dm-sub">{sub}</div>}
        </div>
        <div className="dc-actions">
          {onDetail && (
            <button type="button" className="btn primary sm" onClick={onDetail}>
              Driver detail
            </button>
          )}
          {onPrint && (
            <button type="button" className="btn ghost sm" onClick={onPrint} disabled={printing}>
              <Icon name="printer" />
              {printLabel}
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={onClear} title="Back to the whole fleet">
            <Icon name="x" />
            Clear
          </button>
        </div>
      </div>
      <div className="dc-grid">
        <div className="dc-stats">
          {stats.map((s) => (
            <div key={s.label} className="dc-stat">
              <span className="dc-stat-lbl">{s.label}</span>
              <span className="dc-stat-num">{s.value}</span>
            </div>
          ))}
        </div>
        {spark && spark.rows.length > 0 && <Spark spark={spark} color={color} />}
        {breakdown && (
          <div className="dc-break">
            <div className="dc-h">{breakdown.title}</div>
            {breakdown.rows.length === 0 ? (
              <div className="meta">—</div>
            ) : (
              breakdown.rows.map((r) => (
                <div key={r.label} className="dc-break-row">
                  <span>{r.label}</span>
                  <b>{r.count}</b>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {notes.length > 0 && (
        <div className="dc-notes">
          {notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
      {recent && recent.rows.length > 0 && (
        <div className="dc-recent">
          <div className="dc-h">{recent.title}</div>
          {recent.rows.map((r) => (
            <div key={r.key} className="dc-recent-row">
              <span className="dd-date">{r.date}</span>
              <span className="pro-num">{r.pro}</span>
              {r.item && <span className="ff-item-chip">{r.item}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SOURCE_TEXT = { live: "live entries", history: "imported history", not_tracked: "not captured", none: "no data" };

// A sparkline of plain columns (spec §7.4): every column gray but the latest, in the
// category colour; no axis labels and no numbers in it — the card's title names the
// span, and each column's value, dates and source are in its hover and its screen-reader
// label. Bars are as wide as every other column chart's (kit/shape.js barGeometry).
function Spark({ spark, color }) {
  const [ref, size] = useSize();
  const max = Math.max(1, ...spark.rows.map((r) => r.n || 0));
  const lastWith = spark.rows.reduce((a, r, i) => (r.n !== null ? i : a), -1);
  const { bar, radius } = barGeometry(spark.rows.length, size.width);
  const all = spark.rows.map((r) => `${r.label}: ${r.n === null ? "—" : r.n}`).join("; ");
  return (
    <div className="dc-spark">
      <div className="dc-h">{spark.title}</div>
      <div ref={ref} className="dc-spark-cols" role="list" aria-label={all} title={all} style={{ maxWidth: `min(100%, ${sparkWidth(spark.rows.length)}px)` }}>
        {size.width > 0 &&
          spark.rows.map((r, i) => {
            const text = `${r.label}: ${r.n === null ? "—" : r.n}${r.source ? ` · ${SOURCE_TEXT[r.source] || r.source}` : ""}${r.note ? ` · ${r.note}` : ""}`;
            const state = r.n === null ? "none" : r.n === 0 ? "zero" : "";
            return (
              <div key={r.key} className={`dc-spark-col ${state}`.trim()} role="listitem" title={text} aria-label={text}>
                {r.n !== null && (
                  <span
                    style={{
                      width: bar,
                      height: r.n === 0 ? 2 : `${(r.n / max) * 100}%`,
                      borderRadius: r.n === 0 ? 1 : `${radius}px ${radius}px 0 0`,
                      background: r.n === 0 ? undefined : i === lastWith ? color : DEEMPH,
                      opacity: r.faint && i === lastWith ? PARTIAL_OPACITY : 1,
                    }}
                  />
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
