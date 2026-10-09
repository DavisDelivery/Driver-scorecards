import React from "react";
import { fmtHead } from "./shape.js";

// The hover readout for every chart: the whole date on the head line, then one row per
// series — a short stroke of its colour, its name, and its value right-aligned — every
// series at that slot listed, zeros included, so the pointer never has to land on a thin
// segment to read it. A stack puts its total first.
//
// Recharts clones this element with { active, payload, label }; the row itself is read
// from the payload so the transparent label-carrier bar never shows up here.
//   row.__head   replaces the head line ("Apr 2026 · 22 workdays")
//   row.__notes  strings after the values: why a slot has no data, Unassigned, Fleet: 34
//   grain, xKey  how the head is written from the slot's ISO key when there's no __head
//   unit         follows each value ("%" on a 100% stack)
//   readout      a touch screen: one line pinned to the plot's top instead of a box
//                under the finger
// A series or line may set `digits`, the decimals its value is read out to. One marked
// `optional` (an outline: history's total for a month with no count) is listed only at a
// slot where it has a value, and leads the touch readout there; `hollow` keys it as an
// outline, as it is drawn.
// A series or line may name a `tip` key: the hover reads the value there instead of
// under its id. A chart that draws a slot differently from what it counted (a month
// only imported history holds, shaded; a 3-month average drawn only over long runs)
// draws from one key and reads out the other, so the hover always says what the table
// view says.
export default function ChartTooltip({
  active,
  payload,
  label,
  series = [],
  lines = [],
  total = false,
  unit = "",
  grain = null,
  xKey = null,
  readout = false,
}) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload || {};
  // A series may set `digits` (an average to one decimal: "43.3", never "43.333").
  const fmt = (v, digits = null) =>
    v === null || v === undefined
      ? "—"
      : `${Number(v).toLocaleString("en-US", digits === null ? undefined : { maximumFractionDigits: digits })}${unit}`;
  const head = row.__head || (grain && xKey ? fmtHead(row[xKey], grain, { toDate: row.__toDate || null }) : label);
  const val = (s) => row[s.tip ?? s.id];
  const set = (v) => v !== null && v !== undefined;
  const rows = [...series, ...lines].filter((s) => !s.optional || set(val(s)));
  if (readout) {
    const opt = rows.find((s) => s.optional);
    const first = opt || rows[0];
    const lead = total && !opt ? `${fmt(row.__total)} total` : first ? `${fmt(val(first), first.digits ?? null)} ${first.label}` : "";
    return (
      <div className="ct readout" role="status">
        <b>{head}</b>
        {lead && <span> · {lead}</span>}
      </div>
    );
  }
  return (
    <div className="ct" role="status">
      <div className="ct-head">{head}</div>
      {total && (
        <div className="ct-row ct-total">
          <span>Total</span>
          <b>{fmt(row.__total)}</b>
        </div>
      )}
      {rows.map((s) => (
        <div className="ct-row" key={s.id}>
          <i className={s.hollow ? "hollow" : undefined} style={s.hollow ? { borderColor: s.color } : { background: s.color }} aria-hidden="true" />
          <span>{s.label}</span>
          <b>{fmt(val(s), s.digits ?? null)}</b>
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
