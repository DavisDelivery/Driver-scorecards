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
import Dumbbell from "../kit/charts/Dumbbell.jsx";
import YearLines from "../kit/charts/YearLines.jsx";
import StackedColumns from "../kit/charts/StackedColumns.jsx";
import { BRAND, PRIOR, DEEMPH, INK_2, axisTick } from "../kit/chartTheme.js";
import { openDrill } from "../kit/drillNav.js";
import LeftOut from "./LeftOut.jsx";

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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthNames = (ms) => ms.map((ym) => MONTHS[Number(ym.slice(5, 7)) - 1]).join(", ");

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
      {lfl && <LeftOut exclusions={r.exclusions} phone={phone} />}
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

function ByCategory({ r, cov, cats, months, cmpMonths, label, cmpLabel, measure, lfl, today }) {
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
      title: `${nameOfCat(row.cat)}, ${monthsText(ms)}: ${dec ? `${fmt(value)} a workday (${n} counted)` : n.toLocaleString()} — ${ms.length} month${ms.length === 1 ? "" : "s"}`,
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
      // The months are in the table view; the row says how many, and why the rest aren't.
      note: row.exclusions.length
        ? `${row.months.length} of ${months.length} months · left out: ${[...new Set(row.exclusions.map((e) => DROP_TEXT[e.reason]))].join(", ")}`
        : null,
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
            <span>
              {headline}:{" "}
              <button type="button" className="kpi-note-n" onClick={() => openDrill(totals.cmp)}>
                {r.Cmp.toLocaleString()}
              </button>{" "}
              →{" "}
              <button type="button" className="kpi-note-n" onClick={() => openDrill(totals.cur)}>
                {r.X.toLocaleString()}
              </button>
              {r.pct !== null ? ` (${fmtPct(r.pct)})` : ""} · {verdictText(r.verdict)}
            </span>
            {oneSided.length > 0 && (
              <span>
                Includes {listText(oneSided.map((x) => `${nameOfCat(x.cat)} ${x.n.toLocaleString()} in ${sideWords(x)} only`))}
              </span>
            )}
            {shared.length > 0 && (
              <span>
                {monthsText(shared)} {shared.length === 1 ? "is" : "are"} in both periods: {shared.length === 1 ? "its" : "their"} failures count on both sides
              </span>
            )}
            <span>{dec ? "Per Mon–Fri day of the months compared. " : ""}Click a dot for its entries</span>
          </>
        ) : (
          <span>Nothing in {label} could be compared {lfl ? "like-for-like " : ""}with {cmpLabel}.</span>
        )
      }
      table={table}
      csv={csvName("Company history by category", label)}
      height="auto"
    >
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
  const rows = yl.rows.map((row) => ({
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
  const notes = [];
  if (!one && yl.cats.length) notes.push(`${what} of ${listText(yl.cats.map(nameOfCat))} — the categories tracked in every year drawn`);
  for (const l of yl.left) if (l.years.length) notes.push(`${nameOfCat(l.cat)} left out: not tracked in ${listText(l.years.map(String))}`);
  if (yl.dropped.length && yl.years.length) {
    notes.push(
      one
        ? `${what}: not tracked in ${listText(yl.dropped.map(String))} — not drawn`
        : `${listText(yl.dropped.map(String))} not drawn: no category picked was tracked in every year from ${yl.dropped[yl.dropped.length - 1]} to ${yl.years[0]}`,
    );
  }
  // Every point left off its line, by year and why: "2025 Jun, Aug · spreadsheet vs
  // 2026's app".
  const off = yl.notCompared.map((g) => `${g.year} ${monthNames(g.months)} · ${g.why}`);
  const differ = yl.otherSource.map((g) => `${g.year} ${monthNames(g.months)} · ${g.why}`);
  return (
    <ChartCard
      className="co-years"
      title={`Month by month · ${what}`}
      count={yl.years.length ? `${dec ? "per workday · " : ""}${yl.years.join(" against ")}` : null}
      legend={[
        ...series.map((s) => ({ id: `y${s.year}`, label: s.label, color: s.color, line: true })),
        ...(anyOff ? [{ id: "off", label: "Not compared", color: INK_2, ring: true }] : []),
        ...(anyMarked ? [{ id: "marked", label: "Not captured whole", color: INK_2, ring: true }] : []),
      ]}
      note={
        <>
          {notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
          {off.length > 0 && <span>Not compared like-for-like, drawn hollow off the line: {off.join("; ")}</span>}
          {differ.length > 0 && <span>Captured differently, on the line all the same: {differ.join("; ")}</span>}
          <span>
            {one ? "Pick more categories above for their total" : "Pick one category above to see it alone"} · a line breaks where what was
            captured changes · click a point for its entries
          </span>
        </>
      }
      table={yl.years.length ? table : null}
      csv={csvName("Company history by year", what, through)}
      height={phone ? 260 : 300}
    >
      {yl.years.length ? (
        <YearLines data={rows} years={series} decimals={dec} phone={phone} onPoint={(row, y) => row.drill[y] && openDrill(row.drill[y])} />
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

// ── The mix, quarter by quarter ───────────────────────────────────────────────

function ByQuarter({ cov, months, cats, label, phone }) {
  const qm = React.useMemo(() => quarterMix(cov, months, cats), [cov, months, cats]);
  const SERIES = categoriesFor(qm.cats).map((c) => ({ id: c.id, label: nameOfCat(c.id), color: c.color }));
  const rows = qm.quarters.map((q) => ({
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
      count={qm.cats.length ? `${qm.quarters.filter((q) => q.drawn).length} of ${qm.quarters.length} quarters` : null}
      legend={SERIES}
      note={
        <>
          {qm.cats.length > 0 && (
            <span>
              Shares of {listText(qm.cats.map(nameOfCat))} — the categories captured whole in every quarter drawn
            </span>
          )}
          {enough &&
            qm.left.map((l) => (
              <span key={l.cat}>
                {nameOfCat(l.cat)} left out: {l.why}
              </span>
            ))}
          {qm.cats.length > 0 && qm.quarters.some((q) => !q.drawn) && (
            <span>An incomplete quarter isn&apos;t drawn — hover it for why</span>
          )}
        </>
      }
      table={qm.cats.length ? table : null}
      csv={csvName("Company history mix by quarter", label)}
      height={phone ? 260 : 280}
    >
      {!enough ? (
        <div className="empty-state">Pick two or more categories above to see how they split.</div>
      ) : !qm.cats.length ? (
        <div className="empty-state">No two of the categories picked were captured whole in any quarter of {label}.</div>
      ) : (
        <StackedColumns
          data={rows}
          xKey="label"
          keyOf={(row) => row.key}
          series={SERIES}
          gapKey="gap"
          capLabels={false}
          decimals
          unit="%"
          yAxis={{ domain: [0, 100], ticks: [0, 25, 50, 75, 100], tickFormatter: (v) => `${v}%` }}
          onSegment={(row, c) => {
            const q = qm.quarters.find((x) => x.key === row.key);
            if (q?.drills?.[c]) openDrill(q.drills[c]);
          }}
          onMark={(row) => {
            const q = qm.quarters.find((x) => x.key === row.key);
            if (q?.drill) openDrill(q.drill);
          }}
          xAxis={{ interval: 0, height: 34, tick: <QuarterTick rows={rows} phone={phone} /> }}
        />
      )}
    </ChartCard>
  );
}

// A quarter's tick: "Q1", the year under each Q1 (and the first), and "mixed" under a
// quarter whose months mix the spreadsheet and the app.
function QuarterTick({ x, y, payload, rows, phone }) {
  const i = payload?.index ?? rows.findIndex((r) => r.label === payload?.value);
  const row = rows[i];
  if (!row) return null;
  const [q, yr] = row.label.split(" ");
  const showYear = q === "Q1" || i === 0;
  return (
    <g transform={`translate(${x},${y})`}>
      <text y={9} textAnchor="middle" {...axisTick}>
        {q}
      </text>
      {showYear && (
        <text y={20} textAnchor="middle" {...axisTick} fontSize={9}>
          {phone ? `'${yr.slice(2)}` : yr}
        </text>
      )}
      {row.mixed && (
        <text y={31} textAnchor="middle" {...axisTick} fontSize={9}>
          mixed
        </text>
      )}
    </g>
  );
}
