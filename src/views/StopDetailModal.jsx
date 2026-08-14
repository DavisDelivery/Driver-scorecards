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

export default function StopDetailModal({ row, onClose }) {
  const [state, setState] = React.useState({ status: "idle", events: [], error: null });

  React.useEffect(() => {
    // A new order means the previously loaded timeline no longer applies.
    setState({ status: "idle", events: [], error: null });
  }, [row?.stopNbr]);

  async function loadHistory() {
    setState({ status: "loading", events: [], error: null });
    try {
      const { events } = await fetchStopEvents(row.stopNbr, { stopId: row.stopId });
      setState({ status: "ready", events, error: null });
    } catch (err) {
      setState({
        status: "error",
        events: [],
        error: err?.message || "Could not load the activity history",
      });
    }
  }

  if (!row) return null;
  const actors = state.events.length ? actorsFromEvents(state.events) : [];
  // Only people with driver events "had" the order. A dispatcher who planned or
  // unplanned it is listed separately, not as the person who had it.
  const ours = actors.filter((a) => a.drove);
  const others = actors.filter((a) => !a.drove);
  const place = [row.city, row.state].filter(Boolean).join(", ");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{row.shipmentNbr || row.stopNbr}</div>
            <div className="meta">
              {row.businessName || "—"}
              {place ? ` · ${place}` : ""}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>

        <div className="modal-body">
          <div className="dd-notes">
            <Field k="Stop number" v={row.stopNbr} />
            <Field k="Shipment" v={row.shipmentNbr} />
            <Field k="Address" v={row.addr1} />
            <Field k="Zip" v={row.zip} />
            <Field k="Status" v={row.currentlyUnplanned ? "Unplanned" : row.currentStatus} />
            <Field k="Route" v={row.routeName} />
            <Field
              k="Attempt charged to"
              v={row.originalDriverName || "Not yet attributed"}
            />
            <Field k="On now" v={row.currentDriverName} />
            <Field k="Detected" v={fmtDateTime(row.detectedAt)} />
            {row.legs > 1 && (
              <Field
                k="Split"
                v={`${row.legs} stops on this order — dispatch counts each leg separately`}
              />
            )}
          </div>

          <div className="section-head" style={{ marginTop: 18 }}>
            Activity history
            {state.status === "ready" && (
              <span className="meta"> · {state.events.length} events</span>
            )}
          </div>

          {state.status === "idle" && (
            <div className="empty-state">
              {row.originalDriverName
                ? "The timeline shows every planned, dispatched and unplanned action on this stop, with who did it."
                : "This attempt has no driver attributed — the stop wasn't in the morning routed plan. The timeline names who actually had it."}
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={loadHistory}>
                  Load activity history
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
