import React from "react";
import { getIncidentPhotos } from "../data/firebase.js";
import { SOURCE_LABELS, LATE_REASON_LABELS, FAULT_CODES } from "../data/drivers.js";

const FAULT_LABEL = Object.fromEntries(FAULT_CODES.map((f) => [f.id, f.label]));

// Categories that count "against" a driver — must match the roster card
// (Drivers.jsx) so the modal header reconciles with the card's totals.
const NEG_CATS = ["damage","late","missing","misdelivery","forgotten_freight","attempts","complaint"];
const CAT_LABEL = {
  damage: "Damage", late: "Late", missing: "Missing", misdelivery: "Misdelivery",
  forgotten_freight: "Forgotten Freight", attempts: "Attempts", complaint: "Complaint",
  compliment: "Compliment", return: "Return", trace: "Trace",
};

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

// A month's imported-history aggregate: category count with no per-incident
// detail (PRO/photos), so it's rendered as a summary line, not an expandable row.
function HistoryAggRow({ row }) {
  return (
    <div className="dd-incident dd-incident-agg">
      <div className="dd-incident-head" style={{ cursor: "default" }}>
        <span className="row-caret" style={{ visibility: "hidden" }}>▸</span>
        <span className={`chip ${row.category}`}>{CAT_LABEL[row.category] || row.category}</span>
        <span className="dd-agg-count">× {row.count}</span>
        <span className="dd-agg-note">imported history</span>
      </div>
    </div>
  );
}

// Per-driver scorecard modal — clickable incident history with photos.
// `driver` = { name, role }; `incidents` = that driver's live incidents;
// `history` = that driver's imported monthly aggregates ({year,month,category,count}).
// Both sources are merged with the SAME dedup rule the roster card uses (history
// is ignored for any month that already has live detail), so the modal's counts
// reconcile with the card instead of showing only the live subset.
export default function DriverModal({ driver, incidents, history = [], onClose }) {
  // Months with live detail — history for these is dropped to avoid double count,
  // exactly as Drivers.jsx does (uses every live row, including no-fault ones).
  const ymsWithLive = React.useMemo(() => {
    const s = new Set();
    for (const inc of incidents) s.add(ymKey(inc) || "unknown");
    return s;
  }, [incidents]);

  // History aggregates for months WITHOUT live data.
  const histRows = React.useMemo(
    () =>
      (history || [])
        .map((r) => ({
          ym: `${r.year}-${String(r.month).padStart(2, "0")}`,
          category: r.category,
          count: r.count || 0,
        }))
        .filter((r) => r.count > 0 && !ymsWithLive.has(r.ym)),
    [history, ymsWithLive],
  );

  // Merge live incidents + history aggregates into month buckets.
  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const inc of incidents) {
      const ym = ymKey(inc) || "unknown";
      if (!map.has(ym)) map.set(ym, { live: [], hist: [] });
      map.get(ym).live.push(inc);
    }
    for (const r of histRows) {
      if (!map.has(r.ym)) map.set(r.ym, { live: [], hist: [] });
      map.get(r.ym).hist.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [incidents, histRows]);

  // Header stats — negative categories only, live (non-no-fault) + deduped
  // history, matching the card's All-Time and YTD numbers.
  const { faulted, ytd } = React.useMemo(() => {
    const curYear = new Date().getFullYear().toString();
    // Require a real date (matches the card, which skips ym==="unknown").
    const liveNeg = incidents.filter(
      (i) => !i.no_fault && NEG_CATS.includes(i.category) && ymKey(i),
    );
    const histNeg = histRows.filter((r) => NEG_CATS.includes(r.category));
    const all =
      liveNeg.length + histNeg.reduce((a, r) => a + r.count, 0);
    const ytdN =
      liveNeg.filter((i) => (ymKey(i) || "").startsWith(curYear)).length +
      histNeg.filter((r) => r.ym.startsWith(curYear)).reduce((a, r) => a + r.count, 0);
    return { faulted: all, ytd: ytdN };
  }, [incidents, histRows]);

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
          {grouped.map(([ym, { live, hist }]) => (
            <div key={ym} style={{ marginBottom: 18 }}>
              <div className="section-divider">{fmtMonth(ym)}</div>
              {live.map((inc, idx) => (
                <IncidentDetailRow key={inc.id || idx} inc={inc} />
              ))}
              {hist.map((row, idx) => (
                <HistoryAggRow key={`h-${idx}`} row={row} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
