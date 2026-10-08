import React from "react";
import { downloadCsv } from "../../data/csv.js";
import CardMenu from "./CardMenu.jsx";

// The frame every chart sits in: a title with a one-line subtitle under it, a legend when
// there are two or more series, the plot, one note line, and a single ⋯ menu holding the
// table view and the CSV. One look for every card in the app.
//
// The table is not optional. Forgotten Freight's orange sits below 3:1 contrast on white,
// so a value must always be readable without telling hues apart or landing a hover —
// the table shows every number the chart draws, with where it came from.
//
//   title     the chart's name, sentence case
//   subtitle  the takeaway under it ("37 entries · peak 6 on Tue, Sep 29"); `count` is
//             the old name and still accepted
//   legend    [{ id, label, color, line?, dot?, ring? }] — drawn only for 2+ series; the
//             key mirrors the mark: a stroke for a line, a dot for a dot plot, a hollow
//             ring for the points a chart draws hollow
//   table     { columns, rows } from shape.js chartTable()
//   csv       file name for the export (the menu item is disabled without one)
//   height    plot height INCLUDING the x-axis band, so the card never scrolls inside;
//             "auto" for a plot that sizes itself (a bar list)
//   inset     a chart inside an existing card (a panel cell): no card chrome
//   onLegend  (id) => void — legend entries become buttons that isolate a series (the
//             chart grays the rest); `focus` is the isolated id, pressed
//   note      one line under the plot: what the chart leaves out, in words
//   aside     something small at the header's right, before the menu (a Details link)
//   actions   more menu items [{ id, label, onSelect }]
export default function ChartCard({
  title,
  subtitle = null,
  count = null,
  legend = null,
  table = null,
  csv = null,
  height = 260,
  inset = false,
  className = "",
  onLegend = null,
  focus = null,
  note = null,
  aside = null,
  actions = [],
  busy = false,
  children,
}) {
  const [view, setView] = React.useState("chart");
  const showTable = view === "table" && table;
  const sub = subtitle ?? count;
  const items = [
    ...(table
      ? [
          showTable
            ? { id: "chart", label: "Show as chart", icon: "bar-chart", onSelect: () => setView("chart") }
            : { id: "table", label: "Show as table", icon: "table", onSelect: () => setView("table") },
          {
            id: "csv",
            label: "Download CSV",
            icon: "download",
            disabled: !csv,
            title: csv ? "Download this chart's table as CSV" : "No CSV for this chart",
            onSelect: () => csv && downloadCsv(csv, table.rows, table.columns),
          },
        ]
      : []),
    ...actions,
  ];
  return (
    <div className={`${inset ? "cc-inset" : "chart-card"} ${className}`.trim()}>
      {/* No subtitle: no empty line held for one (an inset head shrinks to its title). */}
      <div className={`cc-head ${sub === null || sub === undefined || sub === "" ? "no-sub" : ""}`.trim()}>
        <div className="cc-titles">
          <div className="cc-title-row">
            <div className="cc-title">{title}</div>
            {showTable && (
              <button type="button" className="cc-pill" onClick={() => setView("chart")} title="Back to the chart">
                Table
              </button>
            )}
          </div>
          {sub !== null && sub !== undefined && sub !== "" && <div className="cc-sub">{subParts(sub)}</div>}
        </div>
        {(aside || items.length > 0) && (
          <div className="cc-tools">
            {aside}
            <CardMenu items={items} label={`${typeof title === "string" ? title : "Chart"} options`} />
          </div>
        )}
      </div>
      {legend && legend.length >= 2 && !showTable && (
        <div className="cc-legend">
          {legend.map((s) =>
            onLegend && !s.line ? (
              <button
                key={s.id}
                type="button"
                className={`cc-legend-item cc-legend-btn ${focus && focus !== s.id ? "off" : ""}`}
                aria-pressed={focus === s.id}
                onClick={() => onLegend(s.id)}
                title={focus === s.id ? "Show every category" : `Only ${s.label} in colour`}
              >
                <i style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </button>
            ) : (
              <span key={s.id} className="cc-legend-item">
                <i
                  className={s.line ? "line" : s.dot ? "dot" : s.ring ? "ring" : ""}
                  style={s.ring ? { borderColor: s.color } : { background: s.color }}
                  aria-hidden="true"
                />
                {s.label}
              </span>
            ),
          )}
        </div>
      )}
      {showTable ? (
        <DataTable columns={table.columns} rows={table.rows} />
      ) : (
        <div
          className={`cc-plot ${busy ? "busy" : ""}`.trim()}
          style={height === "auto" ? undefined : { height }}
          aria-busy={busy || undefined}
        >
          {children}
        </div>
      )}
      {note && !showTable && <div className="cc-note">{noteItems(note)}</div>}
    </div>
  );
}

// A subtitle wraps between its " · " phrases, never inside a short one: "peak 5 on Tue,
// Oct 6" stays whole on a phone rather than leaving "6" alone on the next line.
function subParts(sub) {
  if (typeof sub !== "string" || !sub.includes(" · ")) return sub;
  const parts = sub.split(" · ");
  return parts.map((p, i) => (
    <React.Fragment key={i}>
      <span className={p.length <= 40 ? "cc-sub-part" : undefined}>{p}</span>
      {i < parts.length - 1 ? " · " : ""}
    </React.Fragment>
  ));
}

// The note's items — a " · "-joined string, an array, or a fragment's children — each
// kept whole and wrapped as a unit, with the " · " between two items on the same line
// only: an item that starts a line hides its separator (.cc-note-clip), so no line ever
// ends or starts with a dangling "·". A single element lays itself out.
function noteItems(note) {
  const list =
    typeof note === "string"
      ? note.split(" · ")
      : Array.isArray(note)
        ? React.Children.toArray(note)
        : React.isValidElement(note) && note.type === React.Fragment
          ? React.Children.toArray(note.props.children)
          : [note];
  const items = list.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  return (
    <div className="cc-note-clip">
      <div className="cc-note-items">
        {items.map((x, i) => (
          <span key={i} className="cc-note-item">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

// A chart's numbers as a table. Missing values read "—": a gap is never shown as 0. A
// column marked `wrap` (a long source) wraps rather than widening the table.
export function DataTable({ columns, rows }) {
  if (!rows.length) return <div className="empty-state">Nothing to show.</div>;
  const cell = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString() : v);
  return (
    <div className="table-wrap cc-table">
      <table className="data analytics-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : c.wrap ? "wrap" : undefined}>
                  {cell(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
