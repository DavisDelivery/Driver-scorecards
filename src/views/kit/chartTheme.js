// One Recharts chrome for every chart in the app. Recharts writes SVG attributes, which
// can't read CSS custom properties, so the hexes here mirror the :root tokens in
// styles.css. None of them is a category colour: those live in data/categories.js.
//
// Marks follow the dataviz skill and the chart design rules in CLAUDE.md: bars sized by
// kit/shape.js barGeometry (62% of the slot, at most 36px — 72px for 7 slots or fewer), 4px rounding on the data end
// only, a 2px surface gap between stacked segments, solid 1px horizontal gridlines, and
// all text in ink — Inter, 11px, never smaller.

export const SURFACE = "#ffffff"; // --bg-1, the card and plot surface
export const GRID = "#eef1f5"; // --hairline: gridlines, dividers inside a card
export const BASELINE = "#d5dbe3"; // --chart-baseline: the x baseline and tick marks
export const ZERO = "#e3e7ed"; // --chart-zero: the 2px stub of a counted zero
export const WASH = "#f2f4f7"; // --chart-wash: a slot with no count, a bar-list track
export const HOVER_BAND = "rgba(17,24,39,0.04)"; // --hover-band: the hovered slot
export const INK_0 = "#111827"; // --text-0
export const INK_1 = "#374151"; // --text-1
export const INK_2 = "#6b7280"; // --text-2
export const BRAND = "#234294"; // --davis-blue: single-series and emphasis fill
export const DEEMPH = "#cbd5e1"; // everyone else when one mark is in focus
export const PRIOR = "#94a3b8"; // a comparison series (last year), solid — never dashed

export const RADIUS = 4;
export const GAP = 2;
// A bucket still in progress (this month, this week) is drawn at this opacity.
export const PARTIAL_OPACITY = 0.45;

export const SANS = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const axisTick = { fill: INK_2, fontSize: 11, fontFamily: SANS };
export const axisProps = { tick: axisTick, axisLine: false, tickLine: false };
export const gridProps = { stroke: GRID, vertical: false };
export const cursorFill = { fill: HOVER_BAND };
export const valueLabelStyle = { fontSize: 11, fontFamily: SANS, fill: INK_1, fontWeight: 500 };
// The tooltip's Recharts props, the same on every chart.
export const tooltipProps = {
  offset: 14,
  isAnimationActive: false,
  allowEscapeViewBox: { x: false, y: true },
  wrapperStyle: { outline: "none", zIndex: 5 },
};
