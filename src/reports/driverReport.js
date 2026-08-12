// Per-driver handout report.
//
// The weekly accountability PDF (pdfGenerator.js) covers a whole Uline report
// across every driver. This one answers a different need: a short, professional
// document for ONE driver over the period currently selected on a manual-entry
// tab (Forgotten Freight / Mis-Deliveries / Attempts / Compliments), listing
// every entry with what was forgotten, for whom, and the delivery photo — the
// kind of thing you hand to the driver in a coaching conversation.
//
// Style primitives are imported from pdfGenerator.js so both reports stay
// visually identical rather than drifting apart.
import { jsPDF } from "jspdf";
import { getIncidentPhotosBatch } from "../data/firebase.js";
import {
  DAVIS_BLUE,
  TEXT_DARK,
  TEXT_MUTED,
  LINE,
  setColor,
  drawBadge,
  loadImage,
  fitDims,
} from "./pdfGenerator.js";

const PAGE_MARGIN = 44;
const HEADER_H = 96; // page-1 banner
const RUNNING_H = 34; // banner on continuation pages
const CARD_H = 100;
const CARD_GAP = 10;
const BOTTOM = 44; // room for the footer

// MM/DD/YYYY from an ISO date, parsed from the string so it can't shift a day
// through timezone conversion.
const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10) || "—";
};

const incidentDateOf = (i) => i.delivered_date || i.created_at || "";

// Page furniture -------------------------------------------------------------

function drawTitleBanner(doc, { driverName, heading, periodLabel, rangeText, color }) {
  const pageW = doc.internal.pageSize.getWidth();
  setColor(doc, DAVIS_BLUE, "fill");
  doc.rect(0, 0, pageW, HEADER_H, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("DAVIS DELIVERY", PAGE_MARGIN, 30);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(heading.toUpperCase() + " — DRIVER REPORT", PAGE_MARGIN, 44);

  // The driver's name is the headline: this document is about them.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text(driverName, PAGE_MARGIN, 74);

  // Period, right-aligned against the driver name.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const pw = doc.getTextWidth(periodLabel);
  doc.text(periodLabel, pageW - PAGE_MARGIN - pw, 62);
  if (rangeText) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const rw = doc.getTextWidth(rangeText);
    doc.text(rangeText, pageW - PAGE_MARGIN - rw, 76);
  }

  // Accent rule in the category's own color.
  setColor(doc, color, "fill");
  doc.rect(0, HEADER_H - 4, pageW, 4, "F");
}

function drawRunningHeader(doc, { driverName, heading, periodLabel, color }) {
  const pageW = doc.internal.pageSize.getWidth();
  setColor(doc, DAVIS_BLUE, "fill");
  doc.rect(0, 0, pageW, RUNNING_H, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`${driverName} — ${heading}`, PAGE_MARGIN, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const w = doc.getTextWidth(periodLabel);
  doc.text(periodLabel, pageW - PAGE_MARGIN - w, 22);
  setColor(doc, color, "fill");
  doc.rect(0, RUNNING_H - 3, pageW, 3, "F");
}

function drawFooter(doc, page, total, generatedOn) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const y = pageH - 26;
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.5);
  doc.line(PAGE_MARGIN, y - 10, pageW - PAGE_MARGIN, y - 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(`Generated ${generatedOn}`, PAGE_MARGIN, y);
  const label = `Page ${page} of ${total}`;
  const w = doc.getTextWidth(label);
  doc.text(label, pageW - PAGE_MARGIN - w, y);
}

// Summary --------------------------------------------------------------------

// "What was forgotten" tallied across the period — the at-a-glance answer the
// driver conversation actually starts from.
function drawSummary(doc, { rows, itemLabel, breakdown, color }, x, y, w) {
  const boxH = 62;
  setColor(doc, [249, 250, 251], "fill");
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, w, boxH, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  setColor(doc, color, "text");
  doc.text(String(rows.length), x + 16, y + 34);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(
    `TOTAL ${rows.length === 1 ? "ENTRY" : "ENTRIES"}`,
    x + 16,
    y + 46,
  );

  // Divider between the count and the breakdown.
  setColor(doc, LINE, "draw");
  const divX = x + 92;
  doc.line(divX, y + 12, divX, y + boxH - 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  setColor(doc, TEXT_MUTED, "text");
  doc.text((itemLabel || "BREAKDOWN").toUpperCase(), divX + 16, y + 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, TEXT_DARK, "text");
  if (!breakdown.length) {
    doc.setFont("helvetica", "italic");
    doc.text("—", divX + 16, y + 38);
  } else {
    // Lay the tally out in columns so a long list stays on one line-pair.
    const colW = (w - (divX - x) - 32) / Math.min(breakdown.length, 4);
    breakdown.slice(0, 8).forEach((b, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const bx = divX + 16 + col * colW;
      const by = y + 38 + row * 14;
      doc.setFont("helvetica", "bold");
      doc.text(String(b.count), bx, by);
      doc.setFont("helvetica", "normal");
      setColor(doc, TEXT_MUTED, "text");
      doc.text(` ${b.label}`, bx + doc.getTextWidth(String(b.count)) + 2, by);
      setColor(doc, TEXT_DARK, "text");
    });
  }
  return boxH;
}

// Detail card ----------------------------------------------------------------

async function drawEntryCard(doc, entry, photos, x, y, w, { itemLabel, color }) {
  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, w, CARD_H, 3, 3, "S");
  // Category-colored spine so entries read as a set.
  setColor(doc, color, "fill");
  doc.rect(x, y + 1, 3, CARD_H - 2, "F");

  const padX = x + 16;
  const photoW = 112;
  const textW = w - (padX - x) - photoW - 24;

  // PRO number — the anchor a driver can look up.
  doc.setFont("courier", "bold");
  doc.setFontSize(12);
  setColor(doc, TEXT_DARK, "text");
  doc.text(entry.pro_number || "—", padX, y + 22);

  // What was forgotten, as a badge to the right of the PRO.
  const itemValue = entry.__itemValue;
  if (itemValue) {
    doc.setFont("helvetica", "bold");
    drawBadge(doc, String(itemValue), padX + 96, y + 22, color, { fontSize: 7.5 });
  }

  // Customer.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  setColor(doc, TEXT_DARK, "text");
  const cust = doc.splitTextToSize(entry.customer || "—", textW)[0] || "—";
  doc.text(cust, padX, y + 40);

  // Dates.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(
    `Incident ${fmtMDY(incidentDateOf(entry))}   ·   Logged ${fmtMDY(entry.created_at)}`,
    padX,
    y + 54,
  );

  // Notes, wrapped and clipped to the card.
  const note = (entry.notes || "").trim();
  if (note) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setColor(doc, TEXT_DARK, "text");
    const lines = doc.splitTextToSize(note, textW).slice(0, 3);
    doc.text(lines, padX, y + 70);
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    setColor(doc, TEXT_MUTED, "text");
    doc.text("No notes recorded.", padX, y + 70);
  }

  // Photo (evidence of what was left behind).
  const px = x + w - photoW - 12;
  const py = y + 10;
  const ph = CARD_H - 20;
  const url = (photos || [])[0];
  if (!url) {
    setColor(doc, [250, 250, 251], "fill");
    setColor(doc, LINE, "draw");
    doc.roundedRect(px, py, photoW, ph, 2, 2, "FD");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    setColor(doc, TEXT_MUTED, "text");
    doc.text("No photo", px + photoW / 2, py + ph / 2, { align: "center" });
    return;
  }
  try {
    const img = await loadImage(url);
    const { w: iw, h: ih } = fitDims(img.width, img.height, photoW, ph);
    doc.addImage(
      img.dataUrl,
      img.format,
      px + (photoW - iw) / 2,
      py + (ph - ih) / 2,
      iw,
      ih,
    );
    const extra = (photos || []).length - 1;
    if (extra > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      setColor(doc, TEXT_MUTED, "text");
      const t = `+${extra} more photo${extra === 1 ? "" : "s"}`;
      doc.text(t, px + photoW - doc.getTextWidth(t), py + ph + 8);
    }
  } catch {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    setColor(doc, TEXT_MUTED, "text");
    doc.text("[Photo failed to load]", px + photoW / 2, py + ph / 2, {
      align: "center",
    });
  }
}

// Main -----------------------------------------------------------------------

/**
 * Build a one-driver report for the currently selected period.
 *   driverName  – who the report is for
 *   entries     – that driver's incidents, already scoped to the period
 *   config      – the ManualEntry tab config (heading, color, classify)
 *   periodLabel – e.g. "Last Week"
 *   rangeText   – e.g. "07/27/2026 – 07/31/2026"
 */
// Pass `doc` to APPEND this driver's report to an existing document instead of
// starting a new one — that's how the all-drivers pack is built. Each driver still
// begins on a fresh page and keeps its OWN "Page X of Y" count, because the pack is
// printed once and then split up, and every driver is handed a document that reads
// as their own rather than "page 34 of 96".
export async function generateDriverReport({
  driverName,
  entries,
  config,
  periodLabel,
  rangeText,
  onProgress,
  doc: existingDoc,
}) {
  const appending = !!existingDoc;
  const doc = existingDoc || new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - PAGE_MARGIN * 2;
  const color = hexToRgb(config.color) || DAVIS_BLUE;
  const itemField = config.classify?.field;
  const itemLabel = config.classify?.label || "Breakdown";

  // Newest first — the most recent conversation starter goes on top.
  const rows = [...entries].sort((a, b) =>
    String(incidentDateOf(b)).localeCompare(String(incidentDateOf(a))),
  );
  for (const r of rows) r.__itemValue = itemField ? r[itemField] : "";

  // Tally what was forgotten.
  const tally = new Map();
  for (const r of rows) {
    const k = (r.__itemValue || "Unspecified").toString();
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  const breakdown = [...tally.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Hydrate photos up front (they live in their own documents).
  let photoMap = new Map();
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length) {
    try {
      photoMap = await getIncidentPhotosBatch(ids, onProgress);
    } catch (err) {
      console.warn("driver report photo hydration failed:", err.message);
    }
  }
  const photosFor = (r) => {
    const fetched = photoMap.get(r.id);
    if (fetched?.photo_urls?.length) return fetched.photo_urls;
    return Array.isArray(r.photo_urls) ? r.photo_urls : [];
  };

  const generatedOn = fmtMDY(new Date().toISOString());
  const bannerCtx = { driverName, heading: config.heading, periodLabel, rangeText, color };

  // Layout pass so the footer can print a correct "Page X of Y".
  const summaryH = 62 + 18;
  const placed = [];
  let page = 0;
  let y = HEADER_H + 20 + summaryH;
  for (const r of rows) {
    if (y + CARD_H > pageH - BOTTOM) {
      page++;
      y = RUNNING_H + 18;
    }
    placed.push({ r, page, y });
    y += CARD_H + CARD_GAP;
  }
  // Place the sign-off after the last card. If it doesn't fit, it moves to a new
  // page — but a signature block sitting alone on an otherwise empty page reads
  // as a mistake, so in that case pull the last card over with it (widow
  // control) and re-place the sign-off beneath it.
  const SIGNOFF_H = 54;
  let signoffPage = page;
  let signoffY = y + 8;
  if (signoffY + SIGNOFF_H > pageH - BOTTOM) {
    signoffPage = page + 1;
    signoffY = RUNNING_H + 18;
    const lastOnPrevPage = placed.filter((p) => p.page === page);
    if (lastOnPrevPage.length > 1) {
      const moved = lastOnPrevPage[lastOnPrevPage.length - 1];
      moved.page = signoffPage;
      moved.y = RUNNING_H + 18;
      signoffY = moved.y + CARD_H + 8 + 8;
    }
  }
  const totalPages = Math.max(signoffPage, page) + 1;

  for (let p = 0; p < totalPages; p++) {
    // When appending, the very first page needs a break too — otherwise this
    // driver's banner lands on top of the previous driver's sign-off.
    if (p > 0 || appending) doc.addPage();
    if (p === 0) {
      drawTitleBanner(doc, bannerCtx);
      drawSummary(
        doc,
        { rows, itemLabel, breakdown, color },
        PAGE_MARGIN,
        HEADER_H + 20,
        contentW,
      );
      if (!rows.length) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        setColor(doc, TEXT_MUTED, "text");
        doc.text(
          `No ${config.heading.toLowerCase()} entries for ${driverName} in this period.`,
          PAGE_MARGIN,
          HEADER_H + 20 + summaryH + 20,
        );
      }
    } else {
      drawRunningHeader(doc, bannerCtx);
    }
    for (const item of placed) {
      if (item.page !== p) continue;
      await drawEntryCard(
        doc,
        item.r,
        photosFor(item.r),
        PAGE_MARGIN,
        item.y,
        contentW,
        { itemLabel, color },
      );
    }
    if (p === signoffPage && rows.length) {
      drawSignoff(doc, PAGE_MARGIN, signoffY, contentW);
    }
    drawFooter(doc, p + 1, totalPages, generatedOn);
  }

  return doc;
}

// Acknowledgement block — this is a document handed to a driver and discussed,
// so it ends with somewhere to sign.
function drawSignoff(doc, x, y, w) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  setColor(doc, TEXT_MUTED, "text");
  doc.text("REVIEWED WITH DRIVER", x, y + 10);

  setColor(doc, LINE, "draw");
  doc.setLineWidth(0.6);
  const colW = (w - 24) / 3;
  ["Driver signature", "Supervisor", "Date"].forEach((label, i) => {
    const cx = x + i * (colW + 12);
    doc.line(cx, y + 36, cx + colW, y + 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, TEXT_MUTED, "text");
    doc.text(label, cx, y + 46);
  });
}

// "#f97316" -> [249,115,22]; passthrough for an existing RGB triple.
function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ""));
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : null;
}

// Safe filename: "Alfred Morgan" + "Forgotten Freight" + "Last Week".
export function driverReportFilename(driverName, heading, periodLabel) {
  const clean = (s) =>
    String(s || "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "");
  return `${clean(driverName)}_${clean(heading)}_${clean(periodLabel)}.pdf`;
}

// Filename for the every-driver pack: "All_Drivers_Forgotten_Freight_Last_Week.pdf".
export function allDriversReportFilename(heading, periodLabel) {
  return driverReportFilename("All Drivers", heading, periodLabel);
}
