// Guards the rules behind PDF photo embedding.
//
// These exist because a real report went out with 38 photos in it of which 32 were
// solid white rectangles: correct size, correct position, no pixels, no error. The
// canvas re-encode painted an image that had loaded but not yet decoded, and a
// silently-blank canvas is indistinguishable from a successful one unless you look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { photoSourcePlan, isAllWhite } from "../src/reports/photoEncoding.js";

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
