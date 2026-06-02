import { useState, useEffect, useMemo } from "react";
import {
  getReports,
  deleteIncidentsForReport,
  deleteReport,
} from "../data/firebase.js";
import ReportDetail from "./ReportDetail.jsx";

// Wide-screen detection for the split (list + detail) layout.
function useIsWide() {
  const [wide, setWide] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1024 : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWide(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return wide;
}

function ViewModeToggle({ viewMode, setViewMode }) {
  return (
    <div className="view-toggle">
      <button
        className={viewMode === "split" ? "active" : ""}
        onClick={() => setViewMode("split")}
        title="Split view — list + detail"
      >
        ▭▭ Split
      </button>
      <button
        className={viewMode === "full" ? "active" : ""}
        onClick={() => setViewMode("full")}
        title="Full view — detail only"
      >
        ▭ Full
      </button>
    </div>
  );
}

export default function Reports({
  drivers,
  onNewReport,
  initialReportId,
  onCleared,
}) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialReportId || null);
  const [viewMode, setViewMode] = useState("split");
  const wide = useIsWide();

  const refresh = async () => {
    setLoading(true);
    const list = await getReports();
    setReports(list);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (initialReportId) {
      setSelectedId(initialReportId);
      onCleared?.();
    }
  }, [initialReportId]);

  const filtered = useMemo(() => {
    if (!search) return reports;
    const q = search.toLowerCase();
    return reports.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.range_label || "").toLowerCase().includes(q),
    );
  }, [reports, search]);

  async function handleDelete(e, report) {
    e.stopPropagation();
    if (confirm(`Delete "${report.name}" and all its incidents?`)) {
      await deleteIncidentsForReport(report.id);
      await deleteReport(report.id);
      await refresh();
      if (selectedId === report.id) setSelectedId(null);
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return isNaN(d)
      ? value
      : d.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  }

  const selected = reports.find((r) => r.id === selectedId);

  // Full-screen layout (narrow screens, or "full" view mode).
  if (!wide || viewMode === "full") {
    if (selectedId) {
      if (selected) {
        return (
          <>
            {wide && (
              <div style={{ marginBottom: 14 }}>
                <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
              </div>
            )}
            <ReportDetail
              report={selected}
              drivers={drivers}
              onBack={() => setSelectedId(null)}
              onDeleted={async () => {
                await refresh();
                setSelectedId(null);
              }}
              onReportUpdated={refresh}
            />
          </>
        );
      }
      return (
        <div>
          <button className="btn ghost sm" onClick={() => setSelectedId(null)}>
            ← Back to Reports
          </button>
          <div className="empty-state" style={{ marginTop: 20 }}>
            Report not found.
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="page-title">Generated Reports</div>
        <h1 className="page-heading">
          Report History <span className="meta">· {reports.length} saved</span>
        </h1>
        <div className="toolbar">
          <input
            type="text"
            placeholder="Search by name or date range..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          {wide && <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />}
          <div className="toolbar-spacer" />
          <button className="btn" onClick={onNewReport}>
            + New Weekly Report
          </button>
        </div>
        {loading ? (
          <div className="empty-state">Loading reports...</div>
        ) : reports.length === 0 ? (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                No reports yet. Click <strong>+ New Weekly Report</strong> to
                create one.
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No reports match your search</div>
        ) : (
          <div className="card">
            <div className="card-body tight">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Week Ending</th>
                      <th>Incidents</th>
                      <th>Created</th>
                      <th style={{ width: 80 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        className="clickable"
                        onClick={() => setSelectedId(r.id)}
                      >
                        <td>
                          <strong style={{ color: "var(--davis-blue)" }}>
                            {r.name || "Untitled Report"}
                          </strong>
                        </td>
                        <td>{r.week_ending || r.range_label || "—"}</td>
                        <td>{r.incident_count ?? "—"}</td>
                        <td>{formatDate(r.created_at)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            className="btn ghost sm"
                            onClick={(e) => handleDelete(e, r)}
                            title="Delete report and all its incidents"
                            style={{ color: "var(--accent-red)" }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Split layout (wide screens, "split" view mode).
  return (
    <div>
      <div className="page-title">Generated Reports</div>
      <h1
        className="page-heading"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        Report History
        <span className="meta">· {reports.length} saved</span>
        <div style={{ marginLeft: "auto" }}>
          <ViewModeToggle viewMode={viewMode} setViewMode={setViewMode} />
        </div>
      </h1>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Search reports..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <div className="toolbar-spacer" />
        <button className="btn" onClick={onNewReport}>
          + New Weekly Report
        </button>
      </div>
      <div className="split-view">
        <div className="split-view-list">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              {reports.length === 0 ? "No reports yet" : "No matches"}
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                className={`report-list-item ${selectedId === r.id ? "active" : ""}`}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="report-list-item-title">
                  {r.name || "Untitled Report"}
                </div>
                <div className="report-list-item-meta">
                  <span>{r.week_ending || "—"}</span>
                  <span className="sep">·</span>
                  <span>{r.incident_count ?? 0} incidents</span>
                  <span className="sep">·</span>
                  <span>{formatDate(r.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="split-view-detail">
          {selected ? (
            <ReportDetail
              report={selected}
              drivers={drivers}
              onBack={() => setSelectedId(null)}
              onDeleted={async () => {
                await refresh();
                setSelectedId(null);
              }}
              onReportUpdated={refresh}
              hideBackButton
            />
          ) : (
            <div className="empty-state" style={{ padding: 60 }}>
              Select a report from the list to view details.
              <br />
              <br />
              Or{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onNewReport();
                }}
                style={{ color: "var(--davis-blue)" }}
              >
                create a new weekly report
              </a>
              .
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
