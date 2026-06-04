import { Fragment, useState, useMemo, useEffect } from "react";
import { INCIDENT_CATEGORIES, FAULT_CODES } from "../data/drivers.js";
import {
  saveIncident,
  deleteIncident,
  deleteIncidentsBatch,
  getIncidentPhotos,
  getIncidentPhotosBatch,
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
const FAULT_IDS = new Set(FAULT_CODES.map((f) => f.id));
const CUSTOM = "__custom__";

// Inline row drawer (Phase 3, Fix 3). Reuses the lazy-photo load + saveIncident
// logic from IncidentEditor, rendered inline under a row instead of as a modal.
function IncidentDrawer({ incident, photos, photosLoading, onSave }) {
  // Davis's own note lives in `your_note`; `notes` holds the Uline-scanned note.
  const [davisNote, setDavisNote] = useState(incident.your_note || "");
  const startCustom = !!incident.fault && !FAULT_IDS.has(incident.fault);
  const [faultSel, setFaultSel] = useState(startCustom ? CUSTOM : incident.fault || "unknown");
  const [customFault, setCustomFault] = useState(startCustom ? incident.fault : "");

  const persistDavisNote = () => {
    if ((davisNote || "") !== (incident.your_note || "")) onSave({ your_note: davisNote });
  };
  const onFaultSelect = (val) => {
    setFaultSel(val);
    if (val === CUSTOM) {
      // wait for free-text input; persist when they type/blur
      if (customFault.trim()) onSave({ fault: customFault.trim() });
    } else {
      onSave({ fault: val });
    }
  };
  const persistCustomFault = () => {
    if (customFault.trim() && customFault.trim() !== incident.fault) {
      onSave({ fault: customFault.trim() });
    }
  };

  const urls = photos?.photo_urls || [];

  return (
    <div className="incident-drawer">
      <div className="incident-drawer-grid">
        <div className="drawer-section drawer-photos-section">
          <div className="drawer-label">Delivery Photo(s)</div>
          {photosLoading ? (
            <div className="drawer-muted">Loading photos…</div>
          ) : urls.length > 0 ? (
            <div className="drawer-photos">
              {urls.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer">
                  <img className="drawer-photo" src={src} alt={`Photo ${i + 1}`} />
                </a>
              ))}
            </div>
          ) : (
            <div className="drawer-muted">No photos available</div>
          )}
        </div>

        <div className="drawer-section">
          <div className="drawer-label">Fault</div>
          <select
            className="drawer-fault-select"
            value={faultSel}
            onChange={(e) => onFaultSelect(e.target.value)}
          >
            {FAULT_CODES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {faultSel === CUSTOM && (
            <input
              type="text"
              className="drawer-custom-fault"
              placeholder="Enter custom fault…"
              value={customFault}
              autoFocus
              onChange={(e) => setCustomFault(e.target.value)}
              onBlur={persistCustomFault}
              onKeyDown={(e) => e.key === "Enter" && persistCustomFault()}
            />
          )}

          <div className="drawer-label" style={{ marginTop: 12 }}>
            Uline Notes
          </div>
          <div className="drawer-uline-notes">{incident.notes || "—"}</div>

          <div className="drawer-label" style={{ marginTop: 12 }}>
            Davis Notes
          </div>
          <textarea
            className="drawer-notes"
            value={davisNote}
            onChange={(e) => setDavisNote(e.target.value)}
            onBlur={persistDavisNote}
            rows={4}
            placeholder="Add Davis notes…"
          />
          <button
            className="btn ghost sm"
            style={{ marginTop: 6, alignSelf: "flex-start" }}
            onClick={persistDavisNote}
          >
            Save Davis Notes
          </button>
        </div>
      </div>
    </div>
  );
}

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
  // Phase 3/4: inline row expansion + lazy photo cache. expandedIds is the single
  // source of truth shared by individual row toggles and Expand/Collapse all.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [photosById, setPhotosById] = useState({});
  const [loadingPhotos, setLoadingPhotos] = useState(new Set());
  // Local working copy so inline edits (fault/driver/notes) apply optimistically
  // and instantly — no flash, no dependence on the refetch round-trip.
  const [rows, setRows] = useState(incidents);
  useEffect(() => {
    setRows(incidents);
  }, [incidents]);

  const driverName = (id) => drivers.find((d) => d.id === id)?.name || "";

  const incidentHasPhotos = (inc) =>
    inc.has_photos || (inc.photo_urls && inc.photo_urls.length > 0);

  // Lazy-load one incident's photos (single fetch). No-op once cached/loading.
  const loadPhotosFor = (inc) => {
    const id = inc.id;
    if (photosById[id] !== undefined || loadingPhotos.has(id)) return;
    if (!incidentHasPhotos(inc)) {
      setPhotosById((m) => ({ ...m, [id]: { photo_urls: [], photo_meta: [] } }));
      return;
    }
    setLoadingPhotos((s) => new Set(s).add(id));
    getIncidentPhotos(id)
      .then((p) => setPhotosById((m) => ({ ...m, [id]: p })))
      .catch((err) => {
        console.error("drawer photo load failed", err);
        setPhotosById((m) => ({ ...m, [id]: { photo_urls: [], photo_meta: [] } }));
      })
      .finally(() =>
        setLoadingPhotos((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        }),
      );
  };

  // Toggle a single row drawer; lazy-load its photos on first expand only.
  const toggleExpand = (inc) => {
    const id = inc.id;
    const opening = !expandedIds.has(id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (opening) loadPhotosFor(inc);
  };

  const filtered = useMemo(
    () =>
      rows
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
    [rows, faultFilter, search, drivers],
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

  // Expand/Collapse all operate on the currently visible (filtered + sorted) rows
  // across every group. The button label reflects whether they're all open.
  const allExpanded =
    sorted.length > 0 && sorted.every((inc) => expandedIds.has(inc.id));

  async function expandAll() {
    // Open every visible row immediately so the drawers (and their loading state)
    // render right away rather than blocking on the network.
    setExpandedIds(new Set(sorted.map((inc) => inc.id)));

    // Incidents without photos resolve instantly to an empty result.
    setPhotosById((m) => {
      const next = { ...m };
      for (const inc of sorted) {
        if (!incidentHasPhotos(inc) && next[inc.id] === undefined) {
          next[inc.id] = { photo_urls: [], photo_meta: [] };
        }
      }
      return next;
    });

    // Hydrate the rest with ONE batched call — never N parallel single fetches.
    const needIds = sorted
      .filter(
        (inc) =>
          incidentHasPhotos(inc) &&
          photosById[inc.id] === undefined &&
          !loadingPhotos.has(inc.id),
      )
      .map((inc) => inc.id);
    if (needIds.length === 0) return;

    setLoadingPhotos((s) => {
      const n = new Set(s);
      needIds.forEach((id) => n.add(id));
      return n;
    });
    try {
      const map = await getIncidentPhotosBatch(needIds);
      setPhotosById((m) => {
        const next = { ...m };
        for (const [id, photos] of map) next[id] = photos;
        return next;
      });
    } catch (err) {
      console.error("batch drawer photo load failed", err);
      setPhotosById((m) => {
        const next = { ...m };
        for (const id of needIds)
          if (next[id] === undefined) next[id] = { photo_urls: [], photo_meta: [] };
        return next;
      });
    } finally {
      setLoadingPhotos((s) => {
        const n = new Set(s);
        needIds.forEach((id) => n.delete(id));
        return n;
      });
    }
  }

  const collapseAll = () => setExpandedIds(new Set());
  const toggleExpandAll = () => (allExpanded ? collapseAll() : expandAll());

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

  // Patch one row in local state immediately (optimistic), then persist.
  const patchRow = (id, patch) =>
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function changeFault(inc, fault) {
    patchRow(inc.id, { fault });
    try {
      await saveIncident({ ...inc, fault });
    } catch (err) {
      console.error("save fault failed", err);
    }
    onUpdate?.();
  }
  async function changeDriver(inc, driverId) {
    const d = drivers.find((x) => x.id === driverId);
    const patch = { driver_id: driverId || null, driver_name: d?.name || "" };
    patchRow(inc.id, patch);
    try {
      await saveIncident({ ...inc, ...patch });
    } catch (err) {
      console.error("save driver failed", err);
    }
    onUpdate?.();
  }
  // Persist an edit from the inline drawer (optimistic; errors logged).
  async function saveFromDrawer(inc, patch) {
    patchRow(inc.id, patch);
    try {
      await saveIncident({ ...inc, ...patch });
      onUpdate?.();
    } catch (err) {
      console.error("drawer save failed", err);
    }
  }
  async function removeIncident(id) {
    if (!confirm("Delete this incident? This cannot be undone.")) return;
    setRows((prev) => prev.filter((x) => x.id !== id)); // optimistic
    const next = new Set(selected);
    next.delete(id);
    setSelected(next);
    setExpandedIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    try {
      await deleteIncident(id);
    } catch (err) {
      console.error("delete failed", err);
    }
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
      const set = new Set(ids);
      setRows((prev) => prev.filter((x) => !set.has(x.id))); // optimistic
      setSelected(new Set());
      try {
        await deleteIncidentsBatch(ids);
      } catch (err) {
        console.error("bulk delete failed", err);
      }
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
  const stop = (e) => e.stopPropagation();

  return (
    <>
      {showFilters && (
        <div className="toolbar incidents-toolbar" style={{ flexWrap: "wrap" }}>
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
          <button
            className="btn ghost sm"
            onClick={toggleExpandAll}
            disabled={sorted.length === 0}
            title="Expand or collapse every visible row's drawer"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
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
              <table className="data incident-data">
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
                      <SortableTh
                        col="fault"
                        label="Fault"
                        style={{ minWidth: 160 }}
                      />
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
                          <Fragment key={inc.id}>
                            <tr
                              className={`inc-row ${expandedIds.has(inc.id) ? "expanded" : ""}`}
                              onClick={() => toggleExpand(inc)}
                              title="Click to expand details"
                            >
                              {showBulkActions && (
                                <td onClick={stop}>
                                  <input
                                    type="checkbox"
                                    checked={selected.has(inc.id)}
                                    onChange={() => toggleSelect(inc.id)}
                                  />
                                </td>
                              )}
                              <td className="pro-num">
                                <span className="row-caret">
                                  {expandedIds.has(inc.id) ? "▾" : "▸"}
                                </span>
                                {inc.pro_number}
                              </td>
                              <td>{inc.ship_date || inc.return_date || "—"}</td>
                              {grouping !== "category" && (
                                <td>
                                  <span className={`chip ${inc.category}`}>
                                    {inc.category}
                                  </span>
                                </td>
                              )}
                              <td onClick={stop}>
                                <select
                                  value={inc.driver_id || ""}
                                  onChange={(e) =>
                                    changeDriver(inc, e.target.value)
                                  }
                                  style={{ minWidth: 140 }}
                                >
                                  <option value="">
                                    {inc.driver_raw || "—"}
                                  </option>
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
                                <td onClick={stop}>
                                  <select
                                    className="fault-select"
                                    value={
                                      FAULT_IDS.has(inc.fault)
                                        ? inc.fault
                                        : inc.fault
                                          ? CUSTOM
                                          : "unknown"
                                    }
                                    onChange={(e) =>
                                      e.target.value !== CUSTOM &&
                                      changeFault(inc, e.target.value)
                                    }
                                  >
                                    {FAULT_CODES.map((f) => (
                                      <option key={f.id} value={f.id}>
                                        {f.label}
                                      </option>
                                    ))}
                                    {!FAULT_IDS.has(inc.fault) && inc.fault && (
                                      <option value={CUSTOM}>
                                        {inc.fault} (custom)
                                      </option>
                                    )}
                                  </select>
                                </td>
                              )}
                              <td>
                                <div className="cell-ellipsis" title={inc.reason}>
                                  {inc.reason || "—"}
                                </div>
                              </td>
                              <td>
                                <div
                                  className="cell-ellipsis"
                                  title={inc.your_note || inc.notes}
                                >
                                  {inc.your_note || inc.notes}
                                </div>
                              </td>
                              <td>
                                {inc.has_photos ||
                                (inc.photo_urls &&
                                  inc.photo_urls.length > 0) ? (
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
                              <td onClick={stop}>
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
                            {expandedIds.has(inc.id) && (
                              <tr className="incident-drawer-row">
                                <td colSpan={colCount}>
                                  <IncidentDrawer
                                    incident={inc}
                                    photos={photosById[inc.id]}
                                    photosLoading={loadingPhotos.has(inc.id)}
                                    onSave={(patch) => saveFromDrawer(inc, patch)}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
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
