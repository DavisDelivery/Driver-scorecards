import React, { useState, useEffect } from "react";
import { loadFeedDay, lastScannedDay, DAY_STATUS_TEXT, FEED_EPOCH } from "../data/attemptsFeed.js";
import {
  groupAttemptLegs,
  unassignedReason,
  UNASSIGNED_REASON_SHORT,
  fillFlags,
  FILL_LEFT_REASON,
} from "../data/attemptLegs.js";
import { attemptsDayCandidates, attemptsDayBounds, pickedAttemptsDay, noScanText } from "../data/scorecardKpis.js";
import { fmtDate } from "../data/period.js";

// Live "Delivery Attempts" card for the driver scorecard. Reads the dispatch
// app's automated attempts feed (see attemptsFeed.js) and shows who ORIGINALLY
// had each attempted delivery. Display only — no backend here.
//
// Its day belongs to the Scorecard's month picker (scorecardKpis.js): a day picked in
// the filter row, or else the picked month's last business day whose evening scan ran.
// It used to open on today, which is empty until the 8 PM scan, behind a date box of
// its own inside the card. Days come through the shared feed cache, one at a time.
const AMBER = "#b45309";

// A day as people read it — "Oct 7", "Wed, Oct 7" — parsed from the string, so no
// timezone can shift it (period.js fmtDate).
const fmtMDY = (s) => fmtDate(s);
const fmtDay = (s) => fmtDate(s, { weekday: true });

// One chip style for every status, in sentence case ("Delivered", not the feed's
// "DELIVERED"); an order still unplanned is the one in amber.
const sentenceCase = (s) => {
  const t = String(s || "").replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
};
function StatusBadge({ a }) {
  const unplanned = a.currentlyUnplanned;
  const label = unplanned ? "Unplanned" : sentenceCase(a.currentStatus) || "—";
  return (
    <span className="chip sc-att-status" style={unplanned ? { color: AMBER } : undefined}>
      {label}
    </span>
  );
}

// The card's day for a month: the day picked (when it is one of that month's), else
// the latest business day with an evening scan, found one request at a time (for the
// current month, possibly the month before's last: scorecardKpis.js).
//   → { status: loading | ready | none | error, day, entry, picked, bounds, tried }
//     none   the month has no feed day to show (before the feed began, 06/25/2026, or
//            no scan on any of the days tried)
//     tried  the days asked for, newest first, with each one's status and order count
export function useAttemptsDay(anchorYm, pickedDay) {
  const picked = pickedAttemptsDay(pickedDay, anchorYm);
  const [state, setState] = useState({ status: "loading", day: picked, entry: null, tried: [] });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading", day: picked, entry: null, tried: [] });
    const signal = controller.signal;
    const run = picked
      ? loadFeedDay(picked, { signal }).then((entry) => ({ day: picked, entry, tried: [] }))
      : lastScannedDay(attemptsDayCandidates(anchorYm), { signal });
    run
      .then((r) => {
        if (active) setState({ status: r.day ? "ready" : "none", day: r.day, entry: r.entry, tried: r.tried || [] });
      })
      .catch((e) => {
        if (!active || e?.name === "AbortError") return;
        setState({ status: "error", day: picked, entry: null, tried: [], error: e?.message || "Failed to load" });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [anchorYm, picked]);
  return { ...state, picked, bounds: attemptsDayBounds(anchorYm) };
}

// `day` is useAttemptsDay's answer; `monthLabel` names the picked month.
export default function AttemptsScorecardCard({ day: state, monthLabel }) {
  const { status: loadStatus, day: date, entry } = state;
  // The default day, when it isn't the newest one tried: newer days whose scan found no
  // orders (a holiday, most likely) were stepped over, and a day before the picked
  // month stands in for a month with no scan yet. The hint says which.
  const skipped = date ? (state.tried || []).filter((t) => t.day > date && t.status === "ok" && !t.n) : [];
  const fromMonthBefore = !!(date && state.bounds && date < state.bounds.min);
  const defaultHint = [
    skipped.length ? "Last business day with attempts" : "Last business day with an evening scan",
    fromMonthBefore ? `none yet in ${monthLabel}` : null,
    skipped.length ? `${skipped.map((t) => fmtDate(t.day, { year: false })).join(", ")} scanned none` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // A day the feed has nothing for (no scan, NuVizz unreadable, unreachable) says so,
  // rather than reading as a day with no attempts.
  const feedStatus = entry?.status || null;
  const status =
    loadStatus !== "ready" ? loadStatus : feedStatus === "failed" ? "error" : feedStatus === "ok" ? "ready" : "nodata";
  const error = state.error || entry?.error || "";
  const data = entry;

  // One row per order: a -1/-2 is a duplicate order, not a second attempt, and is
  // never charged to the original's driver (see attemptLegs.js). The manifest's own
  // counts are per stop, so the Unknown count is taken from the grouped rows instead.
  const rows = React.useMemo(() => data?.rows || [], [data]);
  const planMissing = rows.some((r) => r.planMissing);
  const attempts = React.useMemo(() => groupAttemptLegs(rows), [rows]);
  const count = attempts.length;
  // The dispatch app's nightly driver lookup, when it could not read them all.
  const [fillFlag] = fillFlags(data?.fill ? [{ ...data.fill, date }] : []);
  const unknown = attempts.filter((a) => !(a.matched && a.originalDriverName));
  const unmatched = unknown.length;
  const whyUnknown = Object.entries(
    unknown.reduce((m, a) => {
      const why = unassignedReason(a);
      if (why) m[why] = (m[why] || 0) + 1;
      return m;
    }, {}),
  ).map(([why, n]) => `${n} ${UNASSIGNED_REASON_SHORT[why] || why}`);

  return (
    <>
      <div className="section-head" style={{ marginTop: 26 }}>
        Delivery attempts
      </div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Original driver · live
            {date && (
              <span style={{ color: "var(--text-2)", fontWeight: 400 }}>
                {"  "}· {fmtDay(date)}
                {status === "ready" && ` · ${count} attempt${count === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
          {loadStatus !== "none" && (
            <span className="card-hint">
              {state.picked ? "Day picked in the filter row" : defaultHint}
            </span>
          )}
        </div>
        <div className="card-body tight">
          {status === "loading" && (
            <div className="empty-state">Loading attempts…</div>
          )}
          {status === "error" && (
            <div className="empty-state" style={{ color: "var(--accent-red)" }}>
              Couldn't reach the attempts feed{error ? ` (${error})` : ""}. Try again shortly.
            </div>
          )}
          {status === "none" && (
            <div className="empty-state">
              {state.bounds
                ? noScanText(state.tried, monthLabel)
                : `The dispatch feed starts ${fmtMDY(FEED_EPOCH)}, so there are no attempted orders to show for ${monthLabel}.`}
            </div>
          )}
          {status === "nodata" && (
            <div className="empty-state">
              No attempts to show for {fmtMDY(date)}: {DAY_STATUS_TEXT[feedStatus] || feedStatus}.
            </div>
          )}
          {status === "ready" && attempts.length === 0 && (
            <div className="empty-state">
              No attempts recorded for {fmtMDY(date)}.
            </div>
          )}
          {status === "ready" && attempts.length > 0 && (
            <div className="table-wrap">
              <table className="data cards-on-phone sc-att-table">
                <thead>
                  <tr>
                    <th>Original driver</th>
                    <th>Customer</th>
                    <th>Shipment #</th>
                    <th>Stop #</th>
                    <th>Route</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a, i) => (
                    <tr key={a.shipmentNbr || a.stopNbr || i}>
                      <td className="card-primary" style={{ fontWeight: 600 }}>
                        {a.matched && a.originalDriverName ? (
                          a.originalDriverName
                        ) : (
                          <span style={{ color: AMBER }}>Unknown</span>
                        )}
                      </td>
                      <td data-label="Customer" className="sc-att-cust">
                        <div>{a.businessName || "—"}</div>
                        {(a.city || a.state) && (
                          <div className="meta">
                            {[a.city, a.state].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="pro-num" data-label="Shipment">{a.shipmentNbr || "—"}</td>
                      <td data-label="Stop">{(a.legRows || [a]).map((l) => l.stopNbr).join(" + ") || "—"}</td>
                      <td data-label="Route">{a.routeName || "—"}</td>
                      <td data-label="Status">
                        <StatusBadge a={a} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {status === "ready" && fillFlag && (
            <div className="ff-fill-flag" role="alert" style={{ margin: "8px 14px" }}>
              <strong>⚠ The nightly driver lookup couldn&apos;t finish:</strong> {fillFlag.left}{" "}
              attempt{fillFlag.left === 1 ? "" : "s"} still need a driver (
              {fillFlag.stops.map((x) => `${x.stopNbr} — ${FILL_LEFT_REASON[x.reason] || x.reason}`).join("; ")}).
            </div>
          )}
          {status === "ready" && (unmatched > 0 || planMissing) && (
            <div
              className="meta"
              style={{ padding: "8px 14px", color: "var(--text-2)" }}
            >
              {unmatched > 0 &&
                `${unmatched} attempt${unmatched === 1 ? "" : "s"} without a morning driver (shown as Unknown)${whyUnknown.length ? ` — ${whyUnknown.join(", ")}` : ""}.`}
              {unmatched > 0 && planMissing ? " " : ""}
              {planMissing && "Morning plan snapshot was unavailable for this day."}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
