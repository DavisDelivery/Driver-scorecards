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
} from "recharts";
import ChartTooltip from "../ChartTooltip.jsx";
import { topSegments, rowTotal, labelIndexes } from "../shape.js";
import {
  SURFACE,
  MAX_BAR,
  RADIUS,
  GAP,
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
export default function StackedColumns({ data, xKey, series, lines = [], xAxis = {}, margin }) {
  const keys = series.map((s) => s.id);
  const tops = topSegments(data, keys);
  const totals = data.map((r) => rowTotal(r, keys));
  const labelled = new Set(labelIndexes(totals));
  // __cap is a zero-height bar at the top of every stack: it carries the total label.
  const rows = data.map((r, i) => ({ ...r, __total: totals[i], __cap: 0 }));
  // accessibilityLayer: the chart takes focus, and the arrow keys walk the columns with
  // the tooltip following, so keyboard focus shows what hover shows.
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        margin={margin || { top: 18, right: 10, left: -12, bottom: 0 }}
        barCategoryGap="20%"
        accessibilityLayer
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
            shape={(p) => <Segment {...p} top={tops[p.index] === s.id} />}
          />
        ))}
        <Bar dataKey="__cap" stackId="s" fill="transparent" maxBarSize={MAX_BAR} isAnimationActive={false}>
          <LabelList
            dataKey="__total"
            content={(p) => (labelled.has(p.index) ? <CapLabel {...p} /> : null)}
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
// The surface-coloured stroke is the 2px gap between neighbours.
export function Segment({ x, y, width, height, fill, top }) {
  if (!(height > 0) || !(width > 0)) return null;
  const r = top ? Math.min(RADIUS, width / 2, height) : 0;
  if (!r) return <rect x={x} y={y} width={width} height={height} fill={fill} stroke={SURFACE} strokeWidth={GAP} />;
  const b = y + height;
  const d =
    `M${x},${b} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
    `L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${b} Z`;
  return <path d={d} fill={fill} stroke={SURFACE} strokeWidth={GAP} />;
}

function CapLabel({ viewBox, value }) {
  if (!viewBox || value === null || value === undefined) return null;
  const { x, y, width } = viewBox;
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" {...valueLabelStyle}>
      {Number(value).toLocaleString()}
    </text>
  );
}
