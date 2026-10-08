import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { useHashState } from "../../data/hashState.js";
import { loadReportContribsChecked } from "../../data/firebase.js";
import { catLabel, catColor, categoriesFor, ATTEMPTS } from "../../data/categories.js";
import { currentYmET } from "../../data/period.js";
import { csvName } from "../../data/csv.js";
import {
  CAPTURE_WINDOWS,
  SOURCE_FROM,
  SOURCE_TEXT,
  STATE_TEXT,
  REASON_TEXT,
  inCaptureWindow,
  fmtYm,
  fmtDay,
  monthsText,
  reportLag,
  suspiciousZeros,
  unattributedByMonth,
  rollupStatus,
  reconcile,
  causeText,
  reportSpanText,
  captureEvidence,
  offRosterCounts,
} from "../../data/coverage.js";
import { companyWindow, basketCategories, companyDrill, incidentsDrill, FIRST_YM } from "../../data/companyMetrics.js";
import { reportWeekName } from "../../reports/reportNaming.js";
import ChartCard from "../kit/ChartCard.jsx";
import CoverageMatrix from "../kit/charts/CoverageMatrix.jsx";
import { RosterGate } from "../kit/LoadState.jsx";
import { openDrill } from "../kit/drillNav.js";

// Company History › Data Coverage: what every month on file covers, where live entries
// and imported history disagree and why, which report rollups are stale or were never
// made, the Uline reports' coverage, the anomalies, and the state of every read.
//
// It never writes. A stale or missing rollup is fixed by opening the report and pressing
// Re-sync totals in Report Detail; this page only says which reports need it.

const clock = (t) =>
  t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default function DataCoverage({ cov, uline, hasComplaints, today, onOpenReport }) {
  const a = useAnalytics();
  const blend = a.blend(null);
  const nowYm = currentYmET();
  const months = React.useMemo(() => companyWindow("all", { through: nowYm }).months, [nowYm]);
  const failures = React.useMemo(() => basketCategories({ hasComplaints }), [hasComplaints]);
  const rowCats = React.useMemo(() => [...failures, ATTEMPTS, "compliment"], [failures]);

  // The rollup snapshots, read here only (read-only, one small document per report).
  const [contribs, setContribs] = React.useState({ status: "loading", data: null, error: null });
  const loadContribs = React.useCallback(async () => {
    setContribs((c) => ({ ...c, status: "loading" }));
    const r = await loadReportContribsChecked();
    // A copy from this browser's cache isn't the answer: a snapshot it lacks would read
    // as a report never rolled up. It is a failed read, said as one.
    setContribs({ status: r.error ? "error" : "ready", data: r.data, error: r.error, offline: !!r.offline });
  }, []);
  React.useEffect(() => {
    loadContribs();
  }, [loadContribs]);
  // Each report's snapshot against its rows and against what history holds now, so a
  // rollup an import cleared is found too.
  const rollups = React.useMemo(
    () => (contribs.status === "ready" ? rollupStatus(a.reports, a.incidents, contribs.data, a.history) : null),
    [contribs, a.reports, a.incidents, a.history],
  );
  const conflicts = React.useMemo(
    () => reconcile({ conflicts: blend.conflicts, incidents: a.incidents, history: a.history, rollups }),
    [blend, a.incidents, a.history, rollups],
  );

  const [cellParam] = useHashState("co.cell", "");
  const [secParam] = useHashState("co.sec", "");
  const focus = React.useMemo(() => {
    const [ym, cat] = String(cellParam || "").split("|");
    return /^\d{4}-\d{2}$/.test(ym || "") && rowCats.includes(cat) ? { ym, cat } : null;
  }, [cellParam, rowCats]);
  React.useEffect(() => {
    if (secParam) document.getElementById(`co-sec-${secParam}`)?.scrollIntoView?.({ block: "start" });
  }, [secParam]);

  const conflictBy = React.useMemo(() => new Map(conflicts.map((c) => [`${c.ym}|${c.category}`, c])), [conflicts]);
  const describe = (cell) => {
    const parts = [`${fmtYm(cell.ym)} · ${rowLabel(cell.category)} · ${STATE_TEXT[cell.state]}`];
    if (cell.value !== null) parts.push(`shown ${cell.value} · live ${cell.live} · history ${cell.history}`);
    else if (cell.live || cell.history) parts.push(`live ${cell.live} · history ${cell.history}`);
    for (const r of cell.reasons) parts.push(REASON_TEXT[r]);
    if (cell.uline !== undefined && cell.uline < 1) parts.push(`Uline reports cover ${Math.round(cell.uline * 100)}% of its weekdays`);
    const c = conflictBy.get(`${cell.ym}|${cell.category}`);
    if (c) parts.push(c.causes.map(causeText).join("; "));
    return parts.join(" · ");
  };
  const openCell = (cell, expected = cell.value) =>
    openDrill(companyDrill([cell.category], [cell.ym], expected, fmtYm(cell.ym)));

  const matrixRows = React.useMemo(
    () =>
      rowCats.map((cat) => ({
        id: cat,
        label: rowLabel(cat),
        short: SHORT_LABEL[cat],
        color: catColor(cat),
        cells: months.map((ym) => cov.cell(ym, cat)),
        window: new Set(months.filter((ym) => inCaptureWindow(ym, cat))),
      })),
    [rowCats, months, cov],
  );
  const matrixTable = {
    columns: [
      { key: "month", label: "Month" },
      { key: "category", label: "Category" },
      { key: "state", label: "Coverage" },
      { key: "shown", label: "Shown", num: true },
      { key: "live", label: "Live", num: true },
      { key: "history", label: "History", num: true },
      { key: "why", label: "Why" },
    ],
    rows: matrixRows.flatMap((row) =>
      row.cells
        .filter((c) => c.state !== "not_tracked" || c.live || c.history)
        .map((c) => ({
          month: fmtYm(c.ym),
          category: row.label,
          state: STATE_TEXT[c.state],
          shown: c.value,
          live: c.live,
          history: c.history,
          why: c.reasons.map((r) => REASON_TEXT[r]).join("; "),
        })),
    ),
  };

  // Evidence for the capture windows: the months each source actually holds a count for.
  const evidence = React.useMemo(() => captureEvidence(blend, months, rowCats), [rowCats, months, blend]);

  const zeros = React.useMemo(() => suspiciousZeros(cov, months, failures), [cov, months, failures]);
  const unattributed = React.useMemo(() => unattributedByMonth(a.incidents, null, failures), [a.incidents, failures]);
  const lag = React.useMemo(() => reportLag(a.incidents), [a.incidents]);
  const offRoster = React.useMemo(() => offRosterCounts(a.people, blend), [a.people, blend]);

  const stale = (rollups || []).filter((r) => r.status === "stale");
  const cleared = (rollups || []).filter((r) => r.status === "cleared");
  const never = (rollups || []).filter((r) => r.status === "never");
  const h = a.historyState;
  const readErr = (kind) => a.readErrors[kind];

  return (
    <>
      <div className="co-status" role="status">
        <span>
          <b>History</b> {h.monthIds.length || "—"} month documents · {h.records.length.toLocaleString()} records · newest
          record {clock(h.newestUpdatedAt)} · read {clock(h.loadedAt)}
          {h.refreshError && <span className="co-error"> · couldn&apos;t refresh ({h.refreshError})</span>}
        </span>
        <span>
          <b>Incidents</b> {a.incidents.length.toLocaleString()} loaded
          {readErr("incidents") && <ReadError err={readErr("incidents")} retry={a.reload.incidents} />}
        </span>
        <span>
          <b>Reports</b> {a.reports.length}
          {readErr("reports") && <ReadError err={readErr("reports")} retry={a.reload.reports} />}
        </span>
        <span>
          <b>Roster</b> {a.drivers.length} people
          {readErr("drivers") && <ReadError err={readErr("drivers")} retry={a.reload.drivers} />}
        </span>
        <span>
          <b>Rollup snapshots</b>{" "}
          {contribs.status === "loading"
            ? "loading…"
            : contribs.status === "error"
              ? null
              : `${contribs.data.length} read`}
          {contribs.status === "error" && (
            <ReadError err={{ message: contribs.error, stale: contribs.offline }} retry={loadContribs} />
          )}
        </span>
      </div>

      <ChartCard
        className="co-matrix"
        title="Coverage by month"
        count={`${fmtYm(FIRST_YM)} – ${fmtYm(nowYm)}`}
        table={matrixTable}
        csv={csvName("Company history coverage", today)}
        height={null}
      >
        <CoverageMatrix months={months} rows={matrixRows} focus={focus} describe={describe} onOpen={(cell) => openCell(cell)} />
      </ChartCard>

      <div className="card co-card">
        <div className="card-header">
          <div className="card-title">Capture windows</div>
          <span className="card-hint">reviewed Oct 7 · what each month could have held</span>
        </div>
        <div className="table-wrap">
          <table className="data analytics-table co-table cards-on-phone co-windows">
            <thead>
              <tr>
                <th>Category</th>
                <th>Spreadsheets</th>
                <th>In the app</th>
                <th>On file</th>
              </tr>
            </thead>
            <tbody>
              {rowCats.map((cat) => {
                const w = CAPTURE_WINDOWS[cat];
                const ev = evidence[cat];
                return (
                  <tr key={cat}>
                    <td className="card-primary">
                      <span className="cat-swatch" style={{ background: catColor(cat) }} />
                      {rowLabel(cat)}
                    </td>
                    <td className="co-months" data-label="Spreadsheets">
                      {w.backfill.length ? w.backfill.map(([x, y]) => `${fmtYm(x)} – ${fmtYm(y)}`).join(", ") : "never"}
                    </td>
                    <td className="co-months" data-label="In the app">
                      {w.app.map((s) => `${SOURCE_TEXT[s]} from ${fmtYm(SOURCE_FROM[s])}`).join(" · ")}
                    </td>
                    <td className="co-months" data-label="On file">
                      {ev.hist.length ? `history ${spanOf(ev.hist)}` : ""}
                      {ev.hist.length && ev.live.length ? " · " : ""}
                      {ev.live.length ? `live ${spanOf(ev.live)}` : ""}
                      {!ev.hist.length && !ev.live.length ? "nothing" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card co-card" id="co-sec-conflicts">
        <div className="card-header">
          <div className="card-title">Live and history disagree</div>
          <span className="card-hint">the live count is shown; history&apos;s is never added to it</span>
        </div>
        {conflicts.length ? (
          <div className="table-wrap">
            <table className="data analytics-table co-table cards-on-phone co-conflicts">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Category</th>
                  <th className="num">Live</th>
                  <th className="num">History</th>
                  <th className="num">Δ</th>
                  <th>Likely cause</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={`${c.ym}|${c.category}`}>
                    <td data-label="Month">{fmtYm(c.ym)}</td>
                    <td className="card-primary co-conf-cat">
                      <span className="cat-swatch" style={{ background: catColor(c.category) }} />
                      {catLabel(c.category)}
                    </td>
                    <td className="num" data-label="Live">
                      <button
                        type="button"
                        className="kpi-note-n"
                        title="Open the live entries"
                        onClick={() => openCell(cov.cell(c.ym, c.category), c.live)}
                      >
                        {c.live}
                      </button>
                    </td>
                    <td className="num" data-label="History">{c.history}</td>
                    <td className="num" data-label="Difference">
                      {c.delta > 0 ? "+" : ""}
                      {c.delta}
                    </td>
                    <td className="co-cause" data-label="Likely cause">
                      {c.causes.map(causeText).join("; ")}
                      <span className="co-actions">
                        {c.causes
                          .filter((x) => x.kind === "stale_rollup" || x.kind === "cleared_rollup")
                          .flatMap((x) => x.reports)
                          .map((r) => (
                            <button key={r.id} type="button" className="kpi-action" onClick={() => onOpenReport(r.id)}>
                              Open {reportName(r.report)} →
                            </button>
                          ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body">None: wherever both hold a count, live entries and history agree.</div>
        )}
      </div>

      <div className="card co-card" id="co-sec-rollups">
        <div className="card-header">
          <div className="card-title">Report rollups</div>
          <span className="card-hint">Open a report and press Re-sync totals — this page never writes</span>
        </div>
        <div className="card-body co-list">
          {contribs.status === "loading" && <div>Reading the rollup snapshots…</div>}
          {contribs.status === "error" && (
            <div className="co-error">
              The rollup snapshots couldn&apos;t be read ({contribs.error}), so stale rollups can&apos;t be found.{" "}
              <button type="button" className="btn ghost sm" onClick={loadContribs}>
                Try again
              </button>
            </div>
          )}
          {rollups && (
            <>
              <div className="co-sub-h">
                Stale — history holds counts the report&apos;s rows no longer have ({stale.length})
              </div>
              {stale.length === 0 && <div>None.</div>}
              {stale.map((r) => (
                <ReportLine key={r.id} r={r} onOpenReport={onOpenReport}>
                  rolled up {r.snapshot}, its rows now count {r.current}
                  {r.diffs.length > 0 &&
                    ` — ${r.diffs.map((x) => `${fmtYm(x.ym)} ${catLabel(x.category)} ${x.snapshot} → ${x.current}`).join(", ")}`}
                  {r.diffs.length === 0 && " — the same counts under different drivers"}
                  {r.cleared && " · history no longer holds what it rolled up either"}
                </ReportLine>
              ))}
              {cleared.length > 0 && (
                <>
                  <div className="co-sub-h">
                    Not in history any more — an import or a delete cleared their counts ({cleared.length})
                  </div>
                  {cleared.map((r) => (
                    <ReportLine key={r.id} r={r} onOpenReport={onOpenReport}>
                      rolled up {r.snapshot}; history holds less of it now
                      {r.cells.size > 0 && ` — ${monthsText([...r.cells.keys()].map((k) => k.slice(0, 7)))}`}
                    </ReportLine>
                  ))}
                </>
              )}
              <div className="co-sub-h">Never rolled up — their counts aren&apos;t in history ({never.length})</div>
              {never.length === 0 && <div>None.</div>}
              {never.map((r) => (
                <ReportLine key={r.id} r={r} onOpenReport={onOpenReport}>
                  {r.current} to roll up
                  {r.diffs.length > 0 && ` — ${monthsText(r.diffs.map((x) => x.ym))}`}
                </ReportLine>
              ))}
              <div className="co-foot">
                A category with live entries in a month is counted from them, so a stale or missing rollup shows only
                where a category has no live entries left that month — history is read for it then.
              </div>
            </>
          )}
        </div>
      </div>

      <div className="split two co-split">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Uline report coverage</div>
            <span className="card-hint">from each report&apos;s span — approximate</span>
          </div>
          <div className="card-body co-list">
            {uline.intervals.length ? (
              <>
                <div>
                  Covered through <b>{fmtDay(uline.through)}</b>, from {fmtDay(uline.first)}.
                </div>
                <div>
                  {uline.intervals.map((iv) => `${fmtDay(iv.start)} – ${fmtDay(iv.end)}`).join(" · ")}
                </div>
                {uline.gaps.map((g) => (
                  <div key={g.start} className="co-gap">
                    Gap: {fmtDay(g.start)} – {fmtDay(g.end)} ({g.days} days) — the Uline rows for those days (Late,
                    Damage, Lost/Missing, report misdeliveries) are missing, not zero.
                  </div>
                ))}
                {lag.n > 0 && (
                  <div>
                    A report row arrives a median <b>{lag.median} days</b> after its date (90% within {lag.p90}), so the
                    latest month is always short.
                  </div>
                )}
              </>
            ) : (
              <div>No report has a span yet.</div>
            )}
          </div>
        </div>
        <div className="card" id="co-sec-zeros">
          <div className="card-header">
            <div className="card-title">Suspicious zeros</div>
            <span className="card-hint">history 0 where the year before ran at 4+ a month</span>
          </div>
          <div className="card-body co-list">
            {zeros.length === 0 && <div>None.</div>}
            {zeros.map((z) => (
              <div key={`${z.ym}|${z.category}`}>
                <span className="cat-swatch" style={{ background: catColor(z.category) }} />
                <b>
                  {fmtYm(z.ym)} {catLabel(z.category)}
                </b>
                : 0 on file, against a median of {z.median} over the {z.prior} months before — more likely a sheet that
                wasn&apos;t imported than a clean month.
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card co-card" id="co-sec-unattributed">
        <div className="card-header">
          <div className="card-title">Unattributed failures</div>
          <span className="card-hint">no driver: in no total · the Overview&apos;s tile counts the Counted column</span>
        </div>
        {unattributed.length ? (
          <div className="table-wrap">
            <table className="data analytics-table co-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Counted</th>
                  <th className="num">No-fault</th>
                  <th className="num">All</th>
                  <th>By category</th>
                  <th>Load-driver names</th>
                </tr>
              </thead>
              <tbody>
                {unattributed.map((m) => (
                  <tr key={m.ym}>
                    <td>{fmtYm(m.ym)}</td>
                    <td className="num">
                      {m.counted ? (
                        <button
                          type="button"
                          className="kpi-note-n"
                          title="Would count against a driver: not marked no-fault"
                          onClick={() =>
                            openDrill(
                              incidentsDrill(m.countedIds, {
                                months: [m.ym],
                                title: "Unattributed failures",
                                label: fmtYm(m.ym),
                              }),
                            )
                          }
                        >
                          {m.counted}
                        </button>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="num">{m.noFault}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="kpi-note-n"
                        title="Every row with no driver, no-fault included"
                        onClick={() =>
                          openDrill(incidentsDrill(m.ids, { months: [m.ym], title: "Unattributed rows", label: fmtYm(m.ym) }))
                        }
                      >
                        {m.total}
                      </button>
                    </td>
                    <td className="co-months">
                      {Object.entries(m.byCat)
                        .map(([c, n]) => `${catLabel(c)} ${n}`)
                        .join(", ")}
                    </td>
                    <td className="co-months">
                      {m.names.length
                        ? m.names
                            .slice(0, 3)
                            .map((x) => `${x.name} (${x.n})`)
                            .join(", ")
                        : "—"}
                      {m.names.length > 3 ? ` +${m.names.length - 3}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body">None.</div>
        )}
      </div>

      <div className="card co-card" id="co-sec-roster">
        <div className="card-header">
          <div className="card-title">On file but not on the roster</div>
          <span className="card-hint">counted in every total, never hidden</span>
        </div>
        <RosterGate>
          <div className="card-body co-list">
            {offRoster.length === 0 && <div>None: every driver id on file has a roster row.</div>}
            {offRoster.map((p) => (
              <div key={p.id}>
                <b>{p.name}</b> <span className="meta">({p.id})</span> · {p.n} counted · on file{" "}
                {p.firstOnFile === p.lastOnFile ? fmtYm(p.firstOnFile) : `${fmtYm(p.firstOnFile)} – ${fmtYm(p.lastOnFile)}`}
              </div>
            ))}
          </div>
        </RosterGate>
      </div>
    </>
  );
}

// The coverage grid's row labels on a phone, where the long ones are cut off.
const SHORT_LABEL = { forgotten_freight: "FF", [ATTEMPTS]: "Attempts", complaint: "Other" };
const rowLabel = (cat) =>
  cat === ATTEMPTS ? "Attempts (logged)" : cat === "complaint" ? "Other (complaints)" : categoriesFor([cat])[0].label;
const spanOf = (ms) => (ms.length === 1 ? fmtYm(ms[0]) : `${fmtYm(ms[0])} – ${fmtYm(ms[ms.length - 1])}`);
// A report as the Reports list names it ("Week of Sep 14, 2026"), never its raw Uline
// label ("9/14/2026 THRU 9/18/2026").
const reportName = (r) => (r?.name ? reportWeekName(r) : r?.week_ending ? `week ending ${fmtDay(String(r.week_ending).slice(0, 10))}` : "report");

function ReportLine({ r, onOpenReport, children }) {
  return (
    <div className="co-report">
      <span>
        <b>{reportName(r.report)}</b>
        {reportSpanText(r.report) ? ` · ${reportSpanText(r.report)}` : ""} · {children}
      </span>
      <button type="button" className="kpi-action" onClick={() => onOpenReport(r.id)}>
        Open report →
      </button>
    </div>
  );
}

function ReadError({ err, retry }) {
  return (
    <span className="co-error">
      {" "}
      · {err.stale ? "couldn't refresh" : "couldn't load"} ({err.message}){" "}
      {retry && (
        <button type="button" className="btn ghost sm" onClick={retry}>
          Try again
        </button>
      )}
    </span>
  );
}
