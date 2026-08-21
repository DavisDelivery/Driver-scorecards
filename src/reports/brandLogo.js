// brandLogo.js — the logo the printed reports put in their banner.
//
// The real Davis Delivery Service lockup ships with the app (davisLogoPng.js), so a
// report is branded out of the box with nothing to configure. A logo uploaded from
// the Reviews tab overrides it — that's the path for a rebrand or a one-off letterhead
// — and it's kept in the browser as a data URI because jsPDF needs the bytes at print
// time and a blob URL wouldn't survive a reload.
import {
  DAVIS_LOGO_BLUE_PNG,
  DAVIS_LOGO_WHITE_PNG,
  LOGO_W,
  LOGO_H,
} from "./davisLogoPng.js";

const KEY = "dds_brand_logo";

// The logo's own blue, kept here rather than imported from pdfGenerator.js so this
// module has no cycle with the report that draws it.
const BRAND_BLUE = [35, 66, 148];

// The shipped artwork, natural size included so the banner can lay it out without
// waiting on an image decode.
export const SHIPPED_LOGO = {
  blue: { dataUri: DAVIS_LOGO_BLUE_PNG, size: { w: LOGO_W, h: LOGO_H } },
  white: { dataUri: DAVIS_LOGO_WHITE_PNG, size: { w: LOGO_W, h: LOGO_H } },
};

// A custom logo, if one has been uploaded in this browser. "" means use the shipped one.
export function getBrandLogo() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && raw.startsWith("data:image/") ? raw : "";
  } catch {
    return "";
  }
}

export function setBrandLogo(dataUri) {
  try {
    if (dataUri) localStorage.setItem(KEY, dataUri);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false; // quota / private mode
  }
}

// Natural pixel size, so a wide logo is letterboxed rather than squashed. Resolves to
// null if the data URI won't decode.
export function logoSize(dataUri) {
  return new Promise((resolve) => {
    if (!dataUri) return resolve(null);
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

// What a report should draw: the uploaded logo if there is one, otherwise the shipped
// lockup in the cut that suits the background. `onDark` picks the white knockout.
export async function resolveReportLogo({ onDark = false } = {}) {
  const custom = getBrandLogo();
  if (custom) {
    const size = await logoSize(custom);
    if (size) return { dataUri: custom, size, custom: true };
  }
  return { ...(onDark ? SHIPPED_LOGO.white : SHIPPED_LOGO.blue), custom: false };
}

// Draw a resolved logo at a given height, keeping its aspect ratio, and return the
// width it used so callers can lay text out beside it. Returns 0 if it couldn't be
// drawn, which lets a caller fall back to a text wordmark.
export function drawLogo(doc, logo, x, y, height) {
  if (!logo || !logo.dataUri) return 0;
  const nat = logo.size || { w: 1, h: 1 };
  const w = (nat.w / nat.h) * height;
  try {
    doc.addImage(logo.dataUri, x, y, w, height);
    return w;
  } catch {
    return 0;
  }
}

// The lockup as report furniture: drawn at `height`, returning the width used so a
// caller can place text beside it. On a dark banner pass onDark — the WHITE cut of the
// artwork is drawn on transparency, never the blue-on-white file dropped onto blue.
// If the image can't be drawn (a corrupt upload), a rounded-square "D" stands in, so
// a page is never blank-headed.
export function drawWordmark(doc, logo, x, y, height, { onDark = false } = {}) {
  const w = drawLogo(doc, logo, x, y, height);
  if (w) return w;
  if (onDark) doc.setFillColor(255, 255, 255);
  else doc.setFillColor(...BRAND_BLUE);
  doc.roundedRect(x, y, height, height, height * 0.17, height * 0.17, "F");
  doc.setFont("courier", "bold");
  doc.setFontSize(height * 0.62);
  if (onDark) doc.setTextColor(...BRAND_BLUE);
  else doc.setTextColor(255, 255, 255);
  doc.text("D", x + height / 2, y + height * 0.72, { align: "center" });
  return height;
}
