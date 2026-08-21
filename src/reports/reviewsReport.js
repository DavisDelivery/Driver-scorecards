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
import { getBrandLogo, logoSize } from "./brandLogo.js";

const PAGE_MARGIN = 44;
const HEADER_H = 88;
const RUNNING_H = 40;
const BOTTOM = 54;
const GREEN = [21, 128, 61];
const RED = [185, 28, 28];

// US MM/DD/YYYY from an ISO timestamp (or a plain YYYY-MM-DD), parsed from the
// string so a review filed late in the day can't print as the day before. Every
// date on the report goes through here, headers included — one format, no
// exceptions.
export function fmtReviewDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso || "").slice(0, 10);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

const stars = (n) => "*".repeat(Math.max(0, Math.round(n))).padEnd(5, "-");
const ratingRgb = (avg) => (avg >= 4.5 ? GREEN : avg >= 3.5 ? TEXT_DARK : RED);

// The Davis mark. If a logo has been uploaded (Reviews tab → "Logo"), that image is
// drawn; otherwise this falls back to the rounded blue square with a "D" the app
// renders, so a report is never blank-headed while no logo is set.
export function drawBrandMark(doc, x, y, size, { onDark = false, logo = null } = {}) {
  // An uploaded logo wins: draw it letterboxed inside the square the mark occupies,
  // so a wide wordmark keeps its proportions instead of being squashed.
  if (logo && logo.dataUri) {
    const nat = logo.size || { w: 1, h: 1 };
    const scale = Math.min(size / nat.w, size / nat.h);
    const w = nat.w * scale;
    const h = nat.h * scale;
    try {
      doc.addImage(logo.dataUri, x + (size - w) / 2, y + (size - h) / 2, w, h);
      return;
    } catch {
      /* unreadable image — fall through to the drawn mark */
    }
  }
  if (onDark) {
    doc.setFillColor(255, 255, 255);
  } else {
    setColor(doc, DAVIS_BLUE, "fill");
  }
  doc.roundedRect(x, y, size, size, size * 0.17, size * 0.17, "F");
  doc.setFont("courier", "bold");
  doc.setFontSize(size * 0.62);
  if (onDark) setColor(doc, DAVIS_BLUE, "text");
  else doc.setTextColor(255, 255, 255);
  doc.text("D", x + size / 2, y + size * 0.72, { align: "center" });
}

// This goes to CUSTOMERS, so the first thing on the page is who it's from and what
// window it covers — not an internal report title.
function drawBanner(doc, { title, subtitle, periodText, rangeText, logo }) {
  const w = doc.internal.pageSize.getWidth();
  setColor(doc, DAVIS_BLUE, "fill");
  doc.rect(0, 0, w, HEADER_H, "F");

  drawBrandMark(doc, PAGE_MARGIN, 20, 34, { onDark: true, logo });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text("DAVIS DELIVERY", PAGE_MARGIN + 46, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Customer Delivery Reviews", PAGE_MARGIN + 46, 50);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(String(title || "All Drivers"), PAGE_MARGIN, 76);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const right = [periodText, subtitle].filter(Boolean).join("  ·  ");
  if (right) doc.text(right, w - PAGE_MARGIN, 76, { align: "right" });
  // Just the window this covers — no "generated on" line. The customer cares what
  // period the reviews are from, not when the file was made.
  if (rangeText) {
    doc.setFontSize(8);
    doc.text(rangeText, w - PAGE_MARGIN, 36, { align: "right" });
  }
}

function drawRunningHeader(doc, { title, logo }) {
  const w = doc.internal.pageSize.getWidth();
  drawBrandMark(doc, PAGE_MARGIN, 12, 16, { logo });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setColor(doc, DAVIS_BLUE, "text");
  doc.text(`Davis Delivery — ${title}`, PAGE_MARGIN + 22, 24);
  setColor(doc, LINE, "draw");
  doc.line(PAGE_MARGIN, 34, w - PAGE_MARGIN, 34);
}

function drawFooter(doc, page, total) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  setColor(doc, LINE, "draw");
  doc.line(PAGE_MARGIN, h - 34, w - PAGE_MARGIN, h - 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, TEXT_MUTED, "text");
  doc.text(`Page ${page} of ${total}`, w - PAGE_MARGIN, h - 20, { align: "right" });
}

// What a customer reads first: how many, the average out of five, and the share
// rated 4 stars or better — plus the distribution, so the headline number is shown
// to be earned rather than asserted. The low-star count stays in: a report that
// hides its bad reviews is not worth showing anyone.
const SUMMARY_H = 108;

function drawSummary(doc, revs, x, y, w) {
  const n = revs.length;
  const avg = n ? revs.reduce((s, r) => s + (r.rating || 0), 0) / n : 0;
  const low = revs.filter((r) => (r.rating || 0) <= 3).length;
  const good = revs.filter((r) => (r.rating || 0) >= 4).length;
  const pct = n ? Math.round((good / n) * 100) : 0;

  doc.setDrawColor(...LINE);
  doc.roundedRect(x, y, w, SUMMARY_H, 3, 3);

  const cells = [
    ["REVIEWS", String(n), TEXT_DARK],
    ["AVERAGE RATING", n ? `${avg.toFixed(2)} / 5` : "—", ratingRgb(avg)],
    ["RATED 4 STARS OR BETTER", n ? `${pct}%` : "—", pct >= 80 ? GREEN : TEXT_DARK],
    ["3 STARS OR LESS", String(low), low ? RED : TEXT_DARK],
  ];
  const cw = w / cells.length;
  cells.forEach(([label, value, rgb], i) => {
    const cx = x + cw * i + 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    setColor(doc, rgb, "text");
    doc.text(value, cx, y + 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    setColor(doc, TEXT_MUTED, "text");
    doc.text(label, cx, y + 40);
  });

  // Distribution: one bar per star level, widest bar = the biggest bucket.
  const barX = x + 12;
  const barW = w - 24 - 60;
  const top = y + 54;
  const max = Math.max(1, ...[5, 4, 3, 2, 1].map((st) => revs.filter((r) => r.rating === st).length));
  [5, 4, 3, 2, 1].forEach((st, i) => {
    const count = revs.filter((r) => r.rating === st).length;
    const by = top + i * 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, TEXT_MUTED, "text");
    doc.text(`${st}`, barX, by + 5);
    doc.setFillColor(238, 241, 245);
    doc.roundedRect(barX + 10, by, barW, 6, 1, 1, "F");
    if (count) {
      setColor(doc, st >= 4 ? GREEN : st === 3 ? TEXT_MUTED : RED, "fill");
      doc.roundedRect(barX + 10, by, Math.max(2, (count / max) * barW), 6, 1, 1, "F");
    }
    setColor(doc, TEXT_MUTED, "text");
    doc.text(
      `${count}${n ? `  ·  ${Math.round((count / n) * 100)}%` : ""}`,
      barX + 16 + barW,
      by + 5,
    );
  });
  return SUMMARY_H;
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
  periodText,
  rangeText,
  reviews,
  doc: existingDoc,
}) {
  const appending = !!existingDoc;
  const doc = existingDoc || new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - PAGE_MARGIN * 2;
  // Decoded once per report, not once per page.
  const logoUri = getBrandLogo();
  const logo = logoUri ? { dataUri: logoUri, size: await logoSize(logoUri) } : null;
  const rows = reviews || [];

  // Layout pass first, so "Page X of Y" is right before anything is drawn.
  const summaryH = SUMMARY_H + 18;
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
      drawBanner(doc, { title, subtitle, periodText, rangeText, logo });
      drawSummary(doc, rows, PAGE_MARGIN, HEADER_H + 20, contentW);
      if (!rows.length) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        setColor(doc, TEXT_MUTED, "text");
        doc.text("No reviews in this period.", PAGE_MARGIN, HEADER_H + 20 + summaryH + 16);
      }
    } else {
      drawRunningHeader(doc, { title, logo });
    }
    for (const item of placed) {
      if (item.page !== p) continue;
      drawReview(doc, item.r, PAGE_MARGIN, item.y, contentW);
    }
    drawFooter(doc, p + 1, totalPages);
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
