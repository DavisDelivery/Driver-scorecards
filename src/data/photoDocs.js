// Rules for what goes INTO a photo document. Pure, so they can be tested without
// Firestore.
//
// Firestore hard-caps a document at 1 MB and this project has been bitten by it
// repeatedly (see CLAUDE.md). Photos are stored one per document to stay clear of
// that — but the document was carrying the same image bytes THREE times, because the
// NuVizz fetcher builds each photo as `{ ...doc, dataUri, url: dataUri }` and that
// whole object was stored as `meta` alongside the `url` field. The size guard only
// measured one copy, so a 350 KB photo passed a 900 KB limit and then failed the 1 MB
// cap on write: the incident saved, the photos didn't.

// Roughly how many bytes a document will occupy. Base64 data URIs are ASCII, so one
// character is one byte and JSON length is a close enough estimate to guard with.
export function approxDocBytes(payload) {
  try {
    return JSON.stringify(payload ?? null).length;
  } catch {
    return Infinity; // circular / unserialisable — definitely don't try to store it
  }
}

// Photo metadata worth keeping: the descriptive fields (guid, extension, path,
// filename, timestamps) and never the image bytes, which live in the document's own
// `url` field. Anything that is a data URI, or simply too long to be a label, is
// dropped rather than stored a second and third time.
const MAX_META_STRING = 512;

export function slimPhotoMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (value.startsWith("data:") || value.length > MAX_META_STRING) continue;
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
    // Nested objects/arrays are dropped: nothing in a photo's metadata needs them,
    // and they are how bytes sneak back in.
  }
  return Object.keys(out).length ? out : null;
}
