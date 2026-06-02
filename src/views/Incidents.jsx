import { useState, useMemo, Fragment } from "react";
import { saveIncident, deleteIncident, deleteIncidentsBatch } from "../data/firebase.js";
import { FAULT_CODES, INCIDENT_CATEGORIES } from "../data/drivers.js";
import IncidentEditor from "./IncidentEditor.jsx";

// ---------------------------------------------------------------------------
// Category sort order (matches bundle constant b6)
// ---------------------------------------------------------------------------
const CATEGORY_ORDER = [
  "damage",
  "missing",
  "misdelivery",
  "late",
  "forgotten_freight",
  "return",
  "trace",
  "complaint",
  "compliment",
];

const CATEGORY_LABEL_MAP = Object.fromEntries(
  INCIDENT_CATEGORIES.map((c) => [c.id, c.label])
);

// ---------------------------------------------------------------------------
// SortHeader — clickable <th> that toggles sort direction
// ---------------------------------------------------------------------------
function SortHeader({ col, label, style, sortCol, sortDir, onSort }) {
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: "pointer", userSelect: "none", ...style }}
      title="Click to sort"
    >
      {label}
      {sortCol === col && (
        <span style={{ marginLeft: 4, color: "var(--davis-blue)" }}>
          {sortDir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </th>
  );
}

// ---------------------------------------------------------------------------
// IncidentList — filterable, sortable, groupable table with bulk actions.
//
// Props:
//   incidents        — pre-filtered incident array
//   drivers          — full drivers array
//   onUpdate         — called after any mutation (save/delete)
//   groupBy          — "category" | "fault" | "driver" | "none"
//   showBulkActions  — whether to show checkbox column + bulk delete
//   showFilters      — whether to show the toolbar filters
// ---------------------------------------------------------------------------
function IncidentList({
  incidents,
  drivers,
  onUpdate,
  groupBy: groupByProp = "category",
  showBulkActions = true,
  showFilters = true,
}) {
  const [groupBy, setGroupBy] = useState(groupByProp);
  const [sortCol, setSortCol] = useState("pro_number");
  const [sortDir, setSortDir] = useState("asc");
  const [search, setSearch] = useState("");
  const [faultFilter, setFaultFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [editingIncident, setEditingIncident] = useState(null);

  const driverName = (driverId) =>
    drivers.find((d) => d.id === driverId)?.name || "";

  // -- filter
  const filtered = useMemo(
    () =>
      incidents
        .filter((inc) => faultFilter === "all" || inc.fault === faultFilter)
        .filter((inc) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return (
            inc.pro_number?.toLowerCase().includes(q) ||
            (inc.notes || "").toLowerCase().includes(q) ||
            (inc.your_note || "").toLowerCase().includes(q) ||
            driverName(inc.driver_id).toLowerCase().includes(q) ||
            (inc.driver_raw || "").toLowerCase().includes(q) ||
            (inc.reason || "").toLowerCase().includes(q)
          );
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents, faultFilter, search, drivers]
  );

  // -- sort
  const sorted = useMemo(() => {
    const arr = filtered.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av, bv;
      if (sortCol === "driver") {
        av = driverName(a.driver_id) || a.driver_raw || "";
        bv = driverName(b.driver_id) || b.driver_raw || "";
      } else if (sortCol === "date") {
        av = a.ship_date || a.return_date || "";
        bv = b.ship_date || b.return_date || "";
      } else {
        av = a[sortCol] || "";
        bv = b[sortCol] || "";
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortCol, sortDir, drivers]);

  // -- group
  const groups = useMemo(() => {
    if (groupBy === "none")
      return [{ key: "__all__", label: `All Incidents (${sorted.length})`, items: sorted }];
    const map = new Map();
    for (const inc of sorted) {
      let key;
      if (groupBy === "category") key = inc.category || "other";
      else if (groupBy === "fault") key = inc.fault || "unknown";
      else if (groupBy === "driver")
        key = driverName(inc.driver_id) || inc.driver_raw || "— Unassigned —";
      else key = "__all__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(inc);
    }
    const result = Array.from(map.entries()).map(([key, items]) => {
      let label = key;
      if (groupBy === "category")
        label = (CATEGORY_LABEL_MAP[key] || key).toUpperCase();
      else if (groupBy === "fault")
        label = (
          FAULT_CODES.find((f) => f.id === key)?.label || key
        ).toUpperCase();
      return { key, label: `${label} · ${items.length}`, items };
    });
    if (groupBy === "category") {
      result.sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.key);
        const bi = CATEGORY_ORDER.indexOf(b.key);
        if (ai === -1 && bi === -1) return a.key.localeCompare(b.key);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } else {
      result.sort((a, b) => b.items.length - a.items.length);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, groupBy, drivers]);

  function toggleCollapse(key) {
    const next = new Set(collapsed);
    next.has(key) ? next.delete(key) : next.add(key);
    setCollapsed(next);
  }

  function handleSort(col) {
    if (sortCol === col)
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  async function handleInlineFault(inc, fault) {
    await saveIncident({ ...inc, fault });
    onUpdate?.();
  }

  async function handleInlineDriver(inc, driverId) {
    const driver = drivers.find((d) => d.id === driverId);
    await saveIncident({
      ...inc,
      driver_id: driverId || null,
      driver_name: driver?.name || "",
    });
    onUpdate?.();
  }

  async function handleDelete(id) {
    if (!confirm("Delete this incident? This cannot be undone.")) return;
    await deleteIncident(id);
    const next = new Set(selected);
    next.delete(id);
    setSelected(next);
    onUpdate?.();
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (
      !confirm(
        `Delete ${ids.length} incident${ids.length === 1 ? "" : "s"}? This cannot be undone.`
      )
    )
      return;
    await deleteIncidentsBatch(ids);
    setSelected(new Set());
    onUpdate?.();
  }

  function toggleSelect(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length && sorted.length > 0)
      setSelected(new Set());
    else setSelected(new Set(sorted.map((inc) => inc.id)));
  }

  const colSpan = showBulkActions ? 10 : 9;

  return (
    <>
      {showFilters && (
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search PRO#, notes, driver, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <select
            value={faultFilter}
            onChange={(e) => setFaultFilter(e.target.value)}
            style={{ maxWidth: 160 }}
          >
            <option value="all">All Fault Codes</option>
            {FAULT_CODES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              alignSelf: "center",
            }}
          >
            Group by:
          </div>
          <div className="month-picker" style={{ margin: 0 }}>
            <button
              className={`month-btn ${groupBy === "category" ? "active" : ""}`}
              onClick={() => setGroupBy("category")}
            >
              Category
            </button>
            <button
              className={`month-btn ${groupBy === "fault" ? "active" : ""}`}
              onClick={() => setGroupBy("fault")}
            >
              Fault
            </button>
            <button
              className={`month-btn ${groupBy === "driver" ? "active" : ""}`}
              onClick={() => setGroupBy("driver")}
            >
              Driver
            </button>
            <button
              className={`month-btn ${groupBy === "none" ? "active" : ""}`}
              onClick={() => setGroupBy("none")}
            >
              None
            </button>
          </div>
          <div className="toolbar-spacer" />
          {showBulkActions && selected.size > 0 && (
            <button className="btn danger" onClick={handleBulkDelete}>
              Delete {selected.size} Selected
            </button>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-body tight">
          {sorted.length === 0 ? (
            <div className="empty-state">No incidents match filters</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {showBulkActions && (
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={
                            selected.size === sorted.length &&
                            sorted.length > 0
                          }
                          onChange={toggleSelectAll}
                        />
                      </th>
                    )}
                    <SortHeader
                      col="pro_number"
                      label="PRO#"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      col="date"
                      label="Date"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    {groupBy !== "category" && (
                      <SortHeader
                        col="category"
                        label="Cat"
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    )}
                    <SortHeader
                      col="driver"
                      label="Driver"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    {groupBy !== "fault" && (
                      <SortHeader
                        col="fault"
                        label="Fault"
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    )}
                    <SortHeader
                      col="reason"
                      label="Reason"
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <th>Notes</th>
                    <th style={{ width: 70 }}>Photos</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.key}>
                      {groupBy !== "none" && (
                        <tr
                          style={{
                            background: "var(--bg-2)",
                            cursor: "pointer",
                            borderTop: "2px solid var(--border)",
                          }}
                          onClick={() => toggleCollapse(group.key)}
                        >
                          <td
                            colSpan={colSpan}
                            style={{
                              padding: "8px 14px",
                              fontFamily: "var(--mono)",
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              color: "var(--davis-blue)",
                            }}
                          >
                            <span style={{ marginRight: 8 }}>
                              {collapsed.has(group.key) ? "▸" : "▾"}
                            </span>
                            {group.label}
                          </td>
                        </tr>
                      )}
                      {!collapsed.has(group.key) &&
                        group.items.map((inc) => (
                          <tr key={inc.id}>
                            {showBulkActions && (
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selected.has(inc.id)}
                                  onChange={() => toggleSelect(inc.id)}
                                />
                              </td>
                            )}
                            <td className="pro-num">{inc.pro_number}</td>
                            <td>{inc.ship_date || inc.return_date || "—"}</td>
                            {groupBy !== "category" && (
                              <td>
                                <span className={`chip ${inc.category}`}>
                                  {inc.category}
                                </span>
                              </td>
                            )}
                            <td>
                              <select
                                value={inc.driver_id || ""}
                                onChange={(e) =>
                                  handleInlineDriver(inc, e.target.value)
                                }
                                style={{ minWidth: 140 }}
                              >
                                <option value="">
                                  {inc.driver_raw || "—"}
                                </option>
                                {drivers
                                  .slice()
                                  .sort((a, b) =>
                                    (a.name || "").localeCompare(b.name || "")
                                  )
                                  .map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            {groupBy !== "fault" && (
                              <td>
                                <select
                                  value={inc.fault || "unknown"}
                                  onChange={(e) =>
                                    handleInlineFault(inc, e.target.value)
                                  }
                                >
                                  {FAULT_CODES.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td
                              style={{
                                maxWidth: 180,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span title={inc.reason}>{inc.reason || "—"}</span>
                            </td>
                            <td
                              style={{
                                maxWidth: 260,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span title={inc.your_note || inc.notes}>
                                {inc.your_note || inc.notes}
                              </span>
                            </td>
                            <td>
                              {inc.has_photos ||
                              (inc.photo_urls && inc.photo_urls.length > 0) ? (
                                <span style={{ color: "var(--accent-green)" }}>
                                  ✓{" "}
                                  {inc.photo_count ||
                                    inc.photo_urls?.length ||
                                    0}
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-2)" }}>
                                  —
                                </span>
                              )}
                            </td>
                            <td>
                              <button
                                className="btn ghost sm"
                                onClick={() => setEditingIncident(inc)}
                                title="Edit all fields"
                                style={{ marginRight: 4 }}
                              >
                                ✎
                              </button>
                              <button
                                className="btn ghost sm"
                                onClick={() => handleDelete(inc.id)}
                                title="Delete"
                                style={{ color: "var(--accent-red)" }}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editingIncident && (
        <IncidentEditor
          incident={editingIncident}
          drivers={drivers}
          onClose={() => setEditingIncident(null)}
          onSaved={() => {
            setEditingIncident(null);
            onUpdate?.();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Incidents — "All Incidents" tab view.
//
// Props:
//   incidents  — full incidents array (all reports)
//   drivers    — full drivers array
//   reports    — full reports array (for the filter dropdown)
//   onUpdate   — called after any save/delete mutation
// ---------------------------------------------------------------------------
export default function Incidents({ incidents, drivers, reports, onUpdate }) {
  const [reportFilter, setReportFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Build report map (currently unused for display but kept for future use)
  // eslint-disable-next-line no-unused-vars
  const reportMap = useMemo(() => {
    const m = new Map();
    for (const r of reports || []) m.set(r.id, r);
    return m;
  }, [reports]);

  const filtered = useMemo(
    () =>
      incidents
        .filter((inc) => reportFilter === "all" || inc.report_id === reportFilter)
        .filter(
          (inc) => categoryFilter === "all" || inc.category === categoryFilter
        ),
    [incidents, reportFilter, categoryFilter]
  );

  return (
    <div>
      <div className="page-title">All Incidents · Cross-Report Search</div>
      <h1 className="page-heading">
        Incident Log{" "}
        <span className="meta">
          · {filtered.length} / {incidents.length}
        </span>
      </h1>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <select
          value={reportFilter}
          onChange={(e) => setReportFilter(e.target.value)}
          style={{ maxWidth: 280 }}
        >
          <option value="all">All Reports</option>
          {(reports || []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.range_label}
            </option>
          ))}
        </select>
      </div>
      <IncidentList
        incidents={filtered}
        drivers={drivers}
        onUpdate={onUpdate}
        groupBy="category"
        showBulkActions={true}
        showFilters={true}
      />
    </div>
  );
}
