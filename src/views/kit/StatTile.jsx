import React from "react";

// A headline number. The value is always in ink: a figure coloured like its series is
// unreadable for the light hues (Late, Attempts) and repeats what the label says.
//
//   compact  the small in-card tile (.me-stat) rather than the page-level .kpi
//   title    hover text: the tile's one-line definition
//   onClick  makes the compact tile a button: it opens what the number counted
export default function StatTile({ label, value, sub = null, title, compact = false, onClick = null }) {
  if (compact) {
    const body = (
      <>
        <span className="me-stat-num">{value}</span>
        <span className="me-stat-lbl">{label}</span>
        {sub && <span className="me-stat-sub">{sub}</span>}
      </>
    );
    return onClick ? (
      <button type="button" className="me-stat clickable" title={title} onClick={onClick}>
        {body}
      </button>
    ) : (
      <div className="me-stat" title={title}>
        {body}
      </div>
    );
  }
  return (
    <div className="kpi" title={title}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub !== null && <div className="kpi-delta">{sub}</div>}
    </div>
  );
}
