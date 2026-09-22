// Guards the rules behind PDF photo embedding.
//
// These exist because a real report went out with 38 photos in it of which 32 were
// solid white rectangles: correct size, correct position, no pixels, no error. The
// canvas re-encode painted an image that had loaded but not yet decoded, and a
// silently-blank canvas is indistinguishable from a successful one unless you look.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  photoSourcePlan,
  isAllWhite,
  printPixelCap,
  fitWithinPrintCap,
} from "../src/reports/photoEncoding.js";

test("JPEG photos skip the canvas entirely", () => {
  // POD photos are JPEG. Passing the bytes straight to jsPDF means there is no
  // canvas, so there is no decode to lose and nothing that can come back blank.
  assert.equal(photoSourcePlan("data:image/jpeg;base64,/9j/4AAQ"), "passthrough-jpeg");
  assert.equal(photoSourcePlan("data:image/jpg;base64,/9j/4AAQ"), "passthrough-jpeg");
  assert.equal(photoSourcePlan("data:image/JPEG;base64,/9j/4AAQ"), "passthrough-jpeg");
});

test("PNG and unknown sources still go through the canvas", () => {
  // jsPDF's own PNG decoder renders a black rectangle for some encodings, so PNG
  // must keep the canvas round-trip rather than join the passthrough shortcut.
  assert.equal(photoSourcePlan("data:image/png;base64,iVBORw0KG"), "canvas-png");
  assert.equal(photoSourcePlan("data:image/webp;base64,UklGRg"), "canvas-other");
  assert.equal(photoSourcePlan("https://example.com/pod.png"), "canvas-other");
});

test("photoSourcePlan tolerates junk instead of throwing mid-report", () => {
  for (const junk of [null, undefined, "", 0, {}]) {
    assert.equal(photoSourcePlan(junk), "canvas-other");
  }
});

test("a blank canvas is recognised as blank", () => {
  // Exactly what the bug produced: the white fillRect with nothing drawn over it.
  const blank = new Uint8ClampedArray(8 * 8 * 4).fill(255);
  assert.equal(isAllWhite(blank), true);
});

test("a photo is not mistaken for a blank canvas", () => {
  // One non-white pixel is enough — a real photo has thousands.
  const painted = new Uint8ClampedArray(8 * 8 * 4).fill(255);
  painted[4] = 250;
  assert.equal(isAllWhite(painted), false);

  // A pale photo (a white shipping label) must still count as painted.
  const pale = new Uint8ClampedArray(8 * 8 * 4).fill(254);
  assert.equal(isAllWhite(pale), false);
});

test("empty pixel data is not reported as blank", () => {
  // A readback that returned nothing tells us nothing; claiming "blank" there would
  // throw away a good photo in favour of the fallback path.
  assert.equal(isAllWhite(new Uint8ClampedArray(0)), false);
  assert.equal(isAllWhite(null), false);
});

// ---------------------------------------------------------------------------
// Print sizing. A printed report came back with a PostScript error across the top
// of page one — "Image in Form, Type 3 font, or Pattern is too big" — because the
// uploaded logo was a 1536x1024 image stamped at 25x17pt on every page.
// ---------------------------------------------------------------------------

test("print cap follows the size the image is actually drawn at", () => {
  // 25.5pt at 300dpi is ~106px of real detail; the 2x allowance makes it 213.
  assert.equal(printPixelCap(25.5), 213);
  assert.equal(printPixelCap(72), 600); // one inch
  // No size known means no cap — never shrink blind.
  assert.equal(printPixelCap(0), Infinity);
  assert.equal(printPixelCap(NaN), Infinity);
});

test("a wildly oversampled logo is brought down to print size", () => {
  // The real case: the uploaded logo on a page header.
  const fit = fitWithinPrintCap(1536, 1024, 25.5, 17);
  assert.ok(fit);
  assert.ok(fit.w <= printPixelCap(25.5));
  assert.ok(fit.h <= printPixelCap(17));
  // Aspect ratio preserved — 3:2 in, 3:2 out.
  assert.ok(Math.abs(fit.w / fit.h - 1536 / 1024) < 0.02);
});

test("an image already within print resolution is left alone", () => {
  // Re-encoding a photo that is only marginally over costs quality and, on the
  // JPEG path, gives up the passthrough that keeps photos from coming out blank.
  assert.equal(fitWithinPrintCap(720, 1280, 97, 173), null);
  assert.equal(fitWithinPrintCap(100, 100, 200, 200), null);
  assert.equal(fitWithinPrintCap(0, 0, 50, 50), null);
});

test("a huge modern phone photo is capped", () => {
  // 12MP straight off a phone, printed at a quarter of the page.
  const fit = fitWithinPrintCap(4032, 3024, 97, 173);
  assert.ok(fit);
  assert.ok(fit.w <= printPixelCap(97) && fit.h <= printPixelCap(173));
});
