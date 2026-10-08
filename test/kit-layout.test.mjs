// Guards the layout half of the chart kit (kit/shape.js): which ticks an axis labels,
// which columns carry a number, how wide a bar is, which form a series takes. Chad's
// Forgotten Freight screen labelled every day of a 30-day axis ("09/09 09/11 09/12 …")
// until the dates ran into each other; these keep any axis from doing that again, at any
// width.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textWidth,
  TICK_GAP,
  timeTicks,
  fmtHead,
  niceTicks,
  yAxisWidth,
  barGeometry,
  labelPlan,
  capLabelY,
  targetTick,
  CAP_DIGIT_H,
  gridRows,
  sparkWidth,
  columnCaps,
  chartForm,
  chooseGrain,
  tileCols,
  tileRows,
  businessDays,
  isoWeek,
  weekdayOf,
} from "../src/views/kit/shape.js";

// ── Key builders (string arithmetic, no Date of a YYYY-MM-DD) ────────────────────────
const pad = (n) => String(n).padStart(2, "0");
function dayKeys(start, n) {
  let [y, m, d] = start.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${pad(m)}-${pad(d)}`);
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  }
  return out;
}
const weekKeys = (monday, n) => dayKeys(monday, n * 7).filter((_, i) => i % 7 === 0);
function monthKeys(start, n) {
  let [y, m] = start.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
function quarterKeys(year, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(`${year + Math.floor(i / 4)}-Q${(i % 4) + 1}`);
  return out;
}
const yearKeys = (from, n) => Array.from({ length: n }, (_, i) => String(from + i));

const WIDTHS = [...Array.from({ length: 54 }, (_, i) => 280 + i * 40), 320, 390, 720, 1200, 1440, 1920];

// The boxes a plan's labels occupy, as TimeTick draws them.
function boxes(plan, keys, plotWidth) {
  const slot = plotWidth / keys.length;
  return plan.ticks.map((t) => {
    const w = textWidth(t.label);
    const c = (t.index + 0.5) * slot;
    const left = t.anchor === "start" ? t.index * slot : t.anchor === "end" ? (t.index + 1) * slot - w : c - w / 2;
    return { ...t, c, w, left, right: left + w };
  });
}

function checkPlan(keys, grain, plotWidth) {
  const plan = timeTicks(keys, { grain, plotWidth });
  const where = `${grain} n=${keys.length} @${plotWidth}px`;
  assert.ok(plan.ticks.length >= 1, `${where}: at least one tick`);
  const b = boxes(plan, keys, plotWidth);
  const widest = Math.max(...b.map((x) => x.w));
  for (let j = 1; j < b.length; j++) {
    assert.ok(b[j].c - b[j - 1].c >= widest + TICK_GAP - 1e-9, `${where}: ${b[j - 1].label} and ${b[j].label} closer than a label`);
    assert.ok(b[j].left >= b[j - 1].right, `${where}: ${b[j - 1].label} and ${b[j].label} overlap`);
  }
  for (const x of b) {
    assert.ok(x.left >= -1e-9 && x.right <= plotWidth + 1e-9 || b.length === 1, `${where}: ${x.label} runs off the plot`);
    assert.doesNotMatch(x.label, /^\d\d\/\d\d$/, `${where}: no MM/DD label`);
    if (grain === "month") assert.doesNotMatch(x.label, /^[A-Z][a-z]{2} \d\d$/, `${where}: no "May 26"`);
  }
  // Ticks in slot order, each on a real slot.
  for (let j = 1; j < plan.ticks.length; j++) assert.ok(plan.ticks[j].index > plan.ticks[j - 1].index);
  for (const t of plan.ticks) assert.ok(t.index >= 0 && t.index < keys.length);
  return plan;
}

test("no two ticks on any axis are closer than their labels, at any width", () => {
  const cases = [];
  for (const n of [3, 5, 7, 10, 14, 22, 30, 45, 60, 90, 180, 400]) cases.push(["day", dayKeys("2026-01-12", n)]);
  for (const n of [3, 8, 13, 26, 52, 104]) cases.push(["week", weekKeys("2025-12-29", n)]);
  for (const n of [3, 6, 12, 24, 36, 46, 120]) cases.push(["month", monthKeys("2023-01", n)]);
  for (const n of [4, 8, 16]) cases.push(["quarter", quarterKeys(2023, n)]);
  for (const n of [3, 8, 20]) cases.push(["year", yearKeys(2010, n)]);
  for (const [grain, keys] of cases) for (const w of WIDTHS) checkPlan(keys, grain, w);
});

test("Chad's 30 days: week-start ticks, Sep 14 · Sep 21 · Sep 28 · Oct 5, at every width", () => {
  const days = dayKeys("2026-09-09", 30);
  const rows = businessDays(days.map((key) => ({ key, count: 0 })));
  assert.equal(rows.length, 22, "30 calendar days are 22 business days");
  const keys = rows.map((r) => r.key);
  for (const w of [300, 320, 690, 720, 1200, 1340, 2400]) {
    const plan = checkPlan(keys, "day", w);
    assert.deepEqual(plan.ticks.map((t) => t.label), ["Sep 14", "Sep 21", "Sep 28", "Oct 5"], `@${w}px`);
    // Every tick is a Monday.
    for (const t of plan.ticks) assert.equal(weekdayOf(keys[t.index]), 1);
    assert.equal(plan.yearLine, false);
  }
  // With the weekends drawn too (a calendar axis), it is still the Mondays.
  for (const w of [320, 720, 1200]) {
    assert.deepEqual(checkPlan(days, "day", w).ticks.map((t) => t.label), ["Sep 14", "Sep 21", "Sep 28", "Oct 5"]);
  }
});

test("a week of days reads Mon 5 … Thu 8; ten days or fewer label every day when they fit", () => {
  const week = dayKeys("2026-10-05", 4);
  assert.deepEqual(checkPlan(week, "day", 300).ticks.map((t) => t.label), ["Mon 5", "Tue 6", "Wed 7", "Thu 8"]);
  const ten = dayKeys("2026-09-21", 10);
  assert.equal(checkPlan(ten, "day", 1200).ticks.length, 10);
  assert.ok(checkPlan(ten, "day", 320).ticks.length < 10, "thinned on a phone");
});

test("months stride from January, and a year line appears only when the axis crosses one", () => {
  const ms = monthKeys("2025-11", 12);
  const at300 = checkPlan(ms, "month", 300);
  assert.deepEqual(at300.ticks.map((t) => t.label), ["Nov", "Jan", "Mar", "May", "Jul", "Sep"]);
  assert.deepEqual(at300.ticks.filter((t) => t.year).map((t) => [t.label, t.year]), [["Nov", "2025"], ["Jan", "2026"]]);
  const at200 = checkPlan(ms, "month", 200);
  assert.deepEqual(at200.ticks.map((t) => t.label), ["Jan", "Apr", "Jul", "Oct"]);
  assert.deepEqual(at200.ticks.filter((t) => t.year).map((t) => [t.label, t.year]), [["Jan", "2026"]]);
  // One calendar year: no year line.
  const y = checkPlan(monthKeys("2026-01", 12), "month", 1200);
  assert.equal(y.yearLine, false);
  assert.equal(y.ticks.length, 12);
});

test("weeks stride on ISO week parity, so a rolling window's ticks don't jump", () => {
  const a = checkPlan(weekKeys("2026-01-05", 26), "week", 600);
  const b = checkPlan(weekKeys("2026-01-12", 26), "week", 600);
  const labelled = (plan, keys) => plan.ticks.map((t) => keys[t.index]);
  const ka = labelled(a, weekKeys("2026-01-05", 26));
  const kb = labelled(b, weekKeys("2026-01-12", 26));
  // Every week both windows label, they label the same way.
  const shared = ka.filter((k) => kb.includes(k) || k < "2026-01-12");
  assert.ok(shared.length >= ka.length - 1);
  assert.equal(isoWeek("2026-09-14"), 38);
  assert.equal(isoWeek("2026-01-01"), 1);
  assert.equal(isoWeek("2024-12-30"), 1, "the week holding Jan 1's Thursday is week 1");
});

test("the hover head names the whole date, and a bucket in progress says to date", () => {
  assert.equal(fmtHead("2026-09-29", "day"), "Tue, Sep 29, 2026");
  assert.equal(fmtHead("2026-09-14", "week"), "Week of Sep 14–20, 2026");
  assert.equal(fmtHead("2026-09-28", "week"), "Sep 28 – Oct 4, 2026");
  assert.equal(fmtHead("2026-12-28", "week"), "Dec 28, 2026 – Jan 3, 2027");
  assert.equal(fmtHead("2026-09", "month"), "September 2026");
  assert.equal(fmtHead("2026-Q3", "quarter"), "Q3 2026");
  assert.equal(fmtHead("2026", "year"), "2026");
  assert.equal(fmtHead("2026-10", "month", { toDate: { days: 8, of: 31 } }), "October 2026 · to date (8 of 31 days)");
});

test("the count axis tops out at the first nice step at or above the max", () => {
  const table = {
    1: [0, 1],
    3: [0, 1, 2, 3],
    6: [0, 2, 4, 6],
    8: [0, 2, 4, 6, 8],
    10: [0, 5, 10],
    34: [0, 10, 20, 30, 40],
    // 0–150 would leave a fifth of the plot empty: five steps of 25 instead.
    101: [0, 25, 50, 75, 100, 125],
    119: [0, 25, 50, 75, 100, 125],
    552: [0, 200, 400, 600],
  };
  for (const [max, ticks] of Object.entries(table)) assert.deepEqual(niceTicks(Number(max)).ticks, ticks, `max ${max}`);
  // Three intervals on a short plot.
  assert.deepEqual(niceTicks(10, 3).ticks, [0, 5, 10]);
  // 0–10 would leave 30% of a short plot empty; four steps of 2 end at 8.
  assert.deepEqual(niceTicks(7, 3).ticks, [0, 2, 4, 6, 8]);
  // Never more than five steps, and the top always reaches the max.
  for (let m = 1; m <= 2000; m += 3) {
    for (const t of [3, 4]) {
      const y = niceTicks(m, t);
      assert.ok(y.ticks.length - 1 <= 5, `max ${m}: ${y.ticks}`);
      assert.ok(y.top >= m, `max ${m}: top ${y.top}`);
    }
  }
  // Whole numbers only for counts; tenths for a rate.
  for (let m = 1; m <= 2000; m += 7) for (const t of niceTicks(m).ticks) assert.ok(Number.isInteger(t));
  assert.deepEqual(niceTicks(1.79, 4, { decimals: true }).ticks, [0, 0.5, 1, 1.5, 2]);
  assert.equal(yAxisWidth([0, 5, 10]), Math.max(20, Math.ceil(8 + textWidth("10"))));
  assert.equal(yAxisWidth([0, 1]), 20);
});

test("bars fill their slot: 62%, at most 36px (72px for 7 slots or fewer), never touching", () => {
  const cases = [
    [[22, 1076], 30, 4],
    [[22, 300], 8, 2],
    [[12, 1340], 36, 4],
    [[46, 300], 4, 1],
  ];
  for (const [[n, w], bar, radius] of cases) {
    const g = barGeometry(n, w);
    assert.equal(g.bar, bar, `${n} in ${w}px`);
    assert.equal(g.radius, radius, `${n} in ${w}px radius`);
  }
  for (let n = 1; n <= 400; n += 3) {
    for (const w of [200, 300, 720, 1440]) {
      const g = barGeometry(n, w);
      assert.ok(g.bar <= (n <= 7 ? 72 : 36) && g.bar >= 2);
      if (g.slot >= 4) assert.ok(g.bar <= g.slot - 2, "2px of air between bars");
    }
  }
});

test("value labels go on every column or on none", () => {
  assert.equal(labelPlan({ n: 5, slot: 120, values: [10, 7, 7, 6, 7] }), "all");
  assert.equal(labelPlan({ n: 22, slot: 49, values: Array(22).fill(3) }), "none");
  assert.equal(labelPlan({ n: 12, slot: 25, values: Array(12).fill(123) }), "none");
  assert.equal(labelPlan({ n: 12, slot: 112, values: Array(12).fill(123) }), "all");
  assert.equal(labelPlan({ n: 3, slot: 200, values: [0, 0, null] }), "none");
});

test("a column's number sits on its own cap, lifted only past a tick that would cross it", () => {
  // Reports › Monthly once put Jan's "36" on the 2025 tick, 30px over its own column: a
  // tick well above the number, or inside the stack, never moves it.
  const keys = ["damage", "late"];
  const rows = [
    { damage: 20, late: 16, prior: 52 }, // last year well above: its tick clear of the number
    { damage: 20, late: 16, prior: 30 }, // last year lower: its tick inside the stack
    { damage: 20, late: 16, prior: null }, // nothing last year
    { damage: 0, late: 0, prior: 9 }, // a counted zero, last year well above
  ];
  const caps = columnCaps(rows, { keys, marks: ["prior"] });
  // The cap's pixel y comes from the total on the axis; the label is a fixed offset over it.
  const yOf = (v) => 300 - v * 4;
  const ys = caps.map((c) => capLabelY(yOf(c.value), c.value, c.mark === null ? null : yOf(c.mark)));
  assert.deepEqual(ys, [300 - 36 * 4 - 6, 300 - 36 * 4 - 6, 300 - 36 * 4 - 6, 300 - 8]);
  // A tick that crosses the number (last year just over this year) lifts it to stand 4px
  // clear above the tick — and never lowers it.
  const capTop = 156;
  for (const markY of [capTop - 1, capTop - 4, capTop - 6, capTop - 10, capTop - 15]) {
    const base = capLabelY(capTop, 36, markY);
    assert.ok(base <= capTop - 6, `${markY}: never lower than its own place`);
    assert.ok(base <= markY - 5, `${markY}: the digits clear the tick by 4px`);
    assert.ok(base >= markY - 5 - 0 || base === capTop - 6, `${markY}: lifted no further than it must`);
  }
  // Clear of the number: unmoved.
  assert.equal(capLabelY(capTop, 36, capTop - 6 - CAP_DIGIT_H - 8), capTop - 6);
  assert.equal(capLabelY(capTop, 36, capTop + 20), capTop - 6);
  assert.equal(capLabelY(capTop, 36, null), capTop - 6);
});

test("last year's tick runs across its column, a little wider, and the column stays centred", () => {
  for (const [slot, bar] of [[90, 36], [27, 17], [60, 36], [12, 7], [6, 3], [112, 72]]) {
    const t = targetTick({ slot, bar });
    // Centred on the slot, as the column is: it crosses the column, never sits beside it.
    assert.ok(Math.abs(t.x0 + t.w / 2) < 1e-9, `${slot}: centred`);
    assert.ok(t.x0 <= -bar / 2 && t.x0 + t.w >= bar / 2, `${slot}: spans the whole column`);
    assert.ok(t.w <= bar + 8, `${slot}: at most 4px past either edge`);
    assert.ok(t.w <= Math.max(bar, Math.floor(slot * 0.9)), `${slot}: inside its slot`);
  }
  assert.equal(targetTick({ slot: 90, bar: 36 }).w, 44);
});

test("the analytics grid fills every row: no card beside an empty hole, at any width", () => {
  const sum = (r) => r.reduce((a, c) => a + c.span, 0);
  const layouts = {
    // Forgotten Freight / Mis-Deliveries / Unable to Track: trend, By workday, breakdown
    rowsTrend: [{ id: "trend", span: 6 }, { id: "weekday", span: 6 }, { id: "classify", span: 6 }],
    colsTrend: [{ id: "trend", span: 12 }, { id: "weekday", span: 6 }, { id: "classify", span: 6 }],
    // Attempts: the outcome list in place of the breakdown
    attempts: [{ id: "trend", span: 6 }, { id: "weekday", span: 6 }, { id: "outcome", span: 6 }],
    // A short week: no By workday
    noWeekday: [{ id: "trend", span: 12 }, { id: "classify", span: 6 }],
    rowsAlone: [{ id: "trend", span: 6 }],
    // Compliments: the trend beside By workday
    wide: [{ id: "trend", span: 8 }, { id: "weekday", span: 4 }],
    wideAlone: [{ id: "trend", span: 8 }],
    odd: [{ id: "a", span: 6 }, { id: "b", span: 4 }],
  };
  for (const width of [0, 320, 358, 600, 640, 700, 900, 964, 1000, 1088, 1400, 2000]) {
    for (const [name, cells] of Object.entries(layouts)) {
      const rows = gridRows(cells, width);
      for (const r of rows) assert.equal(sum(r), 12, `${name} at ${width}: a row of ${r.map((c) => `${c.id}:${c.span}`).join(" ")}`);
      assert.deepEqual(rows.flat().map((c) => c.id), cells.map((c) => c.id), `${name} at ${width}: every cell, in order`);
      // No cell is narrower than a list can be read at, unless the grid is one column.
      if (width > 0) {
        for (const c of rows.flat()) {
          const px = ((width - 11 * 32) / 12) * c.span + 32 * (c.span - 1);
          assert.ok(c.span === 12 || px >= 300, `${name} at ${width}: ${c.id} is ${Math.round(px)}px`);
        }
      }
    }
  }
  // Wide enough for thirds (1088px, the panel at 1440): trend · By workday · breakdown.
  assert.deepEqual(gridRows(layouts.rowsTrend, 1088).map((r) => r.map((c) => c.span)), [[4, 4, 4]]);
  // Too narrow for thirds: the halves stay, the breakdown spans its own row.
  assert.deepEqual(gridRows(layouts.rowsTrend, 900).map((r) => r.map((c) => c.span)), [[6, 6], [12]]);
  // Columns: the trend's row is whole, the lists share the next.
  assert.deepEqual(gridRows(layouts.colsTrend, 1088).map((r) => r.map((c) => c.span)), [[12], [6, 6]]);
  assert.deepEqual(gridRows(layouts.wideAlone, 1088).map((r) => r.map((c) => c.span)), [[12]]);
  // A phone-width grid is one column.
  assert.deepEqual(gridRows(layouts.colsTrend, 358).map((r) => r.map((c) => c.span)), [[12], [12], [12]]);
});

test("a driver card's sparkline is a strip, not five columns across half a card", () => {
  assert.equal(sparkWidth(5), 168);
  assert.equal(sparkWidth(12), 168);
  assert.equal(sparkWidth(52), 728);
});

test("a short series is rows, a long one columns, a quiet period a sentence", () => {
  assert.equal(chartForm({ slots: 3 }), "rows");
  assert.equal(chartForm({ slots: 6 }), "rows");
  assert.equal(chartForm({ slots: 12 }), "columns");
  assert.equal(chartForm({ slots: 22, total: 9, lowVolume: true }), "few");
  assert.equal(chartForm({ slots: 22, total: 9 }), "columns");
  assert.equal(chartForm({ slots: 22, total: 0, lowVolume: true }), "empty");
});

test("a day slot under 10px steps to weeks, never to weeks over history", () => {
  const win = { start: "2026-09-09", end: "2026-10-08", bucket: "day" };
  assert.equal(chooseGrain(win, 200), "week");
  assert.equal(chooseGrain(win, 300), "day");
  assert.equal(chooseGrain(win, 200, { historyServed: true }), "month");
  // Never finer than period.js decided.
  assert.equal(chooseGrain({ start: "2026-01-01", end: "2026-10-31", bucket: "month" }, 2000), "month");
  const week = { start: "2026-04-01", end: "2026-09-30", bucket: "week" };
  assert.equal(chooseGrain(week, 1000), "week");
  assert.equal(chooseGrain(week, 200), "month");
});

test("tile strips balance their rows", () => {
  assert.equal(tileCols(8, 1440), 4);
  assert.equal(tileCols(5, 1440), 5);
  assert.equal(tileCols(6, 1440), 6);
  assert.equal(tileCols(5, 390), 2);
  assert.equal(tileCols(6, 800), 3);
  assert.deepEqual(tileRows(8, 1440), [4, 4]);
  assert.deepEqual(tileRows(5, 390), [2, 2, 1]);
  assert.deepEqual(tileRows(7, 1440), [4, 3]);
});

test("a bucket still in progress says how far it has got", async () => {
  const { toDate, slotLabel } = await import("../src/views/kit/shape.js");
  assert.deepEqual(toDate({ key: "2026-10", start: "2026-10-01", end: "2026-10-31" }, "2026-10-08"), { days: 8, of: 31 });
  assert.deepEqual(toDate({ key: "2026-10-05", start: "2026-10-05", end: "2026-10-11" }, "2026-10-08"), { days: 4, of: 7 });
  // A week clipped by the window still counts from its Monday.
  assert.deepEqual(toDate({ key: "2026-09-28", start: "2026-10-01", end: "2026-10-04" }, "2026-10-02"), { days: 5, of: 7 });
  assert.equal(toDate({ key: "2026-09", start: "2026-09-01", end: "2026-09-30" }, "2026-10-08"), null);
  assert.equal(toDate({ key: "2026-10-08", start: "2026-10-08", end: "2026-10-08" }, "2026-10-08"), null);
  assert.equal(slotLabel("2026-10-05", "day"), "Mon, Oct 5");
  assert.equal(slotLabel("2026-09-14", "week"), "Week of Sep 14");
  assert.equal(slotLabel("2025-12", "month", { withYear: true }), "December 2025");
});
