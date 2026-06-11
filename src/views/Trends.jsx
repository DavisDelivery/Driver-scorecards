import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { getHistory } from "../data/firebase.js";
import DriverModal from "./DriverModal.jsx";
import { CategoryLeaderboard, LeaderRow } from "./leaderboard.jsx";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CATS = [
  { id: "forgotten_freight", title: "Forgotten Freight", color: "#fb923c" },
  { id: "damage",            title: "Damages",           color: "#dc3545" },
  { id: "missing",           title: "Lost / Missing",    color: "#a855f7" },
  { id: "misdelivery",       title: "Misdeliveries",     color: "#f472b6" },
  { id: "attempts",          title: "Attempts",          color: "#14b8a6" },
  { id: "late",              title: "Lates",             color: "#facc15" },
];
const CAT_IDS = CATS.map((c) => c.id);

const incidentYm = (inc) =>
  (inc.delivered_date || inc.actual_delivery || inc.return_date ||
   inc.trace_date || inc.ship_date || inc.week_ending || inc.ingested_at || ""
  ).slice(0, 7);

const tooltipStyle = {
  contentStyle: {
    background: "#fff", border: "1px solid #dde3ec", borderRadius: 6,
    fontFamily: "JetBrains Mono", fontSize: 11,
    boxShadow: "0 2px 8px rgba(17,24,39,.1)",
  },
  cursor: { fill: "rgba(30,91,146,.06)" },
};
const axisTick = { fill: "#94a3b8", fontSize: 10, fontFamily: "JetBrains Mono" };
const legendStyle = {
  fontFamily: "JetBrains Mono", fontSize: 10,
  textTransform: "uppercase", letterSpacing: ".08em",
};

export default function Trends({ drivers, incidents = [] }) {
  const [history, setHistory] = React.useState([]);
  const [tab, setTab] = React.useState("overview");
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [focusId, setFocusId] = React.useState(null);
  const [driverQuery, setDriverQuery] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    getHistory().then((r) => alive && setHistory(Array.isArray(r) ? r : [])).catch(() => {});
    return () => { alive = false; };
  }, [incidents]);

  // Blended cube: ym -> Map("driverId|cat" -> count). Live months win over
  // history; live respects the "Do not fault driver" toggle.
  const cube = React.useMemo(() => {
    const liveByYm = {};
    for (const inc of incidents) {
      const ym = incidentYm(inc);
      if (!ym || ym.length !== 7) continue;
      (liveByYm[ym] = liveByYm[ym] || []).push(inc);
    }
    const cells = {};
    const names = new Map();
    const ensure = (ym) => (cells[ym] = cells[ym] || new Map());
    for (const [ym, list] of Object.entries(liveByYm)) {
      const cell = ensure(ym);
      for (const inc of list) {
        if (!inc.driver_id || inc.no_fault || !CAT_IDS.includes(inc.category)) continue;
        const k = `${inc.driver_id}|${inc.category}`;
        cell.set(k, (cell.get(k) || 0) + 1);
        if (!names.has(inc.driver_id)) names.set(inc.driver_id, inc.driver_name || inc.driver_raw || inc.driver_id);
      }
    }
    for (const rec of history) {
      if (!rec.driver_id || !CAT_IDS.includes(rec.category)) continue;
      const ym = `${rec.year}-${String(rec.month).padStart(2, "0")}`;
      if (liveByYm[ym]) continue; // live supersedes
      const cell = ensure(ym);
      const k = `${rec.driver_id}|${rec.category}`;
      cell.set(k, (cell.get(k) || 0) + (rec.count || 0));
      if (!names.has(rec.driver_id)) names.set(rec.driver_id, rec.driver_name || rec.driver_id);
    }
    for (const d of drivers) names.set(d.id, d.name);
    return { cells, names };
  }, [incidents, history, drivers]);

  const years = React.useMemo(() => {
    const ys = new Set(Object.keys(cube.cells).map((ym) => Number(ym.slice(0, 4))));
    ys.add(new Date().getFullYear());
    return [...ys].sort();
  }, [cube]);

  // ---- Overview: monthly stacked totals for the selected year ----
  const monthly = React.useMemo(() => {
    return MONTHS.map((label, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      const row = { month: label };
      let total = 0;
      for (const c of CATS) row[c.id] = 0;
      for (const [k, n] of cube.cells[ym] || []) {
        const cat = k.split("|")[1];
        row[cat] = (row[cat] || 0) + n;
        total += n;
      }
      row.total = total;
      return row;
    });
  }, [cube, year]);

  // ---- YoY: per-year stacked totals ----
  const yoy = React.useMemo(() => {
    const byYear = {};
    for (const [ym, cell] of Object.entries(cube.cells)) {
      const y = ym.slice(0, 4);
      byYear[y] = byYear[y] || Object.fromEntries(CATS.map((c) => [c.id, 0]));
      for (const [k, n] of cell) {
        const cat = k.split("|")[1];
        byYear[y][cat] += n;
      }
    }
    return Object.entries(byYear)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([y, cats]) => ({ year: y, ...cats }));
  }, [cube]);

  // ---- Leaderboards: per-category, selected year vs all-time ----
  const leaderData = React.useMemo(() => {
    const out = {};
    for (const c of CATS) out[c.id] = new Map();
    for (const [ym, cell] of Object.entries(cube.cells)) {
      const inYear = ym.startsWith(String(year));
      for (const [k, n] of cell) {
        const [did, cat] = k.split("|");
        if (!out[cat]) continue;
        const rec = out[cat].get(did) || { driverId: did, name: cube.names.get(did) || did, month: 0, ytd: 0 };
        rec.ytd += n;            // all-time (faded)
        if (inYear) rec.month += n; // selected year (solid)
        out[cat].set(did, rec);
      }
    }
    const final = {};
    for (const c of CATS) {
      final[c.id] = [...out[c.id].values()].sort((a, b) => b.month - a.month || b.ytd - a.ytd);
    }
    return final;
  }, [cube, year]);

  // ---- Per-driver: pick driver → monthly trend + category rows ----
  const filteredDrivers = React.useMemo(() => {
    const q = driverQuery.toLowerCase();
    return drivers
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [drivers, driverQuery]);

  const [perDriverId, setPerDriverId] = React.useState("");
  const perDriver = React.useMemo(() => {
    if (!perDriverId) return null;
    const byMonth = MONTHS.map((label, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      let n = 0;
      for (const [k, v] of cube.cells[ym] || []) {
        if (k.startsWith(`${perDriverId}|`)) n += v;
      }
      return { month: label, count: n };
    });
    const cats = CATS.map((c) => {
      let yr = 0, all = 0;
      for (const [ym, cell] of Object.entries(cube.cells)) {
        const n = cell.get(`${perDriverId}|${c.id}`) || 0;
        all += n;
        if (ym.startsWith(String(year))) yr += n;
      }
      return { ...c, yr, all };
    });
    return { byMonth, cats };
  }, [cube, perDriverId, year]);

  const TABS = [
    ["overview", "Overview"],
    ["yoy", "Year over Year"],
    ["leaders", "Leaderboards"],
    ["driver", "Per Driver"],
  ];

  return (
    <div>
      <div className="page-title">Performance Trends</div>
      <h1 className="page-heading">
        Trends <span className="meta">· live + 3-yr history blend</span>
      </h1>

      <div className="toolbar">
        <div className="month-picker">
          {TABS.map(([id, label]) => (
            <button key={id} className={`month-btn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="month-picker">
          {years.map((y) => (
            <button key={y} className={`month-btn ${year === y ? "active" : ""}`} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Monthly Incidents · {year}</div>
            <div className="cc-count">{monthly.reduce((a, r) => a + r.total, 0)} total</div>
          </div>
          <div style={{ height: 300, padding: "10px 14px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={5}>
                <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={legendStyle} />
                {CATS.map((c) => (
                  <Bar key={c.id} dataKey={c.id} name={c.title} stackId="m" fill={c.color} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === "yoy" && (
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">Year over Year</div>
            <div className="cc-count">{yoy.length} years</div>
          </div>
          <div style={{ height: 300, padding: "10px 14px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yoy} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={18}>
                <XAxis dataKey="year" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={legendStyle} />
                {CATS.map((c) => (
                  <Bar key={c.id} dataKey={c.id} name={c.title} stackId="y" fill={c.color} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === "leaders" && (
        <div className="chart-grid">
          {CATS.map((c) => (
            <CategoryLeaderboard
              key={c.id}
              title={c.title}
              color={c.color}
              data={leaderData[c.id] || []}
              onSelect={setFocusId}
              periodLabel={String(year)}
              totalLabel="ALL"
            />
          ))}
        </div>
      )}

      {tab === "driver" && (
        <div>
          <div className="toolbar">
            <input
              type="text"
              placeholder="Search driver…"
              value={driverQuery}
              onChange={(e) => setDriverQuery(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <select value={perDriverId} onChange={(e) => setPerDriverId(e.target.value)}>
              <option value="">— Select driver —</option>
              {filteredDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {perDriverId && (
              <button className="btn primary" onClick={() => setFocusId(perDriverId)}>
                View Incidents
              </button>
            )}
          </div>
          {perDriver && (
            <>
              <div className="chart-card" style={{ marginBottom: 16 }}>
                <div className="chart-card-header">
                  <div className="chart-card-title">
                    {cube.names.get(perDriverId)} · Monthly · {year}
                  </div>
                  <div className="cc-count">
                    {perDriver.byMonth.reduce((a, r) => a + r.count, 0)} in {year}
                  </div>
                </div>
                <div style={{ height: 220, padding: "10px 14px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={perDriver.byMonth} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                      <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} />
                      <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="count" name="Incidents" fill="#1e5b92" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="chart-card">
                <div className="chart-card-header">
                  <div className="chart-card-title">Category Breakdown</div>
                  <div className="cc-count">
                    <span className="cc-key"><i style={{ background: "#1e5b92" }} /> {year}</span>
                    <span className="cc-key"><i className="cc-key-ytd" style={{ background: "#1e5b92" }} /> ALL</span>
                  </div>
                </div>
                <div className="lb-body">
                  {perDriver.cats.map((c, i) => (
                    <LeaderRow
                      key={c.id}
                      rank={i + 1}
                      row={{ driverId: perDriverId, name: c.title, month: c.yr, ytd: c.all }}
                      color={c.color}
                      max={Math.max(1, ...perDriver.cats.map((x) => x.all))}
                      onSelect={() => setFocusId(perDriverId)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
          {!perDriver && <div className="empty-state">Pick a driver to see their trend.</div>}
        </div>
      )}

      {focusId && (
        <DriverModal
          driver={drivers.find((d) => d.id === focusId) || { id: focusId, name: cube.names.get(focusId) || focusId, role: "driver" }}
          incidents={incidents.filter((i) => i.driver_id === focusId)}
          onClose={() => setFocusId(null)}
        />
      )}
    </div>
  );
}
