import React from "react";
import { getHistory } from "../data/firebase.js";
import DriverModal, { ymKey } from "./DriverModal.jsx";

// Categories that count against a driver (negative events). Compliments are
// tracked but never counted "against" a driver.
const NEG_CATS = ["damage","late","missing","misdelivery","forgotten_freight","attempts","complaint"];
const CAT_LABEL = {
  damage: "Damage", late: "Late", missing: "Missing", misdelivery: "Misdeliv",
  forgotten_freight: "Forgot Frt", attempts: "Attempts", complaint: "Complaint",
};
const STRIP = ["damage", "late", "missing", "misdelivery", "forgotten_freight"];

export default function Drivers({ drivers, incidents, onUpdate }) {
  const [selected, setSelected] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [history, setHistory] = React.useState([]);

  React.useEffect(() => {
    let alive = true;
    getHistory()
      .then((recs) => alive && setHistory(Array.isArray(recs) ? recs : []))
      .catch(() => {});
    return () => { alive = false; };
  }, [incidents]);

  const enriched = React.useMemo(() => {
    const curMonth = new Date().toISOString().slice(0, 7);
    const curYear = curMonth.slice(0, 4);

    const liveCells = new Map();
    const liveYms = new Map();
    for (const inc of incidents) {
      if (!inc.driver_id) continue;
      const ym = ymKey(inc) || "unknown";
      if (!liveYms.has(inc.driver_id)) liveYms.set(inc.driver_id, new Set());
      liveYms.get(inc.driver_id).add(ym);
      if (inc.no_fault) continue;
      const k = `${inc.driver_id}|${ym}|${inc.category}`;
      liveCells.set(k, (liveCells.get(k) || 0) + 1);
    }

    return drivers.map((driver) => {
      const ymsWithLive = liveYms.get(driver.id) || new Set();
      const catTotals = {};
      const addCat = (cat, n, year, month) => {
        catTotals[cat] = catTotals[cat] || { all: 0, ytd: 0, mo: 0 };
        catTotals[cat].all += n;
        if (String(year) === curYear) catTotals[cat].ytd += n;
        if (`${year}-${String(month).padStart(2, "0")}` === curMonth) catTotals[cat].mo += n;
      };
      for (const r of history) {
        if (r.driver_id !== driver.id) continue;
        const ym = `${r.year}-${String(r.month).padStart(2, "0")}`;
        if (ymsWithLive.has(ym)) continue;
        addCat(r.category, r.count, r.year, r.month);
      }
      for (const [k, n] of liveCells) {
        const [did, ym, cat] = k.split("|");
        if (did !== driver.id || ym === "unknown") continue;
        const [y, m] = ym.split("-");
        addCat(cat, n, Number(y), Number(m));
      }
      const sum = (sel) => NEG_CATS.reduce((a, c) => a + (catTotals[c]?.[sel] || 0), 0);
      const againstTotal = sum("all");
      const ytdAgainst = sum("ytd");
      const monthAgainst = sum("mo");

      const srcVol = { traces: 0, returns: 0, laters: 0 };
      for (const inc of incidents) {
        if (inc.driver_id !== driver.id || inc.no_fault) continue;
        for (const s of Array.isArray(inc.sources) ? inc.sources : [])
          if (s in srcVol) srcVol[s] += 1;
      }

      return {
        ...driver,
        againstTotal, ytdAgainst, monthAgainst,
        strip: STRIP.map((c) => ({ cat: c, label: CAT_LABEL[c], n: catTotals[c]?.all || 0 })),
        srcVol,
        heat: monthAgainst >= 3 ? "hot" : monthAgainst >= 1 ? "warm" : "cool",
      };
    });
  }, [drivers, incidents, history]);

  const filtered = React.useMemo(() => {
    let list = enriched;
    if (roleFilter !== "all") list = list.filter((d) => d.role === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }
    return list.sort(
      (a, b) =>
        b.monthAgainst - a.monthAgainst ||
        b.againstTotal - a.againstTotal ||
        a.name.localeCompare(b.name),
    );
  }, [enriched, search, roleFilter]);

  return (
    <div>
      <div className="page-title">Driver Roster</div>
      <h1 className="page-heading">
        Drivers <span className="meta">· {filtered.length} / {drivers.length}</span>
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
          {["all", "driver", "loader", "non-driver"].map((r) => (
            <button
              key={r}
              className={`month-btn ${roleFilter === r ? "active" : ""}`}
              onClick={() => setRoleFilter(r)}
            >
              {r === "all" ? "All" : r === "driver" ? "Drivers" : r === "loader" ? "Loaders" : "Non-Driver"}
            </button>
          ))}
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
                <div className={`driver-stat-value ${driver.monthAgainst > 0 ? "red" : ""}`}>
                  {driver.monthAgainst}
                </div>
                <div className="driver-stat-label">Faulted Mo</div>
              </div>
              <div className="driver-stat">
                <div className={`driver-stat-value ${driver.ytdAgainst > 3 ? "amber" : ""}`}>
                  {driver.ytdAgainst}
                </div>
                <div className="driver-stat-label">YTD</div>
              </div>
              <div className="driver-stat">
                <div className="driver-stat-value">{driver.againstTotal}</div>
                <div className="driver-stat-label">All Time</div>
              </div>
            </div>
            <div className="driver-catstrip">
              {driver.strip.map((s) => (
                <div key={s.cat} className={`dcs ${s.n > 0 ? "on" : ""}`}>
                  <span className="dcs-n">{s.n}</span>
                  <span className="dcs-l">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="driver-srcvol">
              <span className="src-badge src-traces">T {driver.srcVol.traces}</span>
              <span className="src-badge src-returns">R {driver.srcVol.returns}</span>
              <span className="src-badge src-laters">L {driver.srcVol.laters}</span>
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
