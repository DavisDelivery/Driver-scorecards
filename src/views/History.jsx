import React, { useState, useRef } from "react";
import { INCIDENT_CATEGORIES } from "../data/drivers.js";
import { saveHistoryBatch, deleteAllHistory } from "../data/firebase.js";
import {
  parseHistoryFiles,
  matchHistoricalDriver,
} from "../parsers/historyParser.js";

export default function History({ drivers, onReportCreated }) {
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Parsed rows from the uploaded workbooks
  const [rows, setRows] = useState([]);
  // Per-file summaries for the "Files Parsed" card
  const [fileSummaries, setFileSummaries] = useState([]);
  // Map of driver_raw → { driver_id, driver_name, matched, auto }
  const [matchMap, setMatchMap] = useState({});
  // Save-in-progress
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // Last-save result
  const [lastResult, setLastResult] = useState(null);

  // ---- file handling -------------------------------------------------------

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) =>
      /\.xlsx?$/i.test(f.name),
    );
    if (!files.length) {
      alert("Drop .xlsx files (historical driver performance).");
      return;
    }
    setParsing(true);
    try {
      const { rows: parsedRows, uniqueDrivers, fileSummaries: summaries } =
        await parseHistoryFiles(files);
      setRows(parsedRows);
      setFileSummaries(summaries);

      // Auto-match each unique driver name against the roster
      const map = {};
      for (const rawName of uniqueDrivers) {
        const found = matchHistoricalDriver(rawName, drivers);
        map[rawName] = found
          ? { driver_id: found.id, driver_name: found.name, matched: true, auto: true }
          : { driver_id: null, driver_name: null, matched: false, auto: false };
      }
      setMatchMap(map);
    } catch (err) {
      alert(`Parse failed: ${err.message}`);
    }
    setParsing(false);
  }

  // ---- derived state -------------------------------------------------------

  const totalUnique = Object.keys(matchMap).length;
  const totalMatched = Object.values(matchMap).filter((m) => m.matched).length;
  const totalUnmatched = totalUnique - totalMatched;

  // Accumulate counts by year and category for preview cards
  const byYear = {};
  const byCategory = {};
  for (const r of rows) {
    byYear[r.year] = (byYear[r.year] || 0) + r.count;
    byCategory[r.category] = (byCategory[r.category] || 0) + r.count;
  }

  // Rows that have a matched driver (will actually be saved)
  const matchedRows = rows.filter((r) => {
    const m = matchMap[r.driver_raw];
    return m && m.driver_id;
  });
  const skippedCount = rows.length - matchedRows.length;

  // ---- manual match override -----------------------------------------------

  function handleManualMatch(rawName, driverId) {
    const driver = drivers.find((d) => d.id === driverId);
    setMatchMap((prev) => ({
      ...prev,
      [rawName]: driverId
        ? {
            driver_id: driverId,
            driver_name: driver?.name || "",
            matched: true,
            auto: false,
          }
        : { driver_id: null, driver_name: null, matched: false, auto: false },
    }));
  }

  // ---- save ----------------------------------------------------------------

  async function handleSave() {
    if (!matchedRows.length) {
      alert("Nothing to save — all rows are unmatched.");
      return;
    }
    if (
      !confirm(`Import ${matchedRows.length} monthly rollup records into History?

This OVERWRITES any existing rollup record for the same (driver × year × month × category).`)
    )
      return;

    setSaving(true);
    setProgress({ done: 0, total: matchedRows.length });
    try {
      const records = matchedRows.map((r) => {
        const m = matchMap[r.driver_raw];
        return {
          driver_id: m.driver_id,
          driver_name: m.driver_name,
          driver_raw: r.driver_raw,
          year: r.year,
          month: r.month,
          category: r.category,
          count: r.count,
          source: "backfill",
        };
      });
      const saved = await saveHistoryBatch(records, {
        replace: true,
        onProgress: (p) => setProgress(p),
      });
      setProgress({ done: saved.length, total: matchedRows.length });
      setLastResult({ saved: saved.length, skipped: skippedCount });
      alert(
        `Backfill complete:\n  ✓ ${saved.length} rollup records saved\n  ○ ${skippedCount} rows skipped (unmatched drivers)`,
      );
      setRows([]);
      setFileSummaries([]);
      setMatchMap({});
    } catch (err) {
      alert("Save failed: " + err.message);
    }
    setSaving(false);
  }

  // ---- delete all ----------------------------------------------------------

  async function handleDeleteAll() {
    if (
      !confirm(
        "Delete ALL historical rollup records? This cannot be undone.",
      ) ||
      !confirm(
        "Are you absolutely sure? All years of historical data will be lost.",
      )
    )
      return;
    const result = await deleteAllHistory();
    alert(`Deleted ${result.deleted} records.`);
  }

  // ---- render: preview state -----------------------------------------------

  if (rows.length > 0) {
    return (
      <div>
        <div className="page-title">Import History · Preview</div>
        <h1 className="page-heading">
          Review before saving
          <span className="meta">· {rows.length} monthly rollup records</span>
        </h1>

        {/* KPI row */}
        <div className="kpi-grid" style={{ marginBottom: 20 }}>
          <div className="kpi">
            <div className="kpi-label">total rows</div>
            <div className="kpi-value">{rows.length}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">drivers matched</div>
            <div className="kpi-value">
              {totalMatched}/{totalUnique}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">rows to save</div>
            <div
              className="kpi-value"
              style={{ color: "var(--accent-green)" }}
            >
              {matchedRows.length}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">rows skipped</div>
            <div
              className="kpi-value"
              style={{
                color:
                  totalUnmatched > 0
                    ? "var(--accent-red)"
                    : "var(--text-1)",
              }}
            >
              {skippedCount}
            </div>
          </div>
        </div>

        {/* By Year */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">By Year</div>
          </div>
          <div className="card-body">
            {Object.entries(byYear)
              .sort()
              .map(([year, count]) => (
                <div
                  key={year}
                  style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                >
                  <strong>{year}</strong>: {count} incidents
                </div>
              ))}
          </div>
        </div>

        {/* By Category */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">By Category (across all years)</div>
          </div>
          <div className="card-body">
            {Object.entries(byCategory)
              .sort()
              .map(([catId, count]) => {
                const cat = INCIDENT_CATEGORIES.find((c) => c.id === catId);
                return (
                  <div
                    key={catId}
                    style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                  >
                    <strong style={{ color: cat?.color }}>
                      {cat?.label || catId}
                    </strong>
                    : {count} incidents
                  </div>
                );
              })}
          </div>
        </div>

        {/* Files Parsed */}
        {fileSummaries.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">
                Files Parsed ({fileSummaries.length})
              </div>
            </div>
            <div className="card-body">
              {fileSummaries.map((f, fi) => (
                <div key={fi} style={{ marginBottom: 10 }}>
                  <div
                    style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                  >
                    <strong>{f.name}</strong> — {f.rows} rows
                  </div>
                  <div
                    style={{
                      marginLeft: 16,
                      fontSize: 11,
                      color: "var(--text-2)",
                    }}
                  >
                    {f.sheets.map((sh, si) => (
                      <div key={si}>
                        <span
                          style={{
                            color: sh.skipped
                              ? "var(--accent-red)"
                              : "var(--accent-green)",
                          }}
                        >
                          {sh.skipped ? "✗" : "✓"}
                        </span>{" "}
                        {sh.name} → {sh.category || "unknown"}{" "}
                        {sh.year ? `(${sh.year})` : ""} · {sh.rows} rows
                        {sh.skipped && (
                          <span style={{ color: "var(--accent-red)" }}>
                            {" "}
                            · {sh.skipped}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Driver Name Reconciliation */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">Driver Name Reconciliation</div>
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>
              {totalUnmatched > 0
                ? `${totalUnmatched} unmatched name(s) need your attention`
                : "All names matched ✓"}
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Historical name</th>
                  <th>Match in roster</th>
                  <th>Rows</th>
                  <th>Match type</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(matchMap)
                  .sort()
                  .map((rawName) => {
                    const m = matchMap[rawName];
                    const rowCount = rows.filter(
                      (r) => r.driver_raw === rawName,
                    ).length;
                    return (
                      <tr
                        key={rawName}
                        style={{
                          background: m.matched
                            ? undefined
                            : "rgba(220,53,69,0.06)",
                        }}
                      >
                        <td style={{ fontFamily: "var(--mono)" }}>
                          {rawName}
                        </td>
                        <td>
                          <select
                            value={m.driver_id || ""}
                            onChange={(e) =>
                              handleManualMatch(
                                rawName,
                                e.target.value || null,
                              )
                            }
                            style={{ width: "100%", maxWidth: 300 }}
                          >
                            <option value="">— skip (don't import) —</option>
                            {drivers.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} ({d.role})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{rowCount}</td>
                        <td style={{ fontSize: 11, color: "var(--text-2)" }}>
                          {m.matched ? (
                            m.auto ? (
                              "auto-matched"
                            ) : (
                              "manual"
                            )
                          ) : (
                            <span style={{ color: "var(--accent-red)" }}>
                              unmatched
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            className="btn"
            onClick={handleSave}
            disabled={saving || matchedRows.length === 0}
            style={{ flex: "0 0 auto" }}
          >
            {saving
              ? `Saving ${progress.done}/${progress.total}...`
              : `💾 Import ${matchedRows.length} records`}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setRows([]);
              setFileSummaries([]);
              setMatchMap({});
            }}
            disabled={saving}
          >
            Discard
          </button>
        </div>
      </div>
    );
  }

  // ---- render: upload state ------------------------------------------------

  return (
    <div>
      <div className="page-title">Import History</div>
      <h1 className="page-heading">Backfill Historical Driver Performance</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="card-body"
          style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-1)" }}
        >
          <p style={{ marginTop: 0 }}>
            Upload the yearly <code>DRIVER_PERFORMANCE.xlsx</code> files to
            backfill monthly incident counts per driver. The app will parse each
            category sheet (DAMAGES, FORGOTTEN FREIGHT, LOST, MISDELIVERED,
            ATTEMPTS) into{" "}
            <strong>monthly rollup records</strong> that the Trends page uses.
          </p>
          <p>
            <strong>What gets imported:</strong> one record per{" "}
            <em>driver × year × month × category</em> combination, matching the
            structure of the original spreadsheets.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Going forward:</strong> weekly reports auto-roll up into
            this same structure, so this backfill only needs to happen once.
          </p>
        </div>
      </div>

      <div
        className={`dropzone ${dragging ? "drag" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-1)",
          }}
        >
          {parsing
            ? "Parsing..."
            : "Drop DRIVER_PERFORMANCE.xlsx files here"}
        </div>
        <div
          style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8 }}
        >
          or click to browse · accepts 2024, 2025, 2026 files
        </div>
        <input
          type="file"
          multiple
          accept=".xlsx,.xls"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Danger zone */}
      <div
        style={{
          marginTop: 40,
          padding: 16,
          background: "var(--bg-2)",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--accent-red)",
            marginBottom: 8,
          }}
        >
          Danger zone
        </div>
        <button
          className="btn ghost"
          onClick={handleDeleteAll}
          style={{ fontSize: 12 }}
        >
          ⚠ Delete all historical rollup data
        </button>
      </div>
    </div>
  );
}
