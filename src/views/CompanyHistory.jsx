import React from "react";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { useHashState, writeHash } from "../data/hashState.js";
import { nowET, toYMD, shiftYm, currentYmET } from "../data/period.js";
import { catLabel, catColor } from "../data/categories.js";
import { buildCoverage, ulineCoverage, fmtYm } from "../data/coverage.js";
import {
  RANGES,
  FIRST_YM,
  companyWindow,
  comparisonMonths,
  lastCompleteYm,
  basketCategories,
} from "../data/companyMetrics.js";
import { AnalyticsGate, LoadError, HistoryRefresh } from "./kit/LoadState.jsx";
import Overview from "./company/Overview.jsx";
import DataCoverage from "./company/DataCoverage.jsx";

// Company History: the whole company, month to month and year to year, over every
// month on file — and, beside it, what each of those months actually covers.
//
// Every count is a blend cell (blend.js), read through the coverage model
// (coverage.js): a month nothing captured is a gap, not a zero, and a comparison runs
// only over the cells captured the same way on both sides. Nothing on this tab writes:
// the stale rollups it finds are fixed from Report Detail's Re-sync.
//
// Its filters live in the hash under co.* (hashState.js), so a link opens the same view.
// The sub-tabs still to come (Compare, Drivers, Where & Why) aren't listed until they
// exist.

const SUBS = [
  ["overview", "Overview"],
  ["coverage", "Data Coverage"],
];
const CMP = [
  ["yoy", "Same months last year"],
  ["prior", "Prior period"],
];
const MEASURES = [
  ["count", "Count"],
  ["workday", "Per workday"],
];

// Phones open on 12 months: 24 columns don't fit 390px.
function usePhone() {
  const query = "(max-width: 640px)";
  const get = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
  const [phone, setPhone] = React.useState(get);
  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return phone;
}

export default function CompanyHistory({ onOpenReport }) {
  const a = useAnalytics();
  const phone = usePhone();
  const today = toYMD(nowET());
  const nowYm = currentYmET();

  const [subParam, setSub] = useHashState("co.sub", "overview");
  const sub = SUBS.some(([v]) => v === subParam) ? subParam : "overview";
  const [rangeParam, setRange] = useHashState("co.r", phone ? "12" : "24");
  const range = RANGES.some(([v]) => v === rangeParam) ? rangeParam : phone ? "12" : "24";
  const [thruParam, setThru] = useHashState("co.thru", lastCompleteYm(today));
  const through = /^\d{4}-\d{2}$/.test(thruParam) && thruParam >= FIRST_YM && thruParam <= nowYm ? thruParam : lastCompleteYm(today);
  const [from] = useHashState("co.from", "");
  const [to] = useHashState("co.to", "");
  const [cmpParam, setCmp] = useHashState("co.cmp", "yoy");
  const cmp = cmpParam === "prior" ? "prior" : "yoy";
  const [measureParam, setMeasure] = useHashState("co.m", "count");
  const measure = measureParam === "workday" ? "workday" : "count";
  const [lflParam, setLfl] = useHashState("co.lfl", "1");
  const lfl = lflParam !== "0";
  const [srcParam, setSrc] = useHashState("co.src", "0");
  const allowSourceChange = srcParam === "1";

  // The coverage of every cell, from the all-fault blend: the Uline reports' days, the
  // history documents that exist, today's month as the one still in progress, and the
  // live rows (a hand-logged entry never rolls up, so it is no disagreement).
  const blend = a.blend(null);
  const uline = React.useMemo(() => ulineCoverage(a.reports, a.incidents), [a.reports, a.incidents]);
  const cov = React.useMemo(
    () => buildCoverage({ blend, historyMonthIds: a.historyState.monthIds, uline, today, incidents: a.incidents }),
    [blend, a.historyState.monthIds, uline, today, a.incidents],
  );

  // The basket: the failures, complaints only when there are any. A chip list from a
  // link keeps the ones the basket knows, in the registry's order; none left reads as all.
  const hasComplaints = React.useMemo(() => blend.months.some((ym) => blend.companyCell(ym, "complaint") > 0), [blend]);
  const basket = React.useMemo(() => basketCategories({ hasComplaints }), [hasComplaints]);
  const [catsParam] = useHashState("co.cats", "");
  const cats = React.useMemo(() => {
    const picked = new Set(String(catsParam || "").split(",").filter(Boolean));
    const out = basket.filter((c) => picked.has(c));
    return out.length ? out : basket;
  }, [catsParam, basket]);
  const toggleCat = (c) => {
    const next = cats.includes(c) ? cats.filter((x) => x !== c) : basket.filter((x) => x === c || cats.includes(x));
    if (!next.length) return; // the last chip stays on: an empty basket counts nothing
    writeHash({ "co.cats": next.length === basket.length ? null : next.join(",") });
  };

  // A custom range from a hand-edited link can't reach past this month: a month still to
  // come would read as a captured zero.
  const clamp = (ym) => (/^\d{4}-\d{2}$/.test(ym || "") && ym > nowYm ? nowYm : ym);
  const win = React.useMemo(
    () => companyWindow(range, { through, from: clamp(from), to: clamp(to) }),
    [range, through, from, to, nowYm], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cmpMonths = React.useMemo(() => comparisonMonths(win.months, cmp), [win, cmp]);

  // Recomputing keeps the last view on screen, faded, rather than flashing empty.
  const params = React.useMemo(
    () => ({ months: win.months, label: win.label, cmpMonths, cats, measure, lfl, allowSourceChange }),
    [win, cmpMonths, cats, measure, lfl, allowSourceChange],
  );
  const shown = React.useDeferredValue(params);
  const pending = shown !== params;

  const throughOptions = React.useMemo(() => {
    const out = [];
    for (let ym = nowYm; ym >= FIRST_YM && out.length < 240; ym = shiftYm(ym, -1)) {
      out.push({ value: ym, label: ym === nowYm ? `${fmtYm(ym)} (in progress)` : fmtYm(ym) });
    }
    return out;
  }, [nowYm]);

  // Uline coverage comes from the reports: without them every app-era month would read
  // as uncovered, so their failed read is shown rather than worked around.
  const reportsBlocked = a.readErrors.reports && !a.readErrors.reports.stale ? a.readErrors.reports : null;

  return (
    <div className="co-page">
      <div className="page-title">Company History</div>
      <h1 className="page-heading sc-heading">
        Company History <span className="meta">· {sub === "overview" ? win.label : "every month on file"}</span>
      </h1>

      <div className="toolbar">
        <div className="month-picker co-subs" role="tablist" aria-label="Company History views">
          {SUBS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={sub === v}
              className={`month-btn ${sub === v ? "active" : ""}`}
              onClick={() => setSub(v, { push: true })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <HistoryRefresh />
      </div>

      {sub === "overview" && (
        <div className="co-filters" role="group" aria-label="Filters">
          <div className="period-bar">
            <div className="month-picker" role="group" aria-label="Range">
              {RANGES.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`month-btn ${range === v ? "active" : ""}`}
                  aria-pressed={range === v}
                  onClick={() => setRange(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            {range === "custom" ? (
              <div className="custom-range">
                <input
                  type="month"
                  value={from}
                  min={FIRST_YM}
                  max={nowYm}
                  onChange={(e) => writeHash({ "co.from": e.target.value || null })}
                  aria-label="From"
                />
                <span className="meta">to</span>
                <input
                  type="month"
                  value={to}
                  min={FIRST_YM}
                  max={nowYm}
                  onChange={(e) => writeHash({ "co.to": e.target.value || null })}
                  aria-label="To"
                />
              </div>
            ) : (
              <label className="period-day">
                <span className="period-day-lbl">Through</span>
                <select className="period-anchor co-through" value={through} onChange={(e) => setThru(e.target.value)}>
                  {throughOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="period-bar">
            <div className="month-picker" role="group" aria-label="Compare with">
              {CMP.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`month-btn ${cmp === v ? "active" : ""}`}
                  aria-pressed={cmp === v}
                  onClick={() => setCmp(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="month-picker" role="group" aria-label="Measure">
              {MEASURES.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`month-btn ${measure === v ? "active" : ""}`}
                  aria-pressed={measure === v}
                  onClick={() => setMeasure(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="month-picker" role="group" aria-label="Comparison rules">
              <button
                type="button"
                className={`month-btn ${lfl ? "active" : ""}`}
                aria-pressed={lfl}
                onClick={() => setLfl(lfl ? "0" : "1")}
                title="Compare only the months and categories captured the same way on both sides"
              >
                Like-for-like
              </button>
              <button
                type="button"
                className={`month-btn ${allowSourceChange ? "active" : ""}`}
                aria-pressed={allowSourceChange}
                disabled={!lfl}
                onClick={() => setSrc(allowSourceChange ? "0" : "1")}
                title="Also compare app months with spreadsheet months. The change is labelled 'different source' and gets no verdict."
              >
                Allow source change
              </button>
            </div>
          </div>
          <div className="co-chips" role="group" aria-label="Categories">
            {basket.map((c) => (
              <button
                key={c}
                type="button"
                className={`co-chip ${cats.includes(c) ? "on" : ""}`}
                aria-pressed={cats.includes(c)}
                onClick={() => toggleCat(c)}
              >
                <i style={{ background: catColor(c) }} aria-hidden="true" />
                {c === "complaint" ? "Other (complaints)" : catLabel(c)}
              </button>
            ))}
          </div>
        </div>
      )}

      <AnalyticsGate>
        {reportsBlocked ? (
          <LoadError what="reports" message={reportsBlocked.message} retry={a.reload.reports} />
        ) : sub === "overview" ? (
          <div className={pending ? "co-pending" : undefined}>
            <Overview
              cov={cov}
              months={shown.months}
              label={shown.label}
              cmpMonths={shown.cmpMonths}
              cats={shown.cats}
              measure={shown.measure}
              lfl={shown.lfl}
              allowSourceChange={shown.allowSourceChange}
              today={today}
              phone={phone}
            />
          </div>
        ) : (
          <DataCoverage cov={cov} uline={uline} hasComplaints={hasComplaints} today={today} onOpenReport={onOpenReport} />
        )}
      </AnalyticsGate>
    </div>
  );
}
