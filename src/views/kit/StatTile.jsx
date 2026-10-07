import React from "react";

// A headline number. The value is always in ink: a figure coloured like its series is
// unreadable for the light hues (Late, Attempts) and repeats what the label says.
//
//   compact  the small in-card tile (.me-stat) rather than the page-level .kpi
//   title    hover text: the tile's one-line definition
export default function StatTile({ label, value, sub = null, title, compact = false }) {
  if (compact) {
    return (
      <div className="me-stat" title={title}>
        <div className="me-stat-num">{value}</div>
        <div className="me-stat-lbl">{label}</div>
        {sub && <div className="me-stat-sub">{sub}</div>}
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
