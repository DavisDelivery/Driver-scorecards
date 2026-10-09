import React from "react";
import { BRAND, PRIOR } from "../chartTheme.js";
import useSize from "../useSize.js";
import { niceTicks, textWidth } from "../shape.js";

// Two dots closer than this (px) are drawn touching, side by side, with one label
// "17 → 21" after them: a value never sits on a dot, and a dot never hides behind
// the other.
const CLOSE = 24;
const PAD = 36; // the track's inset at each end (.db-track --pad)

// Before → after for each item: a gray dot for the comparison, a brand-blue dot for this
// period, joined by a hairline, on one shared scale from 0. Both ends carry their value;
// what changed and how much it means sit in words beside the row. Two shades of one
// story, never a diverging pair: no polarity colour stands in for a series.
//
//   rows  [{ key, label, swatch?, a, b, side, note, reason }]
//         a / b    { value, text, title, onClick } — the comparison and this period
//         side     the change in words (Δ, Δ%, the verdict), in ink
//         note     a muted line under it (months left out)
//         reason   a row that couldn't be compared: its reason, in words (a node, so
//                  a count in it can open its entries) — never a dot at zero
//   max   the largest value drawn; the scale runs 0 → the first nice step at or above
//         it, and a top axis names its ticks (spec §10.2), with faint vertical lines
//         through the rows at each
//
// Each dot's hit area is 24px, leaning off the line (the comparison's up, this period's
// down) so two dots on the same value can both be reached; hover or focus reads it out,
// and a click opens it. Two equal values draw as one dot, half of each.
//
// The readout is anchored so it stays on the card: from the left near the scale's
// start, from the right near its end, centred between.
const anchor = (x) => (x < 0.4 ? "l" : x > 0.6 ? "r" : "c");

export default function Dumbbell({ rows, max }) {
  const [peek, setPeek] = React.useState(null);
  // Every row's track is the same width: the first compared one is measured.
  const [trackRef, track] = useSize();
  const firstCompared = rows.findIndex((r) => !r.reason && r.a && r.b);
  const axis = niceTicks(max > 0 ? max : 1, 3, { decimals: !Number.isInteger(max) });
  const top = axis.top;
  const pos = (v) => Math.max(0, Math.min(1, v / top));
  const span = Math.max(0, track.width - 2 * PAD);
  return (
    <div className="db" role="list">
      {/* The scale: its ticks over the tracks, aligned to them. */}
      {firstCompared >= 0 && (
        <div className="db-row db-axis" aria-hidden="true">
          <div className="db-label" />
          <div className="db-track">
            {axis.ticks.map((t) => (
              <span key={t} className="db-tick" style={{ "--x": pos(t) }}>
                {Number(t).toLocaleString()}
              </span>
            ))}
          </div>
          <div className="db-side" />
        </div>
      )}
      {rows.map((row, ri) => {
        const compared = !row.reason && row.a && row.b;
        const lo = compared ? Math.min(row.a.value, row.b.value) : 0;
        const hi = compared ? Math.max(row.a.value, row.b.value) : 0;
        const close = compared && row.a.value !== row.b.value && span > 0 && (pos(hi) - pos(lo)) * span < CLOSE;
        const mid = (pos(lo) + pos(hi)) / 2;
        // A close pair's "17 → 21" goes right of the dots (spec §10.2) — left only when
        // the track's end leaves it no room.
        const pairText = close ? `${row.a.text} → ${row.b.text}` : "";
        const pairRight = close && (1 - mid) * span + PAD - 16 >= textWidth(pairText, 12) + 4;
        // The smaller end's value sits left of its dot, the larger's right of it, so the
        // two never run into each other or the hairline.
        const ends = compared
          ? [
              { side: "a", end: row.a, color: PRIOR, left: row.a.value < row.b.value || row.a.value === row.b.value },
              { side: "b", end: row.b, color: BRAND, left: row.b.value < row.a.value },
            ]
          : [];
        const same = compared && row.a.value === row.b.value;
        return (
          <div className="db-row" role="listitem" key={row.key}>
            <div className="db-label">
              {row.swatch && <i style={{ background: row.swatch }} aria-hidden="true" />}
              {row.label}
            </div>
            <div className="db-track" ref={ri === firstCompared ? trackRef : undefined}>
              {compared ? (
                <>
                  {axis.ticks.map((t) => (
                    <span key={`g${t}`} className="db-grid" style={{ "--x": pos(t) }} aria-hidden="true" />
                  ))}
                  <span className="db-rule" aria-hidden="true" />
                  {!close && (
                    <span
                      className="db-link"
                      aria-hidden="true"
                      style={{ "--from": pos(lo), "--to": pos(hi) }}
                    />
                  )}
                  {close && (
                    // Right of the pair, or left of it near the scale's end, so it never
                    // runs into the words beside the track.
                    <span className={`db-val db-pair ${pairRight ? "right" : "left"}`} style={{ "--x": mid }} aria-hidden="true">
                      {pairText}
                    </span>
                  )}
                  {ends.map(({ side, end, color, left }) => {
                    const on = peek && peek.key === row.key && peek.side === side;
                    // Close: the two dots sit touching around their midpoint, the
                    // smaller value on the left.
                    const shift = close ? (end.value === lo ? "-6px" : "6px") : "0px";
                    return (
                      <React.Fragment key={side}>
                        <button
                          type="button"
                          className={`db-dot ${side}${same ? " same" : ""}`}
                          style={{ "--x": close ? mid : pos(end.value), "--shift": shift, "--c": color }}
                          onClick={end.onClick || undefined}
                          disabled={!end.onClick}
                          onMouseEnter={() => setPeek({ key: row.key, side })}
                          onMouseLeave={() => setPeek(null)}
                          onFocus={() => setPeek({ key: row.key, side })}
                          onBlur={() => setPeek(null)}
                          aria-label={end.title}
                        >
                          <span aria-hidden="true" />
                        </button>
                        {/* Equal values share one label, set by the blue dot; a close
                            pair has its one "17 → 21" instead. */}
                        {!close && !(same && side === "a") && (
                          <span className={`db-val ${left && !same ? "left" : "right"}`} style={{ "--x": pos(end.value) }} aria-hidden="true">
                            {end.text}
                          </span>
                        )}
                        {on && (
                          <span className={`ct db-tip ${anchor(pos(end.value))}`} style={{ "--x": pos(end.value) }} role="status">
                            {end.title}
                          </span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              ) : typeof row.reason === "string" ? (
                // Not compared: one quiet label; why is in its hover, the table view and
                // the card's footnote — not a paragraph inside the plot.
                <span className="db-reason db-reason-short" title={row.reason}>
                  not compared
                </span>
              ) : (
                <span className="db-reason">{row.reason}</span>
              )}
            </div>
            <div className="db-side" title={row.sideTitle || undefined}>
              {row.side}
              {row.note && <div className="db-note">{row.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
