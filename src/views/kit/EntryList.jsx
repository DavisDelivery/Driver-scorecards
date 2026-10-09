import React from "react";
import { getIncidentPhotos } from "../../data/firebase.js";
import { SOURCE_LABELS, LATE_REASON_LABELS, FAULT_CODES } from "../../data/drivers.js";
import { incidentYm, incidentDateStr } from "../../data/incidentDate.js";
import { fmtDate } from "../../data/period.js";
import { catChipStyle, catLabel } from "../../data/categories.js";
import { isLateRow } from "../../data/faultGroups.js";
import Icon from "./Icon.jsx";

// The rows behind a number: live incidents (expandable, with photos on demand) and
// imported-history aggregates (a monthly count with no per-incident detail), grouped by
// month, newest first. Every drill-down renders its rows through this, so a row reads
// the same wherever it is opened from.

const FAULT_LABEL = Object.fromEntries(FAULT_CODES.map((f) => [f.id, f.label]));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtMonth = (ym) => {
  if (!ym || ym === "unknown") return "Undated";
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] || "?"} ${y}`;
};

// Expandable incident row — click to pull full detail + photos on demand.
// `showDriver` / `onDriver` put the driver on the row (a list across many drivers);
// `hideCategory` drops the chip when every row is the same category.
export function IncidentDetailRow({ inc, showDriver = false, onDriver, hideCategory = false }) {
  const [open, setOpen] = React.useState(false);
  const [photos, setPhotos] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [photoError, setPhotoError] = React.useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && photos === null && inc.has_photos) {
      setLoading(true);
      setPhotoError("");
      try {
        const res = await getIncidentPhotos(inc.id);
        setPhotos(res?.photo_urls || []);
      } catch (err) {
        // Say so. An empty list here would read as "this delivery has no photos".
        setPhotos([]);
        setPhotoError(err?.message || "could not load photos");
      } finally {
        setLoading(false);
      }
    }
  }

  const customer = inc.to_name || inc.customer || inc.consignee || null;
  const dest = [inc.to_city, inc.to_state].filter(Boolean).join(", ") || inc.destination || null;
  const driverText = inc.driver_name || inc.driver_raw || "Unattributed";

  return (
    <div className="dd-incident">
      <div
        className="dd-incident-head"
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className="row-caret">{open ? "▾" : "▸"}</span>
        <span className="dd-date">{/^\d{4}-\d{2}-\d{2}/.test(incidentDateStr(inc)) ? fmtDate(incidentDateStr(inc)) : "—"}</span>
        <span className="pro-num">{inc.pro_number}</span>
        {showDriver &&
          (inc.driver_id && onDriver ? (
            <button
              type="button"
              className="dd-driver-link"
              onClick={(e) => {
                e.stopPropagation();
                onDriver(inc.driver_id);
              }}
              title="Open this driver"
            >
              {driverText}
            </button>
          ) : (
            <span className="dd-driver-text">{driverText}</span>
          ))}
        {!hideCategory && (
          <span className={`chip cat ${inc.category}`} style={catChipStyle(inc.category)}>
            {catLabel(inc.category)}
          </span>
        )}
        {Array.isArray(inc.sources) &&
          inc.sources.map((s) => (
            <span key={s} className={`src-badge src-${s}`}>{SOURCE_LABELS[s] || s}</span>
          ))}
        {inc.no_fault && <span className="src-badge nofault">No Fault</span>}
        {customer && <span className="dd-cust" title={customer}>{customer}</span>}
        {inc.has_photos && (
          <span className="dd-photo-flag" title="Has photos">
            <Icon name="camera" /> {inc.photo_count || ""}
          </span>
        )}
      </div>
      {open && (
        <div className="dd-incident-body">
          <div className="dd-meta-grid">
            {customer && <div><span className="dd-k">Customer</span><span className="dd-v">{customer}</span></div>}
            {dest && <div><span className="dd-k">Destination</span><span className="dd-v">{dest}</span></div>}
            <div><span className="dd-k">Driver</span><span className="dd-v">{inc.driver_name || inc.driver_raw || "—"}</span></div>
            <div><span className="dd-k">Category</span><span className="dd-v">{catLabel(inc.category)}</span></div>
            <div><span className="dd-k">Fault</span><span className="dd-v">{FAULT_LABEL[inc.fault] || inc.fault || "—"}</span></div>
            {/* A late row is reviewed by its late reason, which All Incidents sets in
                place of a fault (faultGroups.js), so a late row always shows it. */}
            {(inc.late_reason || isLateRow(inc)) && (
              <div>
                <span className="dd-k">Late Reason</span>
                <span className="dd-v">
                  {inc.late_reason ? LATE_REASON_LABELS[inc.late_reason] || inc.late_reason : "Not set — set it on All Incidents"}
                </span>
              </div>
            )}
          </div>
          {(inc.reason || inc.notes || inc.your_note) && (
            <div className="dd-notes">
              {inc.reason && <div><span className="dd-k">Reason</span> {inc.reason}</div>}
              {inc.notes && <div><span className="dd-k">Notes</span> {inc.notes}</div>}
              {inc.your_note && <div><span className="dd-k">Your Note</span> {inc.your_note}</div>}
            </div>
          )}
          {inc.has_photos && (
            <div className="dd-photos">
              {loading && <div className="meta">Loading photos…</div>}
              {!loading && photoError && (
                <div className="meta" style={{ color: "var(--accent-red, #b91c1c)" }}>
                  Couldn't load this incident's photos ({photoError}).
                </div>
              )}
              {!loading && !photoError && photos && photos.length === 0 && (
                <div className="meta">No photo available</div>
              )}
              {!loading &&
                (photos || []).map((u, i) => (
                  <img key={i} src={u} alt={`POD ${i + 1}`} className="dd-photo" />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A month's imported-history aggregate: category count with no per-incident
// detail (PRO/photos), so it's rendered as a summary line, not an expandable row.
export function HistoryAggRow({ row, showDriver = false, onDriver, hideCategory = false }) {
  const who = row.driver_name || row.driver_id || "Unattributed";
  return (
    <div className="dd-incident dd-incident-agg">
      <div className="dd-incident-head" style={{ cursor: "default" }}>
        <span className="row-caret" style={{ visibility: "hidden" }}>▸</span>
        <span className="dd-date">{fmtMonth(row.ym)}</span>
        {showDriver &&
          (row.driver_id && onDriver ? (
            <button type="button" className="dd-driver-link" onClick={() => onDriver(row.driver_id)}>
              {who}
            </button>
          ) : (
            <span className="dd-driver-text">{who}</span>
          ))}
        {!hideCategory && (
          <span className={`chip cat ${row.category}`} style={catChipStyle(row.category)}>
            {catLabel(row.category)}
          </span>
        )}
        <span className="dd-agg-count">× {row.count}</span>
        <span className="dd-agg-note">imported history · no per-incident detail</span>
      </div>
    </div>
  );
}

// incidents    live incident rows
// historyRows  [{ ym, driver_id, driver_name, category, count }]
// Rows are grouped under a month heading, newest month first.
export default function EntryList({
  incidents = [],
  historyRows = [],
  showDriver = false,
  onDriver,
  hideCategory = false,
  empty = "Nothing to show.",
}) {
  const grouped = React.useMemo(() => {
    const map = new Map();
    const at = (ym) => map.get(ym) || map.set(ym, { live: [], hist: [] }).get(ym);
    for (const inc of incidents) at(incidentYm(inc) || "unknown").live.push(inc);
    for (const r of historyRows) at(r.ym).hist.push(r);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [incidents, historyRows]);

  if (!grouped.length) return <div className="empty-state">{empty}</div>;
  return grouped.map(([ym, { live, hist }]) => (
    <div key={ym} className="el-month">
      <div className="section-divider">{fmtMonth(ym)}</div>
      {live.map((inc, idx) => (
        <IncidentDetailRow
          key={inc.id || idx}
          inc={inc}
          showDriver={showDriver}
          onDriver={onDriver}
          hideCategory={hideCategory}
        />
      ))}
      {hist.map((row, idx) => (
        <HistoryAggRow
          key={`h-${row.driver_id}-${row.category}-${idx}`}
          row={row}
          showDriver={showDriver}
          onDriver={onDriver}
          hideCategory={hideCategory}
        />
      ))}
    </div>
  ));
}
