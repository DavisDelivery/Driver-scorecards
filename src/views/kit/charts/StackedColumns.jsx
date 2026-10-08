import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ReferenceLine,
} from "recharts";
import ChartTooltip from "../ChartTooltip.jsx";
import { topSegments, rowTotal, labelIndexes } from "../shape.js";
import {
  SURFACE,
  MAX_BAR,
  RADIUS,
  GAP,
  PRIOR,
  axisProps,
  gridProps,
  cursorFill,
  valueLabelStyle,
} from "../chartTheme.js";

// Category columns stacked in the registry's order, on one count axis.
//
//   data    rows keyed by xKey and by each series id
//   series  [{ id, label, color }], bottom of the stack first (use categoriesFor on an
//           orderSeries'd list, so a category keeps its slot and its colour)
//   lines   [{ id, label, color, dots? }] — a total drawn over the columns on the SAME
//           axis (last year's total, the driver-fault count); never a second scale
//
// Marks: ≤ 24px columns, a 2px surface gap between segments, 4px rounding on the top
// segment of each column only, and the column total labelled on the latest and the
// largest column. Every other value is in the tooltip and the table view.
//
//   onMark       (row, index) => void — a click anywhere in a column's band picks it, so
//                the hit target is the whole slot, not just the painted segments
//   selectedKey  keyOf(row) of the picked column; the others fade while it's set
//   gapKey       a row field holding a short label ("no scan", "part not loaded") for a
//                column the data doesn't fully cover. With nothing to draw it's a
//                labelled hairline, never a zero column; over a column the label stands
//                above it, never across the bar, and is left to the hover and the table
//                when there's no room above
export default function StackedColumns({
  data,
  xKey,
  series,
  lines = [],
  xAxis = {},
  margin,
  onMark = null,
  selectedKey = null,
  keyOf = (d) => d.key,
  gapKey = null,
}) {
  const keys = series.map((s) => s.id);
  const tops = topSegments(data, keys);
  const totals = data.map((r) => rowTotal(r, keys));
  const labelled = new Set(labelIndexes(totals));
  // __cap is a zero-height bar at the top of every stack: it carries the total label.
  const rows = data.map((r, i) => ({ ...r, __total: totals[i], __cap: 0 }));
  const plotMargin = margin || { top: 18, right: 10, left: -12, bottom: 0 };
  // accessibilityLayer: the chart takes focus, and the arrow keys walk the columns with
  // the tooltip following, so keyboard focus shows what hover shows.
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        margin={plotMargin}
        barCategoryGap="20%"
        accessibilityLayer
        onClick={
          onMark
            ? (e) => {
                const i = e?.activeTooltipIndex;
                if (i !== undefined && i !== null && data[i]) onMark(data[i], i);
              }
            : undefined
        }
        style={onMark ? { cursor: "pointer" } : undefined}
      >
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} {...xAxis} />
        <YAxis {...axisProps} allowDecimals={false} width={44} />
        <Tooltip cursor={cursorFill} content={<ChartTooltip series={series} lines={lines} total={series.length > 1} />} />
        {series.map((s) => (
          <Bar
            key={s.id}
            dataKey={s.id}
            name={s.label}
            stackId="s"
            fill={s.color}
            maxBarSize={MAX_BAR}
            isAnimationActive={false}
            shape={(p) => (
              <Segment
                {...p}
                top={tops[p.index] === s.id}
                dim={selectedKey !== null && keyOf(data[p.index] || {}) !== selectedKey}
              />
            )}
          />
        ))}
        {gapKey &&
          data.map((r, i) =>
            r[gapKey] && !totals[i] ? (
              <ReferenceLine
                key={`gap-${r[xKey]}`}
                x={r[xKey]}
                stroke={PRIOR}
                strokeWidth={1}
                label={<GapLabel text={r[gapKey]} />}
              />
            ) : null,
          )}
        <Bar dataKey="__cap" stackId="s" fill="transparent" maxBarSize={MAX_BAR} isAnimationActive={false}>
          <LabelList
            dataKey="__total"
            content={(p) => (
              <CapLabel
                {...p}
                total={labelled.has(p.index)}
                gap={gapKey && totals[p.index] ? data[p.index]?.[gapKey] : null}
                plotTop={plotMargin.top || 0}
              />
            )}
          />
        </Bar>
        {lines.map((l) => (
          <Line
            key={l.id}
            type="linear"
            dataKey={l.id}
            name={l.label}
            stroke={l.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={l.dots ? { r: 4, fill: l.color, stroke: SURFACE, strokeWidth: 2 } : false}
            activeDot={{ r: 4, fill: l.color, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// One stacked segment: square, or rounded on top when it's the column's topmost.
// The surface-coloured stroke is the 2px gap between neighbours. `dim` fades a column
// that isn't the picked one.
export function Segment({ x, y, width, height, fill, top, dim = false }) {
  if (!(height > 0) || !(width > 0)) return null;
  const r = top ? Math.min(RADIUS, width / 2, height) : 0;
  const opacity = dim ? 0.35 : 1;
  if (!r) {
    return <rect x={x} y={y} width={width} height={height} fill={fill} stroke={SURFACE} strokeWidth={GAP} opacity={opacity} />;
  }
  const b = y + height;
  const d =
    `M${x},${b} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
    `L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${b} Z`;
  return <path d={d} fill={fill} stroke={SURFACE} strokeWidth={GAP} opacity={opacity} />;
}

// The label on a no-data hairline: set upright along the line, just left of it, from
// the baseline up, in muted ink.
function GapLabel({ viewBox, text }) {
  if (!viewBox) return null;
  const x = viewBox.x;
  const y = viewBox.y + viewBox.height - 4;
  return (
    <text x={x} y={y} dy={-3} transform={`rotate(-90 ${x} ${y})`} {...valueLabelStyle} fontSize={9}>
      {text}
    </text>
  );
}

// What stands on top of a column: its total, when it's one of the labelled columns,
// and a gap label, set upright above that, when there's room for it under the plot's
// top edge (9px mono: about 5.4px a character).
function CapLabel({ viewBox, value, total, gap, plotTop }) {
  if (!viewBox) return null;
  const { x, y, width } = viewBox;
  const showTotal = total && value !== null && value !== undefined;
  const gapFrom = y - (showTotal ? 18 : 4);
  const showGap = gap && gapFrom - plotTop >= String(gap).length * 5.4;
  if (!showTotal && !showGap) return null;
  const gx = x + width / 2 + 3;
  return (
    <g>
      {showTotal && (
        <text x={x + width / 2} y={y - 6} textAnchor="middle" {...valueLabelStyle}>
          {Number(value).toLocaleString()}
        </text>
      )}
      {showGap && (
        <text x={gx} y={gapFrom} transform={`rotate(-90 ${gx} ${gapFrom})`} {...valueLabelStyle} fontSize={9}>
          {gap}
        </text>
      )}
    </g>
  );
}
