import { useState, useEffect, useRef, useCallback } from "react";
import { buildSeededDrivers } from "./data/drivers.js";
import davisLogo from "./assets/davis-logo.svg";
import {
  saveDrivers,
  loadDriversChecked,
  loadIncidentsChecked,
  loadReportsChecked,
  flushPendingIncidents,
  countPendingIncidents,
  onPendingWritesChange,
} from "./data/firebase.js";
import { AnalyticsProvider } from "./data/AnalyticsProvider.jsx";
import { applyReadResult } from "./data/loadState.js";
import { DrillHost } from "./views/kit/DrillDrawer.jsx";
import { AnalyticsGate } from "./views/kit/LoadState.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Ingest from "./views/Ingest.jsx";
import Reports from "./views/Reports.jsx";
import Incidents from "./views/Incidents.jsx";
import Drivers from "./views/Drivers.jsx";
import Trends from "./views/Trends.jsx";
import CompanyHistory from "./views/CompanyHistory.jsx";
import History from "./views/History.jsx";
import Reviews from "./views/Reviews.jsx";
import ManualEntry, {
  MISDELIVERY_CONFIG,
  ATTEMPTS_CONFIG,
  COMPLIMENTS_CONFIG,
} from "./views/ManualEntry.jsx";
import ForgottenFreightTabs from "./views/ForgottenFreightTabs.jsx";
import { migrateBlobsToFirestore } from "./data/migrateFromBlobs.js";
import { rescueLocalEntries } from "./data/rescueLocal.js";
import { useHashState, writeHash } from "./data/hashState.js";

export const APP_VERSION = "0.24.0";
// Host the app is actually served from — shown in the footer so two people can
// instantly confirm they're on the SAME deploy/store (a mismatch is a common
// reason one person's entries never reach another's view).
const APP_HOST =
  typeof window !== "undefined" && window.location ? window.location.host : "";

// Sidebar order, top to bottom: the Scorecard and Reports, Company History third (the
// whole company over every month on file), the day-to-day entry screens, then the other
// analysis screens, and the roster last — it's set up once and rarely revisited.
// "New Report" is deliberately NOT here: it lives on the Reports tab, and listing
// it twice made one screen look like two places. `n` still jumps straight to it.
const TABS = [
  { id: "dashboard", label: "Scorecard", icon: "◫", shortcut: "d" },
  { id: "reports", label: "Reports", icon: "▦", shortcut: "r" },
  { id: "company", label: "Company History", icon: "▤", shortcut: "o" },
  { id: "ff", label: "Forgotten Freight", icon: "▣", shortcut: "f" },
  { id: "misdeliveries", label: "Mis-Deliveries", icon: "⇄", shortcut: "m" },
  { id: "attempts", label: "Attempts", icon: "↻", shortcut: "a" },
  { id: "compliments", label: "Compliments", icon: "✦", shortcut: "c" },
  { id: "trends", label: "Trends", icon: "◭", shortcut: "t" },
  { id: "reviews", label: "Reviews", icon: "★", shortcut: "e" },
  { id: "incidents", label: "All Incidents", icon: "⚠", shortcut: "i" },
  { id: "history", label: "History Import", icon: "↥", shortcut: "h" },
  { id: "drivers", label: "Drivers", icon: "◉", shortcut: "v" },
];
// Every screen the hash can open: the sidebar tabs plus New Report (`n`).
const TAB_IDS = new Set([...TABS.map((x) => x.id), "ingest"]);

export default function App() {
  // The open tab lives in the URL hash (#tab=reports), alongside each tab's own filters
  // (sc.p, att.p …; see hashState.js), so a link opens the same screen and Back returns
  // to the previous tab. An unknown tab in a link falls back to the Scorecard.
  const [hashTab] = useHashState("tab", "dashboard");
  const tab = TAB_IDS.has(hashTab) ? hashTab : "dashboard";
  // A tab change also closes any open drill-down: it belongs to the screen it came from.
  const setTab = useCallback(
    (id) => writeHash({ tab: id === "dashboard" ? null : id, drill: null }, { push: true }),
    [],
  );
  const [menuOpen, setMenuOpen] = useState(false); // mobile nav drawer
  const [incidents, setIncidents] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialReportId, setInitialReportId] = useState(null);
  const [pendingSync, setPendingSync] = useState(0); // entries not yet on server
  // Reads that failed: { incidents | drivers | reports: { message, stale } }. `stale`
  // means an earlier good copy is still on screen; without one, the analytics screens
  // show the failure instead of numbers built on nothing.
  const [readErrors, setReadErrors] = useState({});
  const loadedOnce = useRef({ incidents: false, drivers: false, reports: false });
  const gPressed = useRef(false);
  const gTimer = useRef(null);

  // Apply a checked read: the data on success, the failure on error — never an empty
  // list standing in for a read that didn't happen (loadState.js applyReadResult; a
  // read the server didn't answer can still put this browser's offline copy up, said
  // as old). Returns whether the read succeeded.
  const applyRead = useCallback((kind, result, set) => {
    const next = applyReadResult(result, loadedOnce.current[kind]);
    loadedOnce.current[kind] = next.loaded;
    if (next.data !== undefined) set(next.data);
    setReadErrors((e) => (next.error ? { ...e, [kind]: next.error } : e[kind] ? { ...e, [kind]: null } : e));
    return !next.error;
  }, []);

  // Initial load: seed drivers if the store is empty, then load everything.
  useEffect(() => {
    (async () => {
      try {
        const [drv, inc, reps] = await Promise.all([
          loadDriversChecked(),
          loadIncidentsChecked(),
          loadReportsChecked(),
        ]);
        // Seed ONLY when the roster read succeeded and came back empty. A failed read
        // — including one the server never answered — is not an empty roster, and
        // seeding overwrites the whole roster document.
        if (!drv.error && drv.data.length === 0) {
          const roster = buildSeededDrivers();
          loadedOnce.current.drivers = true;
          setDrivers(roster);
          // saveDrivers throws on failure (so roster edits can report it), but a
          // failed seed must never block startup — show the seeded roster and
          // let the user retry, rather than hanging the app on "Loading…".
          try {
            await saveDrivers(roster);
          } catch (err) {
            console.warn("Seeding the driver roster failed:", err.message);
          }
        } else {
          applyRead("drivers", drv, setDrivers);
        }
        applyRead("incidents", inc, setIncidents);
        applyRead("reports", reps, setReports);
      } catch (err) {
        console.warn("Initial load failed:", err.message);
      } finally {
        setLoading(false);
      }
      // Retry any entries a flaky/offline write left stranded on this device so
      // they reach the server (and every other viewer) without re-typing.
      try {
        const { flushed, remaining } = await flushPendingIncidents();
        if (flushed > 0) applyRead("incidents", await loadIncidentsChecked(), setIncidents);
        setPendingSync(remaining);
      } catch (err) {
        console.warn("Pending-sync flush failed:", err.message);
      }
    })();
  }, [applyRead]);

  // The pending banner follows the write tracker LIVE: it appears the moment a
  // write outlives its ack window and clears the moment the server catches up —
  // not only when someone happens to save or refocus the tab.
  useEffect(() => {
    let alive = true;
    const off = onPendingWritesChange((n) => {
      if (!alive) return;
      if (n > 0) setPendingSync(n);
      else
        // Tracker drained — but writes queued by an EARLIER session aren't in it,
        // so confirm with the SDK before clearing the warning.
        flushPendingIncidents()
          .then(({ remaining }) => alive && setPendingSync(remaining))
          .catch(() => {});
    });
    return () => {
      alive = false;
      off();
    };
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

  // One-time Blobs→Firestore migration, runnable from the browser console as
  // `await window.__ddsMigrate(console.log)` on the live site. Not wired to any
  // button so it can't be triggered by accident.
  useEffect(() => {
    window.__ddsMigrate = migrateBlobsToFirestore;
    // Rescue entries stranded in THIS browser's pre-Firestore localStorage cache
    // (writes that silently failed to sync): dry-run lists them, {commit:true}
    // imports. See src/data/rescueLocal.js.
    window.__ddsRescueLocal = rescueLocalEntries;
    return () => {
      delete window.__ddsMigrate;
      delete window.__ddsRescueLocal;
    };
  }, []);

  const reloadIncidents = async () => applyRead("incidents", await loadIncidentsChecked(), setIncidents);
  const reloadDrivers = async () => applyRead("drivers", await loadDriversChecked(), setDrivers);
  const reloadReports = async () => applyRead("reports", await loadReportsChecked(), setReports);
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
    setPendingSync(countPendingIncidents());
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
      flushPendingIncidents()
        .then(() => Promise.all([loadIncidentsChecked(), loadReportsChecked(), loadDriversChecked()]))
        .then(([inc, reps, roster]) => {
          // A failed refresh keeps what is on screen and says so (readErrors).
          applyRead("incidents", inc, setIncidents);
          applyRead("reports", reps, setReports);
          if (roster.error || roster.data.length) applyRead("drivers", roster, setDrivers);
          setPendingSync(countPendingIncidents());
        })
        .catch(() => {}); // offline — keep showing what we have
    };
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [applyRead]);

  // A list whose read failed with nothing on screen has no count to show: "–", not 0.
  const tabCount = (id) => {
    const kind = { reports: "reports", incidents: "incidents", drivers: "drivers" }[id];
    if (!kind) return undefined;
    if (readErrors[kind] && !readErrors[kind].stale) return "–";
    return { reports, incidents, drivers }[kind].length;
  };

  return (
    <div className="app-shell">
      <aside className="sidebar-nav">
        <div className="sidebar-brand">
          <img className="brand-logo" src={davisLogo} alt="Davis Delivery Service" />
          <div className="brand-text">
            <div className="brand-name">DRIVER SCORECARD</div>
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
            <img className="brand-logo sm" src={davisLogo} alt="Davis Delivery Service" />
            <div className="brand-text">
              <div className="brand-name">DRIVER SCORECARD</div>
              <div className="brand-sub" title={APP_HOST}>
                v{APP_VERSION}
                {APP_HOST ? ` · ${APP_HOST}` : ""}
              </div>
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
              <img className="brand-logo sm" src={davisLogo} alt="Davis Delivery Service" />
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

      <AnalyticsProvider
        incidents={incidents}
        drivers={drivers}
        reports={reports}
        loading={loading}
        readErrors={readErrors}
        reload={{ incidents: reloadIncidents, drivers: reloadDrivers, reports: reloadReports }}
      >
        <main className="content">
          {Object.entries(readErrors).map(
            ([kind, err]) =>
              err && (
                <div key={kind} className="sync-banner load-banner" role="alert">
                  ⚠ {err.stale ? `Couldn't refresh ${READ_NAMES[kind]}` : `Couldn't load ${READ_NAMES[kind]}`} from the
                  server ({err.message}).{" "}
                  {err.offline
                    ? "Showing the copy saved in this browser; it may be out of date."
                    : err.stale
                      ? "Showing the copy loaded earlier; it may be out of date."
                      : kind === "incidents"
                        ? "Every count is missing them until they load, so the screens built on them are hidden; new entries can still be logged."
                        : kind === "drivers"
                          ? "The roster was left untouched. Screens that split by role or hide inactive drivers are hidden until it loads."
                          : "The reports list is hidden until they load."}{" "}
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={{ incidents: reloadIncidents, drivers: reloadDrivers, reports: reloadReports }[kind]}
                  >
                    Try again
                  </button>
                </div>
              ),
          )}
          {pendingSync > 0 && (
            <div className="sync-banner" role="status">
              ⚠ {pendingSync} {pendingSync === 1 ? "entry" : "entries"} saved on this
              device only — not yet synced to the server. Others won't see{" "}
              {pendingSync === 1 ? "it" : "them"} until this device reconnects.
              Retrying automatically; keep this tab open, or reload once you're back
              online.
            </div>
          )}
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : (
            <>
              {tab === "dashboard" && <Dashboard />}
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
                  onNewReport={() => setTab("ingest")}
                  initialReportId={initialReportId}
                  onCleared={() => setInitialReportId(null)}
                />
              )}
              {tab === "incidents" && (
                // The list IS the incidents: with no copy of them it would read as none.
                <AnalyticsGate history={false}>
                  <Incidents
                    incidents={incidents}
                    drivers={drivers}
                    reports={reports}
                    onUpdate={reloadIncidents}
                  />
                </AnalyticsGate>
              )}
              {tab === "drivers" && (
                <Drivers
                  drivers={drivers}
                  incidents={incidents}
                  onUpdate={reloadDrivers}
                />
              )}
              {tab === "trends" && <Trends />}
              {tab === "company" && (
                <CompanyHistory
                  onOpenReport={(id) => {
                    setInitialReportId(id);
                    setTab("reports");
                  }}
                />
              )}
              {tab === "ff" && (
                <ForgottenFreightTabs
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
              {tab === "reviews" && <Reviews incidents={incidents} />}
              {tab === "history" && (
                <History
                  drivers={drivers}
                  onReportCreated={reloadReportsAndIncidents}
                />
              )}
            </>
          )}
        </main>
        <DrillHost />
      </AnalyticsProvider>
    </div>
  );
}

const READ_NAMES = { incidents: "incidents", drivers: "the driver roster", reports: "reports" };
