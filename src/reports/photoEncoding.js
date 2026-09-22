// Pure decisions behind putting a POD photo into a PDF. No DOM, no imports — so the
// rules that actually broke can be tested without a browser.
//
// Background: a shipped report contained 38 photos of which 32 were solid white
// rectangles. They were embedded at the correct size and position with no error
// anywhere; the pixels were simply never painted, because `img.onload` means the
// bytes arrived, not that the bitmap is decoded, and `ctx.drawImage()` on an
// undecoded image paints nothing and throws nothing.

// Which path a photo source should take.
//
// A JPEG is exactly what the canvas would re-encode it to, and jsPDF embeds JPEG
// bytes directly — so re-encoding it buys nothing and only adds a way to fail. POD
// photos are JPEG, which is why this case is worth short-circuiting.
//
// PNG and anything else still needs the canvas: jsPDF's own PNG decoder chokes on
// some encodings (interlaced / 16-bit / unusual color types) and renders a solid
// black rectangle, and the canvas also flattens transparency onto white.
export function photoSourcePlan(src) {
  const s = String(src || "");
  if (/^data:image\/jpe?g[;,]/i.test(s)) return "passthrough-jpeg";
  if (/^data:image\/png[;,]/i.test(s)) return "canvas-png";
  return "canvas-other";
}

// True when every pixel in the sample is pure white — i.e. the draw silently
// no-opped and all that is left is the white fill underneath.
//
// Exact 255s only, deliberately: a real photo of a white shipping label averages to
// *near* white once downscaled, never to exactly 255 everywhere. And a false
// positive costs only a re-encode, while a false negative ships a blank photo.
export function isAllWhite(rgba) {
  if (!rgba || rgba.length === 0) return false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] !== 255 || rgba[i + 1] !== 255 || rgba[i + 2] !== 255) return false;
  }
  return true;
}
