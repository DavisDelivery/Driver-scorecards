// Preparing an UPLOADED logo for print. Pure geometry/colour decisions live here so
// they can be tested without a browser; the canvas work is in brandLogo.js.
//
// The shipped Davis lockup ships in two cuts — brand blue for light pages, white
// knockout for the blue banner — so it always suits its background. An uploaded logo
// has only whatever the file contains, and what people actually upload is a JPEG or
// flattened PNG with an OPAQUE WHITE BACKGROUND and a wide empty margin. Dropped on
// the blue banner as-is that reads as a white sticker slapped on the header, which is
// exactly what it looked like in production.

// Background colour of an image, guessed from its four corners. Returns null when the
// corners disagree, which means there is no flat background to key out (a photo, a
// gradient, a full-bleed design) and nothing here should touch it.
export function cornerBackground(corners, tolerance = 12) {
  if (!corners || corners.length < 4) return null;
  const [r0, g0, b0] = corners[0];
  for (const [r, g, b] of corners) {
    if (
      Math.abs(r - r0) > tolerance ||
      Math.abs(g - g0) > tolerance ||
      Math.abs(b - b0) > tolerance
    ) {
      return null;
    }
  }
  return [r0, g0, b0];
}

// How far a pixel is from the background, 0..1. Used as the alpha for the knockout so
// antialiased edges stay smooth instead of turning into jagged white.
export function distanceFromBackground(r, g, b, bg) {
  const d = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
  // Below ~10% difference is background noise / JPEG ringing, not artwork.
  const FLOOR = 26;
  if (d <= FLOOR) return 0;
  return Math.min(1, (d - FLOOR) / (255 - FLOOR));
}

// A knockout only makes sense over a LIGHT background: that's the case where the
// artwork is dark-on-light and turning it white reads correctly on a dark banner.
// A logo that already has a dark or transparent background is left alone.
export function isLightBackground(bg) {
  if (!bg) return false;
  // Rec. 601 luma — good enough to tell "paper white" from "brand navy".
  const luma = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  return luma >= 200;
}

// Bounding box of everything that isn't background, given a per-pixel test.
// Returns null if the image is entirely background (nothing to show).
export function contentBounds(width, height, isContent) {
  let top = -1;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isContent(x, y)) continue;
      if (top === -1) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top === -1 || right === -1) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// Trimming to the artwork is worth doing only if there is a real margin to remove;
// re-encoding for a 1% crop just costs quality.
export function worthTrimming(box, width, height) {
  if (!box) return false;
  return box.width < width * 0.97 || box.height < height * 0.97;
}
