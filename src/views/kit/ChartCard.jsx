import React from "react";
import { downloadCsv } from "../../data/csv.js";

// The frame every chart sits in: title, count, a legend when there are two or more
// series, and the table-view twin with its CSV.
//
// The table is not optional. Four of the six category colours sit below 3:1 contrast
// on white, so a value must always be readable without telling hues apart or landing a
// hover — the table shows every number the chart draws, with where it came from.
//
//   title    the chart's name
//   count    a short figure for the header ("312 total")
//   legend   [{ id, label, color, line? }] — drawn only for 2+ series
//   table    { columns, rows } from shape.js chartTable()
//   csv      file name for the export (off when absent)
//   height   plot height, INCLUDING the x-axis band, so the card never scrolls inside
//   inset    no card chrome: for a chart that sits inside an existing card
export default function ChartCard({
  title,
  count = null,
  legend = null,
  table = null,
  csv = null,
  height = 260,
  inset = false,
  className = "",
  children,
}) {
  const [view, setView] = React.useState("chart");
  const showTable = view === "table" && table;
  return (
    <div className={`${inset ? "cc-inset" : "chart-card"} ${className}`.trim()}>
      <div className={inset ? "cc-inset-head" : "chart-card-header cc-head"}>
        <div className={inset ? "me-chart-title" : "chart-card-title"}>{title}</div>
        <div className="cc-tools">
          {count !== null && count !== undefined && <span className="cc-count">{count}</span>}
          {table && (
            <span className="cc-view" role="group" aria-label="Show as">
              <button
                type="button"
                className={view === "chart" ? "active" : ""}
                aria-pressed={view === "chart"}
                onClick={() => setView("chart")}
              >
                Chart
              </button>
              <button
                type="button"
                className={view === "table" ? "active" : ""}
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                Table
              </button>
            </span>
          )}
          {table && csv && (
            <button
              type="button"
              className="cc-csv"
              onClick={() => downloadCsv(csv, table.rows, table.columns)}
              title="Download this table as CSV"
            >
              CSV
            </button>
          )}
        </div>
      </div>
      {legend && legend.length >= 2 && !showTable && (
        <div className="cc-legend">
          {legend.map((s) => (
            <span key={s.id} className="cc-legend-item">
              <i className={s.line ? "line" : ""} style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {showTable ? (
        <DataTable columns={table.columns} rows={table.rows} />
      ) : (
        <div className="cc-plot" style={{ height }}>
          {children}
        </div>
      )}
    </div>
  );
}

// A chart's numbers as a table. Missing values read "—": a gap is never shown as 0.
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
                <td key={c.key} className={c.num ? "num" : undefined}>
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
