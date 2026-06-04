// PDF accountability report generator.
// Builds a cover summary page + incident cards (3 cards per page) using jsPDF.
// Photos live in the split photos:{id} blob, so the generator hydrates them for
// ALL incidents up front (same source as the row drawer) before rendering.
import { jsPDF } from "jspdf";
import { getIncidentPhotosBatch } from "../data/firebase.js";

// Palette (RGB triples) matching the app theme.
const DAVIS_BLUE = [30, 91, 146];
const AMBER = [212, 160, 23];
const RED = [220, 53, 69];
const GREEN = [34, 170, 92];
const TEXT_DARK = [55, 65, 81];
const TEXT_MUTED = [107, 114, 128];
const LINE = [229, 231, 235];

function categoryColor(cat) {
  return (
    {
      damage: RED,
      late: AMBER,
      missing: [168, 85, 247],
      misdelivery: [244, 114, 182],
      forgotten_freight: [249, 115, 22],
      complaint: RED,
      compliment: GREEN,
      return: [59, 130, 246],
      trace: TEXT_MUTED,
    }[cat] || TEXT_MUTED
  );
}

function faultColor(fault) {
  return (
    {
      driver: RED,
      preload: AMBER,
      warehouse: AMBER,
      customer: TEXT_MUTED,
      vendor: TEXT_MUTED,
      exonerated: GREEN,
      unknown: TEXT_MUTED,
    }[fault] || TEXT_MUTED
  );
}

function setColor(doc, rgb, mode = "text") {
  if (mode === "text") doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  else if (mode === "draw") doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  else if (mode === "fill") doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

// Draw a rounded pill badge with uppercase text; returns its width.
function drawBadge(doc, text, x, y, color, opts = {}) {
  const fontSize = opts.fontSize || 7;
  doc.setFontSize(fontSize);
  doc.setFont("helvetica", "bold");
  const w = doc.getTextWidth(text.toUpperCase()) + 10;
  const h = fontSize + 4;
  setColor(doc, color, "fill");
  doc.roundedRect(x, y - h + 2, w, h, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(text.toUpperCase(), x + 5, y);
  return w;
}

// jsPDF understands PNG/JPEG natively; detect the encoding from a data URI so we
// can hand the original bytes straight to addImage (re-encoding a transparent PNG
// to JPEG is what turned dock photos into solid black rectangles).
function detectFormat(src) {
  if (/^data:image\/png/i.test(src)) return "PNG";
  if (/^data:image\/jpe?g/i.test(src)) return "JPEG";
  return null;
}

// Load an image and return { dataUrl, format, width, height }, awaited so the
// bytes are fully decoded before addImage runs. Data-URI PNG/JPEG bytes are
// passed through untouched; anything else (remote URL, webp, gif) is rasterized
// onto a white background and re-encoded as JPEG so it still draws.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("image load timeout")), 15000);
    img.onload = () => {
      clearTimeout(timer);
      const passthrough = detectFormat(src);
      if (passthrough) {
        resolve({
          dataUrl: src,
          format: passthrough,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.85),
        format: "JPEG",
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image load failed"));
    };
    img.src = src;
  });
}

// Render up to 2 photos into a cell, fit-within with aspect ratio preserved and
// no gray letterbox. 1 photo fills the cell; 2 photos split it into equal halves
// with no gap between them. Empty list draws the "No photo available" notice.
async function drawPhotos(doc, photos, px, py, pw, ph) {
  const urls = (photos || []).slice(0, 2);
  if (urls.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    setColor(doc, TEXT_MUTED, "text");
    doc.text("No photo available", px + pw / 2, py + ph / 2, { align: "center" });
    return;
  }
  const cellW = pw / urls.length;
  for (let i = 0; i < urls.length; i++) {
    const cellX = px + i * cellW;
    try {
      const loaded = await loadImage(urls[i]);
      const { w: iw, h: ih } = fitDims(loaded.width, loaded.height, cellW, ph);
      doc.addImage(
        loaded.dataUrl,
        loaded.format,
        cellX + (cellW - iw) / 2,
        py + (ph - ih) / 2,
        iw,
        ih,
      );
    } catch {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      setColor(doc, TEXT_MUTED, "text");
      doc.text("[Photo failed to load]", cellX + cellW / 2, py + ph / 2, {
        align: "center",
      });
    }
  }
}

// Fit (w,h) into (maxW,maxH) preserving aspect ratio.
function fitDims(w, h, maxW, maxH) {
  const scale = Math.min(maxW / w, maxH / h);
  return { w: w * scale, h: h * scale };
}

function drawCover(doc, incidents, meta) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 50;

  setColor(doc, DAVIS_BLUE, "fill");
  doc.rect(0, 0, pageW, 110, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("DAVIS DELIVERY", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("DRIVER ACCOUNTABILITY REPORT", margin, 56);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text(meta.title || "Weekly Photo Report", margin, 92);
  if (meta.dateRange) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(220, 230, 245);
    doc.text(meta.dateRange, pageW - margin, 92, { align: "right" });
  }

  const byCategory = {};
  const byFault = {};
  for (const inc of incidents) {
    byCategory[inc.category] = (byCategory[inc.category] || 0) + 1;
    byFault[inc.fault || "unknown"] = (byFault[inc.fault || "unknown"] || 0) + 1;
  }

  let y = 150;
  const cardsTop = y;
  const cardW = (pageW - 2 * margin - 30) / 3;
  const cardH = 70;
  const driverFault = incidents.filter((i) => i.fault === "driver").length;
  const exonerated = incidents.filter(
    (i) =>
      i.fault === "exonerated" ||
      i.fault === "preload" ||
      i.fault === "warehouse" ||
      i.fault === "vendor",
  ).length;

  [
    { label: "TOTAL INCIDENTS", value: String(incidents.length), color: DAVIS_BLUE },
    { label: "DRIVER FAULT", value: String(driverFault), color: RED },
    { label: "EXONERATED", value: String(exonerated), color: GREEN },
  ].forEach((kpi, i) => {
    const x = margin + i * (cardW + 15);
    setColor(doc, LINE, "draw");
    doc.setLineWidth(1);
    doc.roundedRect(x, cardsTop, cardW, cardH, 4, 4, "S");
    setColor(doc, kpi.color, "fill");
    doc.rect(x, cardsTop, 3, cardH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    setColor(doc, TEXT_DARK, "text");
    doc.text(kpi.value, x + 15, cardsTop + 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, TEXT_MUTED, "text");
    doc.text(kpi.label, x + 15, cardsTop + 55);
  });
  y = cardsTop + cardH + 30;

  const colW = (pageW - 2 * margin - 30) / 2;

  // By category bar list.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, TEXT_DARK, "text");
  doc.text("BY CATEGORY", margin, y);
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.5);
  doc.line(margin, y + 4, margin + colW, y + 4);
  let catY = y + 20;
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const catMax = catEntries[0]?.[1] || 1;
  for (const [cat, count] of catEntries) {
    const color = categoryColor(cat);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setColor(doc, TEXT_DARK, "text");
    doc.text(cat.toUpperCase().replace("_", " "), margin, catY);
    doc.setFont("helvetica", "normal");
    doc.text(String(count), margin + colW - 5, catY, { align: "right" });
    setColor(doc, LINE, "fill");
    doc.rect(margin, catY + 3, colW - 15, 4, "F");
    setColor(doc, color, "fill");
    doc.rect(margin, catY + 3, (colW - 15) * (count / catMax), 4, "F");
    catY += 18;
    if (catY > pageH - 100) break;
  }

  // Top offenders (driver fault).
  const offX = margin + colW + 30;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, TEXT_DARK, "text");
  doc.text("TOP OFFENDERS (DRIVER FAULT)", offX, y);
  setColor(doc, LINE, "draw");
  doc.line(offX, y + 4, offX + colW, y + 4);
  const offenders = {};
  for (const inc of incidents.filter((i) => i.fault === "driver")) {
    const name = inc.driver_name || inc.driver_raw || "Unknown";
    offenders[name] = (offenders[name] || 0) + 1;
  }
  const topOffenders = Object.entries(offenders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  let offY = y + 20;
  if (topOffenders.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setColor(doc, TEXT_MUTED, "text");
    doc.text("No driver-fault incidents this period.", offX, offY);
  } else {
    const offMax = topOffenders[0][1];
    for (const [name, count] of topOffenders) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      setColor(doc, TEXT_DARK, "text");
      const label = name.length > 28 ? name.slice(0, 26) + "..." : name;
      doc.text(label, offX, offY);
      doc.setFont("helvetica", "normal");
      doc.text(String(count), offX + colW - 5, offY, { align: "right" });
      setColor(doc, LINE, "fill");
      doc.rect(offX, offY + 3, colW - 15, 4, "F");
      setColor(doc, RED, "fill");
      doc.rect(offX, offY + 3, (colW - 15) * (count / offMax), 4, "F");
      offY += 18;
      if (offY > pageH - 100) break;
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(
    `Generated ${new Date().toLocaleString()} · Davis Driver Scorecard`,
    pageW / 2,
    pageH - 30,
    { align: "center" },
  );
}

// Draw the card frame + header (PRO# left zone, driver name in a gutter after it,
// category/fault badges pinned right). The fixed gutter keeps a long PRO# from
// running into the driver name (Bug 2).
function drawCardHeader(doc, inc, x, y, w, h) {
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 4, 4, "S");
  const catColor = categoryColor(inc.category);
  setColor(doc, catColor, "fill");
  doc.rect(x, y, 3, h, "F");

  const padX = 10;
  const headY = y + 18;

  // Category + fault badges, right-aligned. Drawn first so we know their left edge.
  let badgeRight = x + w - 10;
  const faultW = doc.getTextWidth((inc.fault || "unknown").toUpperCase()) + 10;
  drawBadge(doc, inc.fault || "unknown", badgeRight - faultW, headY, faultColor(inc.fault));
  badgeRight -= faultW + 5;
  const catW = doc.getTextWidth(inc.category.toUpperCase()) + 10;
  drawBadge(doc, inc.category, badgeRight - catW, headY, catColor);
  const badgeLeft = badgeRight - catW;

  // PRO# in its own left zone. Measure at the SAME 11pt size it is drawn at —
  // the old code measured at 9pt, undersizing the gutter and overlapping the name.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor(doc, DAVIS_BLUE, "text");
  const proText = `PRO# ${inc.pro_number}`;
  doc.text(proText, x + padX, headY);
  const proWidth = doc.getTextWidth(proText);

  // Driver name starts at a fixed x AFTER the PRO# plus padding, and is truncated
  // so a long PRO# (or long name) can never run into the badge block.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(doc, TEXT_DARK, "text");
  const driverX = x + padX + proWidth + 14;
  const driverMaxW = badgeLeft - 10 - driverX;
  if (driverMaxW > 16) {
    let driver = (inc.driver_name || inc.driver_raw || "Unassigned").toUpperCase();
    while (driver.length > 1 && doc.getTextWidth(driver) > driverMaxW) {
      driver = driver.slice(0, -2);
    }
    if (driver !== (inc.driver_name || inc.driver_raw || "Unassigned").toUpperCase()) {
      driver = driver.slice(0, -1) + "…";
    }
    doc.text(driver, driverX, headY);
  }

  return catColor;
}

async function drawIncidentCard(doc, inc, x, y, w, h, photos) {
  drawCardHeader(doc, inc, x, y, w, h);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, TEXT_DARK, "text");
  const reason = (inc.reason || "").toUpperCase();
  doc.text(reason.length > 70 ? reason.slice(0, 68) + "..." : reason, x + 10, y + 34);

  const notesY = y + 42;
  const innerH = h - 50;
  const photoW = Math.min(h * 0.9, w * 0.5);
  const notesW = w - photoW - 10 * 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, TEXT_MUTED, "text");
  doc.text("NOTES", x + 10, notesY);
  setColor(doc, LINE, "draw");
  doc.line(x + 10, notesY + 2, x + 10 + notesW, notesY + 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, TEXT_DARK, "text");
  const note = inc.your_note || inc.notes || inc.comments || "—";
  const noteLines = doc.splitTextToSize(note, notesW);
  const maxLines = Math.floor((innerH - 15) / 11);
  doc.text(noteLines.slice(0, maxLines), x + 10, notesY + 13);

  const metaY = y + h - 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setColor(doc, TEXT_MUTED, "text");
  const metaParts = [
    inc.ship_date && `Ship: ${inc.ship_date}`,
    inc.delivered_date && `Delivered: ${inc.delivered_date}`,
    inc.return_date && `Returned: ${inc.return_date}`,
    inc.trace_date && `Traced: ${inc.trace_date}`,
    inc.freight_id && `Item: ${inc.freight_id}`,
  ]
    .filter(Boolean)
    .join("   ·   ");
  doc.text(metaParts, x + 10, metaY);

  // Photo column: 1-up or 2-up, no gray letterbox. "No photo available" is decided
  // purely from this incident's fetched photo list (see generatePhotoReport).
  const photoX = x + 10 + notesW + 10;
  const photoY = notesY;
  const photoH = innerH - 5;
  await drawPhotos(doc, photos, photoX, photoY, photoW, photoH);
}

// Continuation card for an incident's overflow photos (3rd onward), 2 per card,
// captioned with the PRO# so the extra photos stay traceable to their incident.
async function drawContinuationCard(doc, inc, x, y, w, h, photos) {
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 4, 4, "S");
  setColor(doc, categoryColor(inc.category), "fill");
  doc.rect(x, y, 3, h, "F");

  const headY = y + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor(doc, DAVIS_BLUE, "text");
  const proText = `PRO# ${inc.pro_number}`;
  doc.text(proText, x + 10, headY);
  const proWidth = doc.getTextWidth(proText);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, TEXT_MUTED, "text");
  doc.text("ADDITIONAL PHOTOS (CONT.)", x + 10 + proWidth + 14, headY);

  const photoX = x + 10;
  const photoY = y + 28;
  const photoW = w - 20;
  const photoH = h - 28 - 12;
  await drawPhotos(doc, photos, photoX, photoY, photoW, photoH);
}

function drawPageHeader(doc, meta, page, total) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  setColor(doc, DAVIS_BLUE, "fill");
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DAVIS DRIVER SCORECARD", margin, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 215, 235);
  doc.text(meta.title || "Photo Report", pageW / 2, 18, { align: "center" });
  doc.text(`Page ${page} of ${total}`, pageW - margin, 18, { align: "right" });
}

// Build the full photo report (cover + 3 cards/page).
export async function generatePhotoReport(incidents, meta = {}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

  // BUG 1: photos live in the separate photos:{id} blob, not on the light incident
  // record. Hydrate them for ALL incidents up front via the same batch source the
  // row drawer uses, and await it before any rendering so addImage has real bytes.
  const ids = incidents.map((i) => i.id).filter(Boolean);
  let photoMap = new Map();
  if (ids.length) {
    try {
      photoMap = await getIncidentPhotosBatch(ids, meta.onProgress);
    } catch (err) {
      console.warn("PDF photo hydration failed:", err.message);
    }
  }
  const hydrated = incidents.map((inc) => {
    const fetched = photoMap.get(inc.id);
    const urls =
      fetched?.photo_urls && fetched.photo_urls.length > 0
        ? fetched.photo_urls
        : Array.isArray(inc.photo_urls)
          ? inc.photo_urls
          : [];
    return { ...inc, photo_urls: urls };
  });

  drawCover(doc, hydrated, meta);

  // Flatten into a list of cards: each incident -> one incident card (first up to
  // 2 photos) plus continuation cards for any overflow photos (2 per card).
  const cards = [];
  for (const inc of hydrated) {
    const urls = inc.photo_urls || [];
    cards.push({ type: "incident", inc, photos: urls.slice(0, 2) });
    for (let i = 2; i < urls.length; i += 2) {
      cards.push({ type: "continuation", inc, photos: urls.slice(i, i + 2) });
    }
  }

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const topOffset = 45;
  const bottomOffset = 30;
  const perPage = 3;
  const gap = 12;
  const cardH = (pageH - topOffset - bottomOffset - gap * (perPage - 1)) / perPage;
  const cardW = pageW - 2 * margin;
  const pages = Math.ceil(cards.length / perPage);

  for (let p = 0; p < pages; p++) {
    doc.addPage();
    drawPageHeader(doc, meta, p + 2, pages + 1);
    for (let i = 0; i < perPage; i++) {
      const idx = p * perPage + i;
      if (idx >= cards.length) break;
      const card = cards[idx];
      const cardY = topOffset + i * (cardH + gap);
      if (card.type === "continuation") {
        await drawContinuationCard(doc, card.inc, margin, cardY, cardW, cardH, card.photos);
      } else {
        await drawIncidentCard(doc, card.inc, margin, cardY, cardW, cardH, card.photos);
      }
    }
  }
  return doc;
}

export function downloadPdf(doc, filename) {
  doc.save(filename);
}
