// Guards the Scorecard's windows and headline numbers (scorecardKpis.js).
//
// Before v0.22.0 the tiles counted three different populations from the charts below
// them: This Month took the month's raw live rows (returns, traces and no-fault rows
// included), Year to Date summed attempts and compliments in with failures over the
// whole year, and the period counted back from today whatever month was picked. These
// pin each tile to the cells the leaderboards draw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend, driverBuckets } from "../src/data/blend.js";
import { COUNTED8, FAILURES } from "../src/data/categories.js";
import { currentYmET } from "../src/data/period.js";
import { leaderBar } from "../src/views/kit/shape.js";
import {
  scorecardWindows,
  scorecardKpis,
  blendTotal,
  historyFailureMonths,
  monthSpanLabel,
  cachedDispatch,
  dispatchText,
  nextFeedChunk,
  feedSpan,
  attemptsDayCandidates,
  attemptsDayBounds,
  pickedAttemptsDay,
  noScanText,
  failuresNotTracked,
} from "../src/data/scorecardKpis.js";
import { createDayCache } from "../src/data/attemptsFeed.js";
import { drivers, incidents, history } from "./blend-fixture.mjs";

const plain = buildBlend({ incidents, history });
const driverScope = buildBlend({ incidents, history, faultFilter: "driver" });
const legacyDriverScope = buildBlend({ incidents, history, faultFilter: "driver", legacyDriverScope: true });

// ── Windows ──────────────────────────────────────────────────────────────────

test("the period follows the month picker, and the default month is today's in ET", () => {
  // "Mar 2025 · This Mo" counted October 2026 before: the period ignored the picker.
  const w = scorecardWindows({ preset: "this", anchor: "2025-03" });
  assert.deepEqual(w.periodMonths, ["2025-03"]);
  assert.deepEqual(w.ytdMonths, ["2025-01", "2025-02", "2025-03"]);
  assert.equal(w.ytdYear, 2025);
  assert.ok(w.nested);
  assert.deepEqual(scorecardWindows({ preset: "3", anchor: "2025-03" }).periodMonths, ["2025-01", "2025-02", "2025-03"]);
  assert.deepEqual(scorecardWindows({ preset: "last", anchor: "2025-03" }).periodMonths, ["2025-02"]);
  // No month picked: the current month in Eastern time (nowET).
  assert.deepEqual(scorecardWindows({ preset: "this" }).periodMonths, [currentYmET()]);
});

test("year to date is January through the picked month, not the whole year", () => {
  assert.deepEqual(scorecardWindows({ preset: "this", anchor: "2026-06" }).ytdMonths, [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ]);
  assert.deepEqual(scorecardWindows({ preset: "this", anchor: "2026-01" }).ytdMonths, ["2026-01"]);
});

test("a period reaching back over Jan 1 is not inside the year to date", () => {
  const m12 = scorecardWindows({ preset: "12", anchor: "2026-09" });
  assert.equal(m12.periodMonths[0], "2025-10");
  assert.equal(m12.nested, false);
  // The year to date is inside the 12 months: a row is listed over the 12 months.
  assert.deepEqual(m12.scopeMonths, m12.periodMonths);
  const q = scorecardWindows({ preset: "3", anchor: "2026-01" });
  assert.deepEqual(q.periodMonths, ["2025-11", "2025-12", "2026-01"]);
  assert.equal(q.nested, false);
  // A custom range outside the year: a row is listed for either.
  const c = scorecardWindows({ preset: "custom", anchor: "2026-06", from: "2025-11", to: "2025-12" });
  assert.equal(c.nested, false);
  assert.deepEqual(c.scopeMonths, ["2025-11", "2025-12", ...c.ytdMonths]);
});

test("a span of months in words", () => {
  assert.equal(monthSpanLabel(["2026-10"]), "Oct 2026");
  assert.equal(monthSpanLabel(["2026-10", "2026-08", "2026-09"]), "Aug – Oct 2026");
  assert.equal(monthSpanLabel(["2025-11", "2026-01"]), "Nov 2025 – Jan 2026");
  assert.equal(monthSpanLabel([]), "");
});

// ── Leaderboard bars ─────────────────────────────────────────────────────────

test("a leaderboard row crossing Jan 1 is drawn whole, never clamped to its year to date", () => {
  const w = scorecardWindows({ preset: "3", anchor: "2026-01" });
  const rows = driverBuckets({
    blend: plain,
    drivers,
    buckets: { period: w.periodMonths, ytd: w.ytdMonths, scope: w.scopeMonths },
    categoryIds: COUNTED8,
  });
  const row = (id, cat) => {
    const r = rows.find((x) => x.driver.id === id);
    return { month: r.period[cat], ytd: r.ytd[cat] };
  };
  // Bo Baker's damage: November's 2 and December's 5, none in January. The old row
  // clamped the period to the year to date and drew "7 / 0" over an empty bar.
  const bo = row("d2", "damage");
  assert.deepEqual(bo, { month: 7, ytd: 0 });
  assert.deepEqual(leaderBar(bo, { nested: w.nested }), { solid: 7, faded: 0, whole: 7 });
  // Ann's forgotten freight: November's 3 and her 2 live in January — "5 · YTD 2".
  assert.deepEqual(leaderBar(row("d1", "forgotten_freight"), { nested: w.nested }), { solid: 5, faded: 0, whole: 5 });
  // Every row: the bar is the period, whole; the year to date is the number beside it.
  for (const r of rows) {
    for (const cat of COUNTED8) {
      const b = leaderBar({ month: r.period[cat], ytd: r.ytd[cat] }, { nested: w.nested });
      assert.deepEqual(b, { solid: r.period[cat], faded: 0, whole: r.period[cat] });
    }
  }
  // A custom range partly outside the year (Nov 2025 – Feb 2026 at Jun 2026): still
  // the period alone, never the period plus the year's other months.
  const c = scorecardWindows({ preset: "custom", anchor: "2026-06", from: "2025-11", to: "2026-02" });
  assert.equal(c.nested, false);
  const cr = driverBuckets({
    blend: plain,
    drivers,
    buckets: { period: c.periodMonths, ytd: c.ytdMonths },
    categoryIds: COUNTED8,
  });
  for (const r of cr) {
    for (const cat of COUNTED8) assert.equal(leaderBar({ month: r.period[cat], ytd: r.ytd[cat] }, { nested: false }).whole, r.period[cat]);
  }
  // Nested (the period inside the year): exactly the bar it always was, period solid
  // inside the year to date.
  const n = scorecardWindows({ preset: "3", anchor: "2026-06" });
  const nr = driverBuckets({
    blend: plain,
    drivers,
    buckets: { period: n.periodMonths, ytd: n.ytdMonths, scope: n.scopeMonths },
    categoryIds: COUNTED8,
  });
  for (const r of nr) {
    for (const cat of COUNTED8) {
      assert.equal(r.scope[cat], r.ytd[cat]);
      const b = leaderBar({ month: r.period[cat], ytd: r.ytd[cat] }, { nested: n.nested });
      assert.deepEqual(b, { solid: r.period[cat], faded: r.ytd[cat] - r.period[cat], whole: r.ytd[cat] });
    }
  }
});

// ── KPI tiles ────────────────────────────────────────────────────────────────

const H1 = scorecardWindows({ preset: "6", anchor: "2026-06" }); // Jan–Jun 2026

// The leaderboard cards' totals for some categories over some months: every driver,
// drivers and loaders both, inactive drivers included.
const cardTotal = (blend, months, cats) =>
  driverBuckets({ blend, drivers, buckets: { m: months }, categoryIds: cats }).reduce(
    (a, r) => a + cats.reduce((b, c) => b + r.m[c], 0),
    0,
  );

test("counted failures are the failure cells the leaderboards add up to", () => {
  const k = scorecardKpis({ blend: plain, plain, windows: H1 });
  // Jan 5 (3 live FF + 2 history damage), Feb 2, Mar 4, Apr 5, May 2, Jun 1.
  assert.equal(k.failures.period, 19);
  assert.equal(k.failures.period, cardTotal(plain, H1.periodMonths, FAILURES));
  // Attempts and compliments are counted on their own, never into failures.
  assert.equal(k.attempts.period, 2);
  assert.equal(k.compliments.period, 1);
  assert.equal(cardTotal(plain, H1.periodMonths, COUNTED8), k.failures.period + k.attempts.period + k.compliments.period);
  // The inactive driver's three forgotten freight in January stay in the total.
  assert.equal(blendTotal(plain, ["2026-01"], ["forgotten_freight"]), 3);
  // What history serves: January's damage, February's lost/missing, March's damage.
  assert.deepEqual(k.history, { months: ["2026-01", "2026-02", "2026-03"], count: 8 });
});

test("year to date counts failures only, from January to the picked month", () => {
  const k = scorecardKpis({ blend: plain, plain, windows: scorecardWindows({ preset: "this", anchor: "2026-04" }) });
  assert.equal(k.failures.period, 5);
  // Jan 5 + Feb 2 + Mar 4 + Apr 5. The old tile added March's compliment, and May and
  // June's failures and June's attempts too (the whole year).
  assert.equal(k.failures.ytd, 16);
  assert.equal(k.compliments.ytd, 1);
  assert.equal(k.attempts.ytd, 0);
});

test("the fault tiles split the period's counted live failures", () => {
  const k = scorecardKpis({ blend: plain, plain, windows: H1 });
  // Jan: three driver-fault FF. Apr: four driver (late ×2, missing by an id with no
  // roster row, damage) and a vendor damage. May: vendor and warehouse. Jun: a complaint.
  // The unattributed late and the no-fault misdelivery never count.
  assert.equal(k.fault.total, 11);
  assert.equal(k.fault.groups.driver.n, 8);
  assert.equal(k.fault.groups.not_driver.n, 3);
  assert.equal(k.fault.reviewed, 11);
  // The live part of counted failures is exactly what the split covers.
  assert.equal(k.fault.total + k.history.count, k.failures.period);
  // A late row with a reason and no fault is reviewed, apart from driver / not-driver.
  const withReason = [
    ...incidents,
    { id: "lr", driver_id: "d2", category: "late", fault: "unknown", late_reason: "closed_fridays", actual_delivery: "2026-05-20" },
  ];
  const b = buildBlend({ incidents: withReason, history });
  const k2 = scorecardKpis({ blend: b, plain: b, windows: H1 });
  assert.equal(k2.fault.groups.late_reason.n, 1);
  assert.equal(k2.fault.groups.driver.n, 8);
  assert.equal(k2.fault.total, 12);
  assert.equal(k2.fault.reviewed, 12);
});

test("under Driver-fault scope history is not tracked, and the tiles agree with the split", () => {
  const k = scorecardKpis({ blend: driverScope, plain, windows: H1 });
  // Only live driver-fault rows: January's three, April's four, June's complaint.
  assert.equal(k.failures.period, 8);
  assert.equal(k.failures.period, k.fault.groups.driver.n);
  assert.equal(k.failures.period, cardTotal(driverScope, H1.periodMonths, FAILURES));
  // The months history serves are named, from the all-fault blend.
  assert.deepEqual(k.history.months, ["2026-01", "2026-02", "2026-03"]);
  assert.equal(historyFailureMonths(plain, ["2025-11", "2025-12"]).months.join(), "2025-11,2025-12");
  // A history month alone counts nothing.
  const nov = scorecardKpis({ blend: driverScope, plain, windows: scorecardWindows({ preset: "this", anchor: "2025-11" }) });
  assert.equal(nov.failures.period, 0);
  assert.equal(nov.fault.total, 0);
});

test("under Driver-fault scope a span only history holds reads not tracked, period and year alike", () => {
  // Mar 2026 alone: history's damage, no live failure — "—", not 0.
  const mar = scorecardWindows({ preset: "this", anchor: "2026-03" });
  const k = scorecardKpis({ blend: driverScope, plain, windows: mar });
  assert.equal(k.failures.period, 0);
  assert.equal(failuresNotTracked(k, "period", "driver"), true);
  // Its year to date has January's live forgotten freight: counted, with Jan–Mar's
  // history cells named (January's damage, February's lost/missing, March's damage).
  assert.equal(failuresNotTracked(k, "ytd", "driver"), false);
  assert.equal(k.failures.ytd, 3);
  assert.deepEqual(k.historyYtd.months, ["2026-01", "2026-02", "2026-03"]);
  // All incidents: nothing is "not tracked".
  assert.equal(failuresNotTracked(scorecardKpis({ blend: plain, plain, windows: mar }), "period", null), false);
  // A history-only year to date (Nov 2025): both tiles read "—".
  const nov = scorecardKpis({ blend: driverScope, plain, windows: scorecardWindows({ preset: "this", anchor: "2025-11" }) });
  assert.equal(failuresNotTracked(nov, "period", "driver"), true);
  assert.equal(failuresNotTracked(nov, "ytd", "driver"), true);
  // A live month whose failures are none of the driver's (May: vendor and warehouse) is
  // a real 0: tracked, and nobody's.
  const may = scorecardKpis({ blend: driverScope, plain, windows: scorecardWindows({ preset: "this", anchor: "2026-05" }) });
  assert.equal(may.failures.period, 0);
  assert.equal(failuresNotTracked(may, "period", "driver"), false);
  // A month with nothing on record at all is not "not tracked" either.
  const empty = scorecardKpis({ blend: driverScope, plain, windows: scorecardWindows({ preset: "this", anchor: "2025-06" }) });
  assert.equal(failuresNotTracked(empty, "period", "driver"), false);
});

test("a compliment has no fault, so Driver-fault scope never counts one", () => {
  // The tile reads "—" under that scope rather than this 0 (Dashboard.jsx).
  const k = scorecardKpis({ blend: driverScope, plain, windows: H1 });
  assert.equal(k.compliments.period, 0);
  assert.equal(scorecardKpis({ blend: plain, plain, windows: H1 }).compliments.period, 1);
  assert.ok(incidents.filter((i) => i.category === "compliment").every((i) => i.fault !== "driver"));
});

test("Driver-fault scope moved by exactly the history cells it no longer counts", () => {
  // Until v0.22.0 a cell with no live entries read its all-fault history under
  // Driver-fault scope. Now it reads nothing. Every Scorecard number under that scope
  // moves by exactly those cells, and nothing else.
  for (const w of [H1, scorecardWindows({ preset: "3", anchor: "2026-01" }), scorecardWindows({ preset: "12", anchor: "2026-06" })]) {
    const buckets = { period: w.periodMonths, ytd: w.ytdMonths, scope: w.scopeMonths };
    const now = driverBuckets({ blend: driverScope, drivers, buckets, categoryIds: COUNTED8 });
    const before = driverBuckets({ blend: legacyDriverScope, drivers, buckets, categoryIds: COUNTED8 });
    const byId = new Map(now.map((r) => [r.driver.id, r]));
    for (const r of before) {
      for (const [bucket, months] of Object.entries(buckets)) {
        for (const cat of COUNTED8) {
          const hist = [...new Set(months)].reduce(
            (a, ym) =>
              plain.cellSource(ym, cat) === "history" ? a + legacyDriverScope.cell(ym, r.driver.id, cat) : a,
            0,
          );
          assert.equal((byId.get(r.driver.id)?.[bucket][cat] || 0), r[bucket][cat] - hist, `${r.driver.id} ${bucket} ${cat}`);
        }
      }
    }
  }
});

// ── The dispatch feed beside Attempts (logged) ───────────────────────────────

const TODAY = "2026-10-08";
const entry = (rows = [], status = "ok") => ({ status, rows, counts: null, fill: null });
// A -1/-2 copy keeps the original's shipment number (attemptLegs.js).
const leg = (date, stopNbr, name = "Tony Smith") => ({
  date,
  stopNbr,
  shipmentNbr: `ATT${stopNbr.replace(/-\d+$/, "")}`,
  originalDriverName: name,
});

test("the feed span runs from the feed's first day through yesterday", () => {
  assert.deepEqual(feedSpan(["2026-10"], { today: TODAY }), { start: "2026-10-01", end: "2026-10-07" });
  assert.deepEqual(feedSpan(["2026-06"], { today: TODAY }), { start: "2026-06-25", end: "2026-06-30" });
  assert.equal(feedSpan(["2026-03"], { today: TODAY }), null);
  // The first of the month: no finished day yet.
  assert.equal(feedSpan(["2026-10"], { today: "2026-10-01" }), null);
});

test("dispatch's count comes from the cache alone, and says how much of the period it covers", () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("the Scorecard must not fetch for its tile");
  };
  try {
    const cache = createDayCache();
    const opts = { today: TODAY, now: 0 };
    // Nothing cached: nothing to say, so the tile offers to count.
    let d = cachedDispatch(["2026-10"], { cache, ...opts });
    assert.deepEqual([d.of, d.loaded, d.orders], [7, 0, 0]);
    assert.equal(dispatchText(d), null);
    // One day in: a -1 copy is the same order, counted once.
    cache.set("2026-10-07", entry([leg("2026-10-07", "007187644"), leg("2026-10-07", "007187644-1"), leg("2026-10-07", "007187365")]), opts);
    d = cachedDispatch(["2026-10"], { cache, ...opts });
    assert.deepEqual([d.of, d.loaded, d.withData, d.orders], [7, 1, 1, 2]);
    assert.equal(dispatchText(d), "feed: 2 orders on 1 of 7 days");
    // Every day in, one with no scan that night: loaded, but it says nothing.
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) cache.set(day, entry(), opts);
    cache.set("2026-10-06", entry([], "no_manifest"), opts);
    d = cachedDispatch(["2026-10"], { cache, ...opts });
    assert.deepEqual([d.of, d.loaded, d.withData], [7, 7, 6]);
    assert.equal(dispatchText(d), "feed: 2 orders on 6 of 7 days");
    cache.set("2026-10-06", entry(), opts);
    assert.equal(dispatchText(cachedDispatch(["2026-10"], { cache, ...opts })), "feed: 2 orders");
    // Loaded days with no scan to read say nothing: never "saw 0 orders".
    const empty = createDayCache();
    empty.set("2026-10-06", entry([], "no_manifest"), opts);
    d = cachedDispatch(["2026-10"], { cache: empty, ...opts });
    assert.deepEqual([d.loaded, d.withData], [1, 0]);
    assert.equal(dispatchText(d), "feed: no evening scan on the day loaded");
    // A period starting before the feed: the count is since the feed began, and says so.
    cache.set("2026-06-30", entry([leg("2026-06-30", "007100001")]), opts);
    d = cachedDispatch(["2026-06"], { cache, ...opts });
    assert.deepEqual([d.of, d.loaded, d.sinceFeed, d.start], [6, 1, true, "2026-06-25"]);
    assert.equal(dispatchText(d), "feed from Jun 25: 1 order on 1 of 6 days");
    for (const day of ["2026-06-25", "2026-06-26", "2026-06-27", "2026-06-28", "2026-06-29"]) cache.set(day, entry(), opts);
    assert.equal(dispatchText(cachedDispatch(["2026-06"], { cache, ...opts })), "feed from Jun 25: 1 order");
    assert.equal(cachedDispatch(["2026-10"], { cache, ...opts }).sinceFeed, false);
    // Before the feed began, and a month with no finished day yet.
    assert.equal(dispatchText(cachedDispatch(["2026-03"], { cache, ...opts })), "dispatch feed starts Jun 25, 2026");
    assert.equal(dispatchText(cachedDispatch(["2026-10"], { cache, today: "2026-10-01", now: 0 })), "feed: no evening scan yet");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("counting more loads the newest days the cache lacks, 45 at a time", () => {
  const cached = new Set(["2026-10-07", "2026-10-06"]);
  const isCached = (d) => cached.has(d);
  assert.deepEqual(nextFeedChunk({ start: "2026-10-01", end: "2026-10-07" }, { isCached }), ["2026-10-01", "2026-10-05"]);
  assert.deepEqual(nextFeedChunk({ start: "2026-06-25", end: "2026-10-07" }, { isCached }), ["2026-08-22", "2026-10-05"]);
  for (let d = 1; d <= 5; d++) cached.add(`2026-10-0${d}`);
  assert.equal(nextFeedChunk({ start: "2026-10-01", end: "2026-10-07" }, { isCached }), null);
  assert.equal(nextFeedChunk({}, { isCached }), null);
});

// ── The Attempts card's day ──────────────────────────────────────────────────

test("the card's day is a business day of the picked month, newest first", () => {
  // Thursday: today (in case its scan has run), then back over the weekend.
  assert.deepEqual(attemptsDayCandidates("2026-10", { today: "2026-10-08", max: 6 }), [
    "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05", "2026-10-02", "2026-10-01",
  ]);
  // A Monday: never Sunday or Saturday.
  assert.deepEqual(attemptsDayCandidates("2026-10", { today: "2026-10-05", max: 2 }), ["2026-10-05", "2026-10-02"]);
  // A past month starts from its last business day.
  assert.equal(attemptsDayCandidates("2026-08", { today: TODAY })[0], "2026-08-31");
  assert.equal(attemptsDayCandidates("2026-05", { today: TODAY }).length, 0);
  // The feed's first month stops at its first day.
  assert.deepEqual(attemptsDayCandidates("2026-06", { today: TODAY }), ["2026-06-30", "2026-06-29", "2026-06-26", "2026-06-25"]);
  assert.equal(attemptsDayCandidates("2026-09", { today: TODAY }).length, 10);
});

test("the current month's first days fall back to the month before's last business day", () => {
  // Sunday 11/01: nothing of November yet, so Friday 10/30 first.
  assert.deepEqual(attemptsDayCandidates("2026-11", { today: "2026-11-01", max: 3 }), ["2026-10-30", "2026-10-29", "2026-10-28"]);
  // Monday 11/02 before 8 PM: today, then Friday.
  assert.deepEqual(attemptsDayCandidates("2026-11", { today: "2026-11-02", max: 2 }), ["2026-11-02", "2026-10-30"]);
  // Thursday 10/01 and Friday 01/01 (a new year): the month before's last days follow.
  assert.deepEqual(attemptsDayCandidates("2026-10", { today: "2026-10-01", max: 2 }), ["2026-10-01", "2026-09-30"]);
  assert.deepEqual(attemptsDayCandidates("2027-01", { today: "2027-01-01", max: 2 }), ["2027-01-01", "2026-12-31"]);
  // A past month never leaves itself; nor does a picked day (the bounds stay the month).
  assert.equal(attemptsDayCandidates("2026-10", { today: "2026-11-02" })[0], "2026-10-30");
  assert.ok(attemptsDayCandidates("2026-10", { today: "2026-11-02" }).every((d) => d.startsWith("2026-10")));
  assert.equal(pickedAttemptsDay("2026-10-30", "2026-11", { today: "2026-11-02" }), null);
  // Never before the feed: its first month walks back no further than 06/25.
  assert.deepEqual(attemptsDayCandidates("2026-07", { today: "2026-07-01" }), ["2026-07-01", "2026-06-30", "2026-06-29", "2026-06-26", "2026-06-25"]);
});

test("a month with no day to show says why, from the days actually tried", () => {
  assert.equal(
    noScanText([{ day: "2026-11-02", status: "pending", n: 0 }], "Nov 2026"),
    "No evening scan yet in Nov 2026 — today's 8 PM scan hasn't run.",
  );
  assert.equal(
    noScanText(
      [
        { day: "2026-06-30", status: "no_manifest", n: 0 },
        { day: "2026-06-29", status: "fetch_not_ok", n: 0 },
        { day: "2026-06-26", status: "no_manifest", n: 0 },
        { day: "2026-06-25", status: "no_manifest", n: 0 },
      ],
      "Jun 2026",
    ),
    "No evening scan to show for any of the 4 business days from Jun 25, 2026 to Jun 30, 2026.",
  );
  assert.equal(noScanText([{ day: "2026-09-02", status: "no_manifest", n: 0 }], "Sep 2026"), "No evening scan to show for Sep 2, 2026.");
  assert.equal(noScanText([], "Nov 2026"), "No business day of Nov 2026 to show yet.");
});

test("a picked day belongs to its month; another month drops it", () => {
  assert.deepEqual(attemptsDayBounds("2026-10", { today: TODAY }), { min: "2026-10-01", max: TODAY });
  assert.deepEqual(attemptsDayBounds("2026-06", { today: TODAY }), { min: "2026-06-25", max: "2026-06-30" });
  assert.equal(attemptsDayBounds("2025-03", { today: TODAY }), null);
  assert.equal(pickedAttemptsDay("2026-10-06", "2026-10", { today: TODAY }), "2026-10-06");
  assert.equal(pickedAttemptsDay("2026-09-30", "2026-10", { today: TODAY }), null);
  assert.equal(pickedAttemptsDay("2026-10-09", "2026-10", { today: TODAY }), null);
  assert.equal(pickedAttemptsDay("", "2026-10", { today: TODAY }), null);
  assert.equal(pickedAttemptsDay("10/06/2026", "2026-10", { today: TODAY }), null);
});
