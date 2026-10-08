import React from "react";
import { PERIODS, periodWindow, periodLabel, toYMD, nowET } from "../data/period.js";
import { DAY_STATUS_TEXT } from "../data/attemptsFeed.js";
import { bucketGap } from "../data/manualAnalytics.js";
import { OTHER_COLOR } from "../data/categories.js";
import { csvName } from "../data/csv.js";
import PeriodBar, { usePeriodState } from "./kit/PeriodBar.jsx";
import StatTile from "./kit/StatTile.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import StackedColumns from "./kit/charts/StackedColumns.jsx";
import { chartTable, labelIndexes } from "./kit/shape.js";
import { DEEMPH } from "./kit/chartTheme.js";

// Analytics panel for a manual-entry tab (Forgotten Freight, Unable to Track,
// Mis-Deliveries, Compliments, Attempts): the work week and a trend over a period, with
// headline tiles. The numbers are computed by the tab (ManualEntry.jsx, from
// manualAnalytics.js) and drawn here.
//
// Picking a driver — in the box beside the period, by clicking their bar, or with
// #<ns>.driver= in a link — re-scopes the tiles and both charts to that driver against
// the rest of the fleet. Clearing it brings the fleet view back. Clicking a column
// narrows the tab's table or log to that column, behind a chip, and the list's count is
// the column's.
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

// Props:
//   title, color, ns, sourceLabel     the tab, its category colour, its hash namespace,
//                                     where its records come from (table views)
//   statusLine                        rendered under the filter row (the feed coverage)
//   notice                            one line under it (months only in history)
//   feedGap                           { why, empty } when there is no feed data to count at
//                                     all: the numbers are the hand-logged rows alone, and an
//                                     empty period says `empty` rather than "No records"
//   total                             the fleet's count for the period (an empty panel
//                                     when 0)
//   focus, focusLabel, focusOptions, onFocus       the picked driver (a driver key)
//   focusBlocked                      why no driver can be picked (the roster failed to load)
//   print                             { label, title, onClick, disabled } — secondary
//   tiles                             [{ label, value, sub, title, onClick }]
//   weekday, trend, bucket            chart rows (manualAnalytics.js)
//   chips, onWeekday, onBucket        what the charts' clicks set
//   classify                          { label, field, rows, onPick } or null
//   outcome                           outcomeMix() result, with onPick, or null
//   chipBar                           what the clicks narrowed, shown under the charts
//   historyMonths                     Map(ym → n): months only imported history holds,
//                                     marked on a by-month chart rather than drawn as 0
export default function ManualEntryAnalytics({
  title,
  color,
  ns,
  sourceLabel = "logged entries",
  statusLine = null,
  notice = null,
  feedGap = null,
  total,
  focus = null,
  focusLabel = "",
  focusOptions = [],
  focusBlocked = null,
  onFocus,
  print = null,
  tiles = [],
  weekday = [],
  trend = [],
  bucket = "day",
  chips = {},
  onWeekday,
  onBucket,
  classify = null,
  outcome = null,
  chipBar = null,
  historyMonths = null,
}) {
  const { period, setPeriod } = useTabPeriod(ns);
  const todayYMD = toYMD(nowET());

  const series = focus
    ? [
        { id: "count", label: focusLabel, color },
        { id: "rest", label: "Rest of fleet", color: DEEMPH },
      ]
    : [{ id: "count", label: title, color }];
  const legend = focus ? series : null;
  const tableOf = (rows, xLabel, source = sourceLabel) =>
    chartTable({
      rows,
      x: { key: "label", label: xLabel },
      series: series.map(({ id, label }) => ({ id, label })),
      total: !!focus,
      source,
    });
  const trendTitle = bucket === "day" ? "By day" : bucket === "week" ? "By week" : "By month";
  // A trend row's hover notes and its label on a no-data hairline (manualAnalytics.js
  // bucketGap). A bucket with no feed data at all has no count to show, only what was
  // hand-logged: its zeros are blanks ("—" in the hover and the table, empty in the
  // CSV), never a zero.
  const histOf = (b) => (bucket === "month" && historyMonths ? historyMonths.get(b.key) || 0 : 0);
  const trendRows = trend.map((b) => {
    const gap = bucketGap(b);
    const notes = [];
    if (b.gap) notes.push(`No feed data: ${GAP_TEXT[b.gap] || b.gap}`);
    else if (gap?.note) notes.push(gap.note);
    if (histOf(b)) notes.push(`${histOf(b)} in imported history: a monthly total, not entries this tab can list`);
    if (b.unassigned) notes.push(`${b.unassigned} Unassigned`);
    return {
      ...b,
      ...(gap?.empty ? { count: b.count || null, rest: b.rest || null } : {}),
      // A week or month only partly loaded from the feed is marked too: its column is
      // short by the days nobody has asked for yet, not by attempts.
      __gap: gap?.short || (histOf(b) ? "history only" : null),
      __notes: notes,
    };
  });
  const trendSource = (b) =>
    b.gap
      ? `no feed data — ${GAP_TEXT[b.gap] || b.gap}`
      : b.gapDays
        ? `${sourceLabel}; ${bucketGap(b).note}`
        : histOf(b)
          ? `${sourceLabel}; imported history holds ${histOf(b)} (monthly total only)`
          : sourceLabel;

  return (
    <>
      <div className="me-analytics-head stacked">
        <div className="section-head" style={{ margin: 0 }}>
          {title} · Analytics
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
              📄 {print.label}
            </button>
          )}
        </div>
      </div>

      {statusLine}
      {notice && <div className="me-notice">{notice}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="me-stat-row">
            {tiles.map((t) => (
              <StatTile key={t.label} compact {...t} />
            ))}
          </div>

          {total === 0 ? (
            <div className="empty-state">{feedGap?.empty || "No records in this period."}</div>
          ) : (
            <>
              <div className="me-chart-grid">
                <ChartCard
                  inset
                  title="By workday"
                  legend={legend}
                  table={tableOf(weekday, "Weekday")}
                  csv={csvName(title, focus ? focusLabel : "", "by workday")}
                  height={200}
                >
                  <StackedColumns
                    data={weekday}
                    xKey="label"
                    series={series}
                    onMark={onWeekday}
                    selectedKey={chips.weekday ? chips.weekday.key : null}
                  />
                </ChartCard>
                <ChartCard
                  inset
                  title={trendTitle}
                  legend={legend}
                  table={chartTable({
                    rows: trendRows,
                    x: { key: "label", label: bucket === "month" ? "Month" : bucket === "week" ? "Week of" : "Day" },
                    series: series.map(({ id, label }) => ({ id, label })),
                    total: !!focus,
                    source: trendSource,
                  })}
                  csv={csvName(title, focus ? focusLabel : "", trendTitle)}
                  height={200}
                >
                  <StackedColumns
                    data={trendRows}
                    xKey="label"
                    series={series}
                    xAxis={{ interval: "preserveStartEnd" }}
                    onMark={onBucket}
                    selectedKey={chips.bucket ? chips.bucket.key : null}
                    gapKey="__gap"
                  />
                </ChartCard>
              </div>
              {(classify?.rows?.length > 0 || outcome) && (
                <div className="me-chart-grid me-chart-grid-2">
                  {/* One value is a sentence, not a one-bar chart. */}
                  {classify?.rows?.length === 1 && (
                    <div className="cc-inset">
                      <div className="cc-inset-head">
                        <div className="me-chart-title">{`${classify.label}${focus ? ` · ${focusLabel}` : ""}`}</div>
                      </div>
                      <div className="me-one-class">
                        {classify.rows[0].notSet ? "Not set" : classify.rows[0].label} on{" "}
                        {classify.rows[0].count === 1 ? "the one entry" : `all ${classify.rows[0].count} entries`}
                      </div>
                    </div>
                  )}
                  {classify?.rows?.length > 1 && (
                    <ChartCard
                      inset
                      title={`${classify.label}${focus ? ` · ${focusLabel}` : ""}`}
                      table={chartTable({
                        rows: classify.rows,
                        x: { key: "label", label: classify.label },
                        series: [{ id: "count", label: title }],
                        source: sourceLabel,
                      })}
                      csv={csvName(title, focus ? focusLabel : "", classify.label)}
                      height={Math.max(90, classify.rows.length * 30 + 16)}
                    >
                      <EmphasisBars
                        layout="bars"
                        data={classify.rows}
                        xKey="label"
                        valueName={title}
                        color={color}
                        colorOf={(r) => (r.notSet ? OTHER_COLOR : color)}
                        highlightKey={chips.cls ? chips.cls.key : null}
                        onMark={classify.onPick}
                        labelAll
                      />
                    </ChartCard>
                  )}
                  {outcome && <OutcomeBar mix={outcome} focusLabel={focus ? focusLabel : ""} selected={chips.outcome?.key} />}
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

// The driver picker: type to search every name the period offers (no cap), pick one to
// focus the page on them. The box's clear (or ✕) goes back to the fleet.
//
// The box shows the picked option's whole label ("GARRY PITTS (not linked to the
// roster)"), not just the name: the bare name can also be a roster driver's, and
// pressing Enter on it would swap the pick for them.
function DriverFocus({ ns, options, focus, focusLabel, onFocus, blocked = null }) {
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
        placeholder="Pick a driver…"
        aria-label="Focus on a driver"
        title="Pick a driver: the tiles and charts show them against the rest of the fleet"
        onChange={(e) => {
          setText(e.target.value);
          // A pick from the list arrives as the whole label.
          if (!e.target.value || byText.has(e.target.value.trim().toLowerCase())) pick(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && pick(text)}
        onBlur={() => setText(shown)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.key} value={o.label}>
            {o.count} this period
          </option>
        ))}
      </datalist>
      {focus && (
        <button type="button" className="btn ghost sm" onClick={() => onFocus(null)} title="Back to the whole fleet">
          ✕ {focusLabel}
        </button>
      )}
    </div>
  );
}

// What happened after the attempt: one 100% bar, resolved (left) to unresolved, with
// the share on each segment that has room for it. A part-to-whole of four parts at
// most, so a bar, never a donut. Clicking a segment narrows the order table to it.
function OutcomeBar({ mix, focusLabel, selected }) {
  const parts = mix.parts.filter((p) => p.count > 0);
  const title = `What happened after the attempt${focusLabel ? ` · ${focusLabel}` : ""}`;
  return (
    <ChartCard
      inset
      title={title}
      legend={parts.length >= 2 ? parts.map((p) => ({ id: p.id, label: `${p.label} · ${p.count}`, color: p.color })) : null}
      table={chartTable({
        rows: mix.parts.map((p) => ({ label: p.label, count: p.count, pct: p.pct })),
        x: { key: "label", label: "After the attempt" },
        series: [
          { id: "count", label: "Orders" },
          { id: "pct", label: "% of scanned" },
        ],
        source: "dispatch feed, status at the 8 PM scan",
      })}
      height={58}
    >
      {mix.scanned === 0 ? (
        <div className="empty-state">No scanned orders in this period.</div>
      ) : (
        <div className="ob">
          <div className="ob-bar" role="group" aria-label={title}>
            {parts.map((p) => {
              // Ink on the light gray, white on the blues: both clear 4.5:1.
              const ink = p.id === "other" ? "#111827" : "#ffffff";
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`ob-seg ${selected && selected !== p.id ? "dim" : ""}`}
                  style={{ flexGrow: p.count, background: p.color, color: ink }}
                  onClick={() => mix.onPick?.(p)}
                  title={`${p.label}: ${p.count} of ${mix.scanned} (${p.pct}%)`}
                  aria-label={`${p.label}: ${p.count} of ${mix.scanned}, ${p.pct}%`}
                  aria-pressed={selected === p.id}
                >
                  {p.pct >= 9 ? `${p.pct}%` : ""}
                </button>
              );
            })}
          </div>
          <div className="ob-cap">
            Status at the 8 PM scan, not live
            {mix.unscanned ? ` · ${mix.unscanned} hand-logged without a scan status` : ""}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

// The picked driver at a glance, under the Drivers chart: their count and rank, a
// trend, what their entries were, and the way into the detail and the printout.
//
//   name, sub        who, and a qualifier (loader, feed name, not on the roster)
//   stats            [{ label, value }]
//   spark            { title, rows: [{ key, label, n, source?, faint? }], key: [[glyph, text]] }
//   breakdown        { title, rows: [{ label, count }] }
//   notes            strings
//   recent           { title, rows: [{ key, date, pro, item }] }
export function DriverCard({ name, sub, color, stats = [], spark = null, breakdown = null, notes = [], recent = null, onDetail, onPrint, printLabel, printing, onClear }) {
  return (
    <div className="dc" aria-label={`${name} this period`}>
      <div className="dc-head">
        <div>
          <div className="dc-name">{name}</div>
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
              📄 {printLabel}
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={onClear} title="Back to the whole fleet">
            ✕ Clear
          </button>
        </div>
      </div>
      <div className="dc-grid">
        <div className="dc-stats">
          {stats.map((s) => (
            <div key={s.label} className="dc-stat">
              <span className="dc-stat-num">{s.value}</span>
              <span className="me-stat-lbl">{s.label}</span>
            </div>
          ))}
        </div>
        {spark && spark.rows.length > 0 && <Spark spark={spark} color={color} />}
        {breakdown && (
          <div className="dc-break">
            <div className="me-chart-title">{breakdown.title}</div>
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
          <div className="me-chart-title">{recent.title}</div>
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

const SOURCE_GLYPH = { live: "●", history: "○", none: "–", not_tracked: "⊘" };

// A small column trend. Only the latest and the largest carry their number; every value
// is in each column's hover text and the screen-reader label. `faint` columns (a month
// outside the period, a week only partly loaded) are lighter.
const SOURCE_TEXT = { live: "live entries", history: "imported history", not_tracked: "not captured", none: "no data" };

function Spark({ spark, color }) {
  const max = Math.max(1, ...spark.rows.map((r) => r.n || 0));
  const labelled = new Set(labelIndexes(spark.rows.map((r) => r.n)));
  return (
    <div className="dc-spark">
      <div className="me-chart-title">{spark.title}</div>
      <div className="dc-spark-cols" role="list">
        {spark.rows.map((r, i) => {
          // A month with no number (not captured, no data) draws no bar: it isn't a zero.
          const text = `${r.label}: ${r.n === null ? "—" : r.n}${r.source ? ` · ${SOURCE_TEXT[r.source] || r.source}` : ""}${r.note ? ` · ${r.note}` : ""}`;
          return (
            <div key={r.key} className="dc-spark-col" role="listitem" title={text} aria-label={text}>
              <span className="dc-spark-n">{labelled.has(i) ? r.n : ""}</span>
              <span className="dc-spark-bar">
                {r.n !== null && (
                  <span style={{ height: `${(r.n / max) * 100}%`, background: color, opacity: r.faint ? 0.4 : 1 }} />
                )}
              </span>
              <span className="dc-spark-lbl">{r.short || r.label}</span>
              {r.source && <span className="dc-spark-src" aria-hidden="true">{SOURCE_GLYPH[r.source] || ""}</span>}
            </div>
          );
        })}
      </div>
      {spark.key && (
        <div className="dc-spark-key">
          {spark.key.map(([g, t]) => (
            <span key={t}>
              {g} {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
