import React from "react";
import { barListRows, textWidth } from "../shape.js";
import { DEEMPH } from "../chartTheme.js";
import { OTHER_COLOR } from "../../../data/categories.js";

// A ranked (or time-ordered) list of bars in plain HTML: label, a track that spans the
// card, the bar, and the value at the end — no axis, no gridlines; the track is the
// scale. It is every horizontal bar chart in the app: what was forgotten, the drivers,
// the workdays, what happened after an attempt, a short time series (fewer than 7
// slots), a year-over-year list. A list always fills its card.
//
//   rows         the rows, as the caller has them; onMark gets the same object back
//   value        row => number (default row.value); label, key likewise
//   color        the bar colour; colorOf(row) for one that differs ("Not set" is gray)
//   series       [{ id, label, color }] to stack each row by series (row[id] values)
//   order        "value" (largest first) or "given" (Mon → Fri, Jan → Dec)
//   limit        rows shown before "Show all N …" (Not set / Unassigned never count)
//   share        add "· 62%" of `shareOf` (default: the sum of the rows) to each value
//   scaleTo      "max" (the longest visible row fills the track; with `share`, the
//                share's whole does, so a bar is as long as its %) or a number
//   highlightKey a row in focus: the others go gray and its label goes bold
//   faded        row => true for a row still in progress (this year to date)
//   valueText    row => string, to write the value another way ("8 · YTD 8")
//   muted        row => true to set the value in ink 2: a slot with no count ("—"), or
//                another source's total
//   hollow       row => true to draw the bar as an outline, never filled: a total another
//                source holds (a month only imported history has), not a count
//   noun         what the rows are, for "Show all 41 drivers"
//   size         "md" (8px bar, 28px row) or "lg" (20px bar, 40px row)
//   rowTitle     row => hover text
//   plain        names and counts only, no bars: a quiet period's handful of ones would
//                otherwise be full-width slabs
//   note         row => a short line under the row (what a year's total leaves out), or null
//   tailLabel    a heading over the rows that aren't ranked (Not set, Unassigned, names
//                not on the roster), so their gray and their place need no guessing
//   labelNode    row => a node in place of the label text (a driver link), for a list
//                without onMark — a row that is itself a button can't hold one
//   valueNode    row => a node in place of the value text (a count that narrows)
//   ariaLabel    the list's name for a screen reader
export default function BarList({
  rows,
  value = (r) => r.value,
  label = (r) => r.label,
  keyOf = (r) => r.key,
  color = "#234294",
  colorOf = null,
  series = null,
  order = "value",
  limit = 8,
  share = false,
  shareOf = null,
  scaleTo = "max",
  highlightKey = null,
  onMark = null,
  faded = () => false,
  valueText = null,
  muted = null,
  hollow = null,
  noun = "rows",
  size = "md",
  rowTitle = null,
  ariaLabel = null,
  sub = null,
  tailLabel = null,
  note = null,
  plain = false,
  labelNode = null,
  valueNode = null,
}) {
  const [open, setOpen] = React.useState(false);
  const prepared = (rows || []).map((r) => {
    const v = Number(value(r)) || 0;
    return { notSet: !!r.notSet, value: v, __v: v, __src: r };
  });
  const { shown, hidden, total } = barListRows(prepared, {
    order,
    limit,
    open,
    highlightKey,
    keyOf: (r) => keyOf(r.__src),
  });
  const visibleMax = Math.max(0, ...shown.map((r) => r.__v));
  const sum = shareOf ?? prepared.reduce((a, r) => a + r.__v, 0);
  // A share list draws each bar to the whole its percentage is of, so a bar's length
  // is the share printed beside it: two outcomes at 50% each are half the track, not
  // full. A list without shares fills the track with its longest row.
  const scale = scaleTo === "max" ? (share && sum > 0 ? sum : visibleMax) : Number(scaleTo) || visibleMax;
  const pct = (v) => (sum > 0 ? Math.round((v / sum) * 100) : 0);
  const longest = Math.max(0, ...shown.map((r) => textWidth(String(label(r.__src) ?? ""), 13)));
  const labelW = Math.round(Math.min(200, Math.max(96, longest + 4)));
  // A written value ("105 failures") gets the room its longest text needs.
  const valueW = share
    ? 88
    : valueText
      ? Math.round(Math.max(72, ...shown.map((r) => textWidth(String(valueText(r.__src) ?? ""), 13) + 8)))
      : 44;
  const style = { "--bl-label": `${labelW}px`, "--bl-value": `${valueW}px` };
  const widthOf = (v) => (scale > 0 && v > 0 ? `max(2px, ${(v / scale) * 100}%)` : "0");

  const renderRow = (r) => {
    const src = r.__src;
    const k = keyOf(src);
    const picked = highlightKey !== null && highlightKey !== undefined && k === highlightKey;
    const gray = highlightKey !== null && highlightKey !== undefined && !picked;
    const base = src.notSet ? OTHER_COLOR : colorOf ? colorOf(src) : color;
    const fill = gray ? DEEMPH : base;
    const text = valueText ? valueText(src) : r.__v.toLocaleString();
    const title = rowTitle ? rowTitle(src) : `${label(src)}: ${text}${share ? ` · ${pct(r.__v)}%` : ""}`;
    const body = (
      <>
        <span className={`bl-label ${src.notSet ? "not-set" : ""} ${picked ? "picked" : ""}`.trim()} title={String(label(src))}>
          {labelNode && !onMark ? labelNode(src) : label(src)}
        </span>
        <span className="bl-track" aria-hidden="true">
          {series ? (
            <span className="bl-stack" style={{ width: widthOf(r.__v), opacity: faded(src) ? 0.45 : 1 }}>
              {series.map((s) => {
                const v = Number(src[s.id]) || 0;
                return v > 0 ? <span key={s.id} className="bl-seg" style={{ flexGrow: v, background: gray ? DEEMPH : s.color }} /> : null;
              })}
            </span>
          ) : hollow && hollow(src) ? (
            <span className="bl-bar hollow" style={{ width: widthOf(r.__v), borderColor: fill }} />
          ) : (
            <span className="bl-bar" style={{ width: widthOf(r.__v), background: fill, opacity: faded(src) ? 0.45 : 1 }} />
          )}
        </span>
        <span className={`bl-value${muted && muted(src) ? " muted" : ""}`}>
          {valueNode && !onMark ? valueNode(src) : text}
          {share && <span className="bl-share"> · {pct(r.__v)}%</span>}
        </span>
      </>
    );
    const line = note ? note(src) : null;
    const row = onMark ? (
      <button
        key={k}
        type="button"
        role="listitem"
        className={`bl-row bl-btn ${picked ? "picked" : ""}`.trim()}
        onClick={() => onMark(src)}
        aria-pressed={picked}
        title={title}
      >
        {body}
      </button>
    ) : (
      <div key={k} role="listitem" className="bl-row" title={title}>
        {body}
      </div>
    );
    return line ? (
      <React.Fragment key={k}>
        {row}
        <div className="bl-note">{line}</div>
      </React.Fragment>
    ) : (
      row
    );
  };
  // The ranked rows, the fold, then the rows that aren't ranked under their heading.
  const head = shown.filter((r) => !r.notSet);
  const tail = shown.filter((r) => r.notSet);
  return (
    <div className={`bl bl-${size}${plain ? " bl-plain" : ""}`} style={style} role="list" aria-label={ariaLabel || undefined}>
      {head.map(renderRow)}
      {(hidden > 0 || (open && total > limit)) && (
        <button type="button" className="bl-more" onClick={() => setOpen((o) => !o)}>
          {open ? `Show top ${limit}` : `Show all ${total} ${noun}`}
        </button>
      )}
      {tail.length > 0 && tailLabel && (
        <div className="bl-tail" role="presentation">
          {typeof tailLabel === "function" ? tailLabel(tail.map((x) => x.__src)) : tailLabel}
        </div>
      )}
      {tail.map(renderRow)}
      {sub && <div className="bl-sub">{sub}</div>}
    </div>
  );
}
