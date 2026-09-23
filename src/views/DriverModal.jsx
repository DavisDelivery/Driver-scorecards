import React from "react";
import { getIncidentPhotos } from "../data/firebase.js";
import { SOURCE_LABELS, LATE_REASON_LABELS, FAULT_CODES } from "../data/drivers.js";
import { incidentYm, fmtIncidentDate } from "../data/incidentDate.js";
import { buildCategoryDetail, monthsOfYear } from "../data/scorecardDetail.js";

const FAULT_LABEL = Object.fromEntries(FAULT_CODES.map((f) => [f.id, f.label]));

// Categories that count "against" a driver — must match the roster card
// (Drivers.jsx) so the modal header reconciles with the card's totals.
const NEG_CATS = ["damage","late","missing","misdelivery","forgotten_freight","attempts","complaint"];
const CAT_LABEL = {
  damage: "Damage", late: "Late", missing: "Missing", misdelivery: "Misdelivery",
  forgotten_freight: "Forgotten Freight", attempts: "Attempts", complaint: "Complaint",
  compliment: "Compliment", return: "Return", trace: "Trace",
};

// The month an incident is filed under. Kept under its old name for Drivers.jsx, but
// it is now the shared definition: this copy used to read ship_date ahead of
// return_date, so the popup filed some incidents in a different month from the
// Scorecard it was opened from.
export const ymKey = incidentYm;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const fmtMonth = (ym) => {
  if (!ym || ym === "unknown") return "Undated";
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] || "?"} ${y}`;
};

// Expandable incident row — click to pull full detail + photos on demand.
// `showDriver` / `onDriver` put the driver on the row (the category drill-down lists
// many drivers); `hideCategory` drops the chip when every row is the same category.
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
        <span className="dd-date">{fmtIncidentDate(inc)}</span>
        <span className="pro-num">{inc.pro_number}</span>
        {showDriver && (
          <button
            type="button"
            className="dd-driver-link"
            onClick={(e) => {
              e.stopPropagation();
              onDriver?.(inc.driver_id);
            }}
            title="Open this driver"
          >
            {inc.driver_name || inc.driver_raw || "Unattributed"}
          </button>
        )}
        {!hideCategory && <span className={`chip ${inc.category}`}>{inc.category}</span>}
        {Array.isArray(inc.sources) &&
          inc.sources.map((s) => (
            <span key={s} className={`src-badge src-${s}`}>{SOURCE_LABELS[s] || s}</span>
          ))}
        {inc.no_fault && <span className="src-badge nofault">No Fault</span>}
        {customer && <span className="dd-cust" title={customer}>{customer}</span>}
        {inc.has_photos && <span className="dd-photo-flag">📸 {inc.photo_count || ""}</span>}
      </div>
      {open && (
        <div className="dd-incident-body">
          <div className="dd-meta-grid">
            {customer && <div><span className="dd-k">Customer</span><span className="dd-v">{customer}</span></div>}
            {dest && <div><span className="dd-k">Destination</span><span className="dd-v">{dest}</span></div>}
            <div><span className="dd-k">Driver</span><span className="dd-v">{inc.driver_name || inc.driver_raw || "—"}</span></div>
            <div><span className="dd-k">Category</span><span className="dd-v">{CAT_LABEL[inc.category] || inc.category}</span></div>
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
  return (
    <div className="dd-incident dd-incident-agg">
      <div className="dd-incident-head" style={{ cursor: "default" }}>
        <span className="row-caret" style={{ visibility: "hidden" }}>▸</span>
        <span className="dd-date">{fmtMonth(row.ym)}</span>
        {showDriver && (
          <button type="button" className="dd-driver-link" onClick={() => onDriver?.(row.driver_id)}>
            {row.driver_name || row.driver_id}
          </button>
        )}
        {!hideCategory && (
          <span className={`chip ${row.category}`}>{CAT_LABEL[row.category] || row.category}</span>
        )}
        <span className="dd-agg-count">× {row.count}</span>
        <span className="dd-agg-note">imported history · no per-incident detail</span>
      </div>
    </div>
  );
}

// Group a detail's live incidents + history rows into month sections, newest first.
function groupByMonth(detail) {
  const map = new Map();
  for (const inc of detail.incidents) {
    const ym = incidentYm(inc) || "unknown";
    if (!map.has(ym)) map.set(ym, { live: [], hist: [] });
    map.get(ym).live.push(inc);
  }
  for (const r of detail.historyRows) {
    if (!map.has(r.ym)) map.set(r.ym, { live: [], hist: [] });
    map.get(r.ym).hist.push(r);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

// Opened from the Scorecard: scoped to the chart it was clicked from, and built from
// the Scorecard's own month-by-month blend (via buildCategoryDetail), so the numbers
// in the header are the numbers on the row that was clicked — including the months
// that only exist as rolled-up history.
function ScorecardDriverModal({ driver, scorecard, initialCategory, onClose }) {
  const { liveByYm, history, periodMonths, ytdYear, periodLabel, categories, categoryIds } =
    scorecard;
  const [category, setCategory] = React.useState(initialCategory || null);
  const [scope, setScope] = React.useState("period");

  const ytdMonths = React.useMemo(() => monthsOfYear(ytdYear), [ytdYear]);
  const base = { liveByYm, history, categoryIds, driverId: driver.id };

  // Per-category YTD counts, for the chips.
  const ytdAll = React.useMemo(
    () => buildCategoryDetail({ ...base, scopeMonths: ytdMonths }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveByYm, history, ytdMonths, driver.id, categoryIds],
  );
  const periodDetail = React.useMemo(
    () => buildCategoryDetail({ ...base, scopeMonths: periodMonths, categoryId: category }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveByYm, history, periodMonths, driver.id, category, categoryIds],
  );
  const ytdDetail = React.useMemo(
    () => buildCategoryDetail({ ...base, scopeMonths: ytdMonths, categoryId: category }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveByYm, history, ytdMonths, driver.id, category, categoryIds],
  );

  const shown = scope === "period" ? periodDetail : ytdDetail;
  const grouped = React.useMemo(() => groupByMonth(shown), [shown]);
  const catTitle = category
    ? categories.find((c) => c.id === category)?.title || CAT_LABEL[category] || category
    : "All categories";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${driver.name} detail`}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{driver.name}</div>
            <div className="dm-sub">
              {(driver.role || "driver").toUpperCase()}
              {driver.active === false ? " · INACTIVE" : ""} · {catTitle}
            </div>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="dm-stats">
            <div className="dm-stat">
              <div className="dm-stat-num">{periodDetail.total}</div>
              <div className="dm-stat-lbl">{periodLabel}</div>
            </div>
            <div className="dm-stat">
              <div className="dm-stat-num">{ytdDetail.total}</div>
              <div className="dm-stat-lbl">YTD {ytdYear}</div>
            </div>
          </div>

          <div className="dm-chips" role="tablist" aria-label="Category">
            <button
              type="button"
              className={`dm-chip ${category === null ? "active" : ""}`}
              onClick={() => setCategory(null)}
            >
              All <b>{ytdAll.total}</b>
            </button>
            {categories
              .filter((c) => (ytdAll.byCategory.get(c.id) || 0) > 0 || c.id === category)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`dm-chip ${category === c.id ? "active" : ""}`}
                  onClick={() => setCategory(c.id)}
                  style={category === c.id ? { borderColor: c.color, color: c.color } : undefined}
                >
                  <i style={{ background: c.color }} />
                  {c.title} <b>{ytdAll.byCategory.get(c.id) || 0}</b>
                </button>
              ))}
          </div>

          <div className="month-picker dm-scope">
            <button className={`month-btn ${scope === "period" ? "active" : ""}`} onClick={() => setScope("period")}>
              {periodLabel} ({periodDetail.total})
            </button>
            <button className={`month-btn ${scope === "ytd" ? "active" : ""}`} onClick={() => setScope("ytd")}>
              YTD {ytdYear} ({ytdDetail.total})
            </button>
          </div>

          {grouped.length === 0 && (
            <div className="empty-state">
              Nothing counted for {driver.name} in {scope === "period" ? periodLabel : `YTD ${ytdYear}`}
              {category ? ` under ${catTitle}` : ""}.
            </div>
          )}
          {grouped.map(([ym, { live, hist }]) => (
            <div key={ym} style={{ marginBottom: 16 }}>
              <div className="section-divider">{fmtMonth(ym)}</div>
              {live.map((inc, idx) => (
                <IncidentDetailRow key={inc.id || idx} inc={inc} hideCategory={!!category} />
              ))}
              {hist.map((row, idx) => (
                <HistoryAggRow key={`h-${idx}`} row={row} hideCategory={!!category} />
              ))}
            </div>
          ))}
        </div>
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
//
// Pass `scorecard` (from the Scorecard) to get the scoped, period-aware version whose
// numbers match the Scorecard row it was opened from.
export default function DriverModal({
  driver,
  incidents,
  history = [],
  onClose,
  scorecard = null,
  initialCategory = null,
}) {
  if (scorecard) {
    return (
      <ScorecardDriverModal
        driver={driver}
        scorecard={scorecard}
        initialCategory={initialCategory}
        onClose={onClose}
      />
    );
  }
  return <RosterDriverModal driver={driver} incidents={incidents} history={history} onClose={onClose} />;
}

function RosterDriverModal({ driver, incidents, history, onClose }) {
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
            <div className="dm-sub">
              {(driver.role || "driver").toUpperCase()} · {faulted} faulted · {ytd} YTD
            </div>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close">×</button>
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
                <HistoryAggRow key={`h-${idx}`} row={{ ...row, ym }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
