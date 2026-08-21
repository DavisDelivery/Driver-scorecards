import { useState, useEffect } from "react";
import {
  getIncidentsForReport,
  deleteIncidentsForReport,
  deleteReport,
  saveReport,
  getReportWithPdf,
  saveIncident,
  rollupReportToHistory,
  resyncReportRollup,
} from "../data/firebase.js";
import { fetchPhotosForProsBatch } from "../parsers/nuvizzClient.js";
import { generatePhotoReport, downloadPdf } from "../reports/pdfGenerator.js";
import { reportSpanLabel } from "../reports/reportNaming.js";
import IncidentTable from "./IncidentTable.jsx";
import IncidentEditor from "./IncidentEditor.jsx";

export default function ReportDetail({
  report,
  drivers,
  onBack,
  onDeleted,
  onReportUpdated,
  hideBackButton = false,
}) {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  // "add" opens IncidentEditor seeded with this report's id, so a completed
  // report can grow rows after the fact.
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(report?.name || "");
  const [renaming, setRenaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, pro: "" });

  useEffect(() => {
    setName(report?.name || "");
  }, [report?.id]);

  // quiet=true refreshes the data without flipping the loading state, so inline
  // edits (fault/driver/notes) don't flash the table away behind "Loading…".
  const load = async (quiet = false) => {
    if (!report?.id) return;
    if (!quiet) setLoading(true);
    const list = await getIncidentsForReport(report.id);
    setIncidents(list);
    if (!quiet) setLoading(false);
  };

  useEffect(() => {
    load();
  }, [report?.id]);

  if (!report)
    return (
      <div>
        <div className="empty-state">No report selected.</div>
      </div>
    );

  async function handleDelete() {
    if (
      !confirm(
        `Delete report "${report.name}" AND all ${incidents.length} of its incidents?\n\nThis cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteIncidentsForReport(report.id);
      // Reverse this report's contribution to history — deleting used to leave
      // its counts in Trends forever. Done before the report doc goes, so a
      // failure here still leaves the Re-sync button available.
      await rollupReportToHistory([], report.id);
      await deleteReport(report.id);
      onDeleted?.();
    } catch (err) {
      alert(
        `Delete did not complete: ${err.message}\n\nNothing is lost — re-open the report and try again.`,
      );
    } finally {
      setDeleting(false);
    }
  }

  // Manual recovery path: re-derive history totals, counts, bounds and the
  // PDF-stale flag from the report's CURRENT rows. The background resync after
  // each edit does the same thing; this button exists so a failure there (or a
  // rollup that failed during ingest) has a visible, honest retry.
  async function handleResync() {
    setResyncing(true);
    try {
      await resyncReportRollup(report.id);
      onReportUpdated?.();
      await load(true);
      alert("History totals re-synced from this report's current incidents.");
    } catch (err) {
      alert(`Re-sync failed: ${err.message}`);
    } finally {
      setResyncing(false);
    }
  }

  async function handleRename() {
    if (!name.trim()) {
      alert("Name cannot be empty");
      return;
    }
    await saveReport({ ...report, name: name.trim() });
    setRenaming(false);
    onReportUpdated?.();
  }

  // Blur/Enter commit: save when changed + non-blank; silently revert if blank.
  async function commitRename() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(report.name || "");
      setRenaming(false);
      return;
    }
    if (trimmed !== report.name) {
      await saveReport({ id: report.id, name: trimmed });
      onReportUpdated?.();
    }
    setRenaming(false);
  }

  async function downloadLastPdf() {
    const full = await getReportWithPdf(report.id);
    if (!full || !full.pdf_data) {
      alert(
        'No PDF stored yet for this report. Click "Generate PDF" to create one.',
      );
      return;
    }
    const a = document.createElement("a");
    a.href = full.pdf_data;
    a.download = `${(report.name || "report").replace(/[^a-z0-9-_ ]/gi, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function pullMissingPhotos() {
    const missing = incidents.filter(
      (i) => !i.has_photos && (!i.photo_urls || i.photo_urls.length === 0),
    );
    if (!missing.length) {
      alert("All incidents already have photos (or were already fetched).");
      return;
    }
    const pros = [...new Set(missing.map((i) => i.pro_number).filter(Boolean))];
    setPulling(true);
    setProgress({ done: 0, total: pros.length, pro: "" });
    try {
      const byPro = await fetchPhotosForProsBatch(pros, (p) => setProgress(p));
      let ok = 0;
      let none = 0;
      let lookup = 0;
      let failed = 0;
      for (const inc of missing) {
        const result = byPro[inc.pro_number];
        if (!result || result.error) {
          lookup++;
          continue;
        }
        const status = result.photoStatus || {};
        if (status.noPhotosAvailable) {
          none++;
          continue;
        }
        if (result.photos && result.photos.length > 0) {
          const urls = result.photos.map((p) => p.dataUri || p.url).filter(Boolean);
          await saveIncident({ ...inc, photo_urls: urls, photo_meta: result.photos });
          ok++;
        } else if (status.failed > 0) {
          failed++;
        }
      }
      await load();
      alert(
        [
          "Photo pull complete:",
          `  ✓ ${ok} incidents now have photos`,
          none > 0 &&
            `  ○ ${none} have no photos on NuVizz yet (driver hasn't uploaded)`,
          failed > 0 && `  ✗ ${failed} had fetch failures (retry again)`,
          lookup > 0 && `  ! ${lookup} PROs couldn't be looked up`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      alert("Photo fetch failed: " + err.message);
    }
    setPulling(false);
  }

  async function generatePdf() {
    if (!incidents.length) {
      alert("No incidents to include.");
      return;
    }
    setGenerating(true);
    try {
      // Photos are hydrated inside generatePhotoReport (one batched fetch from the
      // photos:{id} blobs), so here we only enrich driver name / notes and order.
      const nameFor = (id) => drivers.find((d) => d.id === id)?.name || "";
      const enriched = incidents.map((i) => ({
        ...i,
        driver_name: nameFor(i.driver_id) || i.driver_raw || "",
        your_note: i.your_note || i.notes || "",
      }));
      const order = [
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
      enriched.sort((a, b) => {
        const ai = order.indexOf(a.category);
        const bi = order.indexOf(b.category);
        return ai !== bi
          ? (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
          : (a.pro_number || "").localeCompare(b.pro_number || "");
      });
      const doc = await generatePhotoReport(enriched, {
        title: report.name,
        dateRange: report.range_label,
        onProgress: ({ done, total }) =>
          setProgress({ done, total, pro: "photos" }),
      });
      const dataUri = doc.output("datauristring");
      const filename = `${(report.name || "report").replace(/[^a-z0-9-_ ]/gi, "_")}.pdf`;
      downloadPdf(doc, filename);
      await saveReport({ id: report.id,
        pdf_data: dataUri,
        incident_count: incidents.length,
        // Regenerated from the current rows — the stored copy is fresh again.
        pdf_stale: false,
      });
      onReportUpdated?.();
    } catch (err) {
      alert("PDF generation failed: " + err.message);
    } finally {
      // Not in a finally before: a hung save stranded "Generating..." forever.
      setGenerating(false);
      setProgress({ done: 0, total: 0, pro: "" });
    }
  }

  const withPhotos = incidents.filter(
    (i) => i.has_photos || (i.photo_urls && i.photo_urls.length > 0),
  ).length;
  const driverFault = incidents.filter(
    (i) => i.fault === "driver" && !i.no_fault,
  ).length;
  const srcVol = { traces: 0, returns: 0, laters: 0 };
  for (const i of incidents) {
    for (const s of Array.isArray(i.sources) ? i.sources : []) {
      if (s in srcVol) srcVol[s] += 1;
    }
  }

  return (
    <div>
      {!hideBackButton && (
        <button
          className="btn ghost sm"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Back to Reports
        </button>
      )}
      <div className="page-title">Report Detail</div>
      <div className="page-heading">
        {renaming ? (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ fontSize: 20, fontWeight: 700, maxWidth: 400 }}
              autoFocus
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setName(report.name || "");
                  setRenaming(false);
                }
              }}
            />
            <button className="btn sm" onClick={handleRename} style={{ marginLeft: 8 }}>
              Save
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                setName(report.name);
                setRenaming(false);
              }}
              style={{ marginLeft: 4 }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {report.name}
            <button
              className="btn ghost sm"
              onClick={() => setRenaming(true)}
              title="Rename"
              style={{ marginLeft: 8 }}
            >
              ✎
            </button>
            <span className="meta">· {reportSpanLabel(report)}</span>
          </>
        )}
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Incidents</div>
          <div className="kpi-value">{incidents.length}</div>
        </div>
        <div className="kpi red">
          <div className="kpi-label">Driver Fault</div>
          <div className="kpi-value">{driverFault}</div>
        </div>
        <div className="kpi green">
          <div className="kpi-label">With Photos</div>
          <div className="kpi-value">{withPhotos}</div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginTop: 8 }}>
        <div className="kpi">
          <div className="kpi-label">Traces (Uline vol.)</div>
          <div className="kpi-value">{srcVol.traces}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Returns (Uline vol.)</div>
          <div className="kpi-value">{srcVol.returns}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Lates (Uline vol.)</div>
          <div className="kpi-value">{srcVol.laters}</div>
        </div>
      </div>
      <div className="meta" style={{ marginTop: 4 }}>
        Uline source volumes count each report a PRO came in on, so they can sum
        to more than total incidents.
      </div>

      <div className="toolbar">
        <button className="btn" onClick={generatePdf} disabled={generating}>
          {generating ? "Generating..." : "📄 Generate PDF"}
        </button>
        {report.pdf_data !== undefined && (
          <button
            className="btn secondary"
            onClick={downloadLastPdf}
            title={
              report.pdf_stale
                ? "The report changed after this PDF was generated — regenerate for a current copy"
                : "Download the stored PDF"
            }
          >
            ↓ Download Last PDF{report.pdf_stale ? " (out of date)" : ""}
          </button>
        )}
        <button className="btn secondary" onClick={pullMissingPhotos} disabled={pulling}>
          {pulling
            ? `Fetching ${progress.done}/${progress.total}...`
            : `📸 Pull Missing Photos (${incidents.length - withPhotos})`}
        </button>
        <button
          className="btn secondary"
          onClick={() => setAdding(true)}
          title="Add an incident to this report — it counts in the report's totals and history like any ingested row"
        >
          ＋ Add Incident
        </button>
        <button
          className="btn secondary"
          onClick={handleResync}
          disabled={resyncing}
          title="Re-derive history totals, counts and date range from this report's current incidents"
        >
          {resyncing ? "Re-syncing..." : "↻ Re-sync totals"}
        </button>
        <div className="toolbar-spacer" />
        <button className="btn danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting..." : "Delete Report"}
        </button>
      </div>

      <div className="section-divider">Incidents</div>
      {loading ? (
        <div className="empty-state">Loading incidents...</div>
      ) : (
        <IncidentTable
          incidents={incidents}
          drivers={drivers}
          onUpdate={() => load(true)}
          groupBy="category"
          showBulkActions
          showFilters
        />
      )}
      {adding && (
        <IncidentEditor
          incident={{
            report_id: report.id,
            week_ending: report.week_ending || "",
            category: "damage",
            fault: "driver",
            sources: [],
          }}
          drivers={drivers}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            // A new row changes the report's totals and possibly its date range.
            try {
              await resyncReportRollup(report.id);
            } catch (err) {
              alert(`The incident saved, but totals could not be re-synced: ${err.message}`);
            }
            onReportUpdated?.();
            load(true);
          }}
        />
      )}
    </div>
  );
}
