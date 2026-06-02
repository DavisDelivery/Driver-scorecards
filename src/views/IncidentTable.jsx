import { Fragment, useState, useMemo } from "react";
import { INCIDENT_CATEGORIES, FAULT_CODES } from "../data/drivers.js";
import {
  saveIncident,
  deleteIncident,
  deleteIncidentsBatch,
} from "../data/firebase.js";
import IncidentEditor from "./IncidentEditor.jsx";

// Category group ordering for the grouped view.
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
const CATEGORY_LABELS = Object.fromEntries(
  INCIDENT_CATEGORIES.map((c) => [c.id, c.label]),
);

export default function IncidentTable({
  incidents,
  drivers,
  onUpdate,
  groupBy = "category",
  showBulkActions = true,
  showFilters = true,
}) {
  const [grouping, setGrouping] = useState(groupBy);
  const [sortCol, setSortCol] = useState("pro_number");
  const [sortDir, setSortDir] = useState("asc");
  const [search, setSearch] = useState("");
  const [faultFilter, setFaultFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);

  const driverName = (id) => drivers.find((d) => d.id === id)?.name || "";

  const filtered = useMemo(
    () =>
      incidents
        .filter((x) => faultFilter === "all" || x.fault === faultFilter)
        .filter((x) => {
          if (!search) return true;
          const q = search.toLowerCase();
          return (
            x.pro_number?.toLowerCase().includes(q) ||
            (x.notes || "").toLowerCase().includes(q) ||
            (x.your_note || "").toLowerCase().includes(q) ||
            driverName(x.driver_id).toLowerCase().includes(q) ||
            (x.driver_raw || "").toLowerCase().includes(q) ||
            (x.reason || "").toLowerCase().includes(q)
          );
        }),
    [incidents, faultFilter, search, drivers],
  );

  const sorted = useMemo(() => {
    const out = filtered.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
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
    return out;
  }, [filtered, sortCol, sortDir, drivers]);

  const groups = useMemo(() => {
    if (grouping === "none")
      return [
        { key: "__all__", label: `All Incidents (${sorted.length})`, items: sorted },
      ];
    const map = new Map();
    for (const inc of sorted) {
      let key;
      if (grouping === "category") key = inc.category || "other";
      else if (grouping === "fault") key = inc.fault || "unknown";
      else if (grouping === "driver")
        key = driverName(inc.driver_id) || inc.driver_raw || "— Unassigned —";
      else key = "__all__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(inc);
    }
    const out = Array.from(map.entries()).map(([key, items]) => {
      let label = key;
      if (grouping === "category")
        label = (CATEGORY_LABELS[key] || key).toUpperCase();
      else if (grouping === "fault")
        label = (FAULT_CODES.find((f) => f.id === key)?.label || key).toUpperCase();
      return { key, label: `${label} · ${items.length}`, items };
    });
    if (grouping === "category")
      out.sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.key);
        const bi = CATEGORY_ORDER.indexOf(b.key);
        return ai === -1 && bi === -1
          ? a.key.localeCompare(b.key)
          : ai === -1
            ? 1
            : bi === -1
              ? -1
              : ai - bi;
      });
    else out.sort((a, b) => b.items.length - a.items.length);
    return out;
  }, [sorted, grouping, drivers]);

  const toggleCollapse = (key) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  const onSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const SortableTh = ({ col, label, style }) => (
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

  async function changeFault(inc, fault) {
    await saveIncident({ ...inc, fault });
    onUpdate?.();
  }
  async function changeDriver(inc, driverId) {
    const d = drivers.find((x) => x.id === driverId);
    await saveIncident({
      ...inc,
      driver_id: driverId || null,
      driver_name: d?.name || "",
    });
    onUpdate?.();
  }
  async function removeIncident(id) {
    if (!confirm("Delete this incident? This cannot be undone.")) return;
    await deleteIncident(id);
    const next = new Set(selected);
    next.delete(id);
    setSelected(next);
    onUpdate?.();
  }
  async function deleteSelected() {
    const ids = Array.from(selected);
    if (
      ids.length &&
      confirm(
        `Delete ${ids.length} incident${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      await deleteIncidentsBatch(ids);
      setSelected(new Set());
      onUpdate?.();
    }
  }
  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    if (selected.size === sorted.length && sorted.length > 0)
      setSelected(new Set());
    else setSelected(new Set(sorted.map((x) => x.id)));
  };

  const colCount = showBulkActions ? 10 : 9;

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
              className={`month-btn ${grouping === "category" ? "active" : ""}`}
              onClick={() => setGrouping("category")}
            >
              Category
            </button>
            <button
              className={`month-btn ${grouping === "fault" ? "active" : ""}`}
              onClick={() => setGrouping("fault")}
            >
              Fault
            </button>
            <button
              className={`month-btn ${grouping === "driver" ? "active" : ""}`}
              onClick={() => setGrouping("driver")}
            >
              Driver
            </button>
            <button
              className={`month-btn ${grouping === "none" ? "active" : ""}`}
              onClick={() => setGrouping("none")}
            >
              None
            </button>
          </div>
          <div className="toolbar-spacer" />
          {showBulkActions && selected.size > 0 && (
            <button className="btn danger" onClick={deleteSelected}>
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
                            selected.size === sorted.length && sorted.length > 0
                          }
                          onChange={toggleSelectAll}
                        />
                      </th>
                    )}
                    <SortableTh col="pro_number" label="PRO#" />
                    <SortableTh col="date" label="Date" />
                    {grouping !== "category" && (
                      <SortableTh col="category" label="Cat" />
                    )}
                    <SortableTh col="driver" label="Driver" />
                    {grouping !== "fault" && (
                      <SortableTh col="fault" label="Fault" />
                    )}
                    <SortableTh col="reason" label="Reason" />
                    <th>Notes</th>
                    <th style={{ width: 70 }}>Photos</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.key}>
                      {grouping !== "none" && (
                        <tr
                          style={{
                            background: "var(--bg-2)",
                            cursor: "pointer",
                            borderTop: "2px solid var(--border)",
                          }}
                          onClick={() => toggleCollapse(group.key)}
                        >
                          <td
                            colSpan={colCount}
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
                            {grouping !== "category" && (
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
                                  changeDriver(inc, e.target.value)
                                }
                                style={{ minWidth: 140 }}
                              >
                                <option value="">{inc.driver_raw || "—"}</option>
                                {drivers
                                  .slice()
                                  .sort((a, b) =>
                                    (a.name || "").localeCompare(b.name || ""),
                                  )
                                  .map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            {grouping !== "fault" && (
                              <td>
                                <select
                                  value={inc.fault || "unknown"}
                                  onChange={(e) =>
                                    changeFault(inc, e.target.value)
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
                                  ✓ {inc.photo_count || inc.photo_urls?.length || 0}
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-2)" }}>—</span>
                              )}
                            </td>
                            <td>
                              <button
                                className="btn ghost sm"
                                onClick={() => setEditing(inc)}
                                title="Edit all fields"
                                style={{ marginRight: 4 }}
                              >
                                ✎
                              </button>
                              <button
                                className="btn ghost sm"
                                onClick={() => removeIncident(inc.id)}
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
      {editing && (
        <IncidentEditor
          incident={editing}
          drivers={drivers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onUpdate?.();
          }}
        />
      )}
    </>
  );
}
