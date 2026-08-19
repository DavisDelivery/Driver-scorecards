import React from "react";
import { fetchStopEvents, actorsFromEvents } from "../data/attemptsFeed.js";

// Detail view for one attempt row, opened by clicking its PRO.
//
// Everything the feed already knows renders immediately and costs nothing. The
// activity history is deliberately behind a button: the dispatch app answers it with
// a live vendor lookup, so it happens once, for one order, when someone asks for it —
// never on open and never for a list.
//
// It is worth asking for on an unattributed row. The feed can only name a driver when
// the stop was in that morning's routed plan; the timeline carries the actual pickup
// and dispatch events, so it names who had the order even after it was unplanned and
// handed to someone else.

const fmtDateTime = (s) => String(s || "").replace(/\s+/g, " ").trim();

function Field({ k, v }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="dd-kv">
      <span className="dd-k">{k}</span>
      <span>{v}</span>
    </div>
  );
}

const IDLE = { status: "idle", events: [], error: null };

export default function StopDetailModal({ row, legs, onClose }) {
  // Every stop on this order, original first so the "-1" duplicates follow it.
  const allLegs = React.useMemo(() => {
    const list = (Array.isArray(legs) && legs.length ? legs : [row]).filter(Boolean);
    const byStop = new Map(list.map((l) => [String(l.stopNbr), l]));
    return [...byStop.values()].sort((a, b) =>
      String(a.stopNbr).localeCompare(String(b.stopNbr)),
    );
  }, [legs, row]);

  const [activeStop, setActiveStop] = React.useState(String(row?.stopNbr || ""));
  // Timelines are per stop, so they're cached per stop — switching between the legs
  // of one order doesn't re-spend a vendor lookup on a leg already loaded.
  const [byStop, setByStop] = React.useState({});

  React.useEffect(() => {
    setActiveStop(String(row?.stopNbr || ""));
    setByStop({});
  }, [row?.stopNbr]);

  const active = allLegs.find((l) => String(l.stopNbr) === activeStop) || row;
  const state = byStop[activeStop] || IDLE;

  async function loadHistory() {
    const stop = activeStop;
    setByStop((m) => ({ ...m, [stop]: { status: "loading", events: [], error: null } }));
    try {
      const { events } = await fetchStopEvents(stop, { stopId: active?.stopId });
      setByStop((m) => ({ ...m, [stop]: { status: "ready", events, error: null } }));
    } catch (err) {
      setByStop((m) => ({
        ...m,
        [stop]: {
          status: "error",
          events: [],
          error: err?.message || "Could not load the activity history",
        },
      }));
    }
  }

  if (!row) return null;
  const actors = state.events.length ? actorsFromEvents(state.events) : [];
  // Only people with driver events "had" the order. A dispatcher who planned or
  // unplanned it is listed separately, not as the person who had it.
  const ours = actors.filter((a) => a.drove);
  const others = actors.filter((a) => !a.drove);
  const place = [active.city, active.state].filter(Boolean).join(", ");
  const isDup = /-\d+$/.test(String(active.stopNbr || ""));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{active.shipmentNbr || active.stopNbr}</div>
            <div className="meta">
              {active.businessName || "—"}
              {place ? ` · ${place}` : ""}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>

        <div className="modal-body">
          {allLegs.length > 1 && (
            <div className="sd-legs">
              <span className="dd-k">
                {allLegs.length} stops on this order — dispatch counts each separately
              </span>
              <div className="month-picker" style={{ margin: 0 }}>
                {allLegs.map((l) => (
                  <button
                    key={l.stopNbr}
                    type="button"
                    className={`month-btn ${String(l.stopNbr) === activeStop ? "active" : ""}`}
                    onClick={() => setActiveStop(String(l.stopNbr))}
                    title={
                      /-\d+$/.test(String(l.stopNbr))
                        ? "The duplicate leg dispatch created later"
                        : "The original stop"
                    }
                  >
                    {l.stopNbr}
                    {/-\d+$/.test(String(l.stopNbr)) ? "" : " · original"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="dd-notes">
            <Field k="Stop number" v={active.stopNbr} />
            <Field k="Shipment" v={active.shipmentNbr} />
            <Field k="Address" v={active.addr1} />
            <Field k="Zip" v={active.zip} />
            <Field
              k="Status"
              v={active.currentlyUnplanned ? "Unplanned" : active.currentStatus}
            />
            <Field k="Route" v={active.routeName} />
            <Field
              k="Attempt charged to"
              v={active.originalDriverName || "Not yet attributed"}
            />
            <Field k="On now" v={active.currentDriverName} />
            <Field k="Detected" v={fmtDateTime(active.detectedAt)} />
            {/* Full text — the log row clamps it to two lines. */}
            <Field k="CS note" v={active.note} />
          </div>

          <div className="section-head" style={{ marginTop: 18 }}>
            Activity history
            {state.status === "ready" && (
              <span className="meta"> · {state.events.length} events</span>
            )}
          </div>

          {state.status === "idle" && (
            <div className="empty-state">
              {active.originalDriverName
                ? "The timeline shows every planned, dispatched and unplanned action on this stop, with who did it."
                : isDup
                  ? "This is the duplicate leg, created after the order was already attempted — it usually carries no driver events at all. Check the original stop above for who had it."
                  : "This attempt has no driver attributed — the stop wasn't in the morning routed plan. The timeline names who actually had it."}
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={loadHistory}>
                  Load activity history
                  {allLegs.length > 1 ? ` for ${active.stopNbr}` : ""}
                </button>
              </div>
            </div>
          )}

          {state.status === "loading" && (
            <div className="empty-state">Loading the activity history…</div>
          )}

          {state.status === "error" && (
            <div className="empty-state" style={{ color: "var(--accent-red)" }}>
              {state.error}
              <div style={{ marginTop: 10 }}>
                <button className="btn ghost sm" onClick={loadHistory}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {state.status === "ready" && (
            <>
              {actors.length > 0 && (
                <div className="dd-notes" style={{ marginBottom: 10 }}>
                  <div className="dd-kv">
                    <span className="dd-k">Who had it</span>
                    <span>
                      {ours.length
                        ? ours
                            .map(
                              (a) =>
                                `${a.name}${a.routes.length ? ` (${a.routes.join(", ")})` : ""}`,
                            )
                            .join(" · ")
                        : allLegs.length > 1
                          ? "No driver ever picked THIS stop up — it was only planned and unplanned. Try the other leg above."
                          : "No driver ever picked this stop up — it was only planned and unplanned."}
                    </span>
                  </div>
                  {others.length > 0 && (
                    <div className="dd-kv">
                      <span className="dd-k">Planned / updated by</span>
                      <span>
                        {others
                          .map((a) => `${a.name}${a.company ? ` — ${a.company}` : ""}`)
                          .join(" · ")}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {state.events.length === 0 ? (
                <div className="empty-state">
                  No activity recorded against this stop.
                </div>
              ) : (
                <div className="ff-timeline-body">
                  {state.events.map((e, i) => (
                    <div key={i} className="ff-tl-row">
                      <span className="ff-tl-time">{fmtDateTime(e.dttm)}</span>
                      <span className="ff-tl-label">{e.name || e.code}</span>
                      {e.routeName && (
                        <span className="ff-tl-detail">{e.routeName}</span>
                      )}
                      {e.user && (
                        <span className="ff-tl-by">
                          {e.user.replace(/\s+/g, " ").trim()}
                          {e.company ? ` · ${e.company}` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
