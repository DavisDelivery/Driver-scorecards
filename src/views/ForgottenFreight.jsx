import React from "react";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import {
  saveIncident,
  getIncidents,
  deleteIncident,
  getIncidentPhotos,
} from "../data/firebase.js";
import { matchDriver } from "../data/driverMatch.js";
import DriverModal from "./DriverModal.jsx";

const pad9 = (p) => String(p || "").replace(/\D/g, "").padStart(9, "0");

// Format an ISO date (YYYY-MM-DD…) as US month/day/year (MM/DD/YYYY). Parsed from
// the string directly so it never shifts a day from new Date() timezone handling.
const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

// What was left behind on the order. Free pick — blank is allowed.
const FORGOTTEN_ITEMS = ["Skid", "Peanut", "Bubble Wrap", "Foam Box", "Pallet Jack"];

export default function ForgottenFreight({ drivers, incidents, onSaved }) {
  const [pro, setPro] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const [pull, setPull] = React.useState(null); // { stop, photos, error }
  const [driverId, setDriverId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [forgottenItem, setForgottenItem] = React.useState("");
  // One date the whole batch is logged under; defaults to today and stays put
  // between entries so a day's worth of forgotten freight all lands on one date.
  const [incidentDate, setIncidentDate] = React.useState(today);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState("");
  const [focus, setFocus] = React.useState(null);

  // Inline edit / delete of an existing forgotten-freight log entry.
  const [editingId, setEditingId] = React.useState(null);
  const [editDriverId, setEditDriverId] = React.useState("");
  const [editDate, setEditDate] = React.useState("");
  const [editNotes, setEditNotes] = React.useState("");
  const [editItem, setEditItem] = React.useState("");
  const [rowBusy, setRowBusy] = React.useState(false);

  function startEdit(inc) {
    setEditingId(inc.id);
    setEditDriverId(inc.driver_id || "");
    setEditDate((inc.delivered_date || inc.created_at || "").slice(0, 10));
    setEditNotes(inc.notes || "");
    setEditItem(inc.forgotten_item || "");
  }
  function cancelEdit() {
    setEditingId(null);
    setRowBusy(false);
  }
  async function saveEdit(inc) {
    if (!editDriverId) return;
    setRowBusy(true);
    const drv = drivers.find((d) => d.id === editDriverId);
    try {
      // Light log records carry no photo bytes; re-attach the stored photos so the
      // save doesn't blank out has_photos / wipe the photos:{id} side of the blob.
      const { photo_urls, photo_meta } = await getIncidentPhotos(inc.id);
      await saveIncident({
        ...inc,
        driver_id: drv.id,
        driver_name: drv.name,
        delivered_date: editDate || inc.delivered_date,
        notes: editNotes,
        forgotten_item: editItem,
        reason: editItem
          ? `Forgotten freight — ${editItem} (manual entry)`
          : "Forgotten freight (manual entry)",
        photo_urls,
        photo_meta,
        updated_at: new Date().toISOString(),
      });
      setSavedMsg(`Updated — ${inc.pro_number} now charged to ${drv.name}.`);
      setEditingId(null);
      onSaved && onSaved();
    } catch (err) {
      setSavedMsg(`Update failed: ${err.message}`);
    } finally {
      setRowBusy(false);
    }
  }
  async function deleteEntry(inc) {
    if (
      !window.confirm(
        `Delete forgotten-freight entry ${inc.pro_number} (${inc.driver_name || "unknown driver"})? This cannot be undone.`,
      )
    )
      return;
    setRowBusy(true);
    try {
      await deleteIncident(inc.id);
      setSavedMsg(`Deleted — ${inc.pro_number} removed from the log.`);
      if (editingId === inc.id) setEditingId(null);
      onSaved && onSaved();
    } catch (err) {
      setSavedMsg(`Delete failed: ${err.message}`);
    } finally {
      setRowBusy(false);
    }
  }

  const ffIncidents = React.useMemo(
    () =>
      incidents
        .filter((i) => i.category === "forgotten_freight")
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [incidents],
  );

  async function doPull() {
    const p = pad9(pro);
    if (p.length !== 9) {
      setPull({ error: "Enter a PRO number (digits only — it will be zero-padded to 9)." });
      return;
    }
    setPulling(true);
    setPull(null);
    setSavedMsg("");
    try {
      const res = await fetchStopData(p);
      setPull({ ...res, pro: p });
      const auto = matchDriver(res?.stop?.driverName, drivers);
      setDriverId(auto ? auto.id : "");
      // Date intentionally left as the batch date (see incidentDate) — it is not
      // pulled from NuVizz so a day's entries all land on the chosen/today date.
    } catch (err) {
      setPull({ error: err.message || "Pull failed", pro: p });
    } finally {
      setPulling(false);
    }
  }

  async function doSave() {
    if (!pull || !driverId) return;
    const dup = incidents.find(
      (i) => i.category === "forgotten_freight" && i.pro_number === pull.pro,
    );
    if (dup && !window.confirm(
      `PRO ${pull.pro} is already logged as forgotten freight for ${dup.driver_name || "a driver"}. Add it again anyway?`,
    )) return;
    setSaving(true);
    setSavedMsg("");
    const drv = drivers.find((d) => d.id === driverId);
    const s = pull.stop || {};
    const now = new Date().toISOString();
    // The batch date (defaults to today, sticky between entries) is what every
    // entry is logged under; falls back to today if somehow cleared.
    const delivered = incidentDate || now.slice(0, 10);
    const photos = (pull.photos || []).map((p) => p.dataUri || p.url).filter(Boolean);
    const incident = {
      id: `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      pro_number: pull.pro,
      category: "forgotten_freight",
      fault: "driver",
      no_fault: false,
      driver_id: drv.id,
      driver_name: drv.name,
      driver_raw: s.driverName || drv.name,
      nuvizz_driver_id: s.driverId || null,
      nuvizz_load_nbr: s.loadNbr || null,
      nuvizz_vehicle: s.vehicleNbr || null,
      customer: s.to?.name || "",
      to_city: s.to?.city || "",
      to_state: s.to?.state || "",
      zip_code: s.to?.zip || "",
      delivered_date: delivered,
      forgotten_item: forgottenItem,
      reason: forgottenItem
        ? `Forgotten freight — ${forgottenItem} (manual entry)`
        : "Forgotten freight (manual entry)",
      notes: notes || "",
      sources: [],
      report_id: null,
      manual_entry: true,
      photo_urls: photos,
      has_photos: photos.length > 0,
      photo_count: photos.length,
      created_at: now,
      ingested_at: now,
    };
    try {
      await saveIncident(incident);
      setSavedMsg(`Saved — ${pull.pro} charged to ${drv.name} under ${fmtMDY(delivered)} (${photos.length} photo${photos.length === 1 ? "" : "s"}).`);
      setPull(null);
      setPro("");
      setNotes("");
      setDriverId("");
      setForgottenItem("");
      onSaved && onSaved();
    } catch (err) {
      setSavedMsg(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const matched = drivers.find((d) => d.id === driverId);
  const s = pull?.stop;

  return (
    <div>
      <div className="page-title">Manual Entry</div>
      <h1 className="page-heading">
        Forgotten Freight
        <span className="meta">· {ffIncidents.length} on record</span>
      </h1>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="ff-input-row">
            <input
              type="text"
              inputMode="numeric"
              placeholder="PRO number…"
              value={pro}
              onChange={(e) => setPro(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pulling && doPull()}
              style={{ maxWidth: 220, fontFamily: "var(--mono)" }}
            />
            <button className="btn primary" onClick={doPull} disabled={pulling}>
              {pulling ? "Pulling from NuVizz…" : "Pull Order"}
            </button>
            <div className="ff-date-field">
              <span className="dd-k">Log entries under</span>
              <input
                type="date"
                value={incidentDate}
                onChange={(e) => setIncidentDate(e.target.value)}
                style={{ fontFamily: "var(--mono)" }}
                title="Every new entry is logged under this date"
              />
            </div>
          </div>
          <div className="meta" style={{ marginTop: 6 }}>
            All new entries are logged under this date (defaults to today). Change it
            once and the whole batch follows.
          </div>

          {pull?.error && !s && (
            <div className="ff-error">NuVizz: {pull.error}</div>
          )}

          {s && (
            <div className="ff-preview">
              <div className="dd-meta-grid" style={{ marginTop: 14 }}>
                <div><span className="dd-k">PRO</span><span className="dd-v" style={{ fontFamily: "var(--mono)" }}>{pull.pro}</span></div>
                <div><span className="dd-k">NuVizz Driver</span><span className="dd-v">{s.driverName || "—"}</span></div>
                <div><span className="dd-k">Customer</span><span className="dd-v">{s.to?.name || "—"}</span></div>
                <div><span className="dd-k">Destination</span><span className="dd-v">{[s.to?.city, s.to?.state].filter(Boolean).join(", ") || "—"}</span></div>
                <div><span className="dd-k">Route</span><span className="dd-v">{s.routeName || "—"}</span></div>
                <div><span className="dd-k">Status</span><span className="dd-v">{s.stopStatus || "—"}</span></div>
              </div>

              {(s.exceptions || []).length > 0 && (
                <div className="dd-notes" style={{ marginTop: 10 }}>
                  {s.exceptions.map((ex, i) => (
                    <div key={i}><span className="dd-k">Exception</span> {ex.code} — {ex.desc} {ex.comment ? `(${ex.comment})` : ""}</div>
                  ))}
                </div>
              )}

              {(pull.photos || []).length > 0 && (
                <div className="dd-photos" style={{ marginTop: 10 }}>
                  {pull.photos.map((p, i) => (
                    <img key={i} src={p.dataUri || p.url} alt={`POD ${i + 1}`} className="dd-photo" />
                  ))}
                </div>
              )}
              {(pull.photos || []).length === 0 && (
                <div className="meta" style={{ marginTop: 10 }}>No POD photos on this stop.</div>
              )}

              <div className="ff-charge-row">
                <div>
                  <div className="dd-k">What was forgotten</div>
                  <select
                    value={forgottenItem}
                    onChange={(e) => setForgottenItem(e.target.value)}
                  >
                    <option value="">— Select item —</option>
                    {FORGOTTEN_ITEMS.map((it) => (
                      <option key={it} value={it}>
                        {it}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="dd-k">Charge to driver</div>
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">— Select driver —</option>
                    {drivers
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}{d.role === "loader" ? " (loader)" : ""}
                        </option>
                      ))}
                  </select>
                  {matched && s.driverName && (
                    <div className="meta" style={{ marginTop: 4 }}>
                      {matchDriver(s.driverName, drivers)?.id === matched.id
                        ? "Auto-matched from NuVizz"
                        : "Manual override"}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="dd-k">Notes</div>
                  <input
                    type="text"
                    placeholder="Optional notes…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <button
                  className="btn primary"
                  onClick={doSave}
                  disabled={!driverId || saving}
                >
                  {saving ? "Saving…" : "Add Forgotten Freight"}
                </button>
              </div>
            </div>
          )}

          {savedMsg && <div className="ff-saved">{savedMsg}</div>}
        </div>
      </div>

      <div className="section-head">Forgotten Freight Log</div>
      <div className="card">
        <div className="card-body" style={{ padding: "4px 14px" }}>
          {ffIncidents.length === 0 && (
            <div className="empty-state">Nothing logged yet.</div>
          )}
          {ffIncidents.map((inc) => (
            <div key={inc.id} className="ff-log-entry">
              <div
                className="dd-incident-head"
                onClick={() =>
                  setFocus(drivers.find((d) => d.id === inc.driver_id) || {
                    id: inc.driver_id,
                    name: inc.driver_name || "(unknown)",
                    role: "driver",
                  })
                }
              >
                <span className="pro-num">{inc.pro_number}</span>
                <span className="lb-name" style={{ width: "auto" }}>{inc.driver_name}</span>
                <span className="meta">{inc.customer || ""}</span>
                {inc.forgotten_item && (
                  <span className="ff-item-chip">{inc.forgotten_item}</span>
                )}
                <span className="meta" style={{ marginLeft: "auto" }}>
                  {fmtMDY(inc.delivered_date || inc.created_at)}
                  {inc.has_photos ? " · 📸" : ""}
                </span>
                <span className="ff-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn ghost sm"
                    onClick={() => (editingId === inc.id ? cancelEdit() : startEdit(inc))}
                    title="Edit this entry"
                  >
                    {editingId === inc.id ? "Close" : "Edit"}
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => deleteEntry(inc)}
                    disabled={rowBusy}
                    title="Delete this entry"
                    style={{ color: "var(--accent-red)" }}
                  >
                    Delete
                  </button>
                </span>
              </div>

              {editingId === inc.id && (
                <div className="ff-edit-row" onClick={(e) => e.stopPropagation()}>
                  <div>
                    <div className="dd-k">Charge to driver</div>
                    <select
                      value={editDriverId}
                      onChange={(e) => setEditDriverId(e.target.value)}
                    >
                      <option value="">— Select driver —</option>
                      {drivers
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}{d.role === "loader" ? " (loader)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <div className="dd-k">Incident date</div>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      style={{ fontFamily: "var(--mono)" }}
                    />
                  </div>
                  <div>
                    <div className="dd-k">What was forgotten</div>
                    <select value={editItem} onChange={(e) => setEditItem(e.target.value)}>
                      <option value="">— Select item —</option>
                      {FORGOTTEN_ITEMS.map((it) => (
                        <option key={it} value={it}>
                          {it}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="dd-k">Notes</div>
                    <input
                      type="text"
                      placeholder="Optional notes…"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => saveEdit(inc)}
                    disabled={!editDriverId || rowBusy}
                  >
                    {rowBusy ? "Saving…" : "Save Changes"}
                  </button>
                  <button className="btn ghost" onClick={cancelEdit} disabled={rowBusy}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {focus && (
        <DriverModal
          driver={focus}
          incidents={incidents.filter((i) => i.driver_id === focus.id)}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}
