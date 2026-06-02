// PDF accountability report generator.
// Builds a cover summary page + incident cards (3 per page, one photo each)
// using jsPDF. Mirrors the production report layout.
import { jsPDF } from "jspdf";

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

// Load an image URL/dataURI into a JPEG dataURL + natural dimensions.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("image load timeout")), 10000);
    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve({
        dataUrl: canvas.toDataURL("image/jpeg", 0.82),
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

async function drawIncidentCard(doc, inc, x, y, w, h) {
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 4, 4, "S");
  const catColor = categoryColor(inc.category);
  setColor(doc, catColor, "fill");
  doc.rect(x, y, 3, h, "F");

  const headY = y + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setColor(doc, DAVIS_BLUE, "text");
  doc.text(`PRO# ${inc.pro_number}`, x + 10, headY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(doc, TEXT_DARK, "text");
  const driver = (inc.driver_name || inc.driver_raw || "Unassigned").toUpperCase();
  const proWidth = doc.getTextWidth(`PRO# ${inc.pro_number}`);
  doc.text(driver, x + 10 + proWidth + 12, headY);

  let badgeRight = x + w - 10;
  const faultW = doc.getTextWidth((inc.fault || "unknown").toUpperCase()) + 10;
  drawBadge(doc, inc.fault || "unknown", badgeRight - faultW, headY, faultColor(inc.fault));
  badgeRight -= faultW + 5;
  const catW = doc.getTextWidth(inc.category.toUpperCase()) + 10;
  drawBadge(doc, inc.category, badgeRight - catW, headY, catColor);

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

  const photoX = x + 10 + notesW + 10;
  const photoY = notesY;
  const photoH = innerH - 5;
  setColor(doc, LINE, "fill");
  doc.rect(photoX, photoY, photoW, photoH, "F");
  if (inc.photo_urls && inc.photo_urls.length > 0) {
    try {
      const loaded = await loadImage(inc.photo_urls[0]);
      const { w: iw, h: ih } = fitDims(loaded.width, loaded.height, photoW - 4, photoH - 4);
      doc.addImage(
        loaded.dataUrl,
        "JPEG",
        photoX + (photoW - iw) / 2,
        photoY + (photoH - ih) / 2,
        iw,
        ih,
      );
    } catch {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      setColor(doc, TEXT_MUTED, "text");
      doc.text("[Photo failed to load]", photoX + photoW / 2, photoY + photoH / 2, {
        align: "center",
      });
    }
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    setColor(doc, TEXT_MUTED, "text");
    doc.text("No photo available", photoX + photoW / 2, photoY + photoH / 2, {
      align: "center",
    });
  }
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

// Build the full photo report (cover + 3 incident cards/page).
export async function generatePhotoReport(incidents, meta = {}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  drawCover(doc, incidents, meta);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const topOffset = 45;
  const bottomOffset = 30;
  const perPage = 3;
  const gap = 12;
  const cardH = (pageH - topOffset - bottomOffset - gap * (perPage - 1)) / perPage;
  const cardW = pageW - 2 * margin;
  const pages = Math.ceil(incidents.length / perPage);

  for (let p = 0; p < pages; p++) {
    doc.addPage();
    drawPageHeader(doc, meta, p + 2, pages + 1);
    for (let i = 0; i < perPage; i++) {
      const idx = p * perPage + i;
      if (idx >= incidents.length) break;
      const inc = incidents[idx];
      const cardY = topOffset + i * (cardH + gap);
      await drawIncidentCard(doc, inc, margin, cardY, cardW, cardH);
    }
  }
  return doc;
}

export function downloadPdf(doc, filename) {
  doc.save(filename);
}
