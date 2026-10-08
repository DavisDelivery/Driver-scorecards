import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { catLabel, catColor, categoriesFor, ATTEMPTS } from "../../data/categories.js";
import { addDays, currentYmET, fmtDate, fmtDateRange } from "../../data/period.js";
import { csvName } from "../../data/csv.js";
import { fetchAttemptsRange, todayET, FEED_EPOCH } from "../../data/attemptsFeed.js";
import { buildAttemptRecords } from "../../data/attemptRecords.js";
import { STATE_TEXT, APP_ERA, fmtYm, monthsText } from "../../data/coverage.js";
import {
  monthlySeries,
  compareWindows,
  overviewTiles,
  weeklyAttempts,
  companyWindow,
  companyDrill,
  weekDrill,
  VERDICT_TEXT,
} from "../../data/companyMetrics.js";
import ChartCard from "../kit/ChartCard.jsx";
import StatTile, { TileStrip } from "../kit/StatTile.jsx";
import StackedColumns from "../kit/charts/StackedColumns.jsx";
import { chartTable, avgLine, peakSummary, toDate, sparkPlan, shadedReasons } from "../kit/shape.js";
import { BRAND, SURFACE, WASH, ZERO } from "../kit/chartTheme.js";
import useSize from "../kit/useSize.js";
import { openDrill } from "../kit/drillNav.js";
import { openCoverage } from "./nav.js";
import WhatChanged from "./WhatChanged.jsx";
import LeftOut from "./LeftOut.jsx";

// Company History › Overview: the headline over the picked window, what it was
// compared on and what changed (WhatChanged.jsx), every month on file, and the dispatch
// feed's attempted orders beside — never inside — the failures.
//
// Every number is a coverage cell (coverage.js) and every click opens the drawer on
// exactly what was counted, with the number shown (test/drill-reconcile.test.mjs).

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const fmtPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x * 1000) / 10)}%`;

// Where a month's numbers come from, in words: "imported history: Damage, Forgotten
// Freight · not tracked: Late".
function sourceText(row, cats) {
  const by = new Map();
  for (const c of cats) {
    const s = row.states[c];
    (by.get(s) || by.set(s, []).get(s)).push(catLabel(c));
  }
  if (by.size === 1) return STATE_TEXT[[...by.keys()][0]];
  return [...by].map(([s, list]) => `${STATE_TEXT[s]}: ${list.join(", ")}`).join(" · ");
}

export default function Overview({ cov, months, label, cmpMonths, cats, measure, lfl, allowSourceChange, today, phone }) {
  const a = useAnalytics();
  const blend = a.blend(null);
  const series = React.useMemo(() => monthlySeries(cov, months, cats, { measure, today }), [cov, months, cats, measure, today]);
  const result = React.useMemo(
    () => compareWindows(cov, months, cmpMonths, cats, { lfl, allowSourceChange, today }),
    [cov, months, cmpMonths, cats, lfl, allowSourceChange, today],
  );
  // Every tile's number, or why there is none, and the drawer it opens (companyMetrics.js).
  const tiles = React.useMemo(
    () => overviewTiles({ cov, blend, incidents: a.incidents, months, cats, today, label }),
    [cov, blend, a.incidents, months, cats, today, label],
  );
  const A = result.A;
  const { workdays } = tiles.perWorkday;
  const cmpLabel = monthsText(cmpMonths);
  const [showCompared, setShowCompared] = React.useState(false);
  const [focus, setFocus] = React.useState(null);
  // A legend isolation whose category was since switched off isolates nothing.
  const isolated = cats.includes(focus) ? focus : null;
  // A What-changed sentence hovered: its categories forward, the rest gray, for as long
  // as the pointer (or focus) is on it.
  const [hover, setHover] = React.useState(null);
  const emphasis = hover && hover.some((c) => cats.includes(c)) ? hover : isolated;

  // The drawer on a set of failures and months, with the number it was clicked from.
  const open = (categoryIds, ms, expected, scopeLabel, title = null) =>
    openDrill(companyDrill(categoryIds, ms, expected, scopeLabel, { title, vocab: cats }));

  // ── The hero ────────────────────────────────────────────────────────────────
  const d = result.delta;
  const compared = result.X > 0 || result.Cmp > 0;
  const how = !lfl ? "all covered cells" : result.sourceChange ? "different source" : "like-for-like";
  const verdict = result.verdict.verdict === "withheld" ? `no verdict — ${result.verdict.why}` : VERDICT_TEXT[result.verdict.verdict];

  // The sparkline: the 24 months up to the window's last month, counts, whatever the range.
  const last = months[months.length - 1];
  const sparkRows = React.useMemo(
    () => monthlySeries(cov, companyWindow("24", { through: last }).months, cats, { today }),
    [cov, last, cats, today],
  );

  // ── Every month on file ─────────────────────────────────────────────────────
  const SERIES = categoriesFor(cats).map((c) => ({
    id: c.id,
    label: c.id === "complaint" ? "Other (complaints)" : c.label,
    color: c.color,
  }));
  // The table keeps every 3-month average (roll3); the chart draws it only over runs of
  // three months or more (roll3Line), and the hover reads roll3, so the hover and the
  // table never disagree.
  const LINE = { id: "roll3", label: "3-month average", color: BRAND, line: true, digits: 2 };
  const LINE_DRAWN = { ...LINE, id: "roll3Line", tip: "roll3" };
  // The hover readout: the month and its workdays on the head line, then one short line
  // per way a category wasn't captured whole ("Damage, Late: partly captured"). Why is
  // left to the table view and Data Coverage — the long reasons ran the readout off the
  // card.
  const rows = series.map((r) => {
    const by = new Map();
    for (const c of cats) {
      const st = r.states[c];
      if (st === "live" || st === "history") continue;
      (by.get(st) || by.set(st, []).get(st)).push(catLabel(c));
    }
    const now = currentYmET();
    const td = r.ym === now ? toDate({ key: r.ym, start: `${r.ym}-01`, end: `${r.ym}-31` }, today) : null;
    return {
      ...r,
      __partial: r.ym === now,
      __head: `${r.label} · ${plural(r.workdays, "workday")}${td ? ` · to date (${td.days} of ${td.of} days)` : ""}`,
      __notes: [
        ...[...by].map(([st, list]) => `${list.join(", ")}: ${STATE_TEXT[st]}`),
        ...(measure === "workday" && r.count !== null ? [`${r.count} counted`] : []),
        ...(r.count !== null ? ["Click a segment for its entries"] : []),
      ],
    };
  });
  // The 3-month average exists only where three months in a row were captured the same
  // way (rolling3). It is drawn over runs of three months or more, and only when that is
  // a real line — six months or more, reaching the latest six (kit/shape.js avgLine);
  // scattered fragments read as a fault, so then the chart drops it and only the hover
  // and the table carry it. Display only — they keep every value.
  const avg = avgLine(rows.map((r) => r.roll3));
  const drawnRows = rows.map((r, i) => ({ ...r, roll3Line: avg.values[i] }));
  const rollDrawn = avg.drawn;
  const rollAny = rows.some((r) => r.roll3 !== null && r.roll3 !== undefined);
  const crossesApp = months[0] < APP_ERA && months[months.length - 1] >= APP_ERA;
  // The shaded months (no count at all), each reason named once with its months, as on
  // the manual-entry trends: "Shaded: no data on file (Jul 2025, Dec 2025)".
  const shadedNote = shadedReasons(
    rows.filter((r) => r.count === null),
    {
      keyOf: (r) => r.ym,
      why: (r) => {
        const st = new Set(cats.map((c) => r.states[c]));
        return st.size === 1 && st.has("not_tracked") ? STATE_TEXT.not_tracked : STATE_TEXT.no_data;
      },
    },
  )
    .map((x) => `${x.why} (${monthsText(x.keys).replace(/ (\d{4})/g, "\u00a0$1")})`)
    .join(", ");
  // Near the right edge of a phone-width plot the long words would run off it.
  const tightNote = phone && months.indexOf(APP_ERA) / months.length > 0.7;
  const table = (() => {
    const t = chartTable({
      rows,
      x: { key: "label", label: "Month" },
      series: SERIES,
      lines: [LINE],
      total: true,
      source: (r) => sourceText(r, cats),
    });
    t.columns.splice(t.columns.length - 1, 0, { key: "workdays", label: "Workdays", num: true });
    t.rows.forEach((row, i) => {
      row.workdays = rows[i].workdays;
    });
    // The source names categories by how they were captured: long, so it wraps.
    t.columns = t.columns.map((c) => (c.key === "__source" ? { ...c, wrap: true } : c));
    return t;
  })();

  const caveats = result.exclusions;

  return (
    <>
      <div className="co-top">
        <div className="kpi co-hero">
          <div className="kpi-label">Counted failures</div>
          <button
            type="button"
            className="kpi-value kpi-value-btn co-hero-num"
            onClick={() => openDrill(tiles.counted.drill)}
            aria-label={`Counted failures: ${A}. Open the detail`}
          >
            {A.toLocaleString()}
          </button>
          <div className="kpi-delta" title="Every driver's failures — inactive drivers and ids with no roster row included">
            {label} · {cats.length === 1 ? catLabel(cats[0]) : `${cats.length} categories`}
          </div>
          {compared ? (
            <div className="co-delta">
              <b>
                {d > 0 ? "▲" : d < 0 ? "▼" : "±"} {Math.abs(d).toLocaleString()}
                {result.pct !== null ? ` (${fmtPct(result.pct)})` : ""} {d > 0 ? "worse" : d < 0 ? "better" : "no change"}
              </b>{" "}
              vs {cmpLabel}, {how} · {verdict}
              <button
                type="button"
                className="kpi-note-n co-compared"
                aria-expanded={showCompared}
                onClick={() => setShowCompared((v) => !v)}
              >
                compared on {result.X.toLocaleString()} of {A.toLocaleString()}
              </button>
            </div>
          ) : (
            <div className="co-delta">
              Nothing in {label} can be compared {lfl ? "like-for-like " : ""}with {cmpLabel}
              {caveats.length ? "" : " — no months to compare"}.
            </div>
          )}
          {lfl && <LeftOut exclusions={caveats} />}
          <Sparkline rows={sparkRows} today={today} />
        </div>
        <WhatChanged
          cov={cov}
          months={months}
          label={label}
          cmpMonths={cmpMonths}
          cmpLabel={cmpLabel}
          cats={cats}
          lfl={lfl}
          allowSourceChange={allowSourceChange}
          today={today}
          onFocus={setHover}
        />
        <TileStrip className="card-strip co-kpis">
          <StatTile
            label="Per workday"
            value={tiles.perWorkday.value === null ? "—" : tiles.perWorkday.value.toFixed(2)}
            sub={
              compared && measureRate(result)
                ? `${plural(workdays, "workday")} · compared ${measureRate(result)}`
                : `${plural(workdays, "workday")} (Mon–Fri) in the months on file`
            }
            title="Counted failures over the Mon–Fri days of the months that hold them. Holidays aren't removed."
          />
          <StatTile
            label="Drivers involved"
            value={tiles.drivers.value}
            sub={
              tiles.drivers.value
                ? `${tiles.drivers.perDriver.toFixed(1)} per driver · inactive and off-roster included`
                : "none"
            }
            title="Drivers with at least one counted failure in the window. Drivers with none can't be counted: history stores no zeros."
          />
          <StatTile
            label="Unattributed"
            value={tiles.unattributed.value === null ? "—" : tiles.unattributed.value}
            sub={
              tiles.unattributed.value === null
                ? tiles.unattributed.reason
                : `in no total${tiles.unattributed.noFault ? ` · +${tiles.unattributed.noFault} marked no-fault` : ""}` +
                  (tiles.unattributed.liveOnly ? " · live months only" : "")
            }
            title="Failures with no driver, not marked no-fault: in no driver's total and no company total. Marked no-fault ones would count against nobody anyway."
            onClick={tiles.unattributed.drill ? () => openDrill(tiles.unattributed.drill) : null}
          >
            <button type="button" className="kpi-action" onClick={() => openCoverage({ section: "unattributed" })}>
              By month in Data Coverage
            </button>
          </StatTile>
          <StatTile
            label="Driver-fault share"
            value={tiles.fault.value === null ? "—" : `${Math.round(tiles.fault.value * 100)}%`}
            sub={
              tiles.fault.value === null
                ? tiles.fault.reason
                : `${tiles.fault.n} of ${tiles.fault.total} counted live · reviewed ${Math.round(tiles.fault.reviewed * 100)}%` +
                  (tiles.fault.historyMonths.length ? ` · ${plural(tiles.fault.historyMonths.length, "history month")} not tracked` : "")
            }
            title="Live failures whose fault is the driver's, of every counted live failure. Imported history has no fault field."
          />
          <StatTile
            label="Compliments"
            value={tiles.compliments.value === null ? "—" : tiles.compliments.value}
            sub={
              tiles.compliments.value === null
                ? tiles.compliments.reason
                : `credit, never netted${tiles.compliments.from ? ` · logged from ${fmtYm(tiles.compliments.from)}` : ""}`
            }
            title="Compliments are a credit: never added to or netted against failures"
            onClick={tiles.compliments.drill ? () => openDrill(tiles.compliments.drill) : null}
          />
        </TileStrip>
      </div>

      {showCompared && compared && (
        <div className="card co-compared-card">
          <div className="card-header">
            <div className="card-title">What was compared</div>
            <span className="card-hint">
              {result.X.toLocaleString()} of {A.toLocaleString()} this period against {result.Cmp.toLocaleString()} in{" "}
              {cmpLabel}
            </span>
          </div>
          <div className="table-wrap">
            <table className="data analytics-table co-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Months compared</th>
                  <th className="num">This period</th>
                  <th className="num">Compared with</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {result.byCat.map((b) => (
                  <tr key={b.cat}>
                    <td>
                      <span className="cat-swatch" style={{ background: catColor(b.cat) }} />
                      {catLabel(b.cat)}
                    </td>
                    <td className="co-months">{monthsText(b.months)}</td>
                    <td className="num">
                      <button type="button" className="kpi-note-n" onClick={() => open([b.cat], b.months, b.X, monthsText(b.months))}>
                        {b.X}
                      </button>
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="kpi-note-n"
                        onClick={() => open([b.cat], b.cmpMonths, b.Cmp, monthsText(b.cmpMonths))}
                      >
                        {b.Cmp}
                      </button>
                    </td>
                    <td className="num">
                      {b.X - b.Cmp > 0 ? "+" : ""}
                      {b.X - b.Cmp}
                    </td>
                  </tr>
                ))}
                <tr className="co-total">
                  <td>Total</td>
                  <td />
                  <td className="num">{result.X}</td>
                  <td className="num">{result.Cmp}</td>
                  <td className="num">
                    {d > 0 ? "+" : ""}
                    {d}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <ChartCard
          className="co-monthly"
          title="Every month on file"
          subtitle={[
            `${A.toLocaleString()} counted failures`,
            measure === "workday" ? null : peakSummary(rows, { grain: "month", value: (r) => r.count, keyOf: (r) => r.ym, partial: (r) => r.__partial }),
          ]
            .filter(Boolean)
            .join(" · ")}
          legend={[...SERIES, ...(rollDrawn ? [LINE] : [])]}
          onLegend={(id) => setFocus((f) => (f === id ? null : id))}
          focus={isolated}
          note={
            shadedNote || crossesApp || (!rollDrawn && rollAny)
              ? [
                  shadedNote ? (
                    <span key="band" title="Data Coverage has each month's detail">
                      <i className="cc-note-swatch" style={{ background: WASH, boxShadow: `inset 0 0 0 1px ${ZERO}` }} />
                      Shaded: {shadedNote}
                    </span>
                  ) : null,
                  crossesApp ? (
                    <span key="era" title="Data Coverage has each month's detail">
                      Before {fmtYm(APP_ERA)}: mostly spreadsheet history
                    </span>
                  ) : null,
                  !rollDrawn && rollAny ? (
                    <span key="avg" title="Too few months in a row were captured the same way to draw it">
                      3-month average in the hover
                    </span>
                  ) : null,
                ]
              : null
          }
          table={table}
          csv={csvName("Company history", measure === "workday" ? "per workday" : "", label)}
          height={phone ? 300 : 340}
        >
          <StackedColumns
            data={drawnRows}
            xKey="ym"
            grain="month"
            keyOf={(r) => r.ym}
            series={SERIES}
            lines={rollDrawn ? [LINE_DRAWN] : []}
            hoverLines={rollDrawn || !rollAny ? [] : [LINE]}
            focusId={emphasis}
            decimals={measure === "workday"}
            annotations={
              crossesApp
                ? [
                    tightNote
                      ? { x: APP_ERA, before: "spreadsheet", after: "app" }
                      : { x: APP_ERA, before: "spreadsheet backfill", after: "app incidents" },
                  ]
                : []
            }
            onSegment={(r, c) => {
              const n = r.counts[c];
              if (n !== null && n !== undefined) open([c], [r.ym], n, fmtYm(r.ym));
            }}
            onMark={(r) => {
              if (r.count !== null) open(cats, [r.ym], r.count, fmtYm(r.ym), "Counted failures");
            }}
          />
        </ChartCard>
      </div>

      <AttemptedOrders logged={tiles.attempts} label={label} />
    </>
  );
}

// "1.79 vs 1.92 a workday" — the compared cells' rates, when there are both.
function measureRate(r) {
  const rate = (n, e) => (e ? (n / e).toFixed(2) : null);
  const x = rate(r.X, r.eA);
  const c = rate(r.Cmp, r.eC);
  return x && c ? `${x} vs ${c} a workday` : null;
}

// The hero's sparkline: 24 monthly totals as one brand-blue line over a light area,
// drawn over each run of three or more months that hold a count, a gap band where there
// is none, and one dot on the latest complete month (kit/shape.js sparkPlan). The month
// in progress isn't drawn — part of a month reads as a dip. With fewer than six months
// on file it isn't drawn at all. Hover or arrow keys read a month out.
function Sparkline({ rows, today }) {
  const [peek, setPeek] = React.useState(null);
  const [ref, size] = useSize();
  const W = size.width;
  const H = 40;
  const pad = 5;
  const thisMonth = String(today).slice(0, 7);
  const values = rows.map((r) => (r.ym < thisMonth ? r.count : null));
  let latest = -1;
  values.forEach((v, i) => {
    if (v !== null && v !== undefined) latest = i;
  });
  const plan = sparkPlan(values, { latest });
  if (!rows.length || !plan) return null;
  const max = Math.max(1, ...values.filter((v) => v !== null && v !== undefined));
  const slot = W > 0 ? (W - 2 * pad) / Math.max(1, rows.length - 1) : 0;
  const x = (i) => pad + i * slot;
  const y = (v) => H - 2 - (v / max) * (H - pad - 2);
  const read = (i) => (rows[i] ? `${fmtYm(rows[i].ym)}: ${rows[i].count === null ? "no data" : rows[i].count}` : "");
  const path = (run) => run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(values[i])}`).join(" ");
  const area = (run) => `${path(run)} L${x(run[run.length - 1])},${H} L${x(run[0])},${H} Z`;
  return (
    <div className="co-spark" ref={ref}>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Counted failures by month, ${fmtYm(rows[0].ym)} to ${fmtYm(rows[rows.length - 1].ym)}. Use the arrow keys to read a month.`}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const from = peek === null ? rows.length - 1 : peek;
            setPeek(Math.max(0, Math.min(rows.length - 1, from + (e.key === "ArrowLeft" ? -1 : 1))));
          }}
          onBlur={() => setPeek(null)}
        >
          {plan.gaps.map(([a, b]) => (
            <rect key={`g${a}`} x={x(a) - slot / 2} y={0} width={(b - a + 1) * slot} height={H} fill={WASH} />
          ))}
          {plan.runs.map((run) => (
            <g key={`r${run[0]}`}>
              <path d={area(run)} fill={BRAND} fillOpacity={0.1} stroke="none" />
              <path d={path(run)} fill="none" stroke={BRAND} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {peek !== null && values[peek] !== null && values[peek] !== undefined && (
            <circle cx={x(peek)} cy={y(values[peek])} r={3} fill={SURFACE} stroke={BRAND} strokeWidth={1.5} />
          )}
          {plan.latest >= 0 && <circle cx={x(plan.latest)} cy={y(values[plan.latest])} r={4} fill={BRAND} stroke={SURFACE} strokeWidth={1.5} />}
          {rows.map((r, i) => (
            <rect
              key={r.ym}
              x={x(i) - slot / 2}
              y={0}
              width={slot}
              height={H}
              fill="transparent"
              onMouseEnter={() => setPeek(i)}
              onMouseLeave={() => setPeek(null)}
            />
          ))}
        </svg>
      )}
      <div className="co-spark-read" aria-live="polite">
        {peek !== null ? read(peek) : plan.latest >= 0 ? `${read(plan.latest)} · last ${rows.length} months` : `last ${rows.length} months`}
      </div>
    </div>
  );
}

// ── Attempted orders, from the dispatch feed ──────────────────────────────────
//
// Its own chart, never stacked with failures: 193 of 348 sampled feed orders are the
// same PRO as a Late incident. The feed's free daily GET (nuvizz-attempts) is read
// through the shared day cache, the last 45 days by default and back to the feed's
// first day when asked. The orders are published for the drawer (AnalyticsProvider),
// so a week drills into exactly the orders it counted.

const FEED_CHUNK = 45;

function AttemptedOrders({ logged, label }) {
  const a = useAnalytics();
  const yesterday = addDays(todayET(), -1);
  const recent = addDays(yesterday, -(FEED_CHUNK - 1));
  const [start, setStart] = React.useState(recent < FEED_EPOCH ? FEED_EPOCH : recent);
  const [feed, setFeed] = React.useState({ status: "loading", days: new Map(), failed: 0 });

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setFeed((f) => ({ ...f, status: "loading" }));
    (async () => {
      const days = new Map();
      let failed = 0;
      // Newest first, a chunk at a time, each shown as it lands.
      for (let end = yesterday; end >= start; end = addDays(end, -FEED_CHUNK)) {
        const s = addDays(end, -(FEED_CHUNK - 1));
        const r = await fetchAttemptsRange(s < start ? start : s, end, { signal: controller.signal, maxDays: FEED_CHUNK });
        if (!active) return;
        for (const [d, entry] of r.days) days.set(d, entry);
        failed += r.failed || 0;
        setFeed({ status: "loading", days: new Map(days), failed });
      }
      setFeed({ status: "ready", days, failed });
    })().catch((e) => {
      if (!active || e?.name === "AbortError") return;
      setFeed({ status: "error", days: new Map(), failed: 0 });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [start, yesterday]);

  const records = React.useMemo(
    () =>
      buildAttemptRecords({ feedDays: feed.days, incidents: a.incidents, drivers: a.drivers }).records.filter(
        (r) => r.date >= start && r.date <= yesterday,
      ),
    [feed.days, a.incidents, a.drivers, start, yesterday],
  );
  const loadedSpan = React.useMemo(() => {
    const ds = [...feed.days.keys()].filter((d) => d >= start).sort();
    return ds.length ? { start: ds[0], end: ds[ds.length - 1] } : null;
  }, [feed.days, start]);
  const weeks = React.useMemo(
    () => (loadedSpan ? weeklyAttempts(records, feed.days, loadedSpan) : []),
    [records, feed.days, loadedSpan],
  );
  const shown = weeks.reduce((t, w) => t + w.n, 0);
  // A week with no feed data and nothing hand-logged has no count to draw: its slot is
  // shaded, never a zero. A week only partly covered is faded; the hover says which days.
  // The chart draws __n; the hover reads n, the count the table lists.
  const bars = React.useMemo(
    () =>
      weeks.map((w) => ({
        ...w,
        __n: !w.n && w.noData ? null : w.n,
        __partial: w.n > 0 && (w.noData > 0 || w.start !== w.key || w.end !== addDays(w.key, 6)),
      })),
    [weeks],
  );
  const allFailed = feed.status === "error" || (feed.status === "ready" && feed.days.size > 0 && feed.failed === feed.days.size);
  // Which weeks are faded, and why, named as shadedReasons names months: "a day with no
  // feed data (Aug 31, Sep 7), partly loaded (Aug 24), to date (Oct 5)".
  const fadedNote = shadedReasons(bars, {
    why: (w) =>
      !w.__partial
        ? null
        : w.noData > 0
          ? "days with no feed data"
          : w.start !== w.key
            ? "partly loaded"
            : "to date",
  })
    .map((x) => `${x.why} (${x.keys.map((k) => fmtDate(k)).join(", ")})`)
    .join(", ");

  // The drawer counts a week's orders from these records — published once they're in,
  // taken back when the Overview closes (the Attempts tab publishes its own).
  const { publishAttempts } = a;
  React.useEffect(() => {
    if (feed.status === "ready" || feed.status === "error") {
      publishAttempts(records, { error: allFailed ? "couldn't reach the feed" : null });
    } else {
      publishAttempts(null);
    }
  }, [feed.status, records, allFailed, publishAttempts]);
  React.useEffect(() => () => publishAttempts(null), [publishAttempts]);

  const SERIES = [{ id: "__n", tip: "n", label: "Attempted orders", color: catColor(ATTEMPTS) }];
  return (
    <ChartCard
      className="co-attempts"
      title="Attempted orders · dispatch feed"
      subtitle={loadedSpan ? `${shown.toLocaleString()} orders · ${monthsDays(loadedSpan)}` : null}
      table={{
        columns: [
          { key: "week", label: "Week of", value: (row) => row.__csvWeek },
          { key: "n", label: "Orders", num: true },
          { key: "noData", label: "Days no data", num: true },
          { key: "unassigned", label: "Unassigned", num: true },
          { key: "source", label: "Source" },
        ],
        rows: weeks.map((w) => ({
          week: fmtDateRange(w.start, w.end),
          // The CSV keeps its ISO span, with the year; the screen reads "Aug 25–30".
          __csvWeek: `${w.start} – ${w.end}`,
          n: w.n,
          noData: w.noData,
          unassigned: w.unassigned,
          source: "dispatch feed + hand-logged attempts",
        })),
      }}
      csv={csvName("Attempted orders by week", loadedSpan ? `${loadedSpan.start} ${loadedSpan.end}` : "")}
      note={
        <>
          {logged.value === null ? (
            <span title={`Attempts (logged) on the Scorecard: ${logged.reason}`}>Logged attempts on the Scorecard: none in {label}</span>
          ) : (
            <span
              title={`Attempts (logged) on the Scorecard, ${label}: a separate count, never added to failures${
                logged.from ? `, logged from ${fmtYm(logged.from)}` : ""
              }`}
            >
              Logged on the Scorecard:{" "}
              <button
                type="button"
                className="kpi-note-n"
                onClick={() => openDrill(logged.drill)}
                disabled={!logged.drill}
              >
                {logged.value}
              </button>
            </span>
          )}
          {bars.some((w) => w.__n === null) && <span>Shaded: no feed data</span>}
          {fadedNote && <span title="The hover says which days">Faded: {fadedNote}</span>}
          {feed.status === "loading" && <span>Loading the dispatch feed…</span>}
          {allFailed && <span className="co-error">Couldn&apos;t reach the dispatch feed — only hand-logged attempts are counted.</span>}
          {!allFailed && feed.failed > 0 && (
            <span className="co-error">
              {plural(feed.failed, "day")} couldn&apos;t be read — shown as no data, not as none.
            </span>
          )}
          {start > FEED_EPOCH && feed.status === "ready" && (
            <button type="button" className="kpi-action" onClick={() => setStart(FEED_EPOCH)}>
              Load since {fmtLong(FEED_EPOCH)}
            </button>
          )}
        </>
      }
      height={220}
    >
      {weeks.length ? (
        <StackedColumns
          data={bars}
          xKey="key"
          grain="week"
          keyOf={(w) => w.key}
          series={SERIES}
          onMark={(w) => openDrill(weekDrill(weeks.find((x) => x.key === w.key) || w))}
        />
      ) : (
        <div className="empty-state">{feed.status === "loading" ? "Loading…" : "No feed days loaded."}</div>
      )}
    </ChartCard>
  );
}

const fmtLong = (ymd) => `${MONTH_ABBR[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}`;
const monthsDays = ({ start, end }) => fmtDateRange(start, end);
