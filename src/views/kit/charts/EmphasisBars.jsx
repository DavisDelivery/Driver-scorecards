import React from "react";
import StackedColumns from "./StackedColumns.jsx";
import { BRAND } from "../chartTheme.js";

// One series of columns, optionally with one in focus: the focused column keeps the
// series colour and the rest fade. One colour for every column otherwise — the slots are
// nominal or time, so a ramp would only re-encode the bar length. It is StackedColumns
// with a single series, so every column chart in the app shares one set of rules (ticks,
// bar width, labels on all or none). A ranked list is a BarList, not this.
//
//   data          rows with an x key (xKey) and a value (valueKey)
//   grain         the x key's grain ("month" …), or null for labels
//   color         the series colour (a category's, or the brand blue)
//   highlightKey  the focused row's keyOf(row), or null
//   onMark        (row) => void — makes the columns clickable
export default function EmphasisBars({
  data,
  xKey = "key",
  grain = null,
  tickLabel = null,
  valueKey = "count",
  valueName = "Count",
  color = BRAND,
  highlightKey = null,
  keyOf = (d) => d.key,
  onMark = null,
}) {
  return (
    <StackedColumns
      data={data}
      xKey={xKey}
      grain={grain}
      tickLabel={tickLabel}
      series={[{ id: valueKey, label: valueName, color }]}
      selectedKey={highlightKey}
      keyOf={keyOf}
      onMark={onMark ? (row) => onMark(row) : null}
    />
  );
}
