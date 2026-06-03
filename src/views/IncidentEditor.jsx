import { useState, useEffect } from "react";
import { getIncidentPhotos, saveIncident } from "../data/firebase.js";
import { FAULT_CODES, INCIDENT_CATEGORIES } from "../data/drivers.js";

// ---------------------------------------------------------------------------
// fetchStopData — calls the Netlify proxy to retrieve stop data + POD photos
// for a given PRO number. Inlined here because no separate nuvizz module
// exists in the reconstructed source tree.
// ---------------------------------------------------------------------------
const TRACK_URL = "/.netlify/functions/track";
const DOC_URL = "/.netlify/functions/doc";

async function fetchDocumentDataUri(guid, ext, company, retries = 2) {
  const companies =
    company === "DAVIS" ? ["DAVIS", "ULINE"] : ["ULINE", "DAVIS"];
  for (const co of companies) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(
          `${DOC_URL}?guid=${encodeURIComponent(guid)}&ext=${encodeURIComponent(
            ext
          )}&company=${encodeURIComponent(co)}`,
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (res.status === 404) break;
        if (!res.ok) {
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          break;
        }
        const data = await res.json();
        if (data.dataUri) return data.dataUri;
        break;
      } catch {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
      }
    }
  }
  return null;
}

async function fetchStopData(proNumber, { company = "ULINE" } = {}) {
  if (!proNumber) return { photos: [], error: "No PRO provided" };
  try {
    let data = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const res = await fetch(
          `${TRACK_URL}?pro=${encodeURIComponent(
            proNumber
          )}&company=${encodeURIComponent(company)}`,
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (!res.ok) {
          lastError = `track ${res.status}`;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 700));
            continue;
          }
          return { photos: [], stop: null, exe: null, error: lastError };
        }
        data = await res.json();
        if (data.error) {
          lastError = data.error;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 700));
            continue;
          }
          return { photos: [], stop: null, exe: null, error: lastError };
        }
        break;
      } catch (err) {
        lastError = err.message || "fetch failed";
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        return { photos: [], stop: null, error: lastError };
      }
    }

    const stopInfo = data.stop || {};
    const exeInfo = data.exe || {};
    const loadInfo = data.load || {};

    const allDocs = [];
    for (const side of ["from", "to"]) {
      for (const doc of (exeInfo[side]?.podDoc) || []) {
        allDocs.push({
          side: side === "from" ? "pickup" : "delivery",
          guid: doc.documentGuid,
          name: doc.documentName,
          extension: doc.extension,
          createdTime: doc.createdTime,
        });
      }
    }

    const imageDocs = allDocs.filter(
      (d) => !d.extension || /jpg|jpeg|png|gif|webp|bmp/i.test(d.extension)
    );
    const retrieved = [];
    const failed = [];
    const BATCH = 3;
    for (let i = 0; i < imageDocs.length; i += BATCH) {
      const batch = imageDocs.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (doc) => ({
          doc,
          dataUri: await fetchDocumentDataUri(
            doc.guid,
            doc.extension || "jpg",
            company
          ),
        }))
      );
      for (const { doc, dataUri } of results) {
        if (dataUri) retrieved.push({ ...doc, dataUri, url: dataUri });
        else failed.push(doc);
      }
    }

    const stop = {
      stopNbr: stopInfo.stopNbr,
      proNumber,
      driverName: loadInfo.driverName || null,
      driverId: loadInfo.driverId || null,
      driverEmail: loadInfo.driverEmail || null,
      vehicleNbr: loadInfo.vehicleNbr || null,
      loadNbr: loadInfo.loadNbr || null,
      routeName: loadInfo.routeName || null,
      stopStatus: exeInfo.stopStatus || null,
      exceptions: (exeInfo.exceptions || []).map((ex) => ({
        code: ex.exceptionCode,
        desc: ex.exceptionDesc,
        comment: ex.exceptionComment,
        addedBy: ex.addedByName,
        addedOn: ex.addedOn,
      })),
      exceptionPresent: !!exeInfo.exceptionPresent,
      to: {
        name:
          stopInfo.to?.address?.name || stopInfo.to?.address?.addrName,
        city: stopInfo.to?.address?.city,
        state: stopInfo.to?.address?.state,
        zip: stopInfo.to?.address?.zip,
        etaDttm: exeInfo.to?.etaDttm,
        arrivalDTTM: exeInfo.to?.arrivalDTTM,
        departureDTTM: exeInfo.to?.departureDTTM,
        confirmedDTTM: exeInfo.to?.confirmedDTTM,
        plannedEtaDTTM: exeInfo.to?.plannedEtaDTTM,
      },
      from: {
        name:
          stopInfo.from?.address?.name || stopInfo.from?.address?.addrName,
        city: stopInfo.from?.address?.city,
        etaDttm: exeInfo.from?.etaDttm,
        plannedEtaDTTM: exeInfo.from?.plannedEtaDTTM,
      },
    };

    return {
      photos: retrieved,
      stop,
      exe: exeInfo,
      error: null,
      photoStatus: {
        expected: imageDocs.length,
        retrieved: retrieved.length,
        failed: failed.length,
        noPhotosAvailable: imageDocs.length === 0,
      },
    };
  } catch (err) {
    return { photos: [], stop: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// IncidentEditor — modal for viewing / editing a single incident record.
//
// Props:
//   incident  — the incident object (light record; photos loaded lazily)
//   drivers   — full drivers array for the reassignment <select>
//   onClose   — called when the modal should be dismissed (no save)
//   onSaved   — called with the saved incident after a successful save
// ---------------------------------------------------------------------------
export default function IncidentEditor({ incident, drivers, onClose, onSaved }) {
  const [local, setLocal] = useState(incident);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  useEffect(() => {
    setLocal(incident);
    let cancelled = false;
    (async () => {
      if (
        !incident ||
        (Array.isArray(incident.photo_urls) && incident.photo_urls.length > 0)
      )
        return;
      if (!incident.has_photos && !incident.photo_count) return;
      setLoadingPhotos(true);
      try {
        const { photo_urls, photo_meta } = await getIncidentPhotos(
          incident.id
        );
        if (!cancelled)
          setLocal((prev) => ({ ...prev, photo_urls, photo_meta }));
      } finally {
        if (!cancelled) setLoadingPhotos(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [incident]);

  if (!incident) return null;

  const patch = (updates) => setLocal((prev) => ({ ...prev, ...updates }));

  async function handleSave() {
    setSaving(true);
    try {
      const driver = drivers.find((d) => d.id === local.driver_id);
      const saved = await saveIncident({
        ...local,
        driver_name: driver?.name || local.driver_raw || "",
      });
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      alert("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRefetch() {
    if (!local.pro_number) {
      alert("No PRO# on this incident.");
      return;
    }
    setFetching(true);
    setFetchMsg("Fetching from NuVizz...");
    try {
      const result = await fetchStopData(local.pro_number);
      if (result.error) {
        setFetchMsg(`Failed: ${result.error}`);
        setFetching(false);
        return;
      }
      const urls = (result.photos || [])
        .map((p) => p.dataUri || p.url)
        .filter(Boolean);
      if (urls.length === 0) {
        setFetchMsg("No photos available for this PRO on NuVizz.");
        setFetching(false);
        return;
      }
      setLocal((prev) => ({
        ...prev,
        photo_urls: urls,
        photo_meta: result.photos || [],
      }));
      setFetchMsg(
        `Got ${urls.length} photo(s). Click Save Changes to persist.`
      );
    } catch (err) {
      setFetchMsg(`Error: ${err.message}`);
    }
    setFetching(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Edit Incident · PRO# {local.pro_number}</div>
          <button className="close-x" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {local.merged_count > 1 && (
            <div
              className="note-block"
              style={{
                marginBottom: 14,
                background: "var(--davis-blue-bg)",
                borderColor: "var(--davis-blue)",
                color: "var(--davis-blue)",
                fontSize: 12,
              }}
            >
              <strong>Consolidated from {local.merged_count} line items.</strong>{" "}
              All items for this PRO are listed together in the Item # field.
            </div>
          )}

          <div className="field-row">
            <label className="field">
              <span>PRO#</span>
              <input
                type="text"
                value={local.pro_number || ""}
                onChange={(e) => patch({ pro_number: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Category</span>
              <select
                value={local.category || ""}
                onChange={(e) => patch({ category: e.target.value })}
              >
                {INCIDENT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Fault</span>
              <select
                value={local.fault || "unknown"}
                onChange={(e) => patch({ fault: e.target.value })}
              >
                {FAULT_CODES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Driver</span>
            <select
              value={local.driver_id || ""}
              onChange={(e) => patch({ driver_id: e.target.value || null })}
            >
              <option value="">— Unassigned —</option>
              {drivers
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Ship Date</span>
              <input
                type="date"
                value={local.ship_date || ""}
                onChange={(e) => patch({ ship_date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Return Date</span>
              <input
                type="date"
                value={local.return_date || ""}
                onChange={(e) => patch({ return_date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Delivered Date</span>
              <input
                type="date"
                value={local.delivered_date || ""}
                onChange={(e) => patch({ delivered_date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Week Ending</span>
              <input
                type="date"
                value={local.week_ending || ""}
                onChange={(e) => patch({ week_ending: e.target.value })}
              />
            </label>
          </div>

          <label className="field">
            <span>Reason</span>
            <input
              type="text"
              value={local.reason || ""}
              onChange={(e) => patch({ reason: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Uline Notes (scanned from report)</span>
            <textarea
              value={local.notes || ""}
              onChange={(e) => patch({ notes: e.target.value })}
              rows={3}
            />
          </label>

          <label className="field">
            <span>Davis Notes (shown on PDF; overrides Uline notes)</span>
            <textarea
              value={local.your_note || ""}
              onChange={(e) => patch({ your_note: e.target.value })}
              rows={2}
              placeholder="Davis' own note — appears on the PDF instead of the Uline note"
            />
          </label>

          {(local.freight_id || local.item_number || local.comments) && (
            <>
              <hr className="div" />
              <div className="field-row">
                {local.freight_id !== undefined && (
                  <label className="field">
                    <span>Freight ID</span>
                    <input
                      type="text"
                      value={local.freight_id || ""}
                      onChange={(e) => patch({ freight_id: e.target.value })}
                    />
                  </label>
                )}
                {local.item_number !== undefined && (
                  <label className="field">
                    <span>Item #</span>
                    <input
                      type="text"
                      value={local.item_number || ""}
                      onChange={(e) => patch({ item_number: e.target.value })}
                    />
                  </label>
                )}
              </div>
              {local.comments !== undefined && (
                <label className="field">
                  <span>Source Comments</span>
                  <textarea
                    value={local.comments || ""}
                    onChange={(e) => patch({ comments: e.target.value })}
                    rows={2}
                  />
                </label>
              )}
            </>
          )}

          <hr className="div" />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Attached Photos ({local.photo_urls ? local.photo_urls.length : 0})
            </div>
            <button
              className="btn ghost sm"
              onClick={handleRefetch}
              disabled={fetching}
              title="Re-fetch photos from NuVizz"
            >
              {fetching ? "⏳ Fetching..." : "↻ Refetch from NuVizz"}
            </button>
          </div>

          {fetchMsg && (
            <div
              className="note-block"
              style={{
                marginBottom: 10,
                fontSize: 11,
                padding: "6px 10px",
                color:
                  fetchMsg.startsWith("Failed") || fetchMsg.startsWith("Error")
                    ? "var(--accent-red)"
                    : "var(--text-1)",
              }}
            >
              {fetchMsg}
            </div>
          )}

          {local.photo_urls && local.photo_urls.length > 0 ? (
            <div className="photo-grid">
              {local.photo_urls.slice(0, 6).map((entry, idx) => {
                const src =
                  typeof entry === "string"
                    ? entry
                    : entry?.dataUri || entry?.url;
                return src ? (
                  <a
                    key={idx}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Click to open full size"
                  >
                    <img
                      src={src}
                      className="photo-thumb"
                      alt={`POD ${idx + 1}`}
                      style={{ cursor: "zoom-in" }}
                      onError={(e) => {
                        e.target.style.display = "none";
                        const div = document.createElement("div");
                        div.className = "photo-thumb";
                        div.style.cssText =
                          "display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:10px;color:var(--accent-red);text-align:center;padding:8px;";
                        div.innerHTML = `Image failed to load<br><small>${
                          src.length > 60 ? src.slice(0, 60) + "..." : src
                        }</small>`;
                        e.target.parentNode.appendChild(div);
                      }}
                    />
                  </a>
                ) : (
                  <div
                    key={idx}
                    className="photo-thumb"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--accent-red)",
                      textAlign: "center",
                      padding: 8,
                    }}
                  >
                    No image data
                    <br />
                    (photo_urls[{idx}] empty)
                  </div>
                );
              })}
            </div>
          ) : loadingPhotos ? (
            <div
              className="empty-state"
              style={{ padding: 20, fontSize: 12 }}
            >
              Loading photos...
            </div>
          ) : (
            <div
              className="empty-state"
              style={{ padding: 20, fontSize: 12 }}
            >
              No photos attached. Click{" "}
              <strong>↻ Refetch from NuVizz</strong> to pull POD photos for
              this PRO.
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-2)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
