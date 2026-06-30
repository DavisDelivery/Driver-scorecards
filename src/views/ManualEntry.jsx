import React from "react";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import {
  saveIncident,
  deleteIncident,
  getIncidentPhotos,
} from "../data/firebase.js";
import { matchDriver } from "../data/driverMatch.js";
import { fetchAttempts, deleteAttempt, todayET } from "../data/attemptsFeed.js";
import DriverModal from "./DriverModal.jsx";
import ManualEntryAnalytics from "./ManualEntryAnalytics.jsx";

const pad9 = (p) => String(p || "").replace(/\D/g, "").padStart(9, "0");

// Format an ISO date (YYYY-MM-DD…) as US month/day/year (MM/DD/YYYY). Parsed from
// the string directly so it never shifts a day from new Date() timezone handling.
const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10);
};

// Format a NuVizz local datetime ("YYYY-MM-DDTHH:MM:SS") as MM/DD/YYYY h:mm AM/PM.
const fmtDateTime = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return String(s || "");
  let h = +m[4];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${m[2]}/${m[3]}/${m[1]} ${h}:${m[5]} ${ap}`;
};

// Status badge for an auto-detected (feed) attempt: amber "Unplanned" when the
// stop is currently unplanned, else the raw status.
function AttemptStatusBadge({ a }) {
  const unplanned = a.currentlyUnplanned;
  return (
    <span
      className="chip"
      style={
        unplanned
          ? { background: "#fef3c7", color: "#b45309", border: "1px solid #fcd9a3" }
          : { background: "var(--bg-3)", color: "var(--text-2)" }
      }
    >
      {unplanned ? "Unplanned" : a.currentStatus || "—"}
    </span>
  );
}

// Config presets for the manual-entry tabs. Both pull a PRO from NuVizz, attribute
// it to a driver, and log it as a manual incident; they differ only in copy,
// category, and whether they carry a classification dropdown.
export const FF_CONFIG = {
  category: "forgotten_freight",
  color: "#f97316",
  heading: "Forgotten Freight",
  logTitle: "Forgotten Freight Log",
  addLabel: "Add Forgotten Freight",
  recordNoun: "forgotten freight", // "…already logged as forgotten freight for…"
  deleteNoun: "forgotten-freight", // "Delete forgotten-freight entry…"
  reasonLabel: "Forgotten freight",
  classify: {
    label: "What was forgotten",
    field: "forgotten_item",
    placeholder: "— Select item —",
    options: ["Skid", "Peanut", "Bubble Wrap", "Foam", "Box", "Pallet Jack"],
  },
};

export const MISDELIVERY_CONFIG = {
  category: "misdelivery",
  color: "#f472b6",
  heading: "Mis-Deliveries",
  logTitle: "Mis-Delivery Log",
  addLabel: "Add Mis-Delivery",
  recordNoun: "a mis-delivery",
  deleteNoun: "mis-delivery",
  reasonLabel: "Mis-delivery",
  classify: {
    label: "What went wrong",
    field: "misdelivery_type",
    placeholder: "— Select issue —",
    options: ["Wrong Address", "Wrong Customer", "Wrong Item"],
  },
};

export const COMPLIMENTS_CONFIG = {
  category: "compliment",
  color: "#22c55e",
  // A compliment is positive credit to the driver — NOT a fault. Empty fault keeps
  // it out of driver-fault counts while still crediting the compliment category.
  fault: "",
  heading: "Compliments",
  logTitle: "Compliments Log",
  addLabel: "Add Compliment",
  recordNoun: "a compliment",
  deleteNoun: "compliment",
  reasonLabel: "Compliment",
  classify: null,
};

export const ATTEMPTS_CONFIG = {
  category: "attempts",
  color: "#14b8a6",
  heading: "Attempts",
  logTitle: "Attempts Log",
  addLabel: "Add Attempt",
  recordNoun: "an attempt",
  deleteNoun: "attempt",
  reasonLabel: "Delivery attempt",
  classify: null,
  // Also load the dispatch app's automated attempts feed for the selected date,
  // merged into the log alongside manual entries (with a per-row delete).
  feed: true,
  feedDeletable: true,
};

// Generic manual-entry view: pull an order from NuVizz, charge it to a driver, and
// log it as a manual incident, plus an editable/deletable log. Driven by `config`
// so Forgotten Freight and Mis-Deliveries share one implementation.
export default function ManualEntry({ drivers, incidents, onSaved, config }) {
  const classifyField = config.classify?.field;

  const [pro, setPro] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const [pull, setPull] = React.useState(null); // { stop, photos, error }
  const [driverId, setDriverId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [classifyValue, setClassifyValue] = React.useState("");
  // One date new MANUAL entries are logged under; defaults to today (ET) and stays
  // put between entries. This does NOT drive the auto feed (see feedDate below).
  const [incidentDate, setIncidentDate] = React.useState(todayET);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState("");
  const [focus, setFocus] = React.useState(null);
  const [logSearch, setLogSearch] = React.useState("");

  // Automated attempts feed (only when config.feed). It has its OWN date picker so
  // you can browse auto attempts for any day independent of the manual log date.
  const feedEnabled = !!config.feed;
  const [feedDate, setFeedDate] = React.useState(todayET);
  const [feed, setFeed] = React.useState({ status: "idle", attempts: [], error: null });
  const [feedNonce, setFeedNonce] = React.useState(0); // bump to refetch
  const [feedDeletingId, setFeedDeletingId] = React.useState(null);

  React.useEffect(() => {
    if (!feedEnabled) return;
    const controller = new AbortController();
    let active = true;
    setFeed((f) => ({ ...f, status: "loading", error: null }));
    fetchAttempts(feedDate, { signal: controller.signal })
      .then((j) => {
        if (!active) return;
        setFeed({ status: "ready", attempts: j.attempts || [], error: null });
      })
      .catch((e) => {
        if (!active || e.name === "AbortError") return;
        setFeed({ status: "error", attempts: [], error: e.message || "Failed to load" });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [feedEnabled, feedDate, feedNonce]);

  // A saved driver-reassignment for a feed attempt (an attributed "attempts"
  // incident keyed to the stop). Its presence overrides the feed's driver and
  // makes the attempt count toward that driver in the scorecard/analytics.
  const overrideFor = (stopNbr) =>
    incidents.find(
      (i) => i.category === config.category && i.attempt_stop_nbr === stopNbr,
    );

  // Reassign (or clear) the driver an auto attempt is attributed to. Persists as
  // a manual "attempts" incident so the correction sticks and counts; the feed
  // row then shows the chosen driver.
  async function reassignAuto(a, driverId) {
    const drv = drivers.find((d) => d.id === driverId);
    const existing = overrideFor(a.stopNbr);
    try {
      if (!driverId) {
        // Cleared back to the feed's driver — drop the override if one existed.
        if (existing) {
          await deleteIncident(existing.id);
          onSaved && onSaved();
        }
        return;
      }
      const now = new Date().toISOString();
      await saveIncident({
        id: existing?.id || `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        pro_number: a.stopNbr,
        category: config.category,
        fault: "driver",
        no_fault: false,
        driver_id: drv.id,
        driver_name: drv.name,
        driver_raw: a.originalDriverName || "",
        customer: a.businessName || "",
        to_city: a.city || "",
        to_state: a.state || "",
        delivered_date: feedDate,
        reason: `Delivery attempt — reassigned from auto feed (was ${a.originalDriverName || "Unknown"})`,
        notes: existing?.notes || "",
        attempt_stop_nbr: a.stopNbr,
        shipment_nbr: a.shipmentNbr || "",
        sources: [],
        report_id: null,
        manual_entry: true,
        created_at: existing?.created_at || now,
        ingested_at: existing?.ingested_at || now,
        updated_at: now,
      });
      onSaved && onSaved();
    } catch (e) {
      setSavedMsg(`Reassign failed: ${e.message}`);
    }
  }

  async function deleteAuto(a) {
    if (
      !window.confirm(
        `Remove auto-detected attempt ${a.shipmentNbr || a.stopNbr} (${a.originalDriverName || "Unknown"})?\n\nThis deletes it from the dispatch feed for ${fmtMDY(feedDate)}.`,
      )
    )
      return;
    setFeedDeletingId(a.stopNbr);
    try {
      await deleteAttempt(feedDate, a.stopNbr);
      // Drop any reassignment we saved for this stop so it isn't orphaned.
      const existing = overrideFor(a.stopNbr);
      if (existing) {
        await deleteIncident(existing.id);
        onSaved && onSaved();
      }
      setFeedNonce((n) => n + 1); // refetch
    } catch (e) {
      setSavedMsg(`Auto-attempt delete failed: ${e.message}`);
    } finally {
      setFeedDeletingId(null);
    }
  }

  // Inline edit / delete of an existing log entry.
  const [editingId, setEditingId] = React.useState(null);
  const [editDriverId, setEditDriverId] = React.useState("");
  const [editDate, setEditDate] = React.useState("");
  const [editNotes, setEditNotes] = React.useState("");
  const [editClassify, setEditClassify] = React.useState("");
  const [rowBusy, setRowBusy] = React.useState(false);

  const buildReason = (value) =>
    value
      ? `${config.reasonLabel} — ${value} (manual entry)`
      : `${config.reasonLabel} (manual entry)`;

  function startEdit(inc) {
    setEditingId(inc.id);
    setEditDriverId(inc.driver_id || "");
    setEditDate((inc.delivered_date || inc.created_at || "").slice(0, 10));
    setEditNotes(inc.notes || "");
    setEditClassify(classifyField ? inc[classifyField] || "" : "");
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
      const patch = {
        ...inc,
        driver_id: drv.id,
        driver_name: drv.name,
        delivered_date: editDate || inc.delivered_date,
        notes: editNotes,
        reason: buildReason(editClassify),
        photo_urls,
        photo_meta,
        updated_at: new Date().toISOString(),
      };
      if (classifyField) patch[classifyField] = editClassify;
      await saveIncident(patch);
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
        `Delete ${config.deleteNoun} entry ${inc.pro_number} (${inc.driver_name || "unknown driver"})? This cannot be undone.`,
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

  const logIncidents = React.useMemo(
    () =>
      incidents
        .filter((i) => i.category === config.category)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [incidents, config.category],
  );

  // Manual rows for the log. Reassignment overrides (attempt_stop_nbr set) are
  // shown on their auto row, not duplicated here (they still count in analytics).
  // On the feed-backed tab (Attempts), the log is a per-day view: manual rows are
  // scoped to the selected feed date so it matches the auto rows shown for that day.
  const manualForView = React.useMemo(() => {
    const base = logIncidents.filter((i) => !i.attempt_stop_nbr);
    if (!feedEnabled) return base;
    return base.filter(
      (i) => (i.delivered_date || i.created_at || "").slice(0, 10) === feedDate,
    );
  }, [logIncidents, feedEnabled, feedDate]);

  // Free-text filter over the manual rows (PRO/driver/customer/item/notes/date).
  const filteredLog = React.useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return manualForView;
    return manualForView.filter((i) =>
      [
        i.pro_number,
        i.driver_name,
        i.customer,
        classifyField ? i[classifyField] : "",
        i.notes,
        fmtMDY(i.delivered_date || i.created_at),
      ].some((f) => String(f || "").toLowerCase().includes(q)),
    );
  }, [manualForView, logSearch, classifyField]);

  // Same search applied to the auto (feed) rows — by PRO/driver/customer/route/stop.
  const filteredFeed = React.useMemo(() => {
    if (!feedEnabled) return [];
    const q = logSearch.trim().toLowerCase();
    if (!q) return feed.attempts;
    return feed.attempts.filter((a) =>
      [
        a.shipmentNbr,
        a.stopNbr,
        a.originalDriverName,
        a.originalDriverUserName,
        a.businessName,
        a.city,
        a.state,
        a.routeName,
      ].some((f) => String(f || "").toLowerCase().includes(q)),
    );
  }, [feedEnabled, feed.attempts, logSearch]);

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
    // Flag a duplicate PRO before saving: list who it's already charged to and the
    // date(s) it was logged under, then confirm whether to add it again.
    const dups = incidents.filter(
      (i) => i.category === config.category && i.pro_number === pull.pro,
    );
    if (dups.length) {
      const lines = dups
        .map(
          (d) =>
            `  • ${d.driver_name || "a driver"} — ${fmtMDY(d.delivered_date || d.created_at)}`,
        )
        .join("\n");
      const proceed = window.confirm(
        `PRO ${pull.pro} is already logged as ${config.recordNoun}` +
          (dups.length > 1 ? ` ${dups.length} times` : "") +
          `:\n${lines}\n\nAdd it again anyway?`,
      );
      if (!proceed) return;
    }
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
      category: config.category,
      fault: config.fault ?? "driver",
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
      reason: buildReason(classifyValue),
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
    if (classifyField) incident[classifyField] = classifyValue;
    try {
      await saveIncident(incident);
      setSavedMsg(`Saved — ${pull.pro} charged to ${drv.name} under ${fmtMDY(delivered)} (${photos.length} photo${photos.length === 1 ? "" : "s"}).`);
      // Jump the log view to the date just logged so the new entry is visible.
      if (feedEnabled) setFeedDate(delivered);
      setPull(null);
      setPro("");
      setNotes("");
      setDriverId("");
      setClassifyValue("");
      onSaved && onSaved();
    } catch (err) {
      setSavedMsg(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const matched = drivers.find((d) => d.id === driverId);
  const s = pull?.stop;
  // Existing log entries for the pulled PRO — surfaced as a heads-up in the preview.
  const existingForPro = pull
    ? incidents.filter(
        (i) => i.category === config.category && i.pro_number === pull.pro,
      )
    : [];

  const feedRows = feedEnabled ? feed.attempts : [];
  // Counts for the current view. On the feed-backed tab everything is scoped to
  // the selected day (manualForView is already date-filtered); elsewhere it's the
  // all-time manual total.
  const totalOnRecord = manualForView.length + feedRows.length;
  const totalShown = filteredLog.length + filteredFeed.length;
  const allTimeManual = logIncidents.filter((i) => !i.attempt_stop_nbr).length;

  const driverOptions = drivers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => (
      <option key={d.id} value={d.id}>
        {d.name}{d.role === "loader" ? " (loader)" : ""}
      </option>
    ));

  return (
    <div>
      <div className="page-title">Manual Entry</div>
      <h1 className="page-heading">
        {config.heading}
        <span className="meta">
          {feedEnabled
            ? ` · ${totalOnRecord} on ${fmtMDY(feedDate)} (${feedRows.length} auto, ${manualForView.length} manual) · ${allTimeManual} logged all-time`
            : ` · ${allTimeManual} on record`}
        </span>
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
              {existingForPro.length > 0 && (
                <div className="ff-dup-warning">
                  ⚠ PRO {pull.pro} is already logged as {config.recordNoun}
                  {existingForPro.length > 1 ? ` ${existingForPro.length} times` : ""}:{" "}
                  {existingForPro
                    .map(
                      (d) =>
                        `${d.driver_name || "a driver"} (${fmtMDY(d.delivered_date || d.created_at)})`,
                    )
                    .join(", ")}
                  . Saving will add another entry.
                </div>
              )}
              <div className="ff-preview-top" style={{ marginTop: 14 }}>
                <div className="dd-meta-grid" style={{ flex: 1, marginBottom: 0 }}>
                  <div><span className="dd-k">PRO</span><span className="dd-v" style={{ fontFamily: "var(--mono)" }}>{pull.pro}</span></div>
                  <div><span className="dd-k">NuVizz Driver</span><span className="dd-v">{s.driverName || "—"}</span></div>
                  <div><span className="dd-k">Customer</span><span className="dd-v">{s.to?.name || "—"}</span></div>
                  <div><span className="dd-k">Destination</span><span className="dd-v">{[s.to?.city, s.to?.state].filter(Boolean).join(", ") || "—"}</span></div>
                  <div><span className="dd-k">Route</span><span className="dd-v">{s.routeName || "—"}</span></div>
                  <div><span className="dd-k">Status</span><span className="dd-v">{s.stopStatus || "—"}</span></div>
                </div>
                <div className="ff-order-contents">
                  <div className="dd-k" style={{ marginBottom: 8 }}>Order Contents</div>
                  <div className="ff-oc-stats">
                    <div className="ff-oc">
                      <span className="ff-oc-num">{s.pieces?.skids ?? "—"}</span>
                      <span className="ff-oc-lbl">Pallets</span>
                    </div>
                    <div className="ff-oc">
                      <span className="ff-oc-num">{s.pieces?.total ?? "—"}</span>
                      <span className="ff-oc-lbl">Total Pieces</span>
                    </div>
                    <div className="ff-oc">
                      <span className="ff-oc-num">{s.pieces?.loose ?? "—"}</span>
                      <span className="ff-oc-lbl">Loose</span>
                    </div>
                  </div>
                </div>
              </div>

              {(s.timeline || []).length > 0 && (
                <details className="ff-timeline">
                  <summary>
                    Activity Timeline · {s.timeline.length} events
                    {s.deliveryAttempt
                      ? ` · ${s.deliveryAttempt} delivery attempt${s.deliveryAttempt === 1 ? "" : "s"}`
                      : ""}
                  </summary>
                  <div className="ff-timeline-body">
                    {s.timeline.map((e, i) => (
                      <div key={i} className={`ff-tl-row ff-tl-${e.kind}`}>
                        <span className="ff-tl-time">{fmtDateTime(e.t)}</span>
                        <span className="ff-tl-label">{e.label}</span>
                        {e.detail && <span className="ff-tl-detail">{e.detail}</span>}
                        {e.by && <span className="ff-tl-by">{e.by}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

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
                {config.classify && (
                  <div>
                    <div className="dd-k">{config.classify.label}</div>
                    <select
                      value={classifyValue}
                      onChange={(e) => setClassifyValue(e.target.value)}
                    >
                      <option value="">{config.classify.placeholder}</option>
                      {config.classify.options.map((it) => (
                        <option key={it} value={it}>
                          {it}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <div className="dd-k">Charge to driver</div>
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">— Select driver —</option>
                    {driverOptions}
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
                  {saving ? "Saving…" : config.addLabel}
                </button>
              </div>
            </div>
          )}

          {savedMsg && <div className="ff-saved">{savedMsg}</div>}
        </div>
      </div>

      <ManualEntryAnalytics
        title={config.heading}
        color={config.color || "var(--davis-blue)"}
        records={logIncidents}
        drivers={drivers}
      />

      <div className="section-head">{config.logTitle}</div>
      <div className="card">
        <div className="card-body" style={{ padding: "4px 14px" }}>
          <div className="ff-log-search-wrap">
            {feedEnabled && (
              <div className="ff-feed-date">
                <span className="dd-k">Attempts for</span>
                <input
                  type="date"
                  value={feedDate}
                  max={todayET()}
                  onChange={(e) => setFeedDate(e.target.value || todayET())}
                  style={{ fontFamily: "var(--mono)" }}
                  title="Show the attempts log (auto + manual) for this day"
                />
              </div>
            )}
            <input
              type="text"
              className="ff-log-search"
              placeholder="Search PRO, driver, customer…"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
            />
          </div>
          {feedEnabled && feed.status === "loading" && (
            <div className="empty-state">Loading attempts for {fmtMDY(feedDate)}…</div>
          )}
          {feedEnabled && feed.status === "error" && (
            <div className="empty-state" style={{ color: "var(--accent-red)" }}>
              Couldn't load auto attempts for {fmtMDY(feedDate)} ({feed.error}).
            </div>
          )}
          {totalOnRecord === 0 &&
            !(feedEnabled && (feed.status === "loading" || feed.status === "error")) && (
              <div className="empty-state">
                {feedEnabled
                  ? `No attempts (auto or manual) for ${fmtMDY(feedDate)}.`
                  : "Nothing logged yet."}
              </div>
            )}
          {totalOnRecord > 0 && totalShown === 0 && logSearch.trim() && (
            <div className="empty-state">
              No entries match “{logSearch.trim()}”.
            </div>
          )}

          {/* Auto-detected attempts from the dispatch feed (selected date). */}
          {filteredFeed.map((a) => (
            <div key={`auto-${a.stopNbr || a.shipmentNbr}`} className="ff-log-entry">
              <div className="dd-incident-head" style={{ cursor: "default" }}>
                <span className="ff-src-chip auto">AUTO</span>
                <span className="pro-num">{a.shipmentNbr || "—"}</span>
                <span
                  className="ff-auto-driver"
                  onClick={(e) => e.stopPropagation()}
                >
                  <select
                    value={overrideFor(a.stopNbr)?.driver_id || ""}
                    onChange={(e) => reassignAuto(a, e.target.value)}
                    title="Attribute this attempt to a driver"
                  >
                    <option value="">
                      {a.originalDriverName
                        ? `${a.originalDriverName} · from feed`
                        : "Unknown · from feed"}
                    </option>
                    {driverOptions}
                  </select>
                  {overrideFor(a.stopNbr) && (
                    <span className="ff-reassigned" title={`Feed said ${a.originalDriverName || "Unknown"}`}>
                      reassigned
                    </span>
                  )}
                </span>
                <span className="meta">
                  {a.businessName || "—"}
                  {a.city || a.state
                    ? ` · ${[a.city, a.state].filter(Boolean).join(", ")}`
                    : ""}
                </span>
                <span className="meta">
                  Stop {a.stopNbr || "—"}
                  {a.routeName ? ` · ${a.routeName}` : ""}
                </span>
                <span style={{ marginLeft: "auto" }}>
                  <AttemptStatusBadge a={a} />
                </span>
                {config.feedDeletable && (
                  <span className="ff-row-actions">
                    <button
                      className="btn ghost sm"
                      onClick={() => deleteAuto(a)}
                      disabled={feedDeletingId === a.stopNbr}
                      title="Remove this auto-detected attempt from the feed"
                      style={{ color: "var(--accent-red)" }}
                    >
                      {feedDeletingId === a.stopNbr ? "…" : "Delete"}
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Manually-logged entries. */}
          {filteredLog.map((inc) => (
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
                {feedEnabled && <span className="ff-src-chip manual">MANUAL</span>}
                <span className="pro-num">{inc.pro_number}</span>
                <span className="lb-name" style={{ width: "auto" }}>{inc.driver_name}</span>
                <span className="meta">{inc.customer || ""}</span>
                {classifyField && inc[classifyField] && (
                  <span className="ff-item-chip">{inc[classifyField]}</span>
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
                      {driverOptions}
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
                  {config.classify && (
                    <div>
                      <div className="dd-k">{config.classify.label}</div>
                      <select value={editClassify} onChange={(e) => setEditClassify(e.target.value)}>
                        <option value="">{config.classify.placeholder}</option>
                        {config.classify.options.map((it) => (
                          <option key={it} value={it}>
                            {it}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
