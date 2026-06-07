import { useState, useEffect, useRef } from "react";
import { buildSeededDrivers } from "./data/drivers.js";
import {
  getDrivers,
  saveDrivers,
  getIncidents,
  getReports,
} from "./data/firebase.js";
import Dashboard from "./views/Dashboard.jsx";
import Ingest from "./views/Ingest.jsx";
import Reports from "./views/Reports.jsx";
import Incidents from "./views/Incidents.jsx";
import Drivers from "./views/Drivers.jsx";
import Trends from "./views/Trends.jsx";
import History from "./views/History.jsx";
import Reviews from "./views/Reviews.jsx";

export const APP_VERSION = "0.7.0";

const TABS = [
  { id: "dashboard", label: "Scorecard", icon: "◫", shortcut: "d" },
  { id: "reports", label: "Reports", icon: "▦", shortcut: "r" },
  { id: "ingest", label: "New Report", icon: "+", shortcut: "n" },
  { id: "incidents", label: "All Incidents", icon: "⚠", shortcut: "i" },
  { id: "trends", label: "Trends", icon: "◭", shortcut: "t" },
  { id: "drivers", label: "Drivers", icon: "◉", shortcut: "v" },
  { id: "reviews", label: "Reviews", icon: "★", shortcut: "e" },
  { id: "history", label: "History Import", icon: "↥", shortcut: "h" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [incidents, setIncidents] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialReportId, setInitialReportId] = useState(null);
  const gPressed = useRef(false);
  const gTimer = useRef(null);

  // Initial load: seed drivers if the store is empty, then load everything.
  useEffect(() => {
    (async () => {
      let roster = await getDrivers();
      if (!roster || roster.length === 0) {
        roster = buildSeededDrivers();
        await saveDrivers(roster);
      }
      const [inc, reps] = await Promise.all([getIncidents(), getReports()]);
      setDrivers(roster);
      setIncidents(inc);
      setReports(reps);
      setLoading(false);
    })();
  }, []);

  // Keyboard navigation: "g" then a tab shortcut; "n" → new report; "/" → search.
  useEffect(() => {
    function onKeyDown(e) {
      const t = e.target;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (gPressed.current) {
        const target = TABS.find((x) => x.shortcut === e.key.toLowerCase());
        if (target) {
          setTab(target.id);
          e.preventDefault();
        }
        gPressed.current = false;
        clearTimeout(gTimer.current);
        return;
      }
      if (e.key === "g") {
        gPressed.current = true;
        gTimer.current = setTimeout(() => {
          gPressed.current = false;
        }, 1200);
        return;
      }
      if (e.key === "n") {
        setTab("ingest");
        e.preventDefault();
      }
      if (e.key === "/") {
        const search = document.querySelector('input[placeholder*="earch"]');
        if (search) {
          search.focus();
          e.preventDefault();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const reloadIncidents = async () => setIncidents(await getIncidents());
  const reloadDrivers = async () => setDrivers(await getDrivers());
  const reloadReports = async () => setReports(await getReports());
  const reloadReportsAndIncidents = async () => {
    await Promise.all([reloadIncidents(), reloadReports()]);
  };

  const tabCount = (id) => {
    if (id === "reports") return reports.length;
    if (id === "incidents") return incidents.length;
    if (id === "drivers") return drivers.length;
    return undefined;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar-nav">
        <div className="sidebar-brand">
          <div className="brand-mark">D</div>
          <div className="brand-text">
            <div className="brand-name">DRIVER SCORECARD</div>
            <div className="brand-sub">Davis Delivery</div>
          </div>
        </div>
        <div className="sidebar-nav-section">
          <div className="sidebar-nav-label">Workspace</div>
          {TABS.map((x) => {
            const count = tabCount(x.id);
            return (
              <button
                key={x.id}
                className={`sidebar-tab ${tab === x.id ? "active" : ""}`}
                onClick={() => setTab(x.id)}
                title={`Go to ${x.label} (g ${x.shortcut})`}
              >
                <span className="sidebar-tab-icon">{x.icon}</span>
                <span className="sidebar-tab-label">{x.label}</span>
                {count !== undefined && (
                  <span className="sidebar-tab-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="sidebar-footer">
          <span className="version">v{APP_VERSION}</span>
          <div className="status-pill">
            <span className="status-dot" />
            CLOUD
          </div>
        </div>
      </aside>

      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div className="brand-text">
            <div className="brand-name">DRIVER SCORECARD</div>
            <div className="brand-sub">Davis Delivery · v{APP_VERSION}</div>
          </div>
        </div>
        <div className="status-pill">
          <span className="status-dot" />
          CLOUD
        </div>
      </header>

      <nav className="tab-bar">
        {TABS.map((x) => {
          const count = tabCount(x.id);
          return (
            <button
              key={x.id}
              className={`tab ${tab === x.id ? "active" : ""}`}
              onClick={() => setTab(x.id)}
            >
              <span>{x.icon}</span>
              <span>{x.label}</span>
              {count !== undefined && (
                <span className="tab-count">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      <main className="content">
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <>
            {tab === "dashboard" && (
              <Dashboard incidents={incidents} drivers={drivers} />
            )}
            {tab === "ingest" && (
              <Ingest
                drivers={drivers}
                onReportCreated={reloadReportsAndIncidents}
                onNavigateToReport={(id) => {
                  setInitialReportId(id);
                  setTab("reports");
                }}
              />
            )}
            {tab === "reports" && (
              <Reports
                drivers={drivers}
                incidents={incidents}
                onNewReport={() => setTab("ingest")}
                initialReportId={initialReportId}
                onCleared={() => setInitialReportId(null)}
              />
            )}
            {tab === "incidents" && (
              <Incidents
                incidents={incidents}
                drivers={drivers}
                reports={reports}
                onUpdate={reloadIncidents}
              />
            )}
            {tab === "drivers" && (
              <Drivers
                drivers={drivers}
                incidents={incidents}
                onUpdate={reloadDrivers}
              />
            )}
            {tab === "trends" && <Trends drivers={drivers} />}
            {tab === "reviews" && <Reviews />}
            {tab === "history" && (
              <History
                drivers={drivers}
                onReportCreated={reloadReportsAndIncidents}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
