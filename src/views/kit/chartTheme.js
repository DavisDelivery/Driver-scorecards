// One Recharts chrome for every chart in the app. Trends and Reports each carried
// their own copy of the tooltip, axis and legend styles, and the manual-entry charts
// used Recharts' defaults with dashed grids — three looks for one app.
//
// The mark specs follow the dataviz skill: thin bars (≤ 24px), 4px rounding on the data
// end only, a 2px surface-coloured gap between stacked segments, solid hairline grid,
// mono ticks in muted ink. Recharts writes these as SVG attributes, which can't read
// CSS custom properties, so the hexes mirror the :root tokens in styles.css.

export const SURFACE = "#ffffff"; // --bg-1, the card and plot surface
export const GRID = "#eef2f7"; // one step off the surface
export const INK_2 = "#6b7280"; // --text-2
export const BRAND = "#234294"; // --davis-blue: single-series and emphasis fill
export const DEEMPH = "#cbd5e1"; // everyone else when one bar is in focus
export const PRIOR = "#94a3b8"; // a comparison series (last year), solid — never dashed

export const MAX_BAR = 24;
export const RADIUS = 4;
export const GAP = 2;

const MONO = "JetBrains Mono, Menlo, Consolas, monospace";
export const axisTick = { fill: INK_2, fontSize: 10, fontFamily: MONO };
export const axisProps = { tick: axisTick, axisLine: false, tickLine: false };
export const gridProps = { stroke: GRID, vertical: false };
export const gridPropsHorizontalBars = { stroke: GRID, horizontal: false };
export const cursorFill = { fill: "rgba(35,66,148,0.06)" };
export const valueLabelStyle = { fontSize: 10, fontFamily: MONO, fill: INK_2 };
