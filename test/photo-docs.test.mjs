// Guards what goes into a photo document.
//
// Firestore caps a document at 1 MB. Photos are stored one per document to stay under
// it, but the document was holding the same image bytes three times: the NuVizz
// fetcher builds each photo as `{ ...doc, dataUri, url: dataUri }`, and that whole
// object was stored as `meta` next to the document's own `url`. The size guard
// measured only one of the three copies, so a 350 KB photo passed a 900 KB check and
// then failed the 1 MB cap at the server — incident saved, photos lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slimPhotoMeta, approxDocBytes } from "../src/data/photoDocs.js";

const dataUri = (kb) => "data:image/jpeg;base64," + "A".repeat(kb * 1024);

// Exactly the shape nuvizzClient.js produces.
const nuvizzPhoto = (kb) => ({
  guid: "abc-123",
  extension: "jpg",
  path: "/pod/2026/07",
  documentType: "POD",
  dataUri: dataUri(kb),
  url: dataUri(kb),
});

test("photo metadata never carries the image bytes", () => {
  const slim = slimPhotoMeta(nuvizzPhoto(300));
  assert.deepEqual(slim, {
    guid: "abc-123",
    extension: "jpg",
    path: "/pod/2026/07",
    documentType: "POD",
  });
  // The whole point: no copy of the photo survives into the metadata.
  assert.equal(JSON.stringify(slim).includes("data:image"), false);
});

test("a photo document holds one copy of the image, not three", () => {
  const photo = nuvizzPhoto(300);
  const fat = { incident_id: "i_1", idx: 0, url: photo.url, meta: photo };
  const slim = { incident_id: "i_1", idx: 0, url: photo.url, meta: slimPhotoMeta(photo) };
  // Before: ~3x the photo. After: ~1x, with room to spare under the 1 MB cap.
  assert.ok(approxDocBytes(fat) > 900_000, `fat doc was ${approxDocBytes(fat)}`);
  assert.ok(approxDocBytes(slim) < 450_000, `slim doc was ${approxDocBytes(slim)}`);
});

test("the size guard measures the document, not one field", () => {
  // A 350 KB photo: one copy is well under the 900 KB guard, three copies are not.
  const photo = nuvizzPhoto(350);
  assert.ok(photo.url.length < 900_000);
  assert.ok(approxDocBytes({ url: photo.url, meta: photo }) > 1_000_000);
  // With slimmed metadata the same photo fits and is stored instead of dropped.
  assert.ok(
    approxDocBytes({ incident_id: "i", idx: 0, url: photo.url, meta: slimPhotoMeta(photo) }) <
      900_000,
  );
});

test("slimPhotoMeta keeps labels and drops anything bulky or nested", () => {
  assert.deepEqual(
    slimPhotoMeta({
      name: "pod.jpg",
      width: 720,
      primary: true,
      blob: "x".repeat(600), // too long to be a label
      nested: { dataUri: dataUri(10) }, // how bytes sneak back in
      missing: null,
    }),
    { name: "pod.jpg", width: 720, primary: true },
  );
});

test("slimPhotoMeta returns null rather than an empty object", () => {
  assert.equal(slimPhotoMeta(null), null);
  assert.equal(slimPhotoMeta(undefined), null);
  assert.equal(slimPhotoMeta("nope"), null);
  assert.equal(slimPhotoMeta([1, 2]), null);
  assert.equal(slimPhotoMeta({ dataUri: dataUri(5) }), null);
});

test("approxDocBytes refuses to under-report something it can't serialise", () => {
  const circular = {};
  circular.self = circular;
  // Infinity means "don't store it", which is the safe direction.
  assert.equal(approxDocBytes(circular), Infinity);
});
