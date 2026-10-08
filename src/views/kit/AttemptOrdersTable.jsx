import React from "react";
import { ATTRIBUTED_BY_TEXT } from "../../data/attemptRecords.js";
import { OUTCOME_LABEL, searchOrders, sortOrders, recordDate } from "../../data/manualAnalytics.js";
import { downloadCsv } from "../../data/csv.js";

// Every attempted order in a period, one row per order: the table the Attempts tab
// lists a driver's orders in, and the drill-down drawer lists a tile's. One component,
// so the two can't drift apart.
//
// It's a table, not a chart: each order has more attributes than a mark can carry and
// the reader acts on single rows — opens one, or reassigns it.
//
//   rows          attempt records (attemptRecords.js), already narrowed by the screen
//   query / onQuery, sort / onSort
//                 the search and sort, held by the caller when it needs the very rows on
//                 screen (Print prints exactly these); otherwise kept here
//   onOpenStop    (record) — opens StopDetailModal for a feed order
//   onReassign    (record, driverId) — inline reassign; omitted, the table is read-only
//   driverOptions <option>s for the reassign select
//   patterns      Map(record id → drivers) for the "customer pattern" tag
//   lateIndex     Map(PRO → Late incidents) for the "also Late" link; onLate(incidents)
//   onCustomer    (record) — narrows to that customer (a chip)
//   onDriver      (record) — picks the row's driver, so the page follows them; not
//                 offered for a deactivated driver (`hidden`), who can't be picked
//   compact       the drawer's narrower set of columns
//   csv           file name for the export (off when absent)

const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10);
};

// The rows the table shows for a search and sort — the caller prints these.
export const visibleOrders = (rows, { query = "", sort } = {}) => sortOrders(searchOrders(rows, query), sort);

const COLUMNS = [
  { key: "date", label: "Date" },
  { key: "shipment", label: "Shipment" },
  { key: "customer", label: "Customer" },
  { key: "route", label: "Route", wide: true },
  { key: "status", label: "At the scan" },
  { key: "driver", label: "Driver" },
  { key: "by", label: "Attributed by", wide: true },
];

const attributedText = (r) =>
  r.attributedBy ? ATTRIBUTED_BY_TEXT[r.attributedBy] || r.attributedBy : r.driver_name ? "" : "—";

export default function AttemptOrdersTable({
  rows,
  query: queryProp,
  onQuery,
  sort: sortProp,
  onSort,
  onOpenStop = null,
  onReassign = null,
  driverOptions = null,
  patterns = null,
  lateIndex = null,
  onLate = null,
  onCustomer = null,
  onDriver = null,
  hidden = null,
  compact = false,
  csv = null,
  empty = "No attempted orders.",
}) {
  const [ownQuery, setOwnQuery] = React.useState("");
  const [ownSort, setOwnSort] = React.useState({ key: "date", dir: "desc" });
  const query = queryProp ?? ownQuery;
  const setQuery = onQuery || setOwnQuery;
  const sort = sortProp || ownSort;
  const setSort = onSort || setOwnSort;
  // The one row whose reassign select is open: a select per row would put the roster
  // into the page hundreds of times over.
  const [editing, setEditing] = React.useState(null);

  const shown = React.useMemo(() => visibleOrders(rows, { query, sort }), [rows, query, sort]);
  const cols = compact ? COLUMNS.filter((c) => !c.wide) : COLUMNS;

  const sortBy = (key) =>
    setSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" ? "desc" : "asc" });

  const exportCsv = () =>
    downloadCsv(csv, shown, [
      { key: "date", label: "Date", value: (r) => recordDate(r) },
      { key: "shipment", label: "Shipment", value: (r) => r.order?.shipmentNbr || r.pro_number || "" },
      { key: "stops", label: "Stops", value: (r) => (r.order?.legRows || (r.order ? [r.order] : [])).map((l) => l.stopNbr).join(" + ") },
      { key: "customer", label: "Customer", value: (r) => r.customer || "" },
      { key: "city", label: "City", value: (r) => r.order?.city || r.to_city || "" },
      { key: "zip", label: "Zip", value: (r) => r.order?.zip || r.zip_code || "" },
      { key: "planned", label: "Planned route", value: (r) => r.order?.originalLoadNbr || "" },
      { key: "current", label: "Current route", value: (r) => r.order?.routeName || "" },
      { key: "status", label: "At the 8 PM scan", value: (r) => (r.outcome ? OUTCOME_LABEL[r.outcome] : "") },
      { key: "driver", label: "Driver", value: (r) => r.driver_name || "Unassigned" },
      { key: "by", label: "Attributed by", value: attributedText },
      { key: "source", label: "Source", value: (r) => (r.from_feed ? "dispatch feed" : "hand-logged") },
    ]);

  return (
    <div className={`aot ${compact ? "compact" : ""}`.trim()}>
      <div className="aot-tools">
        <input
          type="search"
          className="ff-log-search aot-search"
          placeholder="Shipment, stop, customer, city, zip, route…"
          aria-label="Search orders"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* On a phone the rows stack as cards with no header row, so the sort is here. */}
        <select
          className="aot-sort-phone"
          value={`${sort.key}|${sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split("|");
            setSort({ key, dir });
          }}
          aria-label="Sort orders"
        >
          {cols.flatMap((c) => [
            <option key={`${c.key}|desc`} value={`${c.key}|desc`}>
              {c.label} ▾
            </option>,
            <option key={`${c.key}|asc`} value={`${c.key}|asc`}>
              {c.label} ▴
            </option>,
          ])}
        </select>
        {csv && (
          <button type="button" className="cc-csv" onClick={exportCsv} title="Download these orders as CSV">
            CSV
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="empty-state">{query.trim() ? `No orders match “${query.trim()}”.` : empty}</div>
      ) : (
        <div className="table-wrap aot-wrap">
          <table className="data aot-table">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="aot-sort" onClick={() => sortBy(c.key)}>
                      {c.label}
                      <span aria-hidden="true">{sort.key === c.key ? (sort.dir === "asc" ? " ▴" : " ▾") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const o = r.order;
                const legs = o?.legRows || [];
                const pattern = patterns?.get(r.id);
                const late = lateIndex && r.pro ? lateIndex.get(r.pro) : null;
                const place = [o?.city || r.to_city, o?.zip || r.zip_code].filter(Boolean).join(" ");
                return (
                  <tr key={r.id}>
                    <td className="aot-date">{fmtMDY(recordDate(r))}</td>
                    <td className="aot-ship">
                      {o && onOpenStop ? (
                        <button
                          type="button"
                          className="pro-num pro-num-link"
                          onClick={() => onOpenStop(r)}
                          title="Open this order — its details, and its activity history if you ask for it"
                        >
                          {o.shipmentNbr || o.stopNbr}
                        </button>
                      ) : (
                        <span className="pro-num">{o?.shipmentNbr || r.pro_number}</span>
                      )}
                      {legs.length > 1 && (
                        <span
                          className="ff-item-chip aot-chip"
                          title={`Stops ${legs.map((l) => l.stopNbr).join(", ")}. A -1/-2 is a duplicate order: counted once with the original and never charged to the original's driver.`}
                        >
                          {legs.length} stops · 1 attempt
                        </span>
                      )}
                      {!r.from_feed && <span className="ff-src-chip manual aot-chip">MANUAL</span>}
                    </td>
                    <td className="aot-cust">
                      {onCustomer && r.customerKey ? (
                        <button type="button" className="aot-link" onClick={() => onCustomer(r)} title="Only this customer's orders">
                          {r.customer || "—"}
                        </button>
                      ) : (
                        <span>{r.customer || "—"}</span>
                      )}
                      {place && <span className="meta"> · {place}</span>}
                      {pattern && (
                        <span
                          className="ff-item-chip aot-chip"
                          title={`${pattern} different drivers attempted this customer within 30 days — it may be the customer, not the driver`}
                        >
                          customer pattern
                        </span>
                      )}
                      {late?.length > 0 && (
                        <button
                          type="button"
                          className="aot-link aot-late"
                          onClick={() => onLate?.(late)}
                          title="A Late incident carries this order's PRO"
                        >
                          also Late
                        </button>
                      )}
                    </td>
                    {!compact && (
                      <td className="aot-route" data-label="Route">
                        {o?.originalLoadNbr || o?.routeName ? (
                          <>
                            {o.originalLoadNbr || "—"}
                            {o.routeName && o.routeName !== o.originalLoadNbr ? <span className="meta"> → {o.routeName}</span> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td
                      data-label="At the scan"
                      title={o ? `${o.currentlyUnplanned ? "Unplanned" : o.currentStatus || ""} at the 8 PM scan` : "Hand-logged: no scan status"}
                    >
                      {r.outcome ? OUTCOME_LABEL[r.outcome] : "—"}
                    </td>
                    <td className="aot-driver" data-label="Driver">
                      {editing === r.id && onReassign && o ? (
                        <select
                          autoFocus
                          value=""
                          onChange={(e) => {
                            if (e.target.value) onReassign(r, e.target.value);
                            setEditing(null);
                          }}
                          onBlur={() => setEditing(null)}
                          aria-label={`Reassign ${o.shipmentNbr || o.stopNbr}`}
                        >
                          <option value="">Reassign to…</option>
                          {driverOptions}
                        </select>
                      ) : (
                        <>
                          {onDriver && !(r.driver_id && hidden?.has(r.driver_id)) ? (
                            <button
                              type="button"
                              className={`aot-link ${r.driver_name ? "" : "aot-unassigned"}`.trim()}
                              onClick={() => onDriver(r)}
                              title="Show the page for this driver"
                            >
                              {r.driver_name || "Unassigned"}
                            </button>
                          ) : (
                            <span className={r.driver_name ? "" : "aot-unassigned"}>{r.driver_name || "Unassigned"}</span>
                          )}
                          {onReassign && o && (
                            <button
                              type="button"
                              className="aot-link aot-change"
                              onClick={() => setEditing(r.id)}
                              title="Charge this attempt to another driver"
                            >
                              change
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    {!compact && (
                      <td className="aot-by" data-label="Attributed by">
                        {attributedText(r)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="aot-foot">
        {shown.length} order{shown.length === 1 ? "" : "s"}
        {query.trim() && shown.length !== rows.length ? ` matching “${query.trim()}”, of ${rows.length}` : ""}
      </div>
    </div>
  );
}
