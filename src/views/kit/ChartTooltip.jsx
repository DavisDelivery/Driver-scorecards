import React from "react";

// The hover readout for every chart. Values lead and labels follow — the reader already
// knows the series and wants the number — and each row is keyed with a short stroke of
// the series colour rather than a filled box. Every series at that point is listed,
// zeros included, so the pointer never has to land on a thin segment to read it.
//
// Recharts clones this element with { active, payload, label }; the row itself is
// read from the payload so the transparent label-carrier bar never shows up here. A
// row's `__notes` (strings) follow the values: why a day has no data, how many of the
// fleet's were Unassigned.
export default function ChartTooltip({ active, payload, label, series = [], lines = [], total = false }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload || {};
  const fmt = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());
  const rows = [...series, ...lines];
  return (
    <div className="ct" role="status">
      <div className="ct-head">{label}</div>
      {total && (
        <div className="ct-row ct-total">
          <b>{fmt(row.__total)}</b>
          <span>Total</span>
        </div>
      )}
      {rows.map((s) => (
        <div className="ct-row" key={s.id}>
          <i style={{ background: s.color }} aria-hidden="true" />
          <b>{fmt(row[s.id])}</b>
          <span>{s.label}</span>
        </div>
      ))}
      {(row.__notes || []).map((n) => (
        <div className="ct-note" key={n}>
          {n}
        </div>
      ))}
    </div>
  );
}
