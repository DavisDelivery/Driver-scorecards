// Guards the ET period vocabulary: weekdays, workdays, month windows and comparison
// windows. Every one of these reads a day from the string's own year/month/day — a
// YYYY-MM-DD through new Date() is UTC midnight, which in Eastern time is the day
// before, and that is how a Monday turns into a Sunday.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekdayOfYmd,
  addDays,
  shiftYm,
  workdaysInMonth,
  monthWindow,
  comparisonWindow,
  currentYmET,
} from "../src/data/period.js";

test("weekdays come from the calendar day, not a timezone", () => {
  assert.equal(weekdayOfYmd("2026-01-01"), 4); // Thursday
  assert.equal(weekdayOfYmd("2025-12-31"), 3);
  assert.equal(weekdayOfYmd("2024-02-29"), 4); // leap day
  // DST weekends: clocks change on Sunday 2026-03-08 and Sunday 2026-11-01.
  assert.equal(weekdayOfYmd("2026-03-08"), 0);
  assert.equal(weekdayOfYmd("2026-03-09"), 1);
  assert.equal(weekdayOfYmd("2026-11-01"), 0);
  assert.equal(weekdayOfYmd("2026-11-02"), 1);
  // A timestamp is read by its date part.
  assert.equal(weekdayOfYmd("2026-09-14T23:30:00Z"), 1);
  assert.equal(weekdayOfYmd(""), null);
  assert.equal(weekdayOfYmd("not a date"), null);
});

test("the manual-entry tabs' old weekday reader agrees on every day of two years", () => {
  // The function ManualEntryAnalytics carried before it moved here, kept as the oracle.
  function weekdayOf(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  }
  for (let d = "2025-01-01"; d <= "2026-12-31"; d = addDays(d, 1)) {
    assert.equal(weekdayOfYmd(d), weekdayOf(d), d);
  }
});

test("day and month arithmetic crosses year ends, leap days and DST", () => {
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2025-02-28", 1), "2025-03-01");
  assert.equal(addDays("2026-03-07", 2), "2026-03-09"); // over spring-forward
  assert.equal(addDays("2026-10-31", 2), "2026-11-02"); // over fall-back
  assert.equal(shiftYm("2026-01", -1), "2025-12");
  assert.equal(shiftYm("2025-12", 1), "2026-01");
  assert.equal(shiftYm("2026-03", -15), "2024-12");
  assert.equal(shiftYm("2026-03", 0), "2026-03");
});

test("workdays per month, whole and partial", () => {
  assert.equal(workdaysInMonth("2026-09"), 22);
  assert.equal(workdaysInMonth("2024-02"), 21); // leap February: 29 days
  assert.equal(workdaysInMonth("2025-02"), 20);
  assert.equal(workdaysInMonth("2026-03"), 22); // the DST month
  // A month still in progress counts only the days it has had.
  assert.equal(workdaysInMonth("2026-10", { throughDay: 7 }), 5);
  assert.equal(workdaysInMonth("2026-10", { throughDay: "2026-10-07" }), 5);
  assert.equal(workdaysInMonth("2026-10", { throughDay: 3 }), 2); // Thu 1, Fri 2
  assert.equal(workdaysInMonth("2026-10", { throughDay: 0 }), 0);
});

test("month windows count back from the anchor, not from today", () => {
  const a = { anchor: "2025-03" };
  assert.deepEqual(monthWindow("this", a).months, ["2025-03"]);
  assert.deepEqual(monthWindow("last", a).months, ["2025-02"]);
  assert.deepEqual(monthWindow("3", a).months, ["2025-01", "2025-02", "2025-03"]);
  assert.equal(monthWindow("6", a).months.length, 6);
  assert.deepEqual(monthWindow("ytd", a).months, ["2025-01", "2025-02", "2025-03"]);
  assert.equal(monthWindow("ytd", a).label, "YTD 2025");
  assert.equal(monthWindow("3", a).label, "Last 3 Mo");
});

test("month windows cross Jan 1", () => {
  const jan = { anchor: "2026-01" };
  assert.deepEqual(monthWindow("last", jan).months, ["2025-12"]);
  assert.deepEqual(monthWindow("3", jan).months, ["2025-11", "2025-12", "2026-01"]);
  assert.deepEqual(monthWindow("ytd", jan).months, ["2026-01"]);
  const m12 = monthWindow("12", { anchor: "2026-09" }).months;
  assert.equal(m12[0], "2025-10");
  assert.equal(m12[11], "2026-09");
});

test("custom month ranges, including the fallbacks the Scorecard always had", () => {
  const a = { anchor: "2026-10" };
  assert.deepEqual(monthWindow("custom", { ...a, from: "2025-11", to: "2026-02" }).months, [
    "2025-11", "2025-12", "2026-01", "2026-02",
  ]);
  assert.equal(monthWindow("custom", { ...a, from: "2025-11", to: "2026-02" }).label, "Nov 2025 – Feb 2026");
  // Missing or backwards → the anchor month; never more than 36 months.
  assert.deepEqual(monthWindow("custom", { ...a, from: "2026-02" }).months, ["2026-10"]);
  assert.deepEqual(monthWindow("custom", { ...a, from: "2026-05", to: "2026-02" }).months, ["2026-10"]);
  assert.equal(monthWindow("custom", { ...a, from: "2020-01", to: "2026-12" }).months.length, 36);
});

test("monthWindow gives the Scorecard the same months its own list did", () => {
  // The Scorecard's computePeriodMonths, kept verbatim as the oracle (it anchored to
  // today; `now` is injected here so the comparison runs for every month of 2024–2026).
  function computePeriodMonths(sel, from, to, now) {
    const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const cur = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    if (sel === "this") return [ym(cur)];
    if (sel === "last") return [ym(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, 1)))];
    if (sel === "custom") {
      if (!from || !to) return [ym(cur)];
      let [fy, fm] = from.split("-").map(Number);
      const [ty, tm] = to.split("-").map(Number);
      const out = [];
      while (fy < ty || (fy === ty && fm <= tm)) {
        out.push(`${fy}-${String(fm).padStart(2, "0")}`);
        fm++;
        if (fm > 12) { fm = 1; fy++; }
        if (out.length >= 36) break;
      }
      return out.length ? out : [ym(cur)];
    }
    const n = Number(sel) || 1;
    const out = [];
    for (let i = 0; i < n; i++) out.push(ym(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1))));
    return out;
  }
  const ranges = [["2025-11", "2026-02"], ["2026-05", "2026-02"], ["", "2026-02"], ["2019-01", "2026-12"], ["2026-03", "2026-03"]];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const now = new Date(y, m - 1, 15);
      const anchor = `${y}-${String(m).padStart(2, "0")}`;
      for (const sel of ["this", "last", "3", "6", "12"]) {
        assert.deepEqual(
          monthWindow(sel, { anchor }).months,
          computePeriodMonths(sel, "", "", now).sort(),
          `${sel} @ ${anchor}`,
        );
      }
      for (const [from, to] of ranges) {
        assert.deepEqual(
          monthWindow("custom", { anchor, from, to }).months,
          computePeriodMonths("custom", from, to, now).sort(),
          `custom ${from}..${to} @ ${anchor}`,
        );
      }
    }
  }
});

test("the default anchor is the current Eastern month", () => {
  assert.match(currentYmET(), /^\d{4}-\d{2}$/);
  assert.deepEqual(monthWindow("this").months, [currentYmET()]);
});

test("comparison windows: prior and a year earlier", () => {
  const q = monthWindow("3", { anchor: "2026-02" });
  assert.deepEqual(comparisonWindow(q, "prior").months, ["2025-09", "2025-10", "2025-11"]);
  assert.deepEqual(comparisonWindow(q, "yoy").months, ["2024-12", "2025-01", "2025-02"]);

  // Day windows keep their length, across a year end and a DST weekend.
  const w = { start: "2026-01-01", end: "2026-01-10", bucket: "day", months: [] };
  const prior = comparisonWindow(w, "prior");
  assert.equal(prior.start, "2025-12-22");
  assert.equal(prior.end, "2025-12-31");
  const dst = comparisonWindow({ start: "2026-03-09", end: "2026-03-15", bucket: "day", months: [] }, "prior");
  assert.deepEqual([dst.start, dst.end], ["2026-03-02", "2026-03-08"]);
  // A leap day a year back is Feb 28.
  const leap = comparisonWindow({ start: "2024-02-01", end: "2024-02-29", bucket: "day", months: [] }, "yoy");
  assert.deepEqual([leap.start, leap.end], ["2023-02-01", "2023-02-28"]);
  assert.equal(comparisonWindow({}, "prior"), null);
});

test("a day window of whole months compares month for month, days and months agreeing", () => {
  // 6M as periodWindow builds it: May 1 – Oct 31. Counting its 184 days back used to
  // start the prior window on Oct 29, outside the prior six months it returned.
  const six = { start: "2026-05-01", end: "2026-10-31", bucket: "month", months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] };
  const prior = comparisonWindow(six, "prior");
  assert.deepEqual(prior.months, ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual([prior.start, prior.end], ["2025-11-01", "2026-04-30"]);
  // This Mo (October): the prior is all of September, not Aug 31 – Sep 30.
  const oct = comparisonWindow({ start: "2026-10-01", end: "2026-10-31", bucket: "day", months: ["2026-10"] }, "prior");
  assert.deepEqual([oct.start, oct.end, oct.months], ["2026-09-01", "2026-09-30", ["2026-09"]]);
  // Across Jan 1, and a year back from a short February reaches the leap day.
  const jan = comparisonWindow({ start: "2026-01-01", end: "2026-01-31", bucket: "day", months: ["2026-01"] }, "prior");
  assert.deepEqual([jan.start, jan.end, jan.months], ["2025-12-01", "2025-12-31", ["2025-12"]]);
  const feb = comparisonWindow({ start: "2025-02-01", end: "2025-02-28", bucket: "day", months: ["2025-02"] }, "yoy");
  assert.deepEqual([feb.start, feb.end, feb.months], ["2024-02-01", "2024-02-29", ["2024-02"]]);
  // A part-month range keeps its length; its months are the ones its days touch.
  const part = comparisonWindow({ start: "2026-01-15", end: "2026-09-10", bucket: "month", months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] }, "prior");
  assert.equal(part.end, "2026-01-14");
  assert.equal(part.months[0], part.start.slice(0, 7));
  assert.equal(part.months[part.months.length - 1], "2026-01");
});
