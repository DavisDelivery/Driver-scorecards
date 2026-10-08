import React from "react";
import { BRAND, PRIOR } from "../chartTheme.js";

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
//   max   the scale's top (the largest value drawn)
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
  const top = max > 0 ? max : 1;
  const pos = (v) => Math.max(0, Math.min(1, v / top));
  return (
    <div className="db" role="list">
      {rows.map((row) => {
        const compared = !row.reason && row.a && row.b;
        const lo = compared ? Math.min(row.a.value, row.b.value) : 0;
        const hi = compared ? Math.max(row.a.value, row.b.value) : 0;
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
            <div className="db-track">
              {compared ? (
                <>
                  <span className="db-rule" aria-hidden="true" />
                  <span
                    className="db-link"
                    aria-hidden="true"
                    style={{ "--from": pos(lo), "--to": pos(hi) }}
                  />
                  {ends.map(({ side, end, color, left }) => {
                    const on = peek && peek.key === row.key && peek.side === side;
                    return (
                      <React.Fragment key={side}>
                        <button
                          type="button"
                          className={`db-dot ${side}${same ? " same" : ""}`}
                          style={{ "--x": pos(end.value), "--c": color }}
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
                        {/* Equal values share one label, set by the blue dot. */}
                        {!(same && side === "a") && (
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
              ) : (
                <span className="db-reason">{row.reason}</span>
              )}
            </div>
            <div className="db-side">
              {row.side}
              {row.note && <div className="db-note">{row.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
