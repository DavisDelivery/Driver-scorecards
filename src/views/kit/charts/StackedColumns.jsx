import React from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import ChartTooltip from "../ChartTooltip.jsx";
import useSize, { useCoarsePointer } from "../useSize.js";
import { topSegments, columnCaps, capLabelY, targetTick, timeTicks, niceTicks, yAxisWidth, barGeometry, labelPlan } from "../shape.js";
import {
  SURFACE,
  GAP,
  DEEMPH,
  INK_1,
  INK_2,
  PRIOR,
  BASELINE,
  ZERO,
  WASH,
  HOVER_BAND,
  PARTIAL_OPACITY,
  axisTick,
  gridProps,
  valueLabelStyle,
  tooltipProps,
} from "../chartTheme.js";

// Columns on one count axis — a single series, or categories stacked in the registry's
// order. Every layout decision comes from kit/shape.js and the plot's measured width:
// which dates the axis names (timeTicks), how wide a bar is (barGeometry), whether the
// columns carry their numbers (labelPlan: on every column or on none), and the count
// axis (niceTicks).
//
//   data     rows keyed by xKey and by each series id
//   xKey     the slot's key: an ISO date / YYYY-MM / YYYY-Qn / YYYY when `grain` is set,
//            any label otherwise
//   grain    "day" | "week" | "month" | "quarter" | "year" — or null for a categorical
//            axis (week names, years as labels)
//   series   [{ id, label, color }], bottom of the stack first (use categoriesFor on an
//            orderSeries'd list, so a category keeps its slot and its colour)
//   lines    [{ id, label, color, dots? }] — a total drawn over the columns on the SAME
//            axis (last year's total, a 3-month average); never a second scale. A line
//            with gaps (nulls) breaks there
//   hoverLines  [{ id, label, color }] — read out in the hover only, never drawn (an
//            average too broken up to draw as a line)
//   marks    [{ id, label, color }] — a comparison drawn as a 2px tick ACROSS each
//            counted column at its value, a little wider than the column (last year's
//            total, a bullet chart's target; kit/shape.js targetTick), never a line
//            through the bars. The column stays centred on its slot. A slot with no
//            column (still to come, shaded) or no value gets no tick; the hover keeps
//            the value. A column's number stays 6px over its own cap and is lifted only
//            past a tick that would cross it (capLabelY)
//   outline  { id, label, color } — for a slot with no count, a total another source
//            holds (a month only imported history has): an outlined bar at that value,
//            never filled and never stacked on a count, read out in the hover, and not
//            clickable (there is nothing behind it to list)
//
// Slot states, drawn without a word in the plot (the tooltip and the note say why):
//   a count             a bar; a counted zero is a 2px stub on the baseline
//   another source's    an outlined bar (`outline`): history's monthly total, not a count
//   no count (null)     the whole slot shaded (WASH): not captured, not loaded, no feed
//   in progress         row.__partial: the bar at 45% (this month, this week so far)
//   still to come       row.__future: nothing drawn
//
//   onMark       (row, index) => void — a click anywhere in a column's slot picks it
//   selectedKey  keyOf(row) of the picked column; the others fade while it's set (with
//                none picked, a row's own __dim fades it: a month outside the period)
//   onSegment    (row, seriesId, index) => void — a click on one painted segment
//   focusId      a series id in focus (a legend click), or several: the rest go gray
//   annotations  [{ x, before, after }] — a hairline at the left edge of slot x, worded
//                above the plot on either side: where what the chart counts changes
//   decimals     a rate (per workday): the axis may show tenths
//   capLabels    false: never label the columns (a 100% stack)
//   tickLabel    row => text, for a categorical axis (default row[xKey])
//   unit         a suffix for the hover readout's values and the count axis ("%")
//   onLabelPlan  (plan) => void — told the label plan ("all" | "none") at the measured
//                width, so a card's subtitle names the peak only when the columns don't
//                carry their numbers
export default function StackedColumns({
  data,
  xKey,
  series,
  lines = [],
  hoverLines = [],
  marks = [],
  outline = null,
  grain = null,
  tickLabel = null,
  onMark = null,
  selectedKey = null,
  keyOf = (d) => d.key,
  onSegment = null,
  focusId = null,
  annotations = [],
  decimals = false,
  capLabels = true,
  yAxis = {},
  unit = "",
  onLabelPlan = null,
}) {
  const [ref, size] = useSize();
  const coarse = useCoarsePointer();
  const segmentHit = React.useRef(false);
  const keys = series.map((s) => s.id);
  const tops = topSegments(data, keys);
  // Each column's number, whether it is an outline, and the tick it must clear
  // (kit/shape.js columnCaps).
  const caps = columnCaps(data, { keys, outline: outline?.id || null, marks: marks.map((m) => m.id) });
  const totals = caps.map((c) => c.value);
  const inFocus = (id) => !focusId || (Array.isArray(focusId) ? focusId.includes(id) : focusId === id);
  const n = data.length;
  const W = size.width;
  const H = size.height;

  // Layout, from the measured box.
  const top0 = annotations.length ? 22 : 8;
  const margin0 = { top: top0, right: 8, bottom: 0, left: 0 };
  const innerW0 = Math.max(0, W - margin0.left - margin0.right);
  // A line on the same axis would run through the numbers: with a line over the columns
  // they carry none, and the axis and grid carry the scale.
  const plan = capLabels && !lines.length ? labelPlan({ n, slot: n ? innerW0 / n : 0, values: totals }) : "none";
  const labelled = plan === "all";
  // Before the first measure there is no plan to report.
  const measured = W > 0 && H > 0;
  React.useLayoutEffect(() => {
    if (onLabelPlan && measured) onLabelPlan(plan);
  }, [onLabelPlan, plan, measured]);
  const lineVals = lines.flatMap((l) => data.map((r) => r[l.id])).filter((v) => typeof v === "number" && Number.isFinite(v));
  // Only the ticks drawn (on a counted column) set the axis: a value with no column to
  // mark is read out in the hover, never drawn.
  const markVals = caps.map((c) => c.mark).filter((v) => v !== null);
  const max = Math.max(0, ...totals.filter((v) => v !== null), ...lineVals, ...markVals);
  const y = niceTicks(max, H >= 180 ? 4 : 3, { decimals });
  const yW = labelled ? 0 : yAxisWidth(y.ticks.map((t) => `${Number(t).toLocaleString()}${unit}`));
  // Labelled columns have no axis to round up to: the tallest one reaches the top of the
  // plot, and its number's room is kept in pixels above it (margin.top), not in counts.
  const domainTop = labelled ? max : y.top;
  const margin = { ...margin0, top: Math.max(top0, labelled ? 20 : 8) };
  const plotW = Math.max(0, innerW0 - yW);
  const geo = barGeometry(n, plotW);
  const { slot } = geo;
  const { bar, radius } = geo;
  // Last year's tick across each counted column, a little wider than it (targetTick).
  const target = marks.length ? targetTick({ slot, bar }) : null;
  const tickKeys = data.map((r) => (grain ? r[xKey] : tickLabel ? tickLabel(r) : r[xKey]));
  const ticks = timeTicks(tickKeys, { grain, plotWidth: plotW });
  const tickAt = new Map(ticks.ticks.map((t) => [t.index, t]));
  const axisH = ticks.yearLine ? 38 : 24;
  // A count's y on the plot, in px — the same mapping Recharts draws with, so a column's
  // number can tell whether last year's tick would cross it (capLabelY).
  const plotTop = margin.top;
  const plotBottom = H - margin.bottom - axisH;
  const markY = (v) =>
    v === null || v === undefined || !(domainTop > 0) ? null : plotBottom - (v / domainTop) * (plotBottom - plotTop);

  const rows = data.map((r, i) => ({
    ...r,
    __total: caps[i].hollow ? null : totals[i],
    __cap: 0,
    __outline: caps[i].hollow ? caps[i].value : null,
    // The tick drawn: last year's value on a counted column only (columnCaps).
    __mark: caps[i].mark,
  }));
  const seriesFor = series.map((s) => ({ ...s, color: inFocus(s.id) ? s.color : DEEMPH }));
  const segmentOf = (s) => (p) => (
    <Segment
      {...p}
      radius={radius}
      top={tops[p.index] === s.id}
      partial={!!data[p.index]?.__partial}
      dim={selectedKey !== null ? keyOf(data[p.index] || {}) !== selectedKey : !!data[p.index]?.__dim}
    />
  );

  // A pointer never focuses the chart. With the accessibility layer on, the chart takes
  // focus on mousedown — a tap's emulated one included — and Recharts' focus handler
  // moves the readout to the FIRST slot, so a tap on a phone read out slot 0 instead of
  // the column tapped (the same guard as YearLines). Keyboard focus (Tab) still works.
  return (
    <div ref={ref} className="sc-plot" onMouseDown={(e) => e.preventDefault()}>
      {W > 0 && H > 0 && n > 0 && (
        <ComposedChart
          width={W}
          height={H}
          data={rows}
          margin={margin}
          accessibilityLayer
          onClick={
            onMark
              ? (e) => {
                  if (segmentHit.current) {
                    segmentHit.current = false;
                    return;
                  }
                  const i = e?.activeTooltipIndex;
                  // An outlined slot holds another source's total, with nothing here to
                  // list: clicking it would open less than it shows, so it opens nothing.
                  if (i !== undefined && i !== null && data[i] && !caps[i]?.hollow) onMark(data[i], i);
                }
              : undefined
          }
          style={onMark || onSegment ? { cursor: "pointer" } : undefined}
        >
          {/* Slots with no count: the whole slot shaded, neighbours merging, no text. */}
          {rows.map((r, i) =>
            totals[i] === null && !r.__future ? (
              <ReferenceArea key={`band-${i}`} x1={r[xKey]} x2={r[xKey]} fill={WASH} fillOpacity={1} stroke="none" ifOverflow="hidden" />
            ) : null,
          )}
          {!labelled && <CartesianGrid {...gridProps} horizontalValues={y.ticks.filter((t) => t > 0)} />}
          {/* The baseline is drawn over the bars (below), so they stand on it. */}
          <XAxis
            dataKey={xKey}
            interval={0}
            height={axisH}
            tickSize={0}
            tickMargin={0}
            axisLine={false}
            tickLine={false}
            tick={<TimeTick plan={tickAt} slot={slot} />}
          />
          <YAxis
            hide={labelled}
            width={yW || 1}
            domain={[0, domainTop]}
            ticks={labelled ? undefined : y.ticks}
            interval={0}
            tickSize={0}
            tickMargin={8}
            axisLine={false}
            tickLine={false}
            tick={axisTick}
            tickFormatter={(v) => `${Number(v).toLocaleString()}${unit}`}
            allowDecimals={decimals}
            {...yAxis}
          />
          <Tooltip
            {...tooltipProps}
            cursor={<BandCursor slot={slot} />}
            position={coarse ? { y: 0 } : undefined}
            content={
              <ChartTooltip
                series={seriesFor}
                lines={[...lines, ...marks, ...hoverLines, ...(outline ? [{ ...outline, optional: true, hollow: true }] : [])]}
                total={series.length > 1}
                unit={unit}
                grain={grain}
                xKey={xKey}
                readout={coarse}
              />
            }
          />
          {seriesFor.map((s) => (
            <Bar
              key={s.id}
              dataKey={s.id}
              name={s.label}
              stackId="s"
              fill={s.color}
              barSize={bar}
              isAnimationActive={false}
              onClick={
                onSegment
                  ? (d, i) => {
                      if (!data[i]) return;
                      segmentHit.current = true;
                      onSegment(data[i], s.id, i);
                    }
                  : undefined
              }
              shape={segmentOf(s)}
              // The hovered column is drawn exactly like the rest (Recharts would swap in
              // its default, lighter rectangle — which reads as "in progress"); the hover
              // band behind it is the only sign.
              activeBar={segmentOf(s)}
            />
          ))}
          {outline && (
            <Bar
              dataKey="__outline"
              name={outline.label}
              stackId="s"
              fill={outline.color}
              barSize={bar}
              isAnimationActive={false}
              shape={(p) => <Hollow {...p} radius={radius} dim={selectedKey !== null && keyOf(data[p.index] || {}) !== selectedKey} />}
              activeBar={(p) => <Hollow {...p} radius={radius} dim={selectedKey !== null && keyOf(data[p.index] || {}) !== selectedKey} />}
            />
          )}
          <ReferenceLine y={0} stroke={BASELINE} strokeWidth={1} ifOverflow="extendDomain" />
          {annotations.map((a) => (
            <ReferenceLine
              key={`note-${a.x}`}
              x={a.x}
              position="start"
              stroke={BASELINE}
              strokeWidth={1}
              label={<NoteLabel before={a.before} after={a.after} />}
            />
          ))}
          {/* A zero-height bar on top of every stack: it carries the column's number and
              draws a counted zero's stub. */}
          <Bar dataKey="__cap" stackId="s" fill="transparent" barSize={bar} isAnimationActive={false}>
            <LabelList
              dataKey="__total"
              content={(p) => (
                <CapLabel
                  {...p}
                  total={totals[p.index]}
                  hollow={caps[p.index]?.hollow}
                  labelled={labelled}
                  markY={markY(caps[p.index]?.mark)}
                />
              )}
            />
          </Bar>
          {target && (
            <Line
              type="linear"
              dataKey="__mark"
              name={marks[0].label}
              stroke="none"
              dot={<MarkTick x0={target.x0} width={target.w} color={marks[0].color || PRIOR} />}
              activeDot={false}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
              connectNulls={false}
            />
          )}
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
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      )}
    </div>
  );
}

// One x-axis tick, as the plan (kit/shape.js timeTicks) says: a 4px mark under the
// labelled slot's centre, its label under that, and the year under the first tick of
// each year when the axis crosses one. Unlabelled slots draw nothing.
export function TimeTick({ x, y, index, plan, slot }) {
  const t = plan.get(index);
  if (!t || !Number.isFinite(x)) return null;
  const tx = t.anchor === "start" ? x - slot / 2 : t.anchor === "end" ? x + slot / 2 : x;
  return (
    <g>
      <line x1={x} x2={x} y1={y} y2={y + 4} stroke={BASELINE} strokeWidth={1} />
      <text x={tx} y={y + 16} textAnchor={t.anchor} {...axisTick} style={{ fontVariantNumeric: "tabular-nums" }}>
        {t.label}
      </text>
      {t.year && (
        <text x={tx} y={y + 31} textAnchor={t.anchor} fontSize={11} fontWeight={500} fill={INK_1} fontFamily={axisTick.fontFamily}>
          {t.year}
        </text>
      )}
    </g>
  );
}

// The hover cursor: the whole slot, a faint band behind the column (spec §11.1). A
// composed chart's own cursor is a thin vertical rule, which reads as a gridline.
function BandCursor({ points, top, height, slot }) {
  const x = points?.[0]?.x;
  if (!Number.isFinite(x) || !(slot > 0)) return null;
  return <rect x={x - slot / 2} y={top} width={slot} height={height} fill={HOVER_BAND} pointerEvents="none" />;
}

// One stacked segment: square, or rounded on top when it's the column's topmost. A
// segment with another on top of it gives up its top 2px — the surface gap between
// neighbours — so the column stands flush on the baseline with no stroke around it.
// `dim` fades a column that isn't the picked one; `partial` is a bucket still in
// progress.
export function Segment({ x, y, width, height, fill, top, radius = 4, dim = false, partial = false }) {
  if (!(height > 0) || !(width > 0)) return null;
  const gap = top ? 0 : Math.min(GAP, height / 2);
  const y0 = y + gap;
  const h = height - gap;
  const r = top ? Math.min(radius, width / 2, h) : 0;
  const opacity = dim ? 0.35 : 1;
  const fillOpacity = partial ? PARTIAL_OPACITY : 1;
  if (!r) {
    return <rect x={x} y={y0} width={width} height={h} fill={fill} fillOpacity={fillOpacity} opacity={opacity} />;
  }
  const b = y0 + h;
  const d =
    `M${x},${b} L${x},${y0 + r} Q${x},${y0} ${x + r},${y0} ` +
    `L${x + width - r},${y0} Q${x + width},${y0} ${x + width},${y0 + r} L${x + width},${b} Z`;
  return <path d={d} fill={fill} fillOpacity={fillOpacity} opacity={opacity} />;
}

// An annotation's words, above the plot on either side of its hairline: what lies
// before it to the left, what lies after to the right, so neither runs across the line.
function NoteLabel({ viewBox, before, after }) {
  if (!viewBox) return null;
  const y = viewBox.y - 6;
  const style = { fontSize: 11, fontFamily: axisTick.fontFamily, fill: INK_2 };
  return (
    <g>
      {before && (
        <text x={viewBox.x - 6} y={y} textAnchor="end" {...style}>
          {before} ←
        </text>
      )}
      {after && (
        <text x={viewBox.x + 6} y={y} textAnchor="start" {...style}>
          → {after}
        </text>
      )}
    </g>
  );
}

// What stands on a column: a counted zero's 2px stub on the baseline, and — when the
// chart labels its columns (all of them, never some) — the column's total 6px above its
// own cap, lifted only past last year's tick when the tick would cross it (capLabelY). An outlined column's number is
// in ink 2 (another source's total).
function CapLabel({ viewBox, total, hollow = false, labelled, markY = null }) {
  if (!viewBox || total === null || total === undefined) return null;
  const { x, y, width } = viewBox;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ty = capLabelY(y, total, markY);
  return (
    <g>
      {total === 0 && <rect x={x} y={y - 2} width={width} height={2} rx={1} fill={ZERO} />}
      {labelled && (
        <text
          x={x + width / 2}
          y={ty}
          textAnchor="middle"
          {...valueLabelStyle}
          fill={total === 0 || hollow ? INK_2 : INK_1}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {Number(total).toLocaleString()}
        </text>
      )}
    </g>
  );
}

// A slot no count holds but another source totals (a month only imported history has):
// an outline in the series colour at that height, the plot's surface inside, rounded on
// top like any column. Never filled, so it never reads as a count.
function Hollow({ x, y, width, height, fill, radius = 4, dim = false }) {
  if (!(height > 0) || !(width > 0)) return null;
  const sw = 1.5;
  const x0 = x + sw / 2;
  const y0 = y + sw / 2;
  const w = Math.max(0, width - sw);
  const b = y + height;
  const r = Math.min(radius, w / 2, Math.max(0, height - sw));
  const d =
    `M${x0},${b} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} ` +
    `L${x0 + w - r},${y0} Q${x0 + w},${y0} ${x0 + w},${y0 + r} L${x0 + w},${b}`;
  return <path d={d} fill={SURFACE} stroke={fill} strokeWidth={sw} opacity={dim ? 0.35 : 1} />;
}

// Last year's total at one slot: a 2px tick across the column at last year's value, a
// little wider than the column (targetTick), with a 1px surface edge so it reads apart
// from the segments it crosses. Nothing where no column stands or last year has no
// number (columnCaps).
function MarkTick({ cx, cy, x0, width, color }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(width > 0)) return null;
  return (
    <rect
      x={cx + x0}
      y={cy - 1}
      width={width}
      height={2}
      rx={1}
      fill={color}
      stroke={SURFACE}
      strokeWidth={1}
      paintOrder="stroke"
      pointerEvents="none"
    />
  );
}
