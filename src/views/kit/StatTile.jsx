import React from "react";
import useSize from "./useSize.js";
import { tileRows } from "./shape.js";

// A headline number — one tile for every strip in the app (the Scorecard's, Company
// History's and each manual-entry tab's). Label, then value, then a short sub-line, in
// ink: a figure coloured like its series is unreadable for the light hues and repeats
// what the label says.
//
//   label     sentence case, one line
//   value     a number (proportional figures, thousands separators, 12.9K from 10,000),
//             "—" when unavailable, or a word ("Monday", a driver's name), which is set
//             smaller on one line with the full text in the hover
//   sub       one or two short lines under it ("4 entries · 11% of 37")
//   delta     { text, tone: "bad" | "good" | null } — "▲ 12%", first on the sub-line
//   lead      a short text before the delta on the sub-line ("4 of 37"), so a share
//             reads first: "4 of 37 · ▲ 3 vs previous 30 days"
//   title     hover text: the tile's one-line definition
//   onClick   opens what the number counted: the tile is a button
//   children  an action of the tile's own, as a text link under the sub-line (the value
//             is then the button, so a button never sits inside a button)
//   selected  the tile is one of a set that picks what is shown (the drawer's scopes),
//             and this is the one picked: marked, and pressed for a screen reader
//   compact   accepted for the callers that still pass it; there is one look now
export default function StatTile({ label, value, sub = null, delta = null, lead = null, title, onClick = null, children = null, kind = null, selected = null }) {
  // A bare ordinal ("1st") is a number; anything with a word in it ("tied 1st", a name,
  // a weekday) is set as text.
  const isText = kind ? kind === "text" : typeof value === "string" && /[A-Za-z]/.test(value) && !/^\d+(st|nd|rd|th)$/.test(value);
  const shown = typeof value === "number" ? fmtValue(value) : value;
  const valueEl = (
    <span className={`tile-value ${isText ? "text" : ""}`.trim()} title={isText ? String(value) : undefined}>
      {shown}
    </span>
  );
  const hasSub = sub !== null && sub !== undefined && sub !== "";
  const subEl =
    hasSub || delta || lead ? (
      // The whole line in the hover, should two lines ever not hold it.
      <span className="tile-sub" title={typeof sub === "string" && !delta && !lead ? sub : undefined}>
        {lead}
        {lead && (delta || hasSub) && " · "}
        {delta && <span className={`tile-delta ${delta.tone || ""}`.trim()}>{delta.text}</span>}
        {delta && hasSub && " "}
        {hasSub && sub}
      </span>
    ) : null;
  if (onClick && !children) {
    return (
      <button
        type="button"
        className={`tile clickable ${selected ? "selected" : ""}`.trim()}
        title={title}
        onClick={onClick}
        aria-pressed={selected === null ? undefined : !!selected}
      >
        <span className="tile-label">{label}</span>
        {valueEl}
        {subEl}
      </button>
    );
  }
  return (
    <div className="tile" title={title}>
      <span className="tile-label">{label}</span>
      {onClick ? (
        <button type="button" className="tile-value-btn" onClick={onClick} aria-label={`${label}: ${value}. Open the detail`}>
          {valueEl}
        </button>
      ) : (
        valueEl
      )}
      {subEl}
      {children && <div className="tile-extra">{children}</div>}
    </div>
  );
}

// 1,284 · 12.9K from 10,000 · one decimal for a fraction.
function fmtValue(v) {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (!Number.isInteger(v)) return v.toFixed(1);
  return v.toLocaleString("en-US");
}

// Tiles in one white strip, hairline dividers between them, rows balanced by width
// (kit/shape.js tileRows: 8 tiles are 4 + 4, 5 are one row of 5; a short last row
// stretches) so a strip never has a hole. A tile left alone on the last row (5 tiles
// two-up on a phone) spans the row with the same label / value / sub stack as the rest,
// so its number lines up with theirs.
//   footer   one quiet line inside the strip's card, under the tiles: what the numbers
//            can and can't say (Reviews' click-through caveat)
export function TileStrip({ children, className = "", footer = null }) {
  const [ref, size] = useSize();
  const tiles = React.Children.toArray(children).filter(Boolean);
  const rows = tileRows(tiles.length, size.width || 1440);
  let at = 0;
  return (
    <div ref={ref} className={`tile-strip ${className}`.trim()}>
      {rows.map((n, r) => {
        const row = tiles.slice(at, at + n);
        at += n;
        return (
          <div key={r} className={`tile-row ${n === 1 && rows.length > 1 ? "lone" : ""}`.trim()}>
            {row}
          </div>
        );
      })}
      {footer && <div className="tile-foot">{footer}</div>}
    </div>
  );
}
