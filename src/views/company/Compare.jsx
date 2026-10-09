import React from "react";
import { catLabel, catColor, categoriesFor } from "../../data/categories.js";
import { csvName } from "../../data/csv.js";
import { DROP_TEXT, monthsText, exclusionText } from "../../data/coverage.js";
import {
  compareWindows,
  compareByCategory,
  comparedTotalsDrill,
  sharedMonths,
  yearLines,
  quarterMix,
  VERDICT_TEXT,
} from "../../data/companyMetrics.js";
import ChartCard from "../kit/ChartCard.jsx";
import BarList from "../kit/charts/BarList.jsx";
import Dumbbell from "../kit/charts/Dumbbell.jsx";
import YearLines from "../kit/charts/YearLines.jsx";
import StackedColumns from "../kit/charts/StackedColumns.jsx";
import { BRAND, PRIOR, DEEMPH, INK_2 } from "../kit/chartTheme.js";
import { openDrill } from "../kit/drillNav.js";
import LeftOut from "./LeftOut.jsx";
import { openCoverage } from "./nav.js";
import { yearLinesPlan } from "../kit/shape.js";

// Company History › Compare: the window against its comparison, category by category;
// one category (or the basket) month by month, a line per year; and the mix of
// categories quarter by quarter.
//
// Everything follows the one filter row above it — the range, the comparison, the
// measure, like-for-like and the category chips: one chip picks the category the years
// chart draws, several draw their total. Nothing compares a category or a month that
// wasn't captured the same way on both sides unless a source change is allowed, and
// every one left out is named. Every dot, point and segment opens the drawer on exactly
// what it counted (test/drill-reconcile.test.mjs).

const fmtPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x * 1000) / 10)}%`;
const fmtDelta = (n, dec = false) => {
  const v = dec ? Math.abs(n).toFixed(2) : Math.abs(n).toLocaleString();
  return n > 0 ? `+${v}` : n < 0 ? `−${v}` : "±0";
};
const verdictText = (v) => (v.verdict === "withheld" ? `no verdict (${v.why})` : VERDICT_TEXT[v.verdict]);
const nameOfCat = (c) => (c === "complaint" ? "Other (complaints)" : catLabel(c));
const listText = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

// One left-out run of a category in words, the row naming the category: "Jul 2025,
// Dec 2025 · no data on file this period".
const exclusionShort = (e) => exclusionText(e, { withCat: false });

// Year colours: the selected year in the brand blue, the year before in the comparison
// gray, two back lighter still — each line's end carries its year, so none is told
// apart by colour alone.
const YEAR_COLORS = [BRAND, PRIOR, DEEMPH];

export default function Compare({ cov, months, label, cmpMonths, cats, measure, lfl, allowSourceChange, today, years, phone }) {
  const cmpLabel = monthsText(cmpMonths);
  const r = React.useMemo(
    () => compareWindows(cov, months, cmpMonths, cats, { lfl, allowSourceChange, today }),
    [cov, months, cmpMonths, cats, lfl, allowSourceChange, today],
  );
  return (
    <>
      <ByCategory
        r={r}
        cov={cov}
        cats={cats}
        months={months}
        cmpMonths={cmpMonths}
        label={label}
        cmpLabel={cmpLabel}
        measure={measure}
        lfl={lfl}
        today={today}
        exclusions={lfl ? r.exclusions : []}
      />
      <ByYear
        cov={cov}
        cats={cats}
        through={months[months.length - 1]}
        years={years}
        measure={measure}
        lfl={lfl}
        allowSourceChange={allowSourceChange}
        today={today}
        phone={phone}
      />
      <ByQuarter cov={cov} months={months} cats={cats} label={label} phone={phone} />
    </>
  );
}

// ── This period against the comparison, category by category ──────────────────

function ByCategory({ r, cov, cats, months, cmpMonths, label, cmpLabel, measure, lfl, today, exclusions = [] }) {
  const rows = React.useMemo(() => compareByCategory(cov, r, cats, { today, measure }), [cov, r, cats, today, measure]);
  const totals = React.useMemo(() => comparedTotalsDrill(r, cats, how(r, lfl)), [r, cats, lfl]);
  const dec = measure === "workday";
  const fmt = (v) => (dec ? v.toFixed(2) : v.toLocaleString());
  const max = Math.max(0, ...rows.filter((x) => x.compared).flatMap((x) => [x.value, x.cmpValue]));
  const anyCompared = rows.some((x) => x.compared);
  // Like-for-like off counts every covered cell, a category on file on one side only too:
  // its row says so with its count, and the headline is "all on file", not "compared".
  const oneSided = rows.filter((x) => x.oneSided);
  const headline = lfl ? "All compared" : "All on file";
  const shared = sharedMonths(months, cmpMonths);
  const sideWords = (row) => (row.oneSided === "current" ? "this period" : "the comparison");
  const heldIn = (row) => monthsText(row.oneSided === "current" ? row.months : row.cmpMonths);

  const drawn = rows.map((row) => {
    if (!row.compared) {
      return {
        key: row.cat,
        label: nameOfCat(row.cat),
        swatch: catColor(row.cat),
        reason: row.oneSided ? (
          <>
            On file in {sideWords(row)} only:{" "}
            <button
              type="button"
              className="kpi-note-n"
              onClick={() => openDrill(row.drill)}
              title={`${nameOfCat(row.cat)}, ${heldIn(row)}: ${row.n.toLocaleString()}`}
            >
              {row.n.toLocaleString()}
            </button>{" "}
            in {heldIn(row)}, {row.why} — in the total, not compared
          </>
        ) : row.exclusions.length ? (
          `Not compared: ${row.exclusions.map(exclusionShort).join("; ")}`
        ) : (
          `Not compared: ${row.why}`
        ),
      };
    }
    const end = (value, n, ms, drill) => ({
      value,
      text: fmt(value),
      title: `${nameOfCat(row.cat)}, ${monthsText(ms)}: ${dec ? `${fmt(value)} a workday (${n} counted)` : n.toLocaleString()} — ${ms.length} month${ms.length === 1 ? "" : "s"}. Click for the entries.`,
      onClick: () => openDrill(drill),
    });
    const delta = dec ? row.value - row.cmpValue : row.delta;
    return {
      key: row.cat,
      label: nameOfCat(row.cat),
      swatch: catColor(row.cat),
      a: end(row.cmpValue, row.Cmp, row.cmpMonths, row.cmpDrill),
      b: end(row.value, row.X, row.months, row.drill),
      side: (
        <>
          <b>
            {fmtDelta(dec ? Math.round(delta * 100) / 100 : delta, dec)}
            {row.pct !== null && !dec ? ` (${fmtPct(row.pct)})` : ""}
          </b>{" "}
          <span className="db-verdict">
            {row.sourceChange
              ? `different source${row.verdict.why === "different source" ? " · no verdict" : ` · ${verdictText(row.verdict)}`}`
              : verdictText(row.verdict)}
          </span>
        </>
      ),
      // Which months each row compared, and why the rest weren't, are in the table view
      // and in one footnote under the chart — not a caveat column on every row.
      note: null,
      sideTitle: row.exclusions.length
        ? `${row.months.length} of ${months.length} months compared · left out: ${[...new Set(row.exclusions.map((e) => DROP_TEXT[e.reason]))].join(", ")}`
        : `${row.months.length} of ${months.length} months compared`,
    };
  });

  const table = {
    columns: [
      { key: "cat", label: "Category" },
      { key: "cmp", label: "Comparison", num: true },
      { key: "cur", label: "This period", num: true },
      { key: "delta", label: "Change", num: true },
      { key: "pct", label: "Change %" },
      { key: "verdict", label: "Verdict", wrap: true },
      { key: "months", label: "Months compared", wrap: true },
      { key: "cmpMonths", label: "Against", wrap: true },
      { key: "left", label: "Left out", wrap: true },
    ],
    rows: [
      ...rows.map((row) => ({
        cat: nameOfCat(row.cat),
        cmp: row.compared ? row.cmpValue : row.oneSided === "comparison" ? row.value : null,
        cur: row.compared ? row.value : row.oneSided === "current" ? row.value : null,
        delta: row.compared ? (dec ? Math.round((row.value - row.cmpValue) * 100) / 100 : row.delta) : null,
        pct: row.compared && row.pct !== null ? fmtPct(row.pct) : "",
        verdict: row.compared ? verdictText(row.verdict) : row.oneSided ? `${sideWords(row)} only — not compared` : "not compared",
        months: monthsText(row.months),
        cmpMonths: monthsText(row.cmpMonths),
        left: row.exclusions.length ? row.exclusions.map(exclusionShort).join("; ") : row.why || "",
      })),
      ...(anyCompared || oneSided.length
        ? [
            {
              cat: headline,
              cmp: dec ? (r.eC ? Math.round((r.Cmp / r.eC) * 100) / 100 : null) : r.Cmp,
              cur: dec ? (r.eA ? Math.round((r.X / r.eA) * 100) / 100 : null) : r.X,
              delta: dec ? null : r.delta,
              pct: r.pct !== null ? fmtPct(r.pct) : "",
              verdict: verdictText(r.verdict),
              months: "",
              cmpMonths: "",
              left: shared.length ? `${monthsText(shared)} on both sides` : "",
            },
          ]
        : []),
    ],
  };

  return (
    <ChartCard
      className="co-compare"
      title="By category · this period against the comparison"
      count={anyCompared ? how(r, lfl) : null}
      legend={[
        { id: "cmp", label: cmpLabel, color: PRIOR, dot: true },
        { id: "cur", label: label, color: BRAND, dot: true },
      ]}
      note={
        anyCompared || oneSided.length ? (
          <>
            <span
              title={[
                oneSided.length
                  ? `Includes ${listText(oneSided.map((x) => `${nameOfCat(x.cat)} ${x.n.toLocaleString()} in ${sideWords(x)} only`))}.`
                  : null,
                shared.length
                  ? `${monthsText(shared)} ${shared.length === 1 ? "is" : "are"} in both periods: ${shared.length === 1 ? "its" : "their"} failures count on both sides.`
                  : null,
                dec ? "Per Mon–Fri day of the months compared." : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined}
            >
              {headline}:{" "}
              <button type="button" className="kpi-note-n" onClick={() => openDrill(totals.cmp)}>
                {r.Cmp.toLocaleString()}
              </button>{" "}
              →{" "}
              <button type="button" className="kpi-note-n" onClick={() => openDrill(totals.cur)}>
                {r.X.toLocaleString()}
              </button>
              {r.pct !== null ? ` (${fmtPct(r.pct)})` : ""} · {verdictText(r.verdict)}
              {oneSided.length ? ` · ${oneSided.length} one-sided` : ""}
            </span>
          </>
        ) : (
          <span>Nothing in {label} could be compared {lfl ? "like-for-like " : ""}with {cmpLabel}.</span>
        )
      }
      table={table}
      csv={csvName("Company history by category", label)}
      height="auto"
    >
      <LeftOut exclusions={exclusions} />
      <Dumbbell rows={drawn} max={max} />
    </ChartCard>
  );
}

// How the cells were picked, for the card's header and the drawer's heading.
const how = (r, lfl) => (!lfl ? "every covered cell, not like-for-like" : r.sourceChange ? "across a change of source" : "like-for-like");

// ── Month by month, a line per year ───────────────────────────────────────────

function ByYear({ cov, cats, through, years, measure, lfl, allowSourceChange, today, phone }) {
  const yl = React.useMemo(
    () => yearLines(cov, { through, years, cats, measure, today, lfl, allowSourceChange }),
    [cov, through, years, cats, measure, today, lfl, allowSourceChange],
  );
  const dec = measure === "workday";
  const one = cats.length === 1;
  const what = one ? nameOfCat(cats[0]) : "Basket total";
  const series = yl.years.map((y, i) => ({ year: y, label: String(y), color: YEAR_COLORS[i] || DEEMPH, runs: yl.runs[y] || 0 }));
  const anyOff = yl.rows.some((row) => yl.years.some((y) => row.off[y]));
  const anyMarked = yl.rows.some((row) => yl.years.some((y) => row.marked[y]));
  // Lines only over two or more comparable months running, and a table instead of a
  // scatter when no year has three (kit/shape.js yearLinesPlan).
  const plan = yearLinesPlan(yl.rows, series);
  const rows = plan.rows.map((row) => ({
    ...row,
    __head: `${row.label}${dec ? " · per workday" : ""}`,
    __notes: [
      ...row.__notes,
      ...(dec ? yl.years.filter((y) => row.count[y] !== null && row.count[y] !== undefined).map((y) => `${y}: ${row.count[y]} counted`) : []),
    ],
  }));
  const table = {
    columns: [
      { key: "month", label: "Month" },
      ...yl.years.map((y) => ({ key: `v${y}`, label: String(y), num: true })),
      { key: "source", label: lfl ? "Not compared, or not captured whole" : "Not captured whole", wrap: true },
    ],
    rows: yl.rows.map((row) => ({
      month: row.label,
      ...Object.fromEntries(yl.years.map((y) => [`v${y}`, row[`y${y}`] ?? null])),
      source: yl.years
        .filter((y) => row.state[y])
        .map((y) => `${y}: ${row.state[y]}${row.off[y] ? " — not compared" : ""}`)
        .join("; "),
    })),
  };
  // One footnote: what the basket is, what a hollow point means, and where each month's
  // detail lives. The per-point reasons are in the hover and the table view.
  const left = yl.left.filter((l) => l.years.length).map((l) => nameOfCat(l.cat));
  const basket =
    !one && yl.cats.length
      ? `${what} of ${listText(yl.cats.map(nameOfCat))}, the categories tracked in every year drawn${left.length ? ` (${listText(left)} left out)` : ""}.`
      : null;
  const dropped =
    yl.dropped.length && yl.years.length ? `${listText(yl.dropped.map(String))} not drawn: ${one ? `${what} wasn't tracked` : "not tracked the same way"}.` : null;
  const hollow = anyOff ? `Gray rings: not captured the same way as ${yl.years[0]}, so not compared.` : null;
  const differ = yl.otherSource.length ? `Some points are on their line though captured differently (the hover says which).` : null;
  return (
    <ChartCard
      className="co-years"
      title={`Month by month · ${what}`}
      subtitle={yl.years.length ? `${dec ? "per workday · " : ""}${yl.years.join(" against ")}` : null}
      legend={
        plan.form === "table"
          ? null
          : [
              ...series.map((s) => ({ id: `y${s.year}`, label: s.label, color: s.color, line: true })),
              ...(anyOff ? [{ id: "off", label: "Not compared", color: DEEMPH, ring: true }] : []),
              ...(anyMarked ? [{ id: "marked", label: "Not captured whole", color: INK_2, ring: true }] : []),
            ]
      }
      note={
        <p className="cc-foot">
          {/* One sentence, then where the detail is: "Shown as a table: too few
              consecutive months to chart. * not compared — see Data Coverage". */}
          <span title={[basket, dropped, hollow, differ].filter(Boolean).join(" ") || undefined}>
            {(() => {
              const lead =
                plan.form === "table"
                  ? `Shown as a table: too few consecutive months to chart.${anyOff ? " * not compared" : ""}`
                  : basket
                    ? `Basket: the ${yl.cats.length} categories tracked every year`
                    : dropped;
              return lead ? `${lead.replace(/\.$/, "")} — see` : "See";
            })()}
          </span>{" "}
          <button type="button" className="kpi-note-n" onClick={() => openCoverage({})}>
            Data Coverage
          </button>
        </p>
      }
      table={yl.years.length ? table : null}
      csv={csvName("Company history by year", what, through)}
      height={yl.years.length && plan.form === "table" ? "auto" : phone ? 260 : 300}
    >
      {yl.years.length && plan.form === "table" ? (
        // No year has three comparable months in a row: a scatter of points says nothing
        // a table doesn't say better.
        <YearTable rows={yl.rows} years={yl.years} dec={dec} across={!phone} />
      ) : yl.years.length ? (
        <YearLines data={rows} years={series} ends={plan.ends} decimals={dec} onPoint={(row, y) => row.drill[y] && openDrill(row.drill[y])} />
      ) : (
        <div className="empty-state">
          {one
            ? `${what} wasn't tracked in ${listText(yl.dropped.map(String))}.`
            : `No category picked was tracked in ${yl.dropped.length > 1 ? `every year from ${yl.dropped[yl.dropped.length - 1]} to ${yl.dropped[0]}` : yl.dropped[0]}.`}
        </div>
      )}
    </ChartCard>
  );
}

// The years chart as a table, when too few months compare for lines. A value captured
// differently from the newest year is in ink 2 with a "*" (the card's note says what it
// means); "—" is a month not on file. Each value opens its entries, as a point would.
// On a wide card the months run across (a row per year), so the table fills the card;
// on a phone they run down (Month | 2026 | 2025), so it fits the screen.
function YearTable({ rows, years, dec, across = false }) {
  const fmt = (v) => (dec ? Number(v).toFixed(2) : Number(v).toLocaleString());
  // Every month of the year, a month no year has on file included ("—"): a missing
  // column would read as a gap nobody explained.
  const shown = rows;
  const cell = (row, y) => {
    const v = row[`y${y}`];
    if (v === null || v === undefined) return <td key={`${row.label}-${y}`} className="num yl-none">—</td>;
    const off = row.off[y];
    const text = (
      <>
        {fmt(v)}
        {off && <span className="yl-mark">*</span>}
      </>
    );
    return (
      <td
        key={`${row.label}-${y}`}
        className={`num ${off ? "yl-off" : ""}`.trim()}
        title={[row.state[y], off ? "not compared" : null].filter(Boolean).join(" · ") || undefined}
      >
        {row.drill[y] ? (
          <button type="button" className="kpi-note-n" onClick={() => openDrill(row.drill[y])}>
            {text}
          </button>
        ) : (
          text
        )}
      </td>
    );
  };
  if (across) {
    return (
      <div className="table-wrap cc-table">
        <table className="data analytics-table yl-table yl-across">
          <thead>
            <tr>
              <th>Year</th>
              {shown.map((row) => (
                <th key={row.label} className="num">
                  {String(row.label).slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td>{y}</td>
                {shown.map((row) => cell(row, y))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="table-wrap cc-table">
      <table className="data analytics-table yl-table">
        <thead>
          <tr>
            <th>Month</th>
            {years.map((y) => (
              <th key={y} className="num">
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {years.map((y) => cell(row, y))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── The mix, quarter by quarter ───────────────────────────────────────────────

function ByQuarter({ cov, months, cats, label, phone }) {
  const qm = React.useMemo(() => quarterMix(cov, months, cats), [cov, months, cats]);
  const SERIES = categoriesFor(qm.cats).map((c) => ({ id: c.id, label: nameOfCat(c.id), color: c.color }));
  // A quarter not captured whole is left out of the chart (the table keeps it, with
  // why), never drawn as an empty slot; six or fewer left are rows, not columns.
  const leftOut = qm.quarters.filter((q) => !q.drawn);
  const rows = qm.quarters.filter((q) => q.drawn).map((q) => ({
    key: q.key,
    label: q.label,
    ...Object.fromEntries(qm.cats.map((c) => [c, q.drawn ? q.shares[c] : null])),
    gap: q.drawn ? null : "incomplete",
    mixed: q.mixed,
    __head: q.label,
    __notes: q.drawn
      ? [`${q.total.toLocaleString()} failures: ${qm.cats.map((c) => `${nameOfCat(c)} ${q.counts[c]}`).join(", ")}`, ...(q.mixed ? ["spreadsheet and app months"] : [])]
      : [`Incomplete — ${q.why}`],
  }));
  const table = {
    columns: [
      { key: "q", label: "Quarter" },
      ...qm.cats.flatMap((c) => [
        { key: `s_${c}`, label: `${nameOfCat(c)} %`, num: true },
        { key: `n_${c}`, label: nameOfCat(c), num: true },
      ]),
      { key: "total", label: "Total", num: true },
      { key: "status", label: "Status", wrap: true },
    ],
    rows: qm.quarters.map((q) => ({
      q: q.label,
      ...Object.fromEntries(qm.cats.flatMap((c) => [[`s_${c}`, q.drawn ? q.shares[c] : null], [`n_${c}`, q.drawn ? q.counts[c] : null]])),
      total: q.drawn ? q.total : null,
      status: q.drawn ? (q.mixed ? "drawn · spreadsheet and app months" : "drawn") : `incomplete — ${q.why}`,
    })),
  };
  const enough = cats.length > 1;
  return (
    <ChartCard
      className="co-mix"
      title="Category mix by quarter"
      subtitle={qm.cats.length ? `${rows.length} of ${qm.quarters.length} quarters · share of failures` : null}
      legend={SERIES}
      note={
        qm.cats.length > 0 ? (
          <p
            className="cc-foot"
            title={[
              `Shares of ${listText(qm.cats.map(nameOfCat))}, the categories captured whole in every quarter drawn.`,
              enough && qm.left.length ? `Left out: ${qm.left.map((l) => `${nameOfCat(l.cat)} (${l.why})`).join(", ")}.` : null,
              leftOut.length
                ? `${leftOut.length} quarter${leftOut.length === 1 ? "" : "s"} not captured whole (${
                    leftOut.length > 2 ? `${leftOut[0].label} – ${leftOut[leftOut.length - 1].label}` : leftOut.map((q) => q.label).join(", ")
                  }); the table view says why.`
                : null,
              rows.length > 1 && rows.length <= 6 ? "The number after each quarter is its failures." : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {[
              `${qm.cats.length} categories captured whole`,
              leftOut.length ? `${leftOut.length} quarter${leftOut.length === 1 ? "" : "s"} left out` : null,
              enough && qm.left.length ? `${qm.left.length} categor${qm.left.length === 1 ? "y" : "ies"} left out` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null
      }
      table={qm.cats.length ? table : null}
      csv={csvName("Company history mix by quarter", label)}
      height={rows.length && rows.length <= 6 ? "auto" : phone ? 240 : 320}
    >
      {!enough ? (
        <div className="empty-state">Pick two or more categories above to see how they split.</div>
      ) : !qm.cats.length ? (
        <div className="empty-state">No two of the categories picked were captured whole in any quarter of {label}.</div>
      ) : !rows.length ? (
        <div className="empty-state">No quarter of {label} was captured whole for these categories.</div>
      ) : rows.length === 1 ? (
        // One comparable quarter is a sentence, not a lone 100% bar: each category's
        // share and the failures they are a share of. The quarter opens its drawer.
        (() => {
          const q = qm.quarters.find((x) => x.key === rows[0].key);
          return (
            <p className="co-mix-one">
              <button type="button" className="text-link" onClick={() => q?.drill && openDrill(q.drill)} title={rows[0].__notes.join("\n")}>
                {q.label}
              </button>
              :{" "}
              {/* Each part keeps its separator, so a line breaks before a "·", never
                  after one. */}
              {qm.cats.map((c, i) => (
                <React.Fragment key={c}>
                  {i > 0 ? " " : ""}
                  <span className="co-mix-part">
                    {i > 0 && <span className="co-mix-sep">·</span>}
                    <i className="cc-key-swatch" style={{ background: catColor(c) }} aria-hidden="true" />
                    {nameOfCat(c)} {q.shares[c]}%
                  </span>
                </React.Fragment>
              ))}{" "}
              of {q.total.toLocaleString()} failure{q.total === 1 ? "" : "s"}
            </p>
          );
        })()
      ) : rows.length <= 6 ? (
        <BarList
          rows={rows}
          order="given"
          value={() => 100}
          label={(r) => r.label}
          valueText={(r) => {
            // The number after a full-share bar is the quarter's count, said as one, so
            // "100" can't be read as 100%.
            const n = qm.quarters.find((q) => q.key === r.key)?.total ?? 0;
            return `${n.toLocaleString()} failure${n === 1 ? "" : "s"}`;
          }}
          series={SERIES}
          scaleTo={100}
          size="lg"
          limit={0}
          rowTitle={(r) => [r.label, ...r.__notes].join("\n")}
          onMark={(row) => {
            const q = qm.quarters.find((x) => x.key === row.key);
            if (q?.drill) openDrill(q.drill);
          }}
          ariaLabel="Category mix by quarter"
        />
      ) : (
        <StackedColumns
          data={rows}
          xKey="key"
          grain="quarter"
          keyOf={(row) => row.key}
          series={SERIES}
          capLabels={false}
          decimals
          unit="%"
          onSegment={(row, c) => {
            const q = qm.quarters.find((x) => x.key === row.key);
            if (q?.drills?.[c]) openDrill(q.drills[c]);
          }}
          onMark={(row) => {
            const q = qm.quarters.find((x) => x.key === row.key);
            if (q?.drill) openDrill(q.drill);
          }}
        />
      )}
    </ChartCard>
  );
}
