// The category vocabulary: every category's id, label, polarity and colour, kept in
// one place.
//
// Six copies of this list had drifted apart — analytics.js, the Scorecard, Trends, the
// drivers.js colours, the manual-entry tab configs and the PDF's categoryColor — so
// Forgotten Freight was two different oranges, Late was a yellow on screen and an
// amber in print, and Attempts printed gray. Every screen and both PDFs read it from
// here now. Add a colour anywhere else and the two will drift again.
//
// Polarity says what a category IS, so a view can never add the wrong things up:
//   failure   counts against the driver ("Counted failures")
//   attempt   a delivery attempt — its own measure, never summed with failures
//   credit    a compliment — never added to or netted against failures
//   excluded  logged and listed, but charted and rolled up nowhere
//
// COLOURS. The array order is the stack order, and its first six hues are the
// validated categorical palette — the same hue family as before (red, orange, pink,
// amber, violet, teal), with the candy brightness taken out: chroma 0.105–0.145, OKLCH
// lightness 0.49–0.74, so the marks sit quietly on white and the numbers lead.
//
//   node validate_palette.js "#994137,#e2975f,#c16791,#a07e12,#7052a6,#20a1af"
//        --mode light --surface "#ffffff"           → ALL CHECKS PASS
//
//   worst adjacent CVD ΔE 12.9 (late ↔ misdelivery, deutan; was 16.1)
//   worst adjacent normal-vision ΔE 16.9 (misdelivery ↔ forgotten freight)
//   one contrast WARN: Forgotten Freight 2.38:1 — relieved by every chart's table view
//   and by values written in ink beside the marks
//
// Misdelivery pink still must not sit beside Attempts teal (all-pairs deutan ΔE 4.8):
// the stack order keeps them apart.
//
// The rest are deliberately NOT validated slots:
//   complaint   the de-emphasis gray — next to the five failure hues it reads as
//               "Other", which is what it is
//   compliment  an olive green, drawn only on its own card and tab. It now reads clearly
//               apart from Attempts (normal ΔE 16.2, CVD ≥ 16.3; it was 11.3), but it is
//               still never stacked beside it.
//   excluded    neutral slates/blue; never charted, only named on rows.

const LIST = [
  { id: "damage", label: "Damage", title: "Damages", polarity: "failure", color: "#994137" },
  { id: "forgotten_freight", label: "Forgotten Freight", title: "Forgotten Freight", polarity: "failure", color: "#e2975f" },
  { id: "misdelivery", label: "Misdelivery", title: "Misdeliveries", polarity: "failure", color: "#c16791" },
  { id: "late", label: "Late", title: "Lates", polarity: "failure", color: "#a07e12" },
  { id: "missing", label: "Lost/Missing", title: "Lost / Missing", polarity: "failure", color: "#7052a6" },
  { id: "attempts", label: "Attempts", title: "Attempts", polarity: "attempt", color: "#20a1af" },
  { id: "complaint", label: "Complaint", title: "Complaints", polarity: "failure", color: "#94a3b8" },
  { id: "compliment", label: "Compliment", title: "Compliments", polarity: "credit", color: "#6f992a" },
  { id: "return", label: "Return", title: "Returns", polarity: "excluded", color: "#3b82f6" },
  { id: "trace", label: "Trace", title: "Traces", polarity: "excluded", color: "#64748b" },
  // Logged from Forgotten Freight when a PRO can't be tracked to a driver: a record of a
  // failed lookup, not something charged to anyone.
  { id: "unable_to_track", label: "Unable to Track", title: "Unable to Track", polarity: "excluded", color: "#64748b" },
];

export const CATEGORIES = LIST.map((c, order) => ({ ...c, order }));

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
const ids = (polarity) => CATEGORIES.filter((c) => c.polarity === polarity).map((c) => c.id);

// What counts against a driver, in the validated stack order.
export const FAILURES = ids("failure");
export const ATTEMPTS = "attempts";
export const CREDIT = ids("credit");
export const EXCLUDED = ids("excluded");

// The eight categories the history rollup tracks (firebase.js builds TRACKED from this)
// and the Scorecard charts. Used to qualify the blend's cells, so every view decides
// which categories of which months are live the same way.
export const COUNTED8 = CATEGORIES.filter((c) => c.polarity !== "excluded").map((c) => c.id);

// The six Trends and Reports stack: the failures that come from Uline reports and the
// manual-entry tabs, plus Attempts — the validated six-slot order.
export const CHARTED6 = ["damage", "forgotten_freight", "misdelivery", "late", "missing", "attempts"];

// A category id the registry doesn't know is still shown, never hidden, in this gray.
export const OTHER_COLOR = "#94a3b8";

export const category = (id) => BY_ID.get(id) || null;
export const catLabel = (id) => BY_ID.get(id)?.label || String(id || "");
export const catTitle = (id) => BY_ID.get(id)?.title || catLabel(id);
export const catColor = (id) => BY_ID.get(id)?.color || OTHER_COLOR;
export const catPolarity = (id) => BY_ID.get(id)?.polarity || null;

// [{ id, label, title, color, polarity, order }] for the given ids, in the given order.
export const categoriesFor = (list) =>
  list.map((id) => BY_ID.get(id) || { id, label: catLabel(id), title: catTitle(id), color: OTHER_COLOR });

// The colour as an [r, g, b] triple, for jsPDF.
export function catRgb(id) {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(catColor(id));
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// Inline style for a category chip: the chip is tinted from the category's own colour
// (styles.css .chip.cat) and its text stays ink.
export const catChipStyle = (id) => ({ "--cat": catColor(id) });
