import React from "react";
import { BRAND, PRIOR } from "../chartTheme.js";

// What every month on file covers: a row per category, a cell per month. A heat-cell
// grid, not a chart of counts — the counts are in the hover readout and the table view.
//
//   live         a brand-blue cell: the app captured it
//   history      a gray cell: imported history serves it
//   partial      half filled, in its source's colour: captured in part
//   no data      an outlined cell with "–": a spreadsheet month nobody imported
//   conflict     an ink ⚠ in an outlined cell — never an amber fill, which would read as
//                Late — where live entries and history disagree
//   not tracked  no cell at all; the thin bar under a row is the category's capture
//                window, so where tracking starts is visible even across gaps
//
// The grid scrolls inside its own box on a phone (46 months don't fit 390px), opening on
// its latest months; the corner over the row labels names the year of the first month
// in view, so a scrolled grid still says which year its first columns are. One cell at
// a time takes keyboard focus; the arrow keys move it, and the readout above the grid
// says what the hovered or focused cell holds.
//
//   months  YYYY-MM columns, oldest first
//   rows    [{ id, label, short?, color, cells: [cell] (one per month), window: Set(ym) }]
//           `short` is the label on a phone, where the long one would be cut off
//           cell is coverage.js's { ym, category, state, value, … }
//   focus   { ym, cat } to open on (a caveat chip's month), or null
//   describe(cell) → the readout's words
//   onOpen(cell)   opens what a cell counts (cells with a value only)

const MONTH_LETTER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
// One month column: an 18px cell and the 2px gap after it (styles.css .cm-row).
const COLUMN = 20;

export default function CoverageMatrix({ months, rows, focus = null, describe, onOpen }) {
  const wrapRef = React.useRef(null);
  const start = React.useMemo(() => {
    const r = focus ? rows.findIndex((x) => x.id === focus.cat) : -1;
    const c = focus ? months.indexOf(focus.ym) : -1;
    return r >= 0 && c >= 0 ? { r, c } : { r: 0, c: months.length - 1 };
  }, [focus, rows, months]);
  const [active, setActive] = React.useState(start);
  const [peek, setPeek] = React.useState(focus ? start : null);
  const [firstInView, setFirstInView] = React.useState(0);
  const onScroll = () => {
    const el = wrapRef.current;
    if (el) setFirstInView(Math.min(months.length - 1, Math.max(0, Math.round(el.scrollLeft / COLUMN))));
  };
  React.useEffect(() => {
    setActive(start);
    if (focus) setPeek(start);
  }, [start, focus]);

  // Open on the focused month, or the latest months.
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const cellEl = el.querySelector(`[data-rc="${start.r}-${start.c}"]`);
    if (focus && cellEl) {
      el.scrollLeft = Math.max(0, cellEl.offsetLeft - el.clientWidth / 2);
      cellEl.scrollIntoView?.({ block: "nearest" });
    } else {
      el.scrollLeft = el.scrollWidth;
    }
    onScroll();
  }, [start, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (r, c) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(months.length - 1, c));
    setActive({ r: nr, c: nc });
    setPeek({ r: nr, c: nc });
    wrapRef.current?.querySelector(`[data-rc="${nr}-${nc}"]`)?.focus();
  };
  const onKey = (e) => {
    const k = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (k) {
      e.preventDefault();
      move(active.r + k[0], active.c + k[1]);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(active.r, 0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(active.r, months.length - 1);
    }
  };

  const shown = peek ? rows[peek.r]?.cells[peek.c] : null;
  const style = { "--n": months.length, "--live": BRAND, "--hist": PRIOR };
  return (
    <div className="cm" style={style}>
      <div className="cm-key" aria-hidden="true">
        <span><i className="cm-cell s-live" /> live</span>
        <span><i className="cm-cell s-history" /> imported history</span>
        <span><i className="cm-cell s-partial i-app" /> partly captured</span>
        <span><i className="cm-cell s-conflict">⚠</i> live and history disagree</span>
        <span><i className="cm-cell s-no_data">–</i> no data on file</span>
        <span><i className="cm-win-key" /> capture window (no cell: not tracked)</span>
      </div>
      <div className="cm-read" aria-live="polite">
        {shown ? describe(shown) : "Hover or focus a cell to read it; click one to open its entries."}
      </div>
      <div className="cm-wrap" ref={wrapRef} onScroll={onScroll}>
        <div className="cm-grid" role="grid" aria-label="Coverage by category and month" onKeyDown={onKey}>
          <div className="cm-row cm-head" role="row">
            <span className="cm-lbl cm-corner" aria-hidden="true">
              {firstInView > 0 && !months[firstInView]?.endsWith("-01") ? months[firstInView]?.slice(0, 4) : ""}
            </span>
            {months.map((ym, i) => (
              <span key={ym} className="cm-year" role="columnheader" aria-label={ym}>
                {ym.endsWith("-01") || i === 0 ? ym.slice(0, 4) : ""}
              </span>
            ))}
          </div>
          <div className="cm-row cm-head" role="row" aria-hidden="true">
            <span className="cm-lbl" />
            {months.map((ym) => (
              <span key={ym} className={`cm-mon ${ym.endsWith("-01") ? "jan" : ""}`}>
                {MONTH_LETTER[Number(ym.slice(5, 7)) - 1]}
              </span>
            ))}
          </div>
          {rows.map((row, r) => (
            <div key={row.id} className="cm-row" role="row">
              <span className="cm-lbl" role="rowheader" title={row.label}>
                <i style={{ background: row.color }} aria-hidden="true" />
                {row.short ? (
                  <>
                    <span className="cm-lbl-long">{row.label}</span>
                    <span className="cm-lbl-short" aria-hidden="true">
                      {row.short}
                    </span>
                  </>
                ) : (
                  row.label
                )}
              </span>
              {row.cells.map((cell, c) => {
                const isActive = active.r === r && active.c === c;
                const isFocus = focus && focus.cat === row.id && focus.ym === cell.ym;
                const tracked = cell.state !== "not_tracked";
                return (
                  <button
                    key={cell.ym}
                    type="button"
                    role="gridcell"
                    data-rc={`${r}-${c}`}
                    tabIndex={isActive ? 0 : -1}
                    className={[
                      "cm-cell",
                      `s-${cell.state}`,
                      cell.instrument === "backfill" ? "i-backfill" : "i-app",
                      row.window.has(cell.ym) ? "win" : "",
                      cell.ym.endsWith("-01") ? "jan" : "",
                      isFocus ? "focus" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-label={describe(cell)}
                    onMouseEnter={() => setPeek({ r, c })}
                    onFocus={() => {
                      setActive({ r, c });
                      setPeek({ r, c });
                    }}
                    onClick={() => {
                      setActive({ r, c });
                      setPeek({ r, c });
                      if (cell.value !== null && onOpen) onOpen(cell);
                    }}
                  >
                    {tracked ? (cell.state === "conflict" ? "⚠" : cell.state === "no_data" ? "–" : "") : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
