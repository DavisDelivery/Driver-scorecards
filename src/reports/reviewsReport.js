// reviewsReport.js — printable customer-review report.
//
// Style primitives come from pdfGenerator.js for the same reason driverReport.js
// imports them: three reports that look like three different apps is worse than one
// shared palette, so the banner, rules and muted text all resolve to one place.
//
// Two shapes, one generator: the whole review book, or one driver's reviews. Pass
// `doc` to APPEND (that's how the all-drivers pack is built) — each driver starts on
// a fresh page and keeps its own "Page X of Y", because the pack is printed once and
// then split up.
import { jsPDF } from "jspdf";
import {
  DAVIS_BLUE,
  TEXT_DARK,
  TEXT_MUTED,
  LINE,
  setColor,
} from "./pdfGenerator.js";

const PAGE_MARGIN = 44;
const HEADER_H = 88;
const RUNNING_H = 40;
const BOTTOM = 54;
const GREEN = [21, 128, 61];
const RED = [185, 28, 28];

// US M/D/YYYY from an ISO timestamp, parsed from the string so a review filed late
// in the day can't print as the day before.
export function fmtReviewDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso || "").slice(0, 10);
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

const stars = (n) => "*".repeat(Math.max(0, Math.round(n))).padEnd(5, "-");
const ratingRgb = (avg) => (avg >= 4.5 ? GREEN : avg >= 3.5 ? TEXT_DARK : RED);

function drawBanner(doc, { title, subtitle, generatedOn }) {
  const w = doc.internal.pageSize.getWidth();
  setColor(doc, DAVIS_BLUE, "fill");
  doc.rect(0, 0, w, HEADER_H, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text("DAVIS DELIVERY — CUSTOMER REVIEWS", PAGE_MARGIN, 30);
  doc.setFontSize(20);
  doc.text(String(title || "All Drivers"), PAGE_MARGIN, 58);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (subtitle) doc.text(String(subtitle), PAGE_MARGIN, 76);
  doc.text(`Generated ${generatedOn}`, w - PAGE_MARGIN, 30, { align: "right" });
}

function drawRunningHeader(doc, { title }) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(doc, DAVIS_BLUE, "text");
  doc.text(`${title} — Customer Reviews`, PAGE_MARGIN, 26);
  setColor(doc, LINE, "draw");
  doc.line(PAGE_MARGIN, 32, w - PAGE_MARGIN, 32);
}

function drawFooter(doc, page, total, generatedOn) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  setColor(doc, LINE, "draw");
  doc.line(PAGE_MARGIN, h - 34, w - PAGE_MARGIN, h - 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(`Generated ${generatedOn}`, PAGE_MARGIN, h - 20);
  doc.text(`Page ${page} of ${total}`, w - PAGE_MARGIN, h - 20, { align: "right" });
}

// Summary strip: how many, the average, and how many were 3 stars or worse — the
// three numbers anyone reads first.
function drawSummary(doc, revs, x, y, w) {
  const n = revs.length;
  const avg = n ? revs.reduce((s, r) => s + (r.rating || 0), 0) / n : 0;
  const low = revs.filter((r) => (r.rating || 0) <= 3).length;
  setColor(doc, LINE, "draw");
  doc.setDrawColor(...LINE);
  doc.roundedRect(x, y, w, 46, 3, 3);
  const cells = [
    ["REVIEWS", String(n), TEXT_DARK],
    ["AVERAGE", n ? avg.toFixed(2) : "—", ratingRgb(avg)],
    ["3 STARS OR LESS", String(low), low ? RED : TEXT_DARK],
  ];
  const cw = w / cells.length;
  cells.forEach(([label, value, rgb], i) => {
    const cx = x + cw * i + 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    setColor(doc, rgb, "text");
    doc.text(value, cx, y + 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, TEXT_MUTED, "text");
    doc.text(label, cx, y + 38);
  });
  return 46;
}

// One review: stars + driver + date on the head line, then customer/PRO, then the
// comment wrapped. Height is measured first so pagination can place it whole.
function reviewHeight(doc, r, w) {
  const comment = String(r.comment || "").trim();
  const lines = comment ? doc.splitTextToSize(comment, w - 16) : [];
  return 30 + lines.length * 11 + (r.customer || r.proNumber ? 12 : 0);
}

function drawReview(doc, r, x, y, w) {
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  setColor(doc, (r.rating || 0) <= 3 ? RED : GREEN, "text");
  doc.text(stars(r.rating), x, y + 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setColor(doc, TEXT_DARK, "text");
  doc.text(String(r.driverName || "Unattributed"), x + 52, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(fmtReviewDate(r.submittedAt), x + w, y + 12, { align: "right" });

  let cy = y + 24;
  const meta = [r.customer, r.proNumber ? `PRO ${r.proNumber}` : ""]
    .filter(Boolean)
    .join("  ·  ");
  if (meta) {
    doc.setFontSize(8);
    setColor(doc, TEXT_MUTED, "text");
    doc.text(meta, x, cy);
    cy += 12;
  }
  const comment = String(r.comment || "").trim();
  if (comment) {
    doc.setFontSize(9);
    setColor(doc, TEXT_DARK, "text");
    for (const line of doc.splitTextToSize(comment, w - 16)) {
      doc.text(line, x, cy);
      cy += 11;
    }
  }
  setColor(doc, LINE, "draw");
  doc.line(x, y + reviewHeight(doc, r, w) - 4, x + w, y + reviewHeight(doc, r, w) - 4);
}

export async function generateReviewsReport({
  title,
  subtitle,
  reviews,
  doc: existingDoc,
}) {
  const appending = !!existingDoc;
  const doc = existingDoc || new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - PAGE_MARGIN * 2;
  const generatedOn = fmtReviewDate(new Date().toISOString());
  const rows = reviews || [];

  // Layout pass first, so "Page X of Y" is right before anything is drawn.
  const summaryH = 46 + 18;
  const placed = [];
  let page = 0;
  let y = HEADER_H + 20 + summaryH;
  for (const r of rows) {
    const h = reviewHeight(doc, r, contentW);
    if (y + h > pageH - BOTTOM) {
      page++;
      y = RUNNING_H + 12;
    }
    placed.push({ r, page, y, h });
    y += h;
  }
  const totalPages = page + 1;

  for (let p = 0; p < totalPages; p++) {
    if (p > 0 || appending) doc.addPage();
    if (p === 0) {
      drawBanner(doc, { title, subtitle, generatedOn });
      drawSummary(doc, rows, PAGE_MARGIN, HEADER_H + 20, contentW);
      if (!rows.length) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        setColor(doc, TEXT_MUTED, "text");
        doc.text("No reviews in this selection.", PAGE_MARGIN, HEADER_H + 20 + summaryH + 16);
      }
    } else {
      drawRunningHeader(doc, { title });
    }
    for (const item of placed) {
      if (item.page !== p) continue;
      drawReview(doc, item.r, PAGE_MARGIN, item.y, contentW);
    }
    drawFooter(doc, p + 1, totalPages, generatedOn);
  }
  return doc;
}

export function reviewsReportFilename(scope) {
  const clean = (s) =>
    String(s || "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "");
  return `${clean(scope || "All_Drivers")}_Customer_Reviews.pdf`;
}
