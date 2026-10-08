import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Customized } from "recharts";
import ChartTooltip from "../ChartTooltip.jsx";
import { TimeTick } from "./StackedColumns.jsx";
import useSize, { useCoarsePointer } from "../useSize.js";
import { timeTicks, niceTicks, yAxisWidth, textWidth } from "../shape.js";
import { SURFACE, INK_1, INK_2, DEEMPH, BASELINE, axisTick, gridProps, tooltipProps } from "../chartTheme.js";

// One measure month by month, one line per year, on one axis (companyMetrics.js
// yearLines, laid out by kit/shape.js yearLinesPlan). A year's line breaks wherever a
// month is missing or what was captured changes, so a line never joins a spreadsheet
// month to an app month; a line is two months or more, and a comparable month with no
// neighbour is a small dot (y{Y}_lone). A point that can't be compared like-for-like is
// a small gray ring off the line, with no label, and one on its line but not captured
// whole is ringed. Each year's last line carries its year and value, in ink.
//
//   data     yearLinesPlan(...).rows
//   years    [{ year, label, color, runs }] — the selected year first
//   ends     yearLinesPlan(...).ends — the run key each year's label sits on
//   onPoint  (row, year) => void — opens a point: a click or tap on it (every point
//            has a 24px target from the start, so one tap opens it), or Enter on the
//            month the keyboard is on (the selected year's point first)
//   decimals the values aren't whole counts (per workday)
//
// The crosshair snaps to a month and the readout lists every year at it. A press never
// focuses the chart — focus would move the readout to the keyboard's month (January)
// under the pointer — so only the keyboard does.
export default function YearLines({ data, years, ends: endKeys = null, onPoint = null, decimals = false }) {
  const [ref, size] = useSize();
  const coarse = useCoarsePointer();
  const series = years.map((y) => ({ id: `y${y.year}`, label: y.label, color: y.color }));
  // Oldest first, so the selected year is drawn on top.
  const drawOrder = [...years].reverse();
  // Each year's label goes on the last point of its last line; a year with no line has
  // none (its legend entry names it).
  const ends = years
    .map((y) => ({ key: endKeys ? endKeys[y.year] : y.runs ? `y${y.year}_${y.runs - 1}` : null, year: y.year, color: y.color }))
    .filter((e) => e.key);
  // Room on the right for the longest end label ("2024 · 1.77", 11px Inter), so none is
  // cut off at the card's edge.
  const longest = Math.max(
    0,
    ...ends.map((e) => {
      const last = [...data].reverse().find((r) => r[e.key] !== null && r[e.key] !== undefined);
      const whole = last && !last.marked?.[e.year] && !last.off?.[e.year];
      return last ? textWidth(`${e.year} · ${Number(last[e.key]).toLocaleString()}${whole ? "" : " (not whole)"}`) : 0;
    }),
  );
  const right = Math.ceil(14 + longest);
  // The axes, from the measured box (kit/shape.js): month ticks that fit, a count axis
  // that tops out at the first nice step over the largest value.
  const W = size.width;
  const H = size.height;
  const values = data.flatMap((r) => Object.entries(r).filter(([k]) => /^y\d+_/.test(k)).map(([, v]) => v)).filter((v) => typeof v === "number" && Number.isFinite(v));
  const y = niceTicks(Math.max(0, ...values), H >= 180 ? 4 : 3, { decimals });
  const yW = yAxisWidth(y.ticks);
  const plotW = Math.max(0, W - right - yW);
  const n = data.length;
  const slot = n ? plotW / n : 0;
  // The months as calendar keys of one (any) year, so the month ticks stride from Jan.
  const keys = data.map((_, i) => `2000-${String(i + 1).padStart(2, "0")}`);
  const plan = timeTicks(keys, { grain: "month", plotWidth: plotW });
  const tickAt = new Map(plan.ticks.map((t) => [t.index, t]));
  const active = React.useRef(null);
  const open = (row, year) => {
    if (onPoint && row && row.count?.[year] !== null && row.count?.[year] !== undefined) onPoint(row, year);
  };
  const onKeyDown = (e) => {
    if (!onPoint || (e.key !== "Enter" && e.key !== " ")) return;
    const row = data[active.current];
    const year = row && years.find((y) => row.count?.[y.year] !== null && row.count?.[y.year] !== undefined);
    if (!year) return;
    e.preventDefault();
    open(row, year.year);
  };
  return (
    <div className="yl" ref={ref} onMouseDown={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
      {W > 0 && H > 0 && (
        <LineChart
          width={W}
          height={H}
          data={data}
          margin={{ top: 14, right, left: 0, bottom: 0 }}
          accessibilityLayer
          onMouseMove={(st) => {
            if (st && st.activeTooltipIndex !== undefined) active.current = st.activeTooltipIndex;
          }}
        >
          <CartesianGrid {...gridProps} horizontalValues={y.ticks.filter((t) => t > 0)} />
          {/* Each month sits mid-slot, as a column would, so the tick plan's positions
              are the points' own. */}
          <XAxis
            dataKey="label"
            interval={0}
            height={24}
            tickSize={0}
            tickMargin={0}
            axisLine={{ stroke: BASELINE }}
            tickLine={false}
            padding={{ left: slot / 2, right: slot / 2 }}
            tick={<TimeTick plan={tickAt} slot={slot} />}
          />
          <YAxis
            width={yW}
            domain={[0, y.top]}
            ticks={y.ticks}
            interval={0}
            tickSize={0}
            tickMargin={8}
            axisLine={false}
            tickLine={false}
            tick={axisTick}
            tickFormatter={(v) => Number(v).toLocaleString()}
            allowDecimals={decimals}
          />
          <Tooltip
            {...tooltipProps}
            cursor={{ stroke: INK_2, strokeWidth: 1 }}
            position={coarse ? { y: 0 } : undefined}
            content={<ChartTooltip series={series} readout={coarse} />}
          />
          {drawOrder.flatMap((y) => [
            // A comparable month with no comparable neighbour: a small dot, no line.
            <Line
              key={`y${y.year}_lone`}
              type="linear"
              dataKey={`y${y.year}_lone`}
              name={y.label}
              stroke="none"
              isAnimationActive={false}
              legendType="none"
              dot={({ key: k2, ...p }) => (
                <Point key={k2 ?? p.index} {...p} color={y.color} lone hollow={!!p.payload?.marked?.[y.year]} onClick={onPoint ? () => open(p.payload, y.year) : null} />
              )}
              activeDot={(p) => <HitDot {...p} color={y.color} onClick={onPoint ? () => open(p.payload, y.year) : null} />}
            />,
            // The points off the line: no stroke, a hollow ring each.
            <Line
              key={`y${y.year}_x`}
              type="linear"
              dataKey={`y${y.year}_x`}
              name={y.label}
              stroke="none"
              isAnimationActive={false}
              legendType="none"
              dot={({ key: k2, ...p }) => (
                <Point key={k2 ?? p.index} {...p} color={DEEMPH} hollow off onClick={onPoint ? () => open(p.payload, y.year) : null} />
              )}
              activeDot={(p) => <HitDot {...p} color={y.color} hollow onClick={onPoint ? () => open(p.payload, y.year) : null} />}
            />,
            ...Array.from({ length: y.runs }, (_, k) => {
              const key = `y${y.year}_${k}`;
              return (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  name={y.label}
                  stroke={y.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                  dot={({ key: k2, ...p }) => (
                    <Point
                      key={k2 ?? p.index}
                      {...p}
                      color={y.color}
                      hollow={!!p.payload?.marked?.[y.year]}
                      onClick={onPoint ? () => open(p.payload, y.year) : null}
                    />
                  )}
                  activeDot={(p) => (
                    <HitDot
                      {...p}
                      color={y.color}
                      hollow={!!p.payload?.marked?.[y.year]}
                      onClick={onPoint ? () => open(p.payload, y.year) : null}
                    />
                  )}
                />
              );
            }),
          ])}
          <Customized component={<EndLabels ends={ends} />} />
        </LineChart>
      )}
    </div>
  );
}

// Every point's own 24px target, there before any hover so a tap lands on it, and its
// mark: a dot when no line draws it, a hollow ring when it isn't captured whole (or
// can't be compared), nothing more on a plain point of a line.
// A point that can't be compared (`off`) is a small gray ring that recedes, so the lines
// carry the read.
function Point({ cx, cy, color, lone = false, hollow = false, off = false, onClick }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
  return (
    <g onClick={onClick || undefined} style={onClick ? { cursor: "pointer" } : undefined}>
      {onClick && <circle cx={cx} cy={cy} r={12} fill="transparent" />}
      {off ? (
        <circle cx={cx} cy={cy} r={3} fill={SURFACE} stroke={color} strokeWidth={1.5} />
      ) : hollow ? (
        <circle cx={cx} cy={cy} r={4.5} fill={SURFACE} stroke={color} strokeWidth={2} />
      ) : lone ? (
        <circle cx={cx} cy={cy} r={3} fill={color} />
      ) : null}
    </g>
  );
}

// The hovered point: a 4px dot (or ring) with a surface ring, inside a 24px target.
function HitDot({ cx, cy, color, hollow = false, onClick }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
  return (
    <g onClick={onClick || undefined} style={onClick ? { cursor: "pointer" } : undefined}>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      {hollow ? (
        <circle cx={cx} cy={cy} r={5} fill={SURFACE} stroke={color} strokeWidth={2.5} />
      ) : (
        <circle cx={cx} cy={cy} r={4.5} fill={color} stroke={SURFACE} strokeWidth={2} />
      )}
    </g>
  );
}

const LABEL_GAP = 14;
const NEAR_X = 40;

// Each year's label at the end of its line: "2026 · 64" — "(not whole)" after it when
// that month wasn't captured whole. Labels that would land on one another are moved
// apart just enough, with a hairline back to their line's end.
function EndLabels({ ends, formattedGraphicalItems }) {
  const placed = [];
  for (const e of ends) {
    const item = (formattedGraphicalItems || []).find((it) => it?.item?.props?.dataKey === e.key);
    const pts = (item?.props?.points || []).filter((p) => p.value !== null && p.value !== undefined && Number.isFinite(p.y));
    const last = pts[pts.length - 1];
    if (!last) continue;
    const whole = !last.payload?.marked?.[e.year] && !last.payload?.off?.[e.year];
    placed.push({ ...e, x: last.x, y: last.y, ly: last.y, value: last.value, whole });
  }
  // Top to bottom; a label too close to the one above it at about the same x moves down.
  placed.sort((p, q) => p.y - q.y);
  for (let i = 1; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      const p = placed[j];
      const q = placed[i];
      if (Math.abs(p.x - q.x) < NEAR_X && q.ly - p.ly < LABEL_GAP) q.ly = p.ly + LABEL_GAP;
    }
  }
  return (
    <g className="yl-ends">
      {placed.map((p) => (
        <g key={p.key}>
          {p.ly !== p.y && <line x1={p.x + 3} y1={p.y} x2={p.x + 7} y2={p.ly} stroke={BASELINE} strokeWidth={1} />}
          <text
            x={p.x + 8}
            y={p.ly}
            dy="0.32em"
            fontSize={11}
            fontWeight={500}
            fontFamily={axisTick.fontFamily}
            fill={INK_1}
            stroke={SURFACE}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {p.year} · {Number(p.value).toLocaleString()}
            {p.whole ? "" : " (not whole)"}
          </text>
        </g>
      ))}
    </g>
  );
}
