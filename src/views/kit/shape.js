// The pure half of the chart kit: what a chart draws, decided without a browser so it
// can be tested. The components in this folder only render what these return.
import { CATEGORIES } from "../../data/categories.js";

const ORDER = new Map(CATEGORIES.map((c) => [c.id, c.order]));

// Series ids in the registry's fixed stack order, whatever order they arrived in. A
// category keeps its slot when others are filtered out, so it keeps its colour too.
// Ids the registry doesn't know keep their given order, after the known ones.
export function orderSeries(ids) {
  return ids
    .map((id, i) => ({ id, i }))
    .sort((a, b) => (ORDER.get(a.id) ?? 1e6 + a.i) - (ORDER.get(b.id) ?? 1e6 + b.i))
    .map((x) => x.id);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// For each row of a stacked chart, the key of its topmost non-zero segment — the only
// segment that gets rounded corners. `keys` is the stack, bottom first.
export function topSegments(rows, keys) {
  return rows.map((row) => {
    for (let i = keys.length - 1; i >= 0; i--) if ((num(row[keys[i]]) || 0) > 0) return keys[i];
    return null;
  });
}

// A stacked column's total. null — a gap, not a zero — when every segment is missing.
export function rowTotal(row, keys) {
  let total = null;
  for (const k of keys) {
    const v = num(row[k]);
    if (v !== null) total = (total || 0) + v;
  }
  return total;
}

// Which marks get a direct label: the latest one with a value and the largest, never
// every mark. Zero and missing values are never labelled, so the months still to come
// at the end of a year don't take the "latest" label from the month just gone.
export function labelIndexes(values) {
  let latest = -1;
  let max = -1;
  values.forEach((v, i) => {
    const n = num(v);
    if (n === null) return;
    if (n > 0) latest = i;
    if (max === -1 || n > num(values[max])) max = i;
  });
  return [...new Set([latest, max])]
    .filter((i) => i >= 0 && num(values[i]) > 0)
    .sort((a, b) => a - b);
}

// The table-view twin of a chart, shared by the on-screen table and the CSV.
//   x       { key, label }               the category axis
//   series  [{ id, label }]              stacked or single series
//   lines   [{ id, label }]              overlaid lines (same axis)
//   total   true to add a Total column (stacked charts)
//   source  a string for every row, or a row => string
// Missing values stay null (rendered "—", exported empty); they never become 0.
export function chartTable({ rows, x, series = [], lines = [], total = false, source }) {
  const keys = series.map((s) => s.id);
  const columns = [
    { key: x.key, label: x.label },
    ...series.map((s) => ({ key: s.id, label: s.label, num: true })),
    ...(total ? [{ key: "__total", label: "Total", num: true }] : []),
    ...lines.map((l) => ({ key: l.id, label: l.label, num: true })),
    { key: "__source", label: "Source" },
  ];
  const out = rows.map((r) => {
    const row = { [x.key]: r[x.key] };
    for (const s of series) row[s.id] = num(r[s.id]);
    if (total) row.__total = rowTotal(r, keys);
    for (const l of lines) row[l.id] = num(r[l.id]);
    row.__source = typeof source === "function" ? source(r) : source || "";
    return row;
  });
  return { columns, rows: out };
}

// One leaderboard row's bar, drawn to match the numbers beside it:
//   nested  the period lies inside the total (This Mo inside the year to date, Trends'
//           year inside all time): "3 / 12", a solid period inside a faded whole
//   not     a period reaching back over Jan 1 (12M in September, a custom range): it
//           isn't part of the year to date, so the row reads "5 · YTD 2", two counts
//           side by side, and the bar is the period alone. It used to be clamped to the
//           year to date and drawn as a full bar labelled "5 / 0"; a bar spanning both
//           would be a length no number on the row states.
//   → { solid, faded, whole }   whole = solid + faded, what the card's bars scale to
export function leaderBar({ month = 0, ytd = 0 } = {}, { nested = true } = {}) {
  const solid = Math.max(0, Number(month) || 0);
  const whole = nested ? Math.max(solid, Number(ytd) || 0) : solid;
  return { solid, faded: whole - solid, whole };
}
