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
import ManualEntry, {
  FF_CONFIG,
  MISDELIVERY_CONFIG,
  ATTEMPTS_CONFIG,
  COMPLIMENTS_CONFIG,
} from "./views/ManualEntry.jsx";

export const APP_VERSION = "0.10.2";

const TABS = [
  { id: "dashboard", label: "Scorecard", icon: "◫", shortcut: "d" },
  { id: "reports", label: "Reports", icon: "▦", shortcut: "r" },
  { id: "ff", label: "Forgotten Freight", icon: "▣", shortcut: "f" },
  { id: "misdeliveries", label: "Mis-Deliveries", icon: "⇄", shortcut: "m" },
  { id: "attempts", label: "Attempts", icon: "↻", shortcut: "a" },
  { id: "compliments", label: "Compliments", icon: "✦", shortcut: "c" },
  { id: "ingest", label: "New Report", icon: "+", shortcut: "n" },
  { id: "incidents", label: "All Incidents", icon: "⚠", shortcut: "i" },
  { id: "trends", label: "Trends", icon: "◭", shortcut: "t" },
  { id: "drivers", label: "Drivers", icon: "◉", shortcut: "v" },
  { id: "reviews", label: "Reviews", icon: "★", shortcut: "e" },
  { id: "history", label: "History Import", icon: "↥", shortcut: "h" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false); // mobile nav drawer
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

  // Optimistic incident updates for the manual-entry tabs (Forgotten Freight,
  // Mis-Deliveries, Attempts, Compliments). Netlify Blobs `list` is eventually
  // consistent, so a refetch immediately after a write can return a snapshot that
  // is still missing the just-saved row (or still includes a just-deleted one) —
  // which made fresh entries appear to "not persist." Reflect the change in local
  // state right away from the record the save returned; the throttled focus/
  // visibility refresh reconciles with the cloud once it has caught up.
  const applyIncidentChange = (change) => {
    if (!change) {
      reloadIncidents();
      return;
    }
    if (change.type === "upsert" && change.incident && change.incident.id) {
      const inc = change.incident;
      setIncidents((prev) => {
        const i = prev.findIndex((x) => x.id === inc.id);
        if (i === -1) return [...prev, inc];
        const next = prev.slice();
        next[i] = { ...next[i], ...inc };
        return next;
      });
    } else if (change.type === "delete" && change.id) {
      setIncidents((prev) => prev.filter((x) => x.id !== change.id));
    }
  };

  // Cross-device freshness: the app used to fetch once per page load, so a
  // phone tab left open for days showed a frozen snapshot of the cloud store.
  // Refetch everything whenever the tab regains focus (throttled to 60s).
  const lastRefreshRef = useRef(Date.now());
  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshRef.current < 60_000) return;
      lastRefreshRef.current = Date.now();
      Promise.all([getIncidents(), getReports(), getDrivers()])
        .then(([inc, reps, roster]) => {
          setIncidents(inc);
          setReports(reps);
          if (roster && roster.length) setDrivers(roster);
        })
        .catch(() => {}); // offline — keep showing what we have
    };
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, []);

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
        <div className="app-header-left">
          <button
            className="hamburger"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
          <div className="brand">
            <div className="brand-mark">D</div>
            <div className="brand-text">
              <div className="brand-name">DRIVER SCORECARD</div>
              <div className="brand-sub">Davis Delivery · v{APP_VERSION}</div>
            </div>
          </div>
        </div>
        <div className="status-pill">
          <span className="status-dot" />
          CLOUD
        </div>
      </header>

      {menuOpen && (
        <div className="nav-drawer-overlay" onClick={() => setMenuOpen(false)}>
          <nav className="nav-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="nav-drawer-head">
              <div className="brand-name">DRIVER SCORECARD</div>
              <button
                className="nav-drawer-close"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                ×
              </button>
            </div>
            {TABS.map((x) => {
              const count = tabCount(x.id);
              return (
                <button
                  key={x.id}
                  className={`nav-drawer-item ${tab === x.id ? "active" : ""}`}
                  onClick={() => {
                    setTab(x.id);
                    setMenuOpen(false);
                  }}
                >
                  <span className="nav-drawer-icon">{x.icon}</span>
                  <span className="nav-drawer-label">{x.label}</span>
                  {count !== undefined && (
                    <span className="sidebar-tab-count">{count}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      )}

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
            {tab === "trends" && <Trends drivers={drivers} incidents={incidents} />}
            {tab === "ff" && (
              <ManualEntry
                config={FF_CONFIG}
                drivers={drivers}
                incidents={incidents}
                onSaved={applyIncidentChange}
              />
            )}
            {tab === "misdeliveries" && (
              <ManualEntry
                config={MISDELIVERY_CONFIG}
                drivers={drivers}
                incidents={incidents}
                onSaved={applyIncidentChange}
              />
            )}
            {tab === "attempts" && (
              <ManualEntry
                config={ATTEMPTS_CONFIG}
                drivers={drivers}
                incidents={incidents}
                onSaved={applyIncidentChange}
              />
            )}
            {tab === "compliments" && (
              <ManualEntry
                config={COMPLIMENTS_CONFIG}
                drivers={drivers}
                incidents={incidents}
                onSaved={applyIncidentChange}
              />
            )}
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
