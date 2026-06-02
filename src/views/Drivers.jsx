import React from "react";

// ---------------------------------------------------------------------------
// DriverModal — per-driver incident history modal (reconstructed from Age)
// ---------------------------------------------------------------------------
function DriverModal({ driver, incidents, onClose }) {
  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const inc of incidents) {
      const month = (inc.ship_date || inc.return_date || "").slice(0, 7) || "unknown";
      if (!map.has(month)) map.set(month, []);
      map.get(month).push(inc);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [incidents]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{driver.name}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-2)", marginTop: 2 }}>
              {driver.role.toUpperCase()} · {incidents.length} lifetime incidents
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {grouped.length === 0 && (
            <div className="empty-state">No incidents recorded</div>
          )}
          {grouped.map(([month, monthIncidents]) => (
            <div key={month} style={{ marginBottom: 20 }}>
              <div className="section-divider">{month}</div>
              {monthIncidents.map((inc, idx) => (
                <div key={idx} className="incident-row">
                  <span className="pro-num">{inc.pro_number}</span>
                  <span className={`chip ${inc.category}`}>{inc.category}</span>
                  <span style={{ color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {inc.reason} — <span style={{ color: "var(--text-2)" }}>{inc.notes}</span>
                  </span>
                  <span className={`fault-chip ${inc.fault || "unknown"}`}>{inc.fault || "unk"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drivers — main driver roster view (reconstructed from Sge)
// ---------------------------------------------------------------------------
export default function Drivers({ drivers, incidents, onUpdate }) {
  const [selected, setSelected] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");

  const enriched = React.useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const currentYear = currentMonth.slice(0, 4);
    return drivers.map((driver) => {
      const driverIncidents = incidents.filter((inc) => inc.driver_id === driver.id);
      const monthIncidents = driverIncidents.filter((inc) =>
        (inc.ship_date || inc.return_date || "").startsWith(currentMonth)
      );
      const ytdIncidents = driverIncidents.filter((inc) =>
        (inc.ship_date || inc.return_date || "").startsWith(currentYear)
      );
      const driverFaultMonth = monthIncidents.filter((inc) => inc.fault === "driver");
      const byCategory = driverIncidents.reduce((acc, inc) => {
        acc[inc.category] = (acc[inc.category] || 0) + 1;
        return acc;
      }, {});
      return {
        ...driver,
        totalIncidents: driverIncidents.length,
        monthCount: monthIncidents.length,
        ytdCount: ytdIncidents.length,
        driverFaultMonth: driverFaultMonth.length,
        damages: byCategory.damage || 0,
        missing: byCategory.missing || 0,
        misdelivery: byCategory.misdelivery || 0,
        ff: byCategory.forgotten_freight || 0,
        complaints: byCategory.complaint || 0,
        heat:
          driverFaultMonth.length >= 3
            ? "hot"
            : driverFaultMonth.length >= 1
            ? "warm"
            : "cool",
      };
    });
  }, [drivers, incidents]);

  const filtered = React.useMemo(() => {
    let list = enriched;
    if (roleFilter !== "all") {
      list = list.filter((d) => d.role === roleFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }
    return list.sort(
      (a, b) =>
        b.driverFaultMonth - a.driverFaultMonth ||
        b.monthCount - a.monthCount ||
        a.name.localeCompare(b.name)
    );
  }, [enriched, search, roleFilter]);

  return (
    <div>
      <div className="page-title">Driver Roster</div>
      <h1 className="page-heading">
        Drivers
        <span className="meta">· {filtered.length} / {drivers.length}</span>
      </h1>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Search drivers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <div className="month-picker">
          <button
            className={`month-btn ${roleFilter === "all" ? "active" : ""}`}
            onClick={() => setRoleFilter("all")}
          >
            All
          </button>
          <button
            className={`month-btn ${roleFilter === "driver" ? "active" : ""}`}
            onClick={() => setRoleFilter("driver")}
          >
            Drivers
          </button>
          <button
            className={`month-btn ${roleFilter === "non-driver" ? "active" : ""}`}
            onClick={() => setRoleFilter("non-driver")}
          >
            Non-Driver
          </button>
        </div>
      </div>
      <div className="driver-list">
        {filtered.map((driver) => (
          <div
            key={driver.id}
            className={`driver-card ${driver.heat}`}
            onClick={() => setSelected(driver)}
          >
            <div className="driver-name">{driver.name}</div>
            <div className="driver-role">{driver.role}</div>
            <div className="driver-stats">
              <div className="driver-stat">
                <div className={`driver-stat-value ${driver.driverFaultMonth > 0 ? "red" : ""}`}>
                  {driver.driverFaultMonth}
                </div>
                <div className="driver-stat-label">Fault Mo</div>
              </div>
              <div className="driver-stat">
                <div className="driver-stat-value">{driver.monthCount}</div>
                <div className="driver-stat-label">Total Mo</div>
              </div>
              <div className="driver-stat">
                <div className={`driver-stat-value ${driver.ytdCount > 3 ? "amber" : ""}`}>
                  {driver.ytdCount}
                </div>
                <div className="driver-stat-label">YTD</div>
              </div>
              <div className="driver-stat">
                <div className="driver-stat-value">{driver.totalIncidents}</div>
                <div className="driver-stat-label">All Time</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {selected && (
        <DriverModal
          driver={selected}
          incidents={incidents.filter((inc) => inc.driver_id === selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
