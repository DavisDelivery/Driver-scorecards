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

// What stands at the top of each column of a stacked chart, decided once so the bars,
// the band, the labels and the axis agree:
//   value   the column's number — its stack's total, or, for a slot with no count, the
//           `outline` value (a total another source holds: a month only imported history
//           has); null when there's neither (the slot is shaded)
//   hollow  true when `value` is the outline's: drawn as an outlined bar, never filled,
//           and never stacked on a count (a slot with a count draws no outline)
//   mark    the highest of the `marks` values at this slot (last year's total, drawn as a
//           2px tick across the column — targetTick), or null. Only a counted column
//           carries one: a slot still to come, a shaded one or an outline gets no tick
//           standing alone in the plot (the hover and the table keep the value)
export function columnCaps(rows, { keys, outline = null, marks = [] }) {
  return (rows || []).map((row) => {
    const total = rowTotal(row, keys);
    const out = outline ? num(row[outline]) : null;
    const hollow = total === null && out !== null;
    const ms = total === null ? [] : marks.map((m) => num(row[m])).filter((v) => v !== null);
    return { value: hollow ? out : total, hollow, mark: ms.length ? Math.max(...ms) : null };
  });
}

// The shaded slots of a chart, grouped by why, in the order each reason first appears:
// [{ why, keys }]. A note names each reason once — with its slots when they are months
// (monthsText) — so the reader can tell which band means what; `why(row)` is the slot's
// reason, or null for a slot that isn't shaded.
export function shadedReasons(rows, { why, keyOf = (r) => r.key }) {
  const by = new Map();
  for (const r of rows || []) {
    const w = why(r);
    if (!w) continue;
    if (!by.has(w)) by.set(w, []);
    by.get(w).push(keyOf(r));
  }
  return [...by].map(([w, keys]) => ({ why: w, keys }));
}

// The table-view twin of a chart, shared by the on-screen table and the CSV.
//   x       { key, label }               the category axis
//   series  [{ id, label, csvLabel? }]   stacked or single series (csvLabel: the CSV's
//                                        header, when an export keeps an older name)
//   lines   [{ id, label }]              overlaid lines (same axis)
//   total   true to add a Total column (stacked charts)
//   source  a string for every row, or a row => string
// Missing values stay null (rendered "—", exported empty); they never become 0.
export function chartTable({ rows, x, series = [], lines = [], total = false, source }) {
  const keys = series.map((s) => s.id);
  const columns = [
    { key: x.key, label: x.label },
    ...series.map((s) => ({ key: s.id, label: s.label, num: true, ...(s.csvLabel ? { csvLabel: s.csvLabel } : {}) })),
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

// ════════════════════════════════════════════════════════════════════════════════
// Layout: which ticks, which labels, how wide a bar, which form. Every number below is
// decided from the plot's measured width, never from a phone flag, so a chart reads
// the same at 320px and at 1440px. Dates are read from their ISO strings (CLAUDE.md
// Dates): nothing here puts a YYYY-MM-DD through new Date(ymd).
// ════════════════════════════════════════════════════════════════════════════════

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WD_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Inter's average advance at 11px is 0.582em a character (measured over dates and
// counts). Conservative enough that a label this says fits does fit.
export const CHAR_EM = 0.582;
export const textWidth = (s, px = 11) => String(s ?? "").length * CHAR_EM * px;
// Space between two neighbouring labels' boxes, and the minimum between centres beyond
// the widest label.
export const TICK_GAP = 16;

// "YYYY-MM-DD" → [y, m, d] numbers, or null.
function ymdOf(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? [+m[1], +m[2], +m[3]] : null;
}
// Days since 1970-01-01 for a calendar day, by its parts (UTC arithmetic: no DST).
const dayNum = ([y, m, d]) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
const fromDayNum = (n) => {
  const t = new Date(n * 86400000);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};
// 0 = Sun … 6 = Sat.
export const weekdayOf = (ymd) => {
  const p = ymdOf(ymd);
  return p ? (((dayNum(p) + 4) % 7) + 7) % 7 : null;
};
// ISO week number (weeks start Monday; week 1 holds the year's first Thursday).
export function isoWeek(ymd) {
  const p = ymdOf(ymd);
  if (!p) return null;
  const n = dayNum(p);
  const wd = (weekdayOf(ymd) + 6) % 7; // Mon = 0
  const thu = fromDayNum(n - wd + 3);
  const jan1 = dayNum([thu[0], 1, 1]);
  return 1 + Math.floor((n - wd + 3 - jan1) / 7);
}

const yearOfKey = (key) => String(key).slice(0, 4);
const monthOfKey = (key) => Number(String(key).slice(5, 7));

// The short label each grain puts on its axis.
function dayLabel(key) {
  const p = ymdOf(key);
  return p ? `${MONTH_ABBR[p[1] - 1]} ${p[2]}` : String(key);
}
function weekdayDayLabel(key) {
  const p = ymdOf(key);
  return p ? `${WD_ABBR[weekdayOf(key)]} ${p[2]}` : String(key);
}
const monthLabel = (key) => MONTH_ABBR[monthOfKey(key) - 1] || String(key);
const quarterLabel = (key) => {
  const m = /Q([1-4])/.exec(String(key));
  return m ? `Q${m[1]}` : String(key);
};

// The candidate tick sets for one grain, densest first. Each is { idx, label }: the
// slots it labels and how. Strides are anchored to the calendar (ISO week parity,
// January), so the ticks don't jump as a rolling window moves by a day.
function tickTiers(keys, grain) {
  const n = keys.length;
  const all = keys.map((_, i) => i);
  const where = (f) => all.filter((i) => f(keys[i], i));
  // A month starts at slot i when its month differs from the slot before it, or at
  // slot 0 when that slot is the month's first days.
  const monthStart = (k, i) =>
    i === 0 ? Number(String(k).slice(8, 10) || 1) <= (grain === "week" ? 7 : 3) : String(keys[i - 1]).slice(0, 7) !== String(k).slice(0, 7);
  if (grain === "day") {
    const p0 = ymdOf(keys[0]);
    const p1 = ymdOf(keys[n - 1]);
    const span = p0 && p1 ? dayNum(p1) - dayNum(p0) + 1 : n;
    if (span <= 7) return [{ idx: all, label: weekdayDayLabel }];
    return [
      ...(n <= 10 ? [{ idx: all, label: dayLabel }] : []),
      { idx: where((k) => weekdayOf(k) === 1), label: dayLabel },
      { idx: where((k) => weekdayOf(k) === 1 && isoWeek(k) % 2 === 0), label: dayLabel },
      { idx: where(monthStart), label: monthLabel },
      { idx: where((k, i) => monthStart(k, i) && monthOfKey(k) % 2 === 1), label: monthLabel },
    ];
  }
  if (grain === "week") {
    return [
      { idx: all, label: dayLabel },
      { idx: where((k) => isoWeek(k) % 2 === 0), label: dayLabel },
      { idx: where(monthStart), label: monthLabel },
      { idx: where((k, i) => monthStart(k, i) && (monthOfKey(k) - 1) % 3 === 0), label: monthLabel },
    ];
  }
  if (grain === "month") {
    return [
      { idx: all, label: monthLabel },
      { idx: where((k) => monthOfKey(k) % 2 === 1), label: monthLabel },
      { idx: where((k) => (monthOfKey(k) - 1) % 3 === 0), label: monthLabel },
      { idx: where((k) => monthOfKey(k) === 1 || monthOfKey(k) === 7), label: monthLabel },
      { idx: where((k) => monthOfKey(k) === 1), label: monthLabel },
    ];
  }
  if (grain === "quarter") {
    const q = (k) => Number((/Q([1-4])/.exec(String(k)) || [])[1]);
    return [
      { idx: all, label: quarterLabel },
      { idx: where((k) => q(k) === 1 || q(k) === 3), label: quarterLabel },
      { idx: where((k) => q(k) === 1), label: quarterLabel },
    ];
  }
  if (grain === "year") {
    return [
      { idx: all, label: (k) => String(k) },
      { idx: where((k) => Number(k) % 2 === 0), label: (k) => String(k) },
    ];
  }
  // Categorical (week names, driver names …): every slot, then every 2nd, 3rd …
  const tiers = [{ idx: all, label: (k) => String(k) }];
  for (const s of [2, 3, 4, 6, 12]) if (s < n) tiers.push({ idx: all.filter((i) => i % s === 0), label: (k) => String(k) });
  return tiers;
}

// Where each labelled tick's text sits: centred on its slot, unless that would cross
// the plot's edge, when it is anchored to its slot's outer edge instead.
function placeTicks(idx, labels, slot, plotWidth, px) {
  return idx.map((index, j) => {
    const w = textWidth(labels[j], px);
    const c = (index + 0.5) * slot;
    let anchor = "middle";
    let left = c - w / 2;
    if (left < 0) {
      anchor = "start";
      left = index * slot;
    } else if (c + w / 2 > plotWidth) {
      anchor = "end";
      left = (index + 1) * slot - w;
    }
    return { index, label: labels[j], anchor, left, right: left + w, center: c, width: w };
  });
}

// Neighbouring labels sit at least the widest label + TICK_GAP apart, centre to centre,
// and their boxes never touch.
function ticksFit(placed) {
  if (placed.length < 2) return true;
  const widest = Math.max(...placed.map((t) => t.width));
  for (let j = 1; j < placed.length; j++) {
    if (placed[j].center - placed[j - 1].center < widest + TICK_GAP) return false;
    if (placed[j].left - placed[j - 1].right < TICK_GAP / 2) return false;
  }
  return true;
}

// The x-axis plan for a run of keys:
//   keys       ISO keys in slot order: YYYY-MM-DD (day; week = its Monday), YYYY-MM,
//              YYYY-Qn, YYYY — or any strings for a categorical axis (grain null)
//   grain      "day" | "week" | "month" | "quarter" | "year" | null
//   plotWidth  the measured width of the plot area, px
// → { ticks: [{ index, label, anchor, year }], slot, yearLine }
//
// The first candidate set (densest first) whose labels all fit wins. If none does, the
// last is thinned — every other tick dropped — until it fits; one tick always survives.
// Labels are never rotated, never below 11px, and never forced in at the ends. A year
// line (the second line under the first tick and under each January) is drawn only
// when the keys cross a calendar year.
export function timeTicks(keys, { grain = "day", plotWidth = 0, px = 11 } = {}) {
  const n = keys.length;
  if (!n || !(plotWidth > 0)) return { ticks: [], slot: 0, yearLine: false };
  const slot = plotWidth / n;
  const tiers = tickTiers(keys, grain).filter((t) => t.idx.length);
  if (!tiers.length) tiers.push({ idx: keys.map((_, i) => i), label: (k) => String(k) });
  const place = (t) => placeTicks(t.idx, t.idx.map((i) => t.label(keys[i])), slot, plotWidth, px);
  let placed = null;
  for (const t of tiers) {
    const p = place(t);
    if (ticksFit(p)) {
      placed = p;
      break;
    }
  }
  if (!placed) {
    const last = tiers[tiers.length - 1];
    let idx = last.idx;
    let p = place({ ...last, idx });
    while (!ticksFit(p) && idx.length > 1) {
      idx = idx.filter((_, j) => j % 2 === 0);
      p = place({ ...last, idx });
    }
    placed = p;
  }
  // The year line, under the first tick and the first tick of each new year.
  const dated = grain && grain !== "year";
  const crosses = dated && yearOfKey(keys[0]) !== yearOfKey(keys[n - 1]);
  let years = [];
  if (crosses) {
    let prev = null;
    for (const t of placed) {
      const y = yearOfKey(keys[t.index]);
      if (y !== prev) years.push({ index: t.index, year: y, center: t.center, left: t.left, width: textWidth(y, px) });
      prev = y;
    }
    // A year label that would collide with the next one gives way to it.
    let changed = true;
    while (changed && years.length > 1) {
      changed = false;
      for (let j = 0; j < years.length - 1; j++) {
        const a = years[j];
        const b = years[j + 1];
        const aRight = a.left + Math.max(a.width, 0);
        if (b.center - a.center < Math.max(a.width, b.width) + TICK_GAP || b.left - aRight < TICK_GAP / 2) {
          years.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  const yearAt = new Map(years.map((y) => [y.index, y.year]));
  return {
    ticks: placed.map((t) => ({ index: t.index, label: t.label, anchor: t.anchor, year: yearAt.get(t.index) || null })),
    slot,
    yearLine: years.length > 0,
  };
}

// The hover readout's head line for a slot: no date is ambiguous anywhere.
//   day      "Tue, Sep 29, 2026"
//   week     "Week of Sep 14–20, 2026" · "Sep 28 – Oct 4, 2026" across a month
//   month    "September 2026"
//   quarter  "Q3 2026"
//   year     "2026"
// `toDate` adds " · to date (8 of 31 days)" for a bucket still in progress.
export function fmtHead(key, grain, { toDate = null } = {}) {
  const k = String(key ?? "");
  let head = k;
  if (grain === "day") {
    const p = ymdOf(k);
    if (p) head = `${WD_ABBR[weekdayOf(k)]}, ${MONTH_ABBR[p[1] - 1]} ${p[2]}, ${p[0]}`;
  } else if (grain === "week") {
    const p = ymdOf(k);
    if (p) {
      const e = fromDayNum(dayNum(p) + 6);
      if (e[0] !== p[0]) head = `${MONTH_ABBR[p[1] - 1]} ${p[2]}, ${p[0]} – ${MONTH_ABBR[e[1] - 1]} ${e[2]}, ${e[0]}`;
      else if (e[1] !== p[1]) head = `${MONTH_ABBR[p[1] - 1]} ${p[2]} – ${MONTH_ABBR[e[1] - 1]} ${e[2]}, ${e[0]}`;
      else head = `Week of ${MONTH_ABBR[p[1] - 1]} ${p[2]}–${e[2]}, ${p[0]}`;
    }
  } else if (grain === "month") {
    const m = /^(\d{4})-(\d{2})/.exec(k);
    if (m) head = `${MONTH_FULL[+m[2] - 1]} ${m[1]}`;
  } else if (grain === "quarter") {
    const m = /^(\d{4})-?Q([1-4])/.exec(k);
    if (m) head = `Q${m[2]} ${m[1]}`;
  }
  if (toDate && toDate.of) head += ` · to date (${toDate.days} of ${toDate.of} days)`;
  return head;
}

// Short date for a sentence: "Tue, Sep 29" (day), "week of Sep 14", "Jul" — with the
// year when the keys cross one ("Jul 2025").
function shortWhen(key, grain, withYear) {
  const k = String(key);
  if (grain === "day") {
    const p = ymdOf(k);
    return p ? `${WD_ABBR[weekdayOf(k)]}, ${MONTH_ABBR[p[1] - 1]} ${p[2]}${withYear ? `, ${p[0]}` : ""}` : k;
  }
  if (grain === "week") return `the week of ${dayLabel(k)}${withYear ? `, ${yearOfKey(k)}` : ""}`;
  if (grain === "month") return `${monthLabel(k)}${withYear ? ` ${yearOfKey(k)}` : ""}`;
  if (grain === "quarter") return `${quarterLabel(k)}${withYear ? ` ${yearOfKey(k)}` : ""}`;
  return k;
}
const NOUN = { day: "days", week: "weeks", month: "months", quarter: "quarters", year: "years" };

// The takeaway a chart without value labels carries in its subtitle: "peak 6 on Tue,
// Sep 29", "peak 119 in Jul", "peak 6 on Tue, Sep 29 and Thu, Oct 1", "peak 1 on 4
// days". A bucket still in progress is never named as the peak; null when nothing
// counted is above zero.
//   rows      chart rows
//   value     row => number | null
//   keyOf     row => ISO key
//   partial   row => true for a bucket still in progress
export function peakSummary(rows, { grain = "day", value = (r) => r.count, keyOf = (r) => r.key, partial = () => false } = {}) {
  const done = (rows || []).filter((r) => !partial(r) && num(value(r)) !== null);
  if (!done.length) return null;
  const max = Math.max(...done.map(value));
  if (!(max > 0)) return null;
  const top = done.filter((r) => value(r) === max);
  const keys = (rows || []).map(keyOf);
  const withYear = grain !== "year" && keys.length > 0 && yearOfKey(keys[0]) !== yearOfKey(keys[keys.length - 1]);
  const prep = grain === "day" ? "on" : "in";
  const v = max.toLocaleString("en-US");
  if (top.length === 1) return `peak ${v} ${prep} ${shortWhen(keyOf(top[0]), grain, withYear)}`;
  if (top.length === 2) return `peak ${v} ${prep} ${shortWhen(keyOf(top[0]), grain, withYear)} and ${shortWhen(keyOf(top[1]), grain, withYear)}`;
  return `peak ${v} on ${top.length} ${NOUN[grain] || "columns"}`;
}

// The count axis: whole steps of 1, 2, 5 × 10ⁿ, and 25 × 10ⁿ from 25 up — the smallest
// that reaches the max in `target` steps or fewer. The top tick is the first step at
// or above the max, so a max of 10 is 0 · 5 · 10, never 0–15 with a third of the plot
// empty. When that top would still leave more than a fifth of the plot empty (101 on
// a 0–150 axis), up to MAX_INTERVALS steps are allowed instead: 101 is 0–125.
// `decimals` allows tenths for a rate (per workday).
const MAX_INTERVALS = 5;
export function niceTicks(max, target = 4, { decimals = false } = {}) {
  const m = Number(max);
  if (!(m > 0)) return { ticks: [0, 1], top: 1, step: 1 };
  const steps = [];
  if (decimals) steps.push(0.05, 0.1, 0.2, 0.25, 0.5);
  for (let e = 1; e <= 1e9; e *= 10) {
    steps.push(1 * e, 2 * e);
    if (e >= 10) steps.push(2.5 * e);
    steps.push(5 * e);
  }
  steps.sort((a, b) => a - b);
  const stepFor = (t) => steps.find((s) => Math.ceil(m / s - 1e-9) <= t) || steps[steps.length - 1];
  const topOf = (s) => Math.ceil(m / s - 1e-9) * s;
  let step = stepFor(target);
  for (let t = target + 1; t <= MAX_INTERVALS && topOf(step) > m * 1.25; t++) {
    const s = stepFor(t);
    if (topOf(s) < topOf(step)) step = s;
  }
  const k = Math.ceil(m / step - 1e-9);
  const round = (x) => Math.round(x * 1000) / 1000;
  const ticks = Array.from({ length: k + 1 }, (_, i) => round(i * step));
  return { ticks, top: round(k * step), step };
}

// The y axis's width: its longest tick plus 8px to the plot, never under 20px.
export function yAxisWidth(ticks, px = 11) {
  const longest = Math.max(
    0,
    ...(ticks || []).map((t) => textWidth(typeof t === "number" ? t.toLocaleString("en-US") : String(t), px)),
  );
  return Math.max(20, Math.ceil(8 + longest));
}

// A column's width in its slot: 62% of the slot, at most 36px (72px for seven slots or
// fewer) and at least 2, always leaving 2px of air between neighbours; 4px rounding on
// the data end, less on a thin bar so the corner never eats it.
export function barGeometry(n, plotWidth) {
  const slot = n > 0 ? plotWidth / n : 0;
  // Seven slots or fewer across a wide card would leave 36px sticks floating in empty
  // plot: their cap lifts to 72px, so a bar still fills about half its slot.
  const cap = n > 0 && n <= 7 ? 72 : 36;
  const bar = Math.max(2, Math.min(cap, Math.round(slot * 0.62), Math.floor(slot - 2)));
  return { slot, bar, radius: Math.min(4, Math.floor(bar / 3)) };
}

// Where a column's number sits (its baseline, px): 6px over its own cap (8px over a
// counted zero's 2px stub), from the column's total. Last year's tick moves it only when
// the tick would cross it: a tick between the number's top and the column's cap lifts
// the number to stand 4px clear above the tick. A tick inside the stack, or well above
// the number, leaves it where it is — so a number is always read as its column's.
//   capTop  the y (px) of the column's top, from its total on the count axis
//   markY   the y (px) of last year's tick on the same axis, or null
export const CAP_DIGIT_H = 8; // an 11px Inter digit's height over its baseline
export function capLabelY(capTop, total, markY = null) {
  const base = capTop - (total === 0 ? 8 : 6);
  if (markY === null || markY === undefined || !Number.isFinite(markY)) return base;
  // The tick is 2px tall, centred on markY; 2px of air either side counts as touching.
  const crosses = markY + 1 >= base - CAP_DIGIT_H - 2 && markY - 1 <= capTop;
  return crosses ? Math.min(base, markY - 1 - 4) : base;
}

// Last year's total on a column: a 2px tick ACROSS the column, a little wider than it (a
// bullet chart's target), so the column stays centred on its slot and its date. It
// overhangs the column by 4px a side, never past 90% of the slot.
//   → { x0, w }   the tick's left edge from the slot's centre, and its width (px)
export function targetTick({ slot, bar }) {
  const w = Math.max(bar, Math.min(bar + 8, Math.floor(slot * 0.9)));
  return { x0: -w / 2, w };
}

// A driver card's sparkline width: 14px a slot, at least 168px — five weeks are a 168px
// strip, not five columns spread across half a card; a year of weeks takes the room it
// needs (the card caps it at its own width).
export function sparkWidth(n) {
  return Math.max(168, (Number(n) || 0) * 14);
}

// Value labels on columns: on every column or on none — never a subset, so two equal
// columns can never be labelled unequally. "all" when there are 12 columns or fewer,
// the widest value fits its slot with 8px to spare, and something is above zero;
// the y axis and grid then go (the labels carry the scale).
export function labelPlan({ n, slot, values = [] }) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  const max = nums.length ? Math.max(...nums) : 0;
  if (!(max > 0) || n > 12) return "none";
  const widest = Math.max(...nums.map((v) => textWidth(v.toLocaleString("en-US"))));
  return slot >= widest + 8 ? "all" : "none";
}

// Which form a time series takes:
//   "empty"    nothing counted
//   "few"      under `few` entries in the whole period (lowVolume): a sentence, no chart
//   "rows"     fewer than 7 slots: a bar list in time order (3–6 columns float in a
//              wide card)
//   "columns"  everything else
export function chartForm({ slots, total = null, lowVolume = false, few = 10 }) {
  if (total !== null && total <= 0) return "empty";
  if (lowVolume && total !== null && total < few) return "few";
  return slots < 7 ? "rows" : "columns";
}

// The trend's grain at this width: period.js decides the finest it may be; a day slot
// under 10px steps to weeks, a week slot under 10px to months. A window touching a
// month only imported history serves (which has no weeks) goes straight to months.
//   win  { start, end, bucket }   (period.js periodWindow)
export function chooseGrain(win, plotWidth, { historyServed = false, minSlot = 10 } = {}) {
  const grain = win?.bucket || "day";
  const a = ymdOf(win?.start);
  const b = ymdOf(win?.end);
  if (!a || !b || !(plotWidth > 0) || grain === "month") return grain;
  const days = dayNum(b) - dayNum(a) + 1;
  // Business days: the weekend slots an empty weekend drops (businessDays below).
  let weekdays = 0;
  for (let d = dayNum(a); d <= dayNum(b); d++) {
    const wd = (((d + 4) % 7) + 7) % 7;
    if (wd !== 0 && wd !== 6) weekdays++;
  }
  const weeks = Math.ceil((days + ((weekdayOf(win.start) + 6) % 7)) / 7);
  if (grain === "day" && plotWidth / Math.max(1, weekdays) >= minSlot) return "day";
  if (historyServed) return "month";
  if (plotWidth / Math.max(1, weeks) >= minSlot) return "week";
  return "month";
}

// A day axis without its empty weekends: a Saturday or Sunday row whose every series is
// 0 or null, and that carries no gap flag, is dropped. Display only — the table, the CSV,
// the drill-downs and every total keep every calendar day, and the sum is unchanged.
export function businessDays(rows, { keyOf = (r) => r.key, series = ["count"], gapKey = null } = {}) {
  return (rows || []).filter((r) => {
    const wd = weekdayOf(keyOf(r));
    if (wd !== 0 && wd !== 6) return true;
    if (gapKey && r[gapKey]) return true;
    return series.some((s) => (num(r[s]) || 0) !== 0);
  });
}

// A driver's name as a person reads it: an ALL-CAPS feed name ("SEYMOUR WATTS") is
// title-cased word by word ("Seymour Watts"); a name with any lowercase is left as
// typed. Initials stay initials: a whole name of three letters or fewer ("AB"), a word
// with no vowel ("DJ", "JR") and a numeral ("III") are left as typed, so "AB" is never
// "Ab". Display only — the raw name stays in the hover.
export function displayName(name) {
  const s = String(name ?? "");
  if (!/[A-Z]/.test(s) || /[a-z]/.test(s)) return s;
  if (s.replace(/[^A-Z]/g, "").length <= 3) return s;
  return s.replace(/[A-Z0-9]+/g, (w) =>
    !/[AEIOUY]/.test(w) || /^(II|III|IV|VI|VII|VIII)$/.test(w) ? w : w[0] + w.slice(1).toLowerCase(),
  );
}

// Tiles per row in a strip of n at this width: at most 6 from 1024px, 3 from 641px,
// 2 on a phone — balanced, so 8 tiles are 4 + 4 and 5 are one row of 5, never 6 + 2.
export function tileCols(n, width) {
  const maxCols = width >= 1024 ? 6 : width >= 641 ? 3 : 2;
  if (n <= 0) return maxCols;
  return Math.ceil(n / Math.ceil(n / maxCols));
}
// The strip's rows: [4, 4], [2, 2, 1] … A short last row stretches its tiles.
export function tileRows(n, width) {
  const cols = tileCols(n, width);
  const out = [];
  for (let left = n; left > 0; left -= cols) out.push(Math.min(cols, left));
  return out;
}

// The analytics panel's grid (a manual-entry tab's trend, By workday and its breakdown),
// packed so every row fills all 12 columns: a card never sits alone in half a row
// beside an empty hole. `cells` [{ id, span }] are in reading order, each span its
// preferred share of 12 (12, 8, 6 or 4); `width` is the grid's measured width (0 before
// the first measure: the preferred spans, packed), `gap` its column gap.
//   - Cells fill rows at their preferred spans, in order.
//   - A cell left alone after a row of two halves joins it as three thirds when a third
//     is still `min` px wide (trend · By workday · What was forgotten on one row).
//   - Any other short row's cells share its 12 columns (a lone cell spans the row).
//   - A row with a cell under `min` px goes to two halves, or one cell a row.
//   → [[{ id, span, ... }]]   every row's spans sum to 12
export function gridRows(cells, width = 0, { gap = 32, min = 300 } = {}) {
  const list = (cells || []).map((c) => ({ ...c, span: Math.max(1, Math.min(12, Math.round(c.span) || 12)) }));
  if (!list.length) return [];
  const measured = width > 0;
  // A cell's width in px at a span: its share of the tracks plus the gaps it covers.
  const px = (span) => ((width - 11 * gap) / 12) * span + gap * (span - 1);
  const fits = (span) => !measured || span === 12 || px(span) >= min;
  const rows = [];
  let row = [];
  let used = 0;
  for (const c of list) {
    if (used + c.span > 12 && row.length) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(c);
    used += c.span;
  }
  if (row.length) rows.push(row);
  const packed = [];
  for (const r of rows) {
    const sum = r.reduce((a, c) => a + c.span, 0);
    const prev = packed[packed.length - 1];
    if (sum === 12) packed.push(r);
    else if (r.length === 1 && prev && prev.length === 2 && prev.every((c) => c.span === 6) && fits(4)) {
      packed[packed.length - 1] = [...prev, ...r].map((c) => ({ ...c, span: 4 }));
    } else {
      // Share the row in proportion to the preferred spans; the last cell takes what
      // rounding leaves, so the row is exactly 12.
      let left = 12;
      packed.push(
        r.map((c, i) => {
          const span = i === r.length - 1 ? left : Math.max(1, Math.round((c.span / sum) * 12));
          left -= span;
          return { ...c, span };
        }),
      );
    }
  }
  const out = [];
  for (const r of packed) {
    if (r.every((c) => fits(c.span))) out.push(r);
    else if (r.length === 2 && fits(6)) out.push(r.map((c) => ({ ...c, span: 6 })));
    else for (const c of r) out.push([{ ...c, span: 12 }]);
  }
  return out;
}

// A bar list's rows in the order they show: sorted by value (or as given), "Not set",
// Unassigned and names the roster doesn't match always last, and only the top `limit`
// of the rest unless the list is open (or the highlighted row is below the fold).
//   → { shown, hidden, total }   hidden: how many of the ranked rows are folded away
export function barListRows(rows, { order = "value", limit = 8, open = false, highlightKey = null, keyOf = (r) => r.key } = {}) {
  const list = (rows || []).map((r, i) => ({ r, i }));
  const tail = list.filter(({ r }) => r.notSet);
  let head = list.filter(({ r }) => !r.notSet);
  if (order === "value") head = head.sort((a, b) => (num(b.r.value) || 0) - (num(a.r.value) || 0) || a.i - b.i);
  const ranked = head.map(({ r }) => r);
  const hiAt = highlightKey === null ? -1 : ranked.findIndex((r) => keyOf(r) === highlightKey);
  const all = open || !limit || ranked.length <= limit || hiAt >= limit;
  const shown = all ? ranked : ranked.slice(0, limit);
  return { shown: [...shown, ...tail.map(({ r }) => r)], hidden: ranked.length - shown.length, total: ranked.length };
}

// A run of a line's points worth drawing: a value with at least `min - 1` neighbours
// in an unbroken run. Shorter runs become null (display only — the table keeps them),
// so a 3-month average is never a lone dot or a two-point stub.
export function keepRuns(values, min = 3) {
  const out = values.map((v) => (num(v) === null ? null : v));
  let i = 0;
  while (i < out.length) {
    if (out[i] === null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] !== null) j++;
    if (j - i < min) for (let k = i; k < j; k++) out[k] = null;
    i = j;
  }
  return out;
}

// Whether a chart draws its rolling average, and where (Company History › Every month
// on file). The average is drawn only over runs of `minRun` (3) months in a row; and only
// when that leaves at least `minDrawn` (6) months drawn, one of them among the latest
// `recent` (6) — otherwise the line is a few scattered fragments that read as a
// rendering fault, and the chart drops it (the hover and the table keep every value).
//   values  the average per slot, oldest first; null where there is none
// → { values: [v | null], drawn: boolean, partial: boolean }
//   partial  drawn, but not over every slot that holds an average
export function avgLine(values, { minRun = 3, minDrawn = 6, recent = 6 } = {}) {
  const kept = keepRuns(values || [], minRun);
  const n = kept.filter((v) => v !== null).length;
  const lately = kept.slice(-recent).some((v) => v !== null);
  if (n < minDrawn || !lately) return { values: kept.map(() => null), drawn: false, partial: false };
  const had = (values || []).filter((v) => num(v) !== null).length;
  return { values: kept, drawn: true, partial: n < had };
}

// The years chart (Compare › Month by month), decided from its rows (companyMetrics.js
// yearLines), where each run key y{Y}_{k} holds one unbroken run of comparable months:
//   · a run of `minLine` (2) months or more is a line; a comparable month with no
//     comparable neighbour moves to y{Y}_lone and is drawn as a small dot, never as a
//     line of one
//   · each year's end label sits on its last line (none when the year has no line)
//   · the chart compares the other years with the first (the selected one): when that
//     year has no run of `minChart` (3) comparable months, the chart is a scatter of
//     points that says nothing a table doesn't — form "table"
// Display only: every value is the row's own and the drill-downs are untouched.
//   rows   yearLines(...).rows
//   years  [{ year, runs }] — the selected year first
// → { form: "lines" | "table", rows, ends: { [year]: run key | null }, longest }
//   longest  the selected year's longest run of comparable months
export function yearLinesPlan(rows, years, { minLine = 2, minChart = 3 } = {}) {
  const out = (rows || []).map((r) => ({ ...r }));
  const ends = {};
  const longestOf = {};
  for (const { year, runs = 0 } of years || []) {
    ends[year] = null;
    longestOf[year] = 0;
    const lone = `y${year}_lone`;
    for (let k = 0; k < runs; k++) {
      const key = `y${year}_${k}`;
      // The key's unbroken stretches (one, as yearLines builds them; split anyway).
      const stretches = [];
      let cur = null;
      out.forEach((r, i) => {
        if (num(r[key]) === null) {
          cur = null;
          return;
        }
        if (!cur) stretches.push((cur = []));
        cur.push(i);
      });
      for (const s of stretches) {
        longestOf[year] = Math.max(longestOf[year], s.length);
        if (s.length >= minLine) {
          ends[year] = key;
          continue;
        }
        for (const i of s) {
          out[i][lone] = out[i][key];
          out[i][key] = null;
        }
      }
    }
  }
  const longest = years && years.length ? longestOf[years[0].year] : 0;
  return { form: longest >= minChart ? "lines" : "table", rows: out, ends, longest };
}

// The Company History hero's sparkline: a line over each run of `minRun` (3) or more
// months in a row that hold a count, a gap band over the months between runs, and one dot
// on the latest month. With fewer than `minMonths` (6) months holding a count it isn't
// drawn at all — a few points say nothing about a trend.
//   values  one count per month, oldest first; null for a month with none (and for
//           the month in progress, which would read as a dip)
//   latest  index of the month the dot marks (the latest complete one), or -1
// → null | { runs: [[index …]], gaps: [[from, to]], latest }
export function sparkPlan(values, { latest = -1, minRun = 3, minMonths = 6 } = {}) {
  const vals = (values || []).map((v) => num(v));
  if (vals.filter((v) => v !== null).length < minMonths) return null;
  const stretches = [];
  let cur = null;
  vals.forEach((v, i) => {
    if (v === null) {
      cur = null;
      return;
    }
    if (!cur) stretches.push((cur = []));
    cur.push(i);
  });
  const runs = stretches.filter((s) => s.length >= minRun);
  const drawn = new Set(runs.flat());
  // Gaps: the stretches of months not on a line, from the first month to the last one
  // drawn or marked — never past the latest point (the month in progress isn't a gap).
  const lastShown = Math.max(latest, runs.length ? runs[runs.length - 1][runs[runs.length - 1].length - 1] : -1);
  const gaps = [];
  let from = null;
  for (let i = 0; i <= lastShown; i++) {
    const off = !drawn.has(i) && i !== latest;
    if (off && from === null) from = i;
    if (!off && from !== null) {
      gaps.push([from, i - 1]);
      from = null;
    }
  }
  if (from !== null) gaps.push([from, lastShown]);
  return { runs, gaps, latest: latest >= 0 && vals[latest] !== null ? latest : -1 };
}

// A slot's name where there is room for it (a bar list row, a drawer's head): "Mon,
// Oct 5", "Week of Sep 14", "September" — with the year when `withYear`.
export function slotLabel(key, grain, { withYear = false } = {}) {
  const k = String(key ?? "");
  if (grain === "day") {
    const p = ymdOf(k);
    return p ? `${WD_ABBR[weekdayOf(k)]}, ${MONTH_ABBR[p[1] - 1]} ${p[2]}${withYear ? `, ${p[0]}` : ""}` : k;
  }
  if (grain === "week") return `Week of ${dayLabel(k)}${withYear ? `, ${yearOfKey(k)}` : ""}`;
  if (grain === "month") {
    const m = /^(\d{4})-(\d{2})/.exec(k);
    return m ? `${MONTH_FULL[+m[2] - 1]}${withYear ? ` ${m[1]}` : ""}` : k;
  }
  if (grain === "quarter") return `${quarterLabel(k)}${withYear ? ` ${yearOfKey(k)}` : ""}`;
  return k;
}

// How much of a bucket has gone by on `today` (YYYY-MM-DD): { days, of } for a week or
// month that holds today, null for one that is whole (or a single day).
export function toDate(bucket, today) {
  const s = ymdOf(bucket?.start);
  const t = ymdOf(today);
  if (!s || !t || !bucket?.end || bucket.start === bucket.end) return null;
  if (!(bucket.start <= today && today <= bucket.end)) return null;
  const grainOf = /^\d{4}-\d{2}$/.test(String(bucket.key)) ? "month" : "week";
  const of = grainOf === "month" ? new Date(Date.UTC(s[0], s[1], 0)).getUTCDate() : 7;
  const first = grainOf === "month" ? dayNum([s[0], s[1], 1]) : dayNum(ymdOf(bucket.key) || s);
  return { days: dayNum(t) - first + 1, of };
}
