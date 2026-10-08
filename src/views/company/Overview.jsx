import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { catLabel, catColor, categoriesFor, ATTEMPTS } from "../../data/categories.js";
import { addDays } from "../../data/period.js";
import { csvName } from "../../data/csv.js";
import { fetchAttemptsRange, todayET, FEED_EPOCH } from "../../data/attemptsFeed.js";
import { buildAttemptRecords } from "../../data/attemptRecords.js";
import { STATE_TEXT, APP_ERA, fmtYm, monthsText, exclusionText } from "../../data/coverage.js";
import {
  monthlySeries,
  sparkRuns,
  compareWindows,
  overviewTiles,
  weeklyAttempts,
  companyWindow,
  companyDrill,
  weekDrill,
  VERDICT_TEXT,
} from "../../data/companyMetrics.js";
import ChartCard from "../kit/ChartCard.jsx";
import StatTile from "../kit/StatTile.jsx";
import StackedColumns from "../kit/charts/StackedColumns.jsx";
import { chartTable } from "../kit/shape.js";
import { BRAND, PRIOR, SURFACE, axisTick } from "../kit/chartTheme.js";
import { openDrill } from "../kit/drillNav.js";
import { openCoverage } from "./nav.js";

// Company History › Overview: the headline over the picked window, what it was
// compared on, every month on file, and the dispatch feed's attempted orders beside —
// never inside — the failures.
//
// Every number is a coverage cell (coverage.js) and every click opens the drawer on
// exactly what was counted, with the number shown (test/drill-reconcile.test.mjs).

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const fmtPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x * 1000) / 10)}%`;

// A month's provenance, one ink glyph under its column: L live, H history, ◐ partly
// captured (drawn, not typed: the font's ◐ is a speck), ⚠ live and history disagree,
// – no data on file. Blank: nothing tracked.
function glyphOf(row, cats) {
  const states = cats.map((c) => row.states[c]);
  if (states.includes("conflict")) return "⚠";
  if (states.includes("partial")) return "◐";
  const whole = states.filter((s) => s === "live" || s === "history");
  if (!whole.length) return states.includes("no_data") ? "–" : "";
  if (whole.every((s) => s === "live")) return "L";
  if (whole.every((s) => s === "history")) return "H";
  return "LH";
}
const GLYPH_KEY = [
  ["L", "live entries"],
  ["H", "imported history"],
  ["◐", "partly captured"],
  ["⚠", "live and history disagree"],
  ["–", "no data on file"],
];
const GLYPH_INK = "#374151";

// The partly-captured mark: a ring with its lower half filled, centred on (0, cy).
function PartialMark({ cy = 0, r = 4.25 }) {
  return (
    <g>
      <circle cx={0} cy={cy} r={r} fill="none" stroke={GLYPH_INK} strokeWidth={1.3} />
      <path d={`M${-r},${cy} A${r},${r} 0 0 0 ${r},${cy} Z`} fill={GLYPH_INK} />
    </g>
  );
}

// A column's slot narrower than this has no room for its glyph: the strip is left out
// (the hover, the table view and Data Coverage still say where each month came from).
const STRIP_MIN_SLOT = 10;

// The plot's width, followed as the card resizes. The axis runs the card's width less
// its padding (2 × 14), the y-axis band (44 − 12) and the right margin (10).
function usePlotWidth() {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setW(Math.max(0, el.clientWidth - 70));
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

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
  const [showCaveats, setShowCaveats] = React.useState(false);
  const [focus, setFocus] = React.useState(null);
  // A legend isolation whose category was since switched off isolates nothing.
  const isolated = cats.includes(focus) ? focus : null;

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
  const LINE = { id: "roll3", label: "3-month average", color: BRAND, line: true, loneDots: true };
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
    return {
      ...r,
      __head: `${r.label} · ${plural(r.workdays, "workday")}`,
      __notes: [
        ...[...by].map(([st, list]) => `${list.join(", ")}: ${STATE_TEXT[st]}`),
        ...(measure === "workday" && r.count !== null ? [`${r.count} counted`] : []),
      ],
    };
  });
  const glyphs = rows.map((r) => glyphOf(r, cats));
  const every = months.length > 24 ? (phone ? 6 : 2) : phone && months.length > 12 ? 2 : 1;
  const [plotRef, plotWidth] = usePlotWidth();
  const strip = !plotWidth || plotWidth / Math.max(1, months.length) >= STRIP_MIN_SLOT;
  const crossesApp = months[0] < APP_ERA && months[months.length - 1] >= APP_ERA;
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
  const usedGlyphs = new Set(glyphs);

  const caveats = result.exclusions;
  const CAVEATS_SHOWN = phone ? 2 : 4;

  return (
    <>
      <div className="kpi-grid co-kpis">
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
              Nothing in {label} can be compared {lfl ? "like-for-like " : ""}with {cmpLabel} —{" "}
              {caveats.length ? "see what was left out below" : "no months to compare"}.
            </div>
          )}
          <Sparkline rows={sparkRows} today={today} />
        </div>
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
            By month in Data Coverage →
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

      {lfl && caveats.length > 0 && (
        <div className="co-caveats" aria-label="Left out of the comparison">
          <span className="co-caveats-h">Left out of the comparison</span>
          {(showCaveats ? caveats : caveats.slice(0, CAVEATS_SHOWN)).map((e) => (
            <button
              key={`${e.cat}|${e.reason}|${e.side}`}
              type="button"
              className="dr-chip co-caveat"
              onClick={() => openCoverage({ ym: caveatMonth(e), cat: e.cat })}
              title={`${exclusionText(e)} — compared with ${monthsText(e.cmpMonths)}. Opens Data Coverage at ${fmtYm(caveatMonth(e))}.`}
            >
              {exclusionText(e)}
            </button>
          ))}
          {caveats.length > CAVEATS_SHOWN && (
            <button type="button" className="kpi-note-n" onClick={() => setShowCaveats((v) => !v)}>
              {showCaveats ? "Show fewer" : `+${caveats.length - CAVEATS_SHOWN} more`}
            </button>
          )}
        </div>
      )}

      <div ref={plotRef}>
        <ChartCard
          className="co-monthly"
          title="Every month on file"
          count={`${A.toLocaleString()} counted failures`}
          legend={[...SERIES, LINE]}
          onLegend={(id) => setFocus((f) => (f === id ? null : id))}
          focus={isolated}
          note={
            <>
              {strip ? (
                GLYPH_KEY.filter(([g]) => usedGlyphs.has(g) || (g === "L" && usedGlyphs.has("LH"))).map(([g, t]) => (
                  <span key={g} className="co-glyph-key">
                    {g === "◐" ? (
                      <svg width="10" height="10" viewBox="-5 -5 10 10" aria-hidden="true">
                        <PartialMark />
                      </svg>
                    ) : (
                      <b>{g}</b>
                    )}{" "}
                    {t}
                  </span>
                ))
              ) : (
                <span>Too many months to mark each one&apos;s source here — the table view lists it</span>
              )}
              <span>Click a segment for its entries, a column for the month</span>
            </>
          }
          table={table}
          csv={csvName("Company history", measure === "workday" ? "per workday" : "", label)}
          height={phone ? 300 : 340}
        >
          <StackedColumns
            data={rows}
            xKey="label"
            keyOf={(r) => r.ym}
            series={SERIES}
            lines={[LINE]}
            focusId={isolated}
            decimals={measure === "workday"}
            annotations={
              crossesApp
                ? [
                    tightNote
                      ? { x: fmtYm(APP_ERA), before: "spreadsheet", after: "app" }
                      : { x: fmtYm(APP_ERA), before: "spreadsheet backfill", after: "app incidents" },
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
            xAxis={{
              interval: 0,
              height: strip ? 46 : 30,
              tick: <MonthTick rows={rows} glyphs={strip ? glyphs : null} every={every} />,
            }}
          />
        </ChartCard>
      </div>

      <AttemptedOrders logged={tiles.attempts} label={label} />
    </>
  );
}

// The month a caveat chip opens Data Coverage at: where its reason lies — the comparison
// month when only that side lacks what this one has.
const caveatMonth = (e) => (e.side === "comparison" ? e.cmpMonths[0] : e.months[0]);

// "1.79 vs 1.92 a workday" — the compared cells' rates, when there are both.
function measureRate(r) {
  const rate = (n, e) => (e ? (n / e).toFixed(2) : null);
  const x = rate(r.X, r.eA);
  const c = rate(r.Cmp, r.eC);
  return x && c ? `${x} vs ${c} a workday` : null;
}

// One column's tick: the month, the year under January (and the first column), and the
// provenance glyph under both. Dense ranges label every `every`-th month; the glyph is
// there for every month whenever the strip is (`glyphs`, null when there's no room).
function MonthTick({ x, y, payload, rows, glyphs, every }) {
  const i = payload?.index ?? rows.findIndex((r) => r.label === payload?.value);
  const ym = rows[i]?.ym || "";
  if (!ym) return null;
  const jan = ym.endsWith("-01");
  const showMonth = i % every === 0 || jan;
  return (
    <g transform={`translate(${x},${y})`}>
      {showMonth && (
        <text y={9} textAnchor="middle" {...axisTick}>
          {MONTH_ABBR[Number(ym.slice(5, 7)) - 1]}
        </text>
      )}
      {(jan || i === 0) && (
        <text y={20} textAnchor="middle" {...axisTick} fontSize={9}>
          {ym.slice(0, 4)}
        </text>
      )}
      {glyphs &&
        (glyphs[i] === "◐" ? (
          <PartialMark cy={32} />
        ) : (
          <text y={36} textAnchor="middle" fill={GLYPH_INK} fontSize={12} fontFamily="var(--sans)">
            {glyphs[i] || ""}
          </text>
        ))}
    </g>
  );
}

// The hero's sparkline: 24 monthly totals in the comparison gray, the latest complete
// month in the brand blue, nothing drawn across a gap or a change in what was captured
// (companyMetrics.js sparkRuns). Hover or arrow keys read a month out.
function Sparkline({ rows, today }) {
  const [peek, setPeek] = React.useState(null);
  const W = 240;
  const H = 44;
  const pad = 5;
  const values = rows.map((r) => r.count);
  const runs = sparkRuns(
    values,
    rows.map((r) => r.sig),
  );
  const max = Math.max(1, ...values.filter((v) => v !== null));
  const x = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, rows.length - 1);
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const lastComplete = String(today).slice(0, 7);
  let latest = -1;
  rows.forEach((r, i) => {
    if (r.count !== null && r.ym < lastComplete) latest = i;
  });
  const read = (i) => (rows[i] ? `${fmtYm(rows[i].ym)}: ${rows[i].count === null ? "no data" : rows[i].count}` : "");
  const slot = (W - 2 * pad) / Math.max(1, rows.length - 1);
  if (!rows.length) return null;
  return (
    <div className="co-spark">
      <svg
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
        {runs.map((run, k) =>
          run.length > 1 ? (
            <polyline
              key={k}
              points={run.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
              fill="none"
              stroke={PRIOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <circle key={k} cx={x(run[0].i)} cy={y(run[0].v)} r={1.8} fill={PRIOR} />
          ),
        )}
        {peek !== null && rows[peek]?.count !== null && (
          <circle cx={x(peek)} cy={y(rows[peek].count)} r={3} fill={SURFACE} stroke={PRIOR} strokeWidth={1.5} />
        )}
        {latest >= 0 && (
          <circle cx={x(latest)} cy={y(rows[latest].count)} r={3.2} fill={BRAND} stroke={SURFACE} strokeWidth={1.5} />
        )}
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
      <div className="co-spark-read" aria-live="polite">
        {peek !== null ? read(peek) : latest >= 0 ? `${read(latest)} · 24 months` : "24 months"}
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
  // The no-data days are under every week's column (WeekTick); a week with nothing to
  // draw is also a hairline, so it can't read as an empty week.
  const bars = React.useMemo(() => weeks.map((w) => ({ ...w, gap: !w.n && w.noData ? "no data" : null })), [weeks]);
  const allFailed = feed.status === "error" || (feed.status === "ready" && feed.days.size > 0 && feed.failed === feed.days.size);

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

  const SERIES = [{ id: "n", label: "Attempted orders", color: catColor(ATTEMPTS) }];
  return (
    <ChartCard
      className="co-attempts"
      title="Attempted orders · dispatch feed"
      count={loadedSpan ? `${shown.toLocaleString()} orders · ${monthsDays(loadedSpan)}` : null}
      table={{
        columns: [
          { key: "week", label: "Week of" },
          { key: "n", label: "Orders", num: true },
          { key: "noData", label: "Days no data", num: true },
          { key: "unassigned", label: "Unassigned", num: true },
          { key: "source", label: "Source" },
        ],
        rows: weeks.map((w) => ({
          week: `${w.start} – ${w.end}`,
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
            <span>Attempts (logged) on the Scorecard: {logged.reason} — none in {label}.</span>
          ) : (
            <span>
              Attempts (logged) on the Scorecard, {label}:{" "}
              <button
                type="button"
                className="kpi-note-n"
                onClick={() => openDrill(logged.drill)}
                disabled={!logged.drill}
              >
                {logged.value}
              </button>{" "}
              — a separate count, never added to failures{logged.from ? `, logged from ${fmtYm(logged.from)}` : ""}.
            </span>
          )}
          {weeks.some((w) => w.noData) && <span>Under a week: its days with no feed data — not zero</span>}
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
          xKey="label"
          keyOf={(w) => w.key}
          series={SERIES}
          gapKey="gap"
          onMark={(w) => openDrill(weekDrill(w))}
          xAxis={{ interval: 0, height: 30, tick: <WeekTick weeks={weeks} /> }}
        />
      ) : (
        <div className="empty-state">{feed.status === "loading" ? "Loading…" : "No feed days loaded."}</div>
      )}
    </ChartCard>
  );
}

// A week's tick: its Monday, and under it how many of its days had no feed data
// ("2d no data") — a part-loaded week must not read as a full count. Weeks too narrow
// for every label show every other one, the latest always; the no-data line stays,
// shortened to "2d" when there is no room for the words.
function WeekTick({ x, y, payload, width, weeks }) {
  const i = payload?.index ?? weeks.findIndex((w) => w.label === payload?.value);
  const w = weeks[i];
  if (!w) return null;
  const slot = width && weeks.length ? width / weeks.length : 60;
  const showLabel = slot >= 34 || i % 2 === (weeks.length - 1) % 2;
  return (
    <g transform={`translate(${x},${y})`}>
      {showLabel && (
        <text y={9} textAnchor="middle" {...axisTick}>
          {w.label}
        </text>
      )}
      {w.noData > 0 && (
        <text y={21} textAnchor="middle" {...axisTick} fontSize={9}>
          {slot >= 54 ? `${w.noData}d no data` : `${w.noData}d`}
        </text>
      )}
    </g>
  );
}

const fmtLong = (ymd) => `${MONTH_ABBR[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}`;
const monthsDays = ({ start, end }) => `${fmtLong(start)} – ${fmtLong(end)}`;
