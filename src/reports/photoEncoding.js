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

// How many pixels a given printed size can actually use.
//
// A laser printer rasterises at ~300dpi, so an image placed at 25pt wide can show
// about 106 pixels of detail no matter what you hand it. Handing it 1536 is invisible
// on paper and costs real money at print time: a PostScript RIP has to hold the whole
// thing to paint a postage stamp, and when it can't it gives up with
// "%%[ DirectPDF print error: Image in Form, Type 3 font, or Pattern is too big. ]%%"
// across the top of page one — which is exactly what a printed report came back with.
//
// The 2x allowance keeps a margin for scaling and for printers that go beyond 300dpi,
// without re-encoding images that are only marginally over.
export const PRINT_DPI = 300;
export const PRINT_OVERSAMPLE = 2;

export function printPixelCap(points, dpi = PRINT_DPI, oversample = PRINT_OVERSAMPLE) {
  if (!Number.isFinite(points) || points <= 0) return Infinity;
  return Math.ceil((points / 72) * dpi * oversample);
}

// Target pixel size for an image of srcW x srcH drawn at ptW x ptH, or null when it
// is already small enough to leave alone. Aspect ratio is preserved.
export function fitWithinPrintCap(srcW, srcH, ptW, ptH) {
  if (!srcW || !srcH) return null;
  const capW = printPixelCap(ptW);
  const capH = printPixelCap(ptH);
  if (srcW <= capW && srcH <= capH) return null;
  const scale = Math.min(capW / srcW, capH / srcH);
  if (!Number.isFinite(scale) || scale >= 1) return null;
  return {
    w: Math.max(1, Math.round(srcW * scale)),
    h: Math.max(1, Math.round(srcH * scale)),
  };
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
