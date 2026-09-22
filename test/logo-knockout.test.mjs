// Guards the rules for putting an UPLOADED logo on a report.
//
// These exist because a real report went out with the company's own logo rendered as
// a white sticker on the blue banner: the upload is a JPEG-style image with an opaque
// white background, and dropping it on a dark header unchanged shows the background
// as much as the mark.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cornerBackground,
  distanceFromBackground,
  isLightBackground,
  contentBounds,
  worthTrimming,
} from "../src/reports/logoKnockout.js";

const WHITE = [255, 255, 255];
const NEAR_WHITE = [252, 254, 253]; // what the real upload's corners actually are

test("corners that agree identify a flat background", () => {
  assert.deepEqual(cornerBackground([WHITE, WHITE, WHITE, WHITE]), WHITE);
  // JPEG noise must not defeat the match — the real logo's corners vary by a few.
  assert.deepEqual(
    cornerBackground([NEAR_WHITE, [251, 253, 250], [254, 254, 254], [252, 254, 253]]),
    NEAR_WHITE,
  );
});

test("corners that disagree mean there is nothing to key out", () => {
  // A photo or full-bleed design: leave it completely alone rather than guessing.
  assert.equal(cornerBackground([WHITE, [12, 40, 90], WHITE, [200, 30, 30]]), null);
  assert.equal(cornerBackground([WHITE, WHITE]), null);
  assert.equal(cornerBackground(null), null);
});

test("only a light background gets knocked out to white", () => {
  assert.equal(isLightBackground(WHITE), true);
  assert.equal(isLightBackground(NEAR_WHITE), true);
  // Already dark, or already brand-coloured: re-colouring it would destroy the mark.
  assert.equal(isLightBackground([35, 66, 148]), false);
  assert.equal(isLightBackground([0, 0, 0]), false);
  assert.equal(isLightBackground(null), false);
});

test("background pixels get no alpha, artwork does", () => {
  // Pure background and its JPEG noise are invisible...
  assert.equal(distanceFromBackground(255, 255, 255, WHITE), 0);
  assert.equal(distanceFromBackground(250, 252, 251, WHITE), 0);
  // ...while the brand blue is fully opaque white in the knockout.
  assert.equal(distanceFromBackground(35, 66, 148, WHITE) > 0.8, true);
  // An antialiased edge lands in between, which is what keeps edges smooth.
  const edge = distanceFromBackground(180, 195, 220, WHITE);
  assert.equal(edge > 0 && edge < 1, true);
});

test("content bounds find the artwork inside a wide margin", () => {
  // 10x10 image with a 3px-inset 4x2 block of content.
  const box = contentBounds(10, 10, (x, y) => x >= 3 && x <= 6 && y >= 3 && y <= 4);
  assert.deepEqual(box, { x: 3, y: 3, width: 4, height: 2 });
});

test("an image that is all background has no bounds", () => {
  assert.equal(contentBounds(10, 10, () => false), null);
});

test("trimming is skipped when there is no real margin to remove", () => {
  // Re-encoding for a 1% crop just costs quality.
  assert.equal(worthTrimming({ x: 0, y: 0, width: 100, height: 100 }, 100, 100), false);
  assert.equal(worthTrimming({ x: 0, y: 0, width: 99, height: 100 }, 100, 100), false);
  // The real upload: 1217x425 of artwork inside a 1536x1024 canvas.
  assert.equal(worthTrimming({ x: 0, y: 0, width: 1217, height: 425 }, 1536, 1024), true);
  assert.equal(worthTrimming(null, 100, 100), false);
});
