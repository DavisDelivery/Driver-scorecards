import React, { useState, useEffect } from "react";

// Live attempts feed from the dispatch app (CORS-enabled, read-only, no auth).
// A delivery "attempt" is a stop a driver couldn't complete; CS prepends "ATT"
// to the shipment and unplans it, so it later shows a different driver (or none).
// The feed computes who ORIGINALLY had each attempt from that morning's routed
// plan. This card only consumes + displays it — no backend here.
const FEED_URL =
  "https://dd-dispatch-map.netlify.app/.netlify/functions/nuvizz-attempts";

const AMBER = "#b45309";

// Today as YYYY-MM-DD in America/New_York (the feed's default day boundary).
function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// MM/DD/YYYY for display, parsed from the string to avoid timezone day-shift.
function fmtMDY(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "");
}

function StatusBadge({ a }) {
  const unplanned = a.currentlyUnplanned;
  const label = unplanned ? "Unplanned" : a.currentStatus || "—";
  return (
    <span
      className="chip"
      style={
        unplanned
          ? { background: "#fef3c7", color: AMBER, border: "1px solid #fcd9a3" }
          : { background: "var(--bg-3)", color: "var(--text-2)" }
      }
    >
      {label}
    </span>
  );
}

// Live "Delivery Attempts" card for the driver scorecard. Optional `driver`
// (userName/name substring) filters the feed for a single-driver view.
export default function AttemptsScorecardCard({ driver }) {
  const [date, setDate] = useState(todayET);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    setError(null);
    const url =
      `${FEED_URL}?date=${encodeURIComponent(date)}` +
      (driver ? `&driver=${encodeURIComponent(driver)}` : "");
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!active) return;
        if (!j || j.ok === false) throw new Error(j?.error || "Feed error");
        setData(j);
        setStatus("ready");
      })
      .catch((e) => {
        if (!active || e.name === "AbortError") return;
        setError(e.message || "Failed to load");
        setStatus("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [date, driver]);

  const attempts = data?.attempts || [];
  const count = data?.count ?? attempts.length;
  const counts = data?.manifest?.counts;
  const unmatched = counts?.unmatched || 0;
  const planMissing = !!data?.manifest?.planMissing;

  return (
    <>
      <div className="section-head" style={{ marginTop: 26 }}>
        Delivery Attempts
      </div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            Original Driver · Live
            {status === "ready" && (
              <span style={{ color: "var(--text-2)", fontWeight: 400 }}>
                {"  "}· {count} attempt{count === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <input
            type="date"
            value={date}
            max={todayET()}
            onChange={(e) => setDate(e.target.value || todayET())}
            style={{ fontFamily: "var(--mono)", fontSize: 12 }}
            title="Attempts recorded on this day (America/New_York)"
          />
        </div>
        <div className="card-body tight">
          {status === "loading" && (
            <div className="empty-state">Loading attempts…</div>
          )}
          {status === "error" && (
            <div className="empty-state" style={{ color: "var(--accent-red)" }}>
              Couldn't reach the attempts feed ({error}). Try again shortly.
            </div>
          )}
          {status === "ready" && attempts.length === 0 && (
            <div className="empty-state">
              No attempts recorded for {fmtMDY(date)}.
            </div>
          )}
          {status === "ready" && attempts.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Original Driver</th>
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
                      <td style={{ fontWeight: 700 }}>
                        {a.matched && a.originalDriverName ? (
                          a.originalDriverName
                        ) : (
                          <span style={{ color: AMBER }}>Unknown</span>
                        )}
                      </td>
                      <td>
                        <div>{a.businessName || "—"}</div>
                        {(a.city || a.state) && (
                          <div className="meta">
                            {[a.city, a.state].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="pro-num">{a.shipmentNbr || "—"}</td>
                      <td>{a.stopNbr || "—"}</td>
                      <td>{a.routeName || "—"}</td>
                      <td>
                        <StatusBadge a={a} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {status === "ready" && (unmatched > 0 || planMissing) && (
            <div
              className="meta"
              style={{ padding: "8px 14px", color: "var(--text-2)" }}
            >
              {unmatched > 0 &&
                `${unmatched} attempt${unmatched === 1 ? "" : "s"} without a morning driver (shown as Unknown).`}
              {unmatched > 0 && planMissing ? " " : ""}
              {planMissing && "Morning plan snapshot was unavailable for this day."}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
