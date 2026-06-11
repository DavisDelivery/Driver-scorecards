import React from "react";
import { getIncidentPhotos } from "../data/firebase.js";
import { SOURCE_LABELS, LATE_REASON_LABELS, FAULT_CODES } from "../data/drivers.js";

const FAULT_LABEL = Object.fromEntries(FAULT_CODES.map((f) => [f.id, f.label]));

export const ymKey = (inc) =>
  (inc.delivered_date || inc.ship_date || inc.return_date || inc.trace_date || "").slice(0, 7);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const fmtMonth = (ym) => {
  if (!ym || ym === "unknown") return "Undated";
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] || "?"} ${y}`;
};

// Expandable incident row — click PRO to pull full detail + photos on demand.
function IncidentDetailRow({ inc }) {
  const [open, setOpen] = React.useState(false);
  const [photos, setPhotos] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && photos === null && inc.has_photos) {
      setLoading(true);
      try {
        const res = await getIncidentPhotos(inc.id);
        setPhotos(res?.photo_urls || []);
      } catch {
        setPhotos([]);
      } finally {
        setLoading(false);
      }
    }
  }

  const customer = inc.to_name || inc.customer || inc.consignee || null;
  const dest = [inc.to_city, inc.to_state].filter(Boolean).join(", ") || inc.destination || null;

  return (
    <div className="dd-incident">
      <div className="dd-incident-head" onClick={toggle}>
        <span className="row-caret">{open ? "▾" : "▸"}</span>
        <span className="pro-num">{inc.pro_number}</span>
        <span className={`chip ${inc.category}`}>{inc.category}</span>
        {Array.isArray(inc.sources) &&
          inc.sources.map((s) => (
            <span key={s} className={`src-badge src-${s}`}>{SOURCE_LABELS[s] || s}</span>
          ))}
        {inc.no_fault && <span className="src-badge nofault">No Fault</span>}
        {inc.has_photos && <span className="dd-photo-flag">📸 {inc.photo_count || ""}</span>}
      </div>
      {open && (
        <div className="dd-incident-body">
          <div className="dd-meta-grid">
            {customer && <div><span className="dd-k">Customer</span><span className="dd-v">{customer}</span></div>}
            {dest && <div><span className="dd-k">Destination</span><span className="dd-v">{dest}</span></div>}
            <div><span className="dd-k">Category</span><span className="dd-v">{inc.category}</span></div>
            <div><span className="dd-k">Fault</span><span className="dd-v">{FAULT_LABEL[inc.fault] || inc.fault || "—"}</span></div>
            {inc.late_reason && (
              <div><span className="dd-k">Late Reason</span><span className="dd-v">{LATE_REASON_LABELS[inc.late_reason] || inc.late_reason}</span></div>
            )}
          </div>
          {(inc.reason || inc.notes) && (
            <div className="dd-notes">
              {inc.reason && <div><span className="dd-k">Uline</span> {inc.reason}</div>}
              {inc.notes && <div><span className="dd-k">Davis</span> {inc.notes}</div>}
            </div>
          )}
          {inc.has_photos && (
            <div className="dd-photos">
              {loading && <div className="meta">Loading photos…</div>}
              {!loading && photos && photos.length === 0 && (
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

// Per-driver scorecard modal — clickable incident history with photos.
// `driver` = { name, role }; `incidents` = that driver's live incidents.
export default function DriverModal({ driver, incidents, onClose }) {
  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const inc of incidents) {
      const ym = ymKey(inc) || "unknown";
      if (!map.has(ym)) map.set(ym, []);
      map.get(ym).push(inc);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [incidents]);

  const faulted = incidents.filter((i) => !i.no_fault).length;
  const curYear = new Date().getFullYear().toString();
  const ytd = incidents.filter((i) => !i.no_fault && (ymKey(i) || "").startsWith(curYear)).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{driver.name}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-2)", marginTop: 2 }}>
              {(driver.role || "driver").toUpperCase()} · {faulted} faulted · {ytd} YTD
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {grouped.length === 0 && (
            <div className="empty-state">No detailed incidents on file for this driver.</div>
          )}
          {grouped.map(([ym, list]) => (
            <div key={ym} style={{ marginBottom: 18 }}>
              <div className="section-divider">{fmtMonth(ym)}</div>
              {list.map((inc, idx) => (
                <IncidentDetailRow key={inc.id || idx} inc={inc} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
