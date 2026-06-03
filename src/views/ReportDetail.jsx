import { useState, useEffect } from "react";
import {
  getIncidentsForReport,
  deleteIncidentsForReport,
  deleteReport,
  saveReport,
  getReportWithPdf,
  getIncidentPhotosBatch,
  saveIncident,
} from "../data/firebase.js";
import { fetchPhotosForProsBatch } from "../parsers/nuvizzClient.js";
import { generatePhotoReport, downloadPdf } from "../reports/pdfGenerator.js";
import { reportSpanLabel } from "../reports/reportNaming.js";
import IncidentTable from "./IncidentTable.jsx";

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
      confirm(
        `Delete report "${report.name}" AND all ${incidents.length} of its incidents?\n\nThis cannot be undone.`,
      )
    ) {
      await deleteIncidentsForReport(report.id);
      await deleteReport(report.id);
      onDeleted?.();
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
      await saveReport({ ...report, name: trimmed });
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
      const withPhotoIds = incidents
        .filter((i) => i.has_photos || (i.photo_urls && i.photo_urls.length > 0))
        .map((i) => i.id);
      const photoMap =
        withPhotoIds.length > 0
          ? await getIncidentPhotosBatch(withPhotoIds, ({ done, total }) =>
              setProgress({ done, total, pro: "photos" }),
            )
          : new Map();
      const nameFor = (id) => drivers.find((d) => d.id === id)?.name || "";
      const enriched = incidents.map((i) => {
        const photos = photoMap.get(i.id);
        return {
          ...i,
          driver_name: nameFor(i.driver_id) || i.driver_raw || "",
          your_note: i.your_note || i.notes || "",
          photo_urls: photos?.photo_urls || i.photo_urls || [],
          photo_meta: photos?.photo_meta || i.photo_meta || [],
        };
      });
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
      });
      const dataUri = doc.output("datauristring");
      const filename = `${(report.name || "report").replace(/[^a-z0-9-_ ]/gi, "_")}.pdf`;
      downloadPdf(doc, filename);
      await saveReport({
        ...report,
        pdf_data: dataUri,
        incident_count: incidents.length,
      });
      onReportUpdated?.();
    } catch (err) {
      alert("PDF generation failed: " + err.message);
    }
    setGenerating(false);
    setProgress({ done: 0, total: 0, pro: "" });
  }

  const withPhotos = incidents.filter(
    (i) => i.has_photos || (i.photo_urls && i.photo_urls.length > 0),
  ).length;
  const driverFault = incidents.filter((i) => i.fault === "driver").length;

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

      <div className="toolbar">
        <button className="btn" onClick={generatePdf} disabled={generating}>
          {generating ? "Generating..." : "📄 Generate PDF"}
        </button>
        {report.pdf_data !== undefined && (
          <button className="btn secondary" onClick={downloadLastPdf}>
            ↓ Download Last PDF
          </button>
        )}
        <button className="btn secondary" onClick={pullMissingPhotos} disabled={pulling}>
          {pulling
            ? `Fetching ${progress.done}/${progress.total}...`
            : `📸 Pull Missing Photos (${incidents.length - withPhotos})`}
        </button>
        <div className="toolbar-spacer" />
        <button className="btn danger" onClick={handleDelete}>
          Delete Report
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
    </div>
  );
}
