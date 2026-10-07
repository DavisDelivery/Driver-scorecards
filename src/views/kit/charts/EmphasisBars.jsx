import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";
import ChartTooltip from "../ChartTooltip.jsx";
import { labelIndexes } from "../shape.js";
import {
  BRAND,
  DEEMPH,
  MAX_BAR,
  RADIUS,
  axisProps,
  gridProps,
  gridPropsHorizontalBars,
  cursorFill,
  valueLabelStyle,
} from "../chartTheme.js";

// One series, optionally with one mark in focus: the focused bar keeps the series
// colour and the rest go gray (the emphasis pattern the manual-entry tabs already used
// for "click a driver"). One colour for every bar otherwise — the categories on the
// axis are nominal, so a ramp or a rainbow would only re-encode the bar length.
//
//   data          rows with an x label (xKey) and a value (valueKey)
//   color         the series colour (a category's, or the brand blue)
//   highlightKey  the focused row's keyOf(row), or null
//   onMark        (row) => void — makes the bars clickable
//   layout        "columns" (vertical) or "bars" (horizontal, a ranked list)
//   labelAll      label every bar at its tip (a ranked list reads that way); otherwise
//                 only the latest and the largest are labelled
export default function EmphasisBars({
  data,
  xKey = "label",
  valueKey = "count",
  valueName = "Count",
  color = BRAND,
  highlightKey = null,
  keyOf = (d) => d.key,
  onMark = null,
  layout = "columns",
  labelAll = false,
  categoryWidth = 132,
  xAxis = {},
}) {
  const bars = layout === "bars";
  const labelled = new Set(labelAll ? data.map((_, i) => i) : labelIndexes(data.map((d) => d[valueKey])));
  const series = [{ id: valueKey, label: valueName, color }];
  const fillOf = (d) => (highlightKey && keyOf(d) !== highlightKey ? DEEMPH : color);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={bars ? "vertical" : "horizontal"}
        margin={bars ? { top: 4, right: 30, left: 4, bottom: 4 } : { top: 18, right: 8, left: -16, bottom: 0 }}
        barCategoryGap={bars ? 6 : "20%"}
        accessibilityLayer
      >
        <CartesianGrid {...(bars ? gridPropsHorizontalBars : gridProps)} />
        {bars ? (
          <>
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis
              type="category"
              dataKey={xKey}
              width={categoryWidth}
              interval={0}
              {...axisProps}
              tick={{ ...axisProps.tick, fontSize: 11 }}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} {...xAxis} />
            <YAxis allowDecimals={false} width={40} {...axisProps} />
          </>
        )}
        <Tooltip cursor={cursorFill} content={<ChartTooltip series={series} />} />
        <Bar
          dataKey={valueKey}
          name={valueName}
          maxBarSize={MAX_BAR}
          radius={bars ? [0, RADIUS, RADIUS, 0] : [RADIUS, RADIUS, 0, 0]}
          isAnimationActive={false}
          cursor={onMark ? "pointer" : undefined}
          onClick={onMark ? (d) => onMark(d && d.payload ? d.payload : d) : undefined}
        >
          {data.map((d, i) => (
            <Cell key={keyOf(d) ?? i} fill={fillOf(d)} />
          ))}
          <LabelList
            dataKey={valueKey}
            content={(p) => (labelled.has(p.index) ? <TipLabel {...p} bars={bars} /> : null)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TipLabel({ viewBox, value, bars }) {
  if (!viewBox || !value) return null;
  const { x, y, width, height } = viewBox;
  return bars ? (
    <text x={x + width + 6} y={y + height / 2} dominantBaseline="central" {...valueLabelStyle}>
      {value}
    </text>
  ) : (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" {...valueLabelStyle}>
      {value}
    </text>
  );
}
