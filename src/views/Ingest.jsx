import React, { useState, useRef } from "react";
import { saveReport, saveIncidentsBatch, rollupReportToHistory } from "../data/firebase.js";
import { parseExcelFiles, buildIncidents, dedupeIncidents, resolveDriverId } from "../parsers/excelParser.js";
import { fetchPhotosForProsBatch } from "../parsers/nuvizzClient.js";

/** Return the coming Friday (or today if today is Friday) in YYYY-MM-DD. */
function nextFriday() {
  const now = new Date();
  const daysUntilFriday = (5 - now.getDay() + 7) % 7;
  now.setDate(now.getDate() + daysUntilFriday);
  return now.toISOString().slice(0, 10);
}

/** Format a YYYY-MM-DD string as "Week of MMM D, YYYY". */
function formatWeekLabel(dateStr) {
  const d = new Date(dateStr);
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = d.getDate();
  const year = d.getFullYear();
  return `Week of ${month} ${day}, ${year}`;
}

export default function Ingest({ drivers, onReportCreated, onNavigateToReport }) {
  const [weekEnding, setWeekEnding] = useState(nextFriday());
  const [reportName, setReportName] = useState("");
  const [parsedFiles, setParsedFiles] = useState(null);   // array of file metadata
  const [isParsing, setIsParsing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAddDragOver, setIsAddDragOver] = useState(false);

  // Primary drop zone ref
  const fileInputRef = useRef(null);
  // "Add more files" drop zone ref (in preview)
  const addFileInputRef = useRef(null);

  // Current incident list (after parse + merge)
  const [pendingReport, setPendingReport] = useState(null);
  const [incidents, setIncidents] = useState([]);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });

  // NuVizz enrichment state
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, pro: "" });
  const [enrichSummary, setEnrichSummary] = useState(null);

  // ---------------------------------------------------------------------------
  // File drop / input handler
  // ---------------------------------------------------------------------------

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) =>
      /\.(xlsx|xls|csv)$/i.test(f.name),
    );
    if (!files.length) {
      alert("Drop .xlsx, .xls, or .csv files.");
      return;
    }

    setIsParsing(true);
    try {
      const parsed = await parseExcelFiles(files);
      const built = buildIncidents(parsed, weekEnding);
      const rawRowCount = built._rawRowCount || built.length;

      // Resolve driver IDs from driver_raw
      for (const inc of built) {
        if (inc.driver_raw) {
          inc.driver_id = resolveDriverId(inc.driver_raw, drivers);
          inc.driver_name = inc.driver_id
            ? drivers.find((d) => d.id === inc.driver_id)?.name
            : inc.driver_raw;
        }
      }

      let finalIncidents, finalRawCount, finalDupes;

      if (incidents && incidents.length > 0) {
        // Merge with existing incidents
        const merged = [...incidents, ...built];
        const { incidents: deduped, duplicatesRemoved } = dedupeIncidents(merged);
        finalIncidents = deduped;
        finalRawCount = ((pendingReport?.raw_row_count) || incidents.length) + rawRowCount;
        finalDupes = finalRawCount - finalIncidents.length;
      } else {
        finalIncidents = built;
        finalRawCount = rawRowCount;
        finalDupes = built._duplicatesRemoved || 0;
      }

      const name =
        pendingReport?.name ||
        reportName.trim() ||
        formatWeekLabel(weekEnding);

      const report = {
        ...(pendingReport || {}),
        name,
        range_label: `Week ending ${weekEnding}`,
        week_ending: weekEnding,
        scope: "week",
        incident_count: finalIncidents.length,
        raw_row_count: finalRawCount,
        duplicates_removed: finalDupes,
      };

      const newFiles = [...(parsedFiles || []), ...parsed.files];

      setPendingReport(report);
      setIncidents(finalIncidents);
      setParsedFiles(newFiles);
    } catch (err) {
      alert(`Parse failed: ${err.message}`);
    }
    setIsParsing(false);
  }

  // ---------------------------------------------------------------------------
  // Save report
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!pendingReport || !incidents.length) return;

    setIsSaving(true);
    setSaveProgress({ done: 0, total: incidents.length });

    try {
      const report = await saveReport({ ...pendingReport, incident_count: incidents.length });
      const tagged = incidents.map((inc) => ({ ...inc, report_id: report.id }));

      await saveIncidentsBatch(tagged, (progress) => setSaveProgress(progress));

      try {
        await rollupReportToHistory(tagged, report.id);
      } catch (err) {
        console.warn("rollup to history failed (non-fatal):", err);
      }

      onReportCreated?.(report.id);
      alert(`Saved "${report.name}" with ${incidents.length} incidents.`);
      if (onNavigateToReport) onNavigateToReport(report.id);

      // Reset state
      setPendingReport(null);
      setIncidents([]);
      setParsedFiles(null);
      setReportName("");
      setEnrichSummary(null);
    } catch (err) {
      alert("Save failed: " + err.message);
    }

    setIsSaving(false);
    setSaveProgress({ done: 0, total: 0 });
  }

  // ---------------------------------------------------------------------------
  // NuVizz enrichment
  // ---------------------------------------------------------------------------

  async function handleEnrich() {
    const pros = [...new Set(incidents.map((inc) => inc.pro_number).filter(Boolean))];
    if (!pros.length) return;

    setIsEnriching(true);
    setEnrichProgress({ done: 0, total: pros.length, pro: "" });

    const results = await fetchPhotosForProsBatch(pros, (p) =>
      setEnrichProgress(p),
    );

    let driversFound = 0;
    let photosFound = 0;
    let errors = 0;
    let nuvizzNoPhotos = 0;
    let fetchFailures = 0;

    for (const pro of pros) {
      const r = results[pro];
      if (!r || r.error) {
        errors++;
        continue;
      }
      if (r.stop?.driverName) driversFound++;
      if (r.photos) photosFound += r.photos.length;
      const ps = r.photoStatus || {};
      if (ps.noPhotosAvailable) nuvizzNoPhotos++;
      if (ps.failed > 0) fetchFailures++;
    }

    const enriched = incidents.map((inc) => {
      const r = results[inc.pro_number];
      if (!r || !r.stop) return inc;

      const rawName = r.stop.driverName || "";
      const driverId = rawName ? resolveDriverId(rawName, drivers) : inc.driver_id;

      return {
        ...inc,
        driver_raw: rawName || inc.driver_raw,
        driver_id: driverId,
        driver_name:
          (driverId && drivers.find((d) => d.id === driverId)?.name) ||
          rawName,
        nuvizz_driver_id: r.stop.driverId,
        nuvizz_load_nbr: r.stop.loadNbr,
        nuvizz_vehicle: r.stop.vehicleNbr,
        customer: r.stop.to?.name || inc.customer,
        to_city: r.stop.to?.city,
        to_state: r.stop.to?.state,
        actual_delivery:
          r.stop.to?.arrivalDTTM?.slice(0, 10) || inc.actual_delivery,
        photo_urls: (r.photos || [])
          .map((p) => p.dataUri || p.url)
          .filter(Boolean),
        photo_meta: r.photos || [],
      };
    });

    setIncidents(enriched);
    setEnrichSummary({
      total: pros.length,
      driversFound,
      photosFound,
      errors,
      nuvizzNoPhotos,
      fetchFailures,
    });
    setIsEnriching(false);
  }

  // ---------------------------------------------------------------------------
  // Discard
  // ---------------------------------------------------------------------------

  function handleDiscard() {
    if (confirm("Discard this parsed data? Nothing has been saved yet.")) {
      setPendingReport(null);
      setIncidents([]);
      setParsedFiles(null);
      setEnrichSummary(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Preview view (after files have been parsed)
  // ---------------------------------------------------------------------------

  if (pendingReport) {
    const categoryCounts = {};
    for (const inc of incidents) {
      categoryCounts[inc.category] = (categoryCounts[inc.category] || 0) + 1;
    }

    return (
      <div>
        <div className="page-title">New Weekly Report · Preview</div>
        <h1 className="page-heading">
          {pendingReport.name}
          <span className="meta">· {incidents.length} incidents parsed</span>
        </h1>

        {pendingReport.duplicates_removed > 0 && (
          <div className="note-block" style={{ marginBottom: 16 }}>
            <strong>Consolidated:</strong>{" "}
            {pendingReport.raw_row_count} raw rows from Uline →{" "}
            {incidents.length} unique incidents{" "}
            ({pendingReport.duplicates_removed} duplicates merged). Rows for the
            same PRO were combined — items are now listed together.
          </div>
        )}

        <div className="kpi-grid">
          {Object.entries(categoryCounts).map(([cat, count]) => (
            <div className="kpi" key={cat}>
              <div className="kpi-label">{cat}</div>
              <div className="kpi-value">{count}</div>
            </div>
          ))}
        </div>

        {parsedFiles && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">Files Parsed ({parsedFiles.length})</div>
              <button
                className="btn ghost sm"
                onClick={() => addFileInputRef.current?.click()}
                disabled={isParsing}
                title="Add another xlsx file to this report"
              >
                {isParsing ? "Parsing..." : "+ Add More Files"}
              </button>
            </div>
            <div className="card-body">
              {parsedFiles.map((f, idx) => (
                <div
                  key={idx}
                  style={{ fontFamily: "var(--mono)", fontSize: 12, marginBottom: 4 }}
                >
                  <span
                    style={{
                      color:
                        f.type === "unknown"
                          ? "var(--accent-red)"
                          : "var(--accent-green)",
                    }}
                  >
                    {f.type === "unknown" ? "✗" : "✓"}
                  </span>{" "}
                  <strong>{f.name}</strong> →{" "}
                  <span style={{ color: "var(--text-1)" }}>
                    {f.type.toUpperCase()} ({f.rows} rows)
                  </span>
                </div>
              ))}

              <div
                className={`dropzone ${isAddDragOver ? "drag" : ""}`}
                style={{ marginTop: 14, padding: "18px 16px", borderStyle: "dashed" }}
                onClick={() => addFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsAddDragOver(true);
                }}
                onDragLeave={() => setIsAddDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsAddDragOver(false);
                  handleFiles(e.dataTransfer.files);
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-1)",
                  }}
                >
                  + Drop More Files Here
                </div>
                <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
                  Adds to this same weekly report · same-PRO items auto-merge
                </div>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv"
                  ref={addFileInputRef}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">Enrich with NuVizz</div>
          </div>
          <div className="card-body">
            <p style={{ marginBottom: 12, color: "var(--text-1)" }}>
              Pulls driver names, customer info, and delivery photos from NuVizz
              for each PRO. This takes ~1 minute per 30 incidents.
            </p>
            <button className="btn" onClick={handleEnrich} disabled={isEnriching}>
              {isEnriching
                ? `Enriching ${enrichProgress.done}/${enrichProgress.total} (${enrichProgress.pro})...`
                : "⬇ Enrich from NuVizz"}
            </button>
            {enrichSummary && (
              <div className="note-block your-note" style={{ marginTop: 12 }}>
                <strong>Enrichment complete:</strong>{" "}
                {enrichSummary.driversFound}/{enrichSummary.total} drivers found,{" "}
                {enrichSummary.photosFound} photos attached
                {enrichSummary.errors > 0 && `, ${enrichSummary.errors} errors`}
              </div>
            )}
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 20 }}>
          <button className="btn" onClick={handleSave} disabled={isSaving}>
            {isSaving
              ? saveProgress.total > 0
                ? `Saving ${saveProgress.done}/${saveProgress.total}...`
                : "Saving..."
              : `💾 Save Report (${incidents.length} incidents)`}
          </button>
          <button className="btn ghost" onClick={handleDiscard}>
            Discard
          </button>
          <div className="toolbar-spacer" />
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-2)",
            }}
          >
            After saving, you can review/edit incidents on the report's detail page.
          </div>
        </div>

        <div className="section-divider">Preview</div>

        <div className="card">
          <div className="card-body tight">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>PRO#</th>
                    <th>Cat</th>
                    <th>Driver</th>
                    <th>Reason</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...incidents]
                    .sort(
                      (a, b) =>
                        (a.category || "").localeCompare(b.category || "") ||
                        (a.pro_number || "").localeCompare(b.pro_number || ""),
                    )
                    .map((inc, idx) => (
                      <tr key={idx}>
                        <td className="pro-num">{inc.pro_number}</td>
                        <td>
                          <span className={`chip ${inc.category}`}>
                            {inc.category}
                          </span>
                        </td>
                        <td>{inc.driver_name || inc.driver_raw || "—"}</td>
                        <td
                          style={{
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span title={inc.reason}>{inc.reason}</span>
                        </td>
                        <td
                          style={{
                            maxWidth: 280,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span title={inc.notes}>{inc.notes}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Initial / empty state view
  // ---------------------------------------------------------------------------

  return (
    <div className="form-constrained">
      <div className="page-title">New Weekly Report</div>
      <h1 className="page-heading">Start a New Report</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Report Details</div>
        </div>
        <div className="card-body">
          <div className="field-row">
            <label className="field">
              <span>Week Ending (Friday)</span>
              <input
                type="date"
                value={weekEnding}
                onChange={(e) => setWeekEnding(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Report Name (optional — auto-generated if blank)</span>
              <input
                type="text"
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder={formatWeekLabel(weekEnding)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Upload Weekly Files</div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--text-2)",
            }}
          >
            Laters · Returns · Traces · drop all 3 at once
          </div>
        </div>
        <div className="card-body">
          <div
            className={`dropzone ${isDragOver ? "drag" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="dropzone-title">↑ Drop Excel Files Here</div>
            <div className="dropzone-sub">.xlsx, .xls, or .csv · Click to browse</div>
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,.csv"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {isParsing && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              Parsing...
            </div>
          )}

          <div className="note-block" style={{ marginTop: 16 }}>
            <strong style={{ color: "var(--text-0)" }}>How this works:</strong>{" "}
            You drop the 3 weekly files. The parser detects each file by its
            headers (Laters / Returns / Traces), extracts all incidents, and
            presents a preview. You can then enrich with NuVizz (driver names +
            photos) and save the whole week as one named report. Everything syncs
            to the cloud.
          </div>
        </div>
      </div>
    </div>
  );
}
