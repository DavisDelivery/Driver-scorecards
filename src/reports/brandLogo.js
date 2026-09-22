// brandLogo.js — the logo the printed reports put in their banner.
//
// The real Davis Delivery Service lockup ships with the app (davisLogoPng.js), so a
// report is branded out of the box with nothing to configure. A logo uploaded from
// the Reviews tab overrides it — that's the path for a rebrand or a one-off letterhead
// — and it's kept in the browser as a data URI because jsPDF needs the bytes at print
// time and a blob URL wouldn't survive a reload.
import {
  cornerBackground,
  distanceFromBackground,
  isLightBackground,
  contentBounds,
  worthTrimming,
} from "./logoKnockout.js";
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
// Prepared custom logos are cached per (source, background) so a 14-page report
// doesn't re-key the same image once per page header.
const preparedCache = new Map();

export async function resolveReportLogo({ onDark = false } = {}) {
  const custom = getBrandLogo();
  if (custom) {
    const key = `${onDark ? "dark" : "light"}:${custom.length}:${custom.slice(-64)}`;
    if (preparedCache.has(key)) return preparedCache.get(key);

    let resolved = null;
    try {
      const prepared = await prepareCustomLogo(custom, { onDark });
      if (prepared) resolved = { ...prepared, custom: true };
    } catch {
      /* fall through to the untouched upload below */
    }
    if (!resolved) {
      const size = await logoSize(custom);
      if (size) resolved = { dataUri: custom, size, custom: true };
    }
    if (resolved) {
      preparedCache.set(key, resolved);
      return resolved;
    }
  }
  return { ...(onDark ? SHIPPED_LOGO.white : SHIPPED_LOGO.blue), custom: false };
}

// Make an uploaded logo fit its background.
//
// What people upload is a JPEG or flattened PNG: opaque white background, wide empty
// margin. Two things are done to it, both only when the image actually has a flat
// background to key out (corners that agree). A photo or a full-bleed design is left
// exactly as it is.
//
//   1. TRIM the empty margin, so the mark fills the space the banner gives it instead
//      of shrinking to fit a mostly-blank canvas.
//   2. On a dark banner, KNOCK IT OUT to white: background pixels become transparent
//      and the artwork becomes white, with alpha following how far each pixel sits
//      from the background so antialiased edges stay smooth. This is what "invert the
//      logo to white" means in practice — the alternative is a white sticker on a
//      blue header.
//
// Returns { dataUri, size } or null to mean "leave the upload alone".
async function prepareCustomLogo(src, { onDark }) {
  if (typeof document === "undefined") return null;
  const img = await loadLogoImage(src);
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // tainted canvas — can't inspect it, so don't touch it
  }
  const { data } = pixels;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  // An upload that already has transparency is artwork someone prepared properly.
  // Trim it, but never re-colour it.
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const transparentCorners = corners.every((c) => c[3] < 16);
  const bg = transparentCorners ? null : cornerBackground(corners);
  if (!bg && !transparentCorners) return null; // no flat background — leave it alone

  const isContent = (x, y) => {
    const [r, g, b, a] = at(x, y);
    if (a < 16) return false;
    return bg ? distanceFromBackground(r, g, b, bg) > 0 : true;
  };

  const box = contentBounds(w, h, isContent) || { x: 0, y: 0, width: w, height: h };
  const knockout = onDark && !!bg && isLightBackground(bg);
  const oversized = box.width > LOGO_PRINT_CAP_PX || box.height > LOGO_PRINT_CAP_PX;
  if (!knockout && !oversized && !worthTrimming(box, w, h)) return null;

  const shaped = document.createElement("canvas");
  shaped.width = box.width;
  shaped.height = box.height;
  const sctx = shaped.getContext("2d");

  if (knockout) {
    const px = sctx.createImageData(box.width, box.height);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const [r, g, b, a] = at(box.x + x, box.y + y);
        const o = (y * box.width + x) * 4;
        const strength = distanceFromBackground(r, g, b, bg) * (a / 255);
        px.data[o] = 255;
        px.data[o + 1] = 255;
        px.data[o + 2] = 255;
        px.data[o + 3] = Math.round(strength * 255);
      }
    }
    sctx.putImageData(px, 0, 0);
  } else {
    sctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  }

  // Scale down to what print can actually show. The banner draws this at 26pt tall
  // and the running header at 17pt; an uploaded 1536x1024 is ~14x more pixels than
  // 300dpi can use, and that oversampled image is what made a printer refuse the
  // whole job with "Image in Form ... is too big" across the top of page one.
  const out = scaleToCap(shaped, LOGO_PRINT_CAP_PX);

  // PNG only where transparency is actually needed. jsPDF has to split an alpha PNG
  // into colour + soft-mask and re-embeds it barely compressed, so an opaque logo
  // kept as PNG would add most of a megabyte to every report for nothing.
  const needsAlpha = knockout || !bg;
  return {
    dataUri: needsAlpha ? out.toDataURL("image/png") : out.toDataURL("image/jpeg", 0.92),
    size: { w: out.width, h: out.height },
  };
}

// The logo is never drawn larger than ~80pt across, which at 300dpi is ~333px of
// real detail. 384 leaves headroom without embedding a megapixel to paint a stamp.
const LOGO_PRINT_CAP_PX = 384;

function scaleToCap(source, cap) {
  const longest = Math.max(source.width, source.height);
  if (longest <= cap) return source;
  const scale = cap / longest;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

function loadLogoImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!/^data:/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = async () => {
      // Same rule as the photo path: onload is not decoded, and reading pixels off an
      // undecoded image gets you the blank canvas instead of the logo.
      if (typeof img.decode === "function") {
        try {
          await img.decode();
        } catch {
          /* best effort */
        }
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error("logo load failed"));
    img.src = src;
  });
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
