import React from "react";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import { saveIncident, getIncidents } from "../data/firebase.js";
import DriverModal from "./DriverModal.jsx";

const pad9 = (p) => String(p || "").replace(/\D/g, "").padStart(9, "0");

// Fuzzy-match a NuVizz driver name to the roster.
function matchDriver(nuvizzName, drivers) {
  if (!nuvizzName) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const target = norm(nuvizzName);
  if (!target) return null;
  // exact
  let hit = drivers.find((d) => norm(d.name) === target);
  if (hit) return hit;
  // all tokens contained either way
  const tTokens = target.split(/\s+/);
  hit = drivers.find((d) => {
    const dn = norm(d.name);
    return tTokens.every((t) => dn.includes(t));
  });
  if (hit) return hit;
  // first+last initial style fallback
  hit = drivers.find((d) => {
    const dTokens = norm(d.name).split(/\s+/);
    return (
      dTokens[0] === tTokens[0] &&
      dTokens[dTokens.length - 1]?.[0] === tTokens[tTokens.length - 1]?.[0]
    );
  });
  return hit || null;
}

export default function ForgottenFreight({ drivers, incidents, onSaved }) {
  const [pro, setPro] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const [pull, setPull] = React.useState(null); // { stop, photos, error }
  const [driverId, setDriverId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [incidentDate, setIncidentDate] = React.useState("");
  const [dateTouched, setDateTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState("");
  const [focus, setFocus] = React.useState(null);

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
      if (!dateTouched) {
        const t = res?.stop?.to || {};
        const raw = t.confirmedDTTM || t.departureDTTM || t.arrivalDTTM || "";
        setIncidentDate(raw ? String(raw).slice(0, 10) : new Date().toISOString().slice(0, 10));
      }
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
    const deliveredRaw = s.to?.confirmedDTTM || s.to?.departureDTTM || s.to?.arrivalDTTM || "";
    // The set incident date wins (historical backfill); falls back to the
    // NuVizz delivery date, then today. Sticky between entries on purpose.
    const delivered =
      incidentDate ||
      (deliveredRaw ? String(deliveredRaw).slice(0, 10) : now.slice(0, 10));
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
      reason: "Forgotten freight (manual entry)",
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
      setSavedMsg(`Saved — ${pull.pro} charged to ${drv.name} under ${delivered} (${photos.length} photo${photos.length === 1 ? "" : "s"}).`);
      setPull(null);
      setPro("");
      setNotes("");
      setDriverId("");
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
                  <div className="dd-k">Incident date</div>
                  <input
                    type="date"
                    value={incidentDate}
                    onChange={(e) => {
                      setIncidentDate(e.target.value);
                      setDateTouched(true);
                    }}
                    style={{ fontFamily: "var(--mono)" }}
                  />
                  <div className="meta" style={{ marginTop: 4 }}>
                    {dateTouched
                      ? "Set manually — stays for the next entry (backfill mode)"
                      : "From NuVizz delivery — edit for historical backfill"}
                  </div>
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
            <div
              key={inc.id}
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
              <span className="meta" style={{ marginLeft: "auto" }}>
                {(inc.delivered_date || inc.created_at || "").slice(0, 10)}
                {inc.has_photos ? " · 📸" : ""}
              </span>
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
