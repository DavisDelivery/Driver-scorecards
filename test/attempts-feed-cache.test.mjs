// Guards the feed's day status and its shared day cache (src/data/attemptsFeed.js).
//
// Two ways the Attempts tab could show the wrong number without anyone noticing: a
// night the evening scan never ran counted as a night with no attempts, and a day
// kept in a cache after dispatch revised it — or after it was deleted. The manifests
// below are the real shapes from 09/01–10/06.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ATTEMPTS_FEED_URL,
  FEED_EPOCH,
  RECENT_TTL_MS,
  classifyDay,
  createDayCache,
  dayCache,
  deleteAttempt,
  feedCoverage,
  fetchAttemptsRange,
  noDataRuns,
  NO_DATA_STATUSES,
} from "../src/data/attemptsFeed.js";

const TODAY = "2026-10-07";

// The feed's response for a day, by manifest shape.
const att = (stopNbr) => ({ stopNbr, shipmentNbr: `ATT${stopNbr}`, originalDriverName: "Tony Smith" });
const RESPONSES = {
  // A normal weekday.
  "2026-09-03": { ok: true, manifest: { fetchOk: true, planMissing: false, counts: { attempts: 1, candidates: 722 } }, attempts: [att("007170001")] },
  // No scan that night.
  "2026-09-02": { ok: true, manifest: null, attempts: [] },
  // Orders but no counts at all.
  "2026-09-04": { ok: true, manifest: { fetchOk: true, planMissing: false }, attempts: [att("007170002"), att("007170003")] },
  // The scan ran but couldn't read NuVizz.
  "2026-09-08": { ok: true, manifest: { fetchOk: false, planMissing: false, counts: { attempts: 0, candidates: 659 } }, attempts: [] },
  // Saturday: a tiny plan, nothing attempted.
  "2026-09-12": { ok: true, manifest: { fetchOk: true, planMissing: false, counts: { attempts: 0, candidates: 22 } }, attempts: [] },
  // Sunday: no plan at all.
  "2026-09-13": { ok: true, manifest: { fetchOk: true, planMissing: true, counts: { attempts: 0, candidates: 0 } }, attempts: [] },
  // A Monday whose manifest lost its counts and lists nothing.
  "2026-10-05": { ok: true, manifest: { fetchOk: true, planMissing: false, holder: "read" }, attempts: [] },
};
// Today, once its 8 PM scan has run (tests that want it add it to RESPONSES).
const TODAY_SCANNED = { ok: true, manifest: { fetchOk: true, planMissing: false, counts: { attempts: 1 } }, attempts: [att("007187109")] };

let calls;
let realFetch;
let failing;
beforeEach(() => {
  calls = [];
  failing = new Set();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    const date = new URL(url).searchParams.get("date");
    if (failing.has(date)) return { ok: false, status: 502, json: async () => ({}) };
    const body = RESPONSES[date] || { ok: true, date, manifest: { fetchOk: true, counts: {} }, attempts: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  dayCache.clear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  dayCache.clear();
});
const fetchedDays = () => calls.map((c) => new URL(c.url).searchParams.get("date"));

test("day status: only no manifest, fetchOk=false and a failed request are no data", () => {
  const s = (date) => classifyDay(RESPONSES[date], { date, today: TODAY });
  assert.equal(s("2026-09-03"), "ok");
  assert.equal(s("2026-09-02"), "no_manifest");
  assert.equal(s("2026-09-04"), "ok", "orders with no counts are still orders");
  assert.equal(s("2026-09-08"), "fetch_not_ok");
  assert.equal(s("2026-09-12"), "ok", "a weekend's tiny plan is a real zero");
  assert.equal(s("2026-09-13"), "ok", "a planMissing Sunday is a real zero");
  assert.equal(s("2026-10-05"), "ok", "a manifest without counts is still a scan that ran");
  // Today, before the 8 PM scan, is pending — not a night the scan missed.
  assert.equal(classifyDay({ ok: true, manifest: null, attempts: [] }, { date: TODAY, today: TODAY }), "pending");
  // Before the feed started there was no scan to miss.
  assert.equal(classifyDay({ ok: true, manifest: null, attempts: [] }, { date: "2026-06-10", today: TODAY }), "before_feed");
  assert.equal(classifyDay({ ok: true, manifest: null, attempts: [] }, { date: FEED_EPOCH, today: TODAY }), "no_manifest");
  // fetchOk false with orders listed: the orders are real.
  assert.equal(
    classifyDay({ manifest: { fetchOk: false }, attempts: [att("1")] }, { date: "2026-09-01", today: TODAY }),
    "ok",
  );
  assert.deepEqual([...NO_DATA_STATUSES].sort(), ["failed", "fetch_not_ok", "no_manifest"]);
});

test("the range returns every day's status, counts and rows, and calls only the attempts GET", async () => {
  const r = await fetchAttemptsRange("2026-09-02", "2026-09-04", { today: TODAY });
  assert.deepEqual(
    [...r.days].map(([d, e]) => [d, e.status, e.rows.length]),
    [
      ["2026-09-02", "no_manifest", 0],
      ["2026-09-03", "ok", 1],
      ["2026-09-04", "ok", 2],
    ],
  );
  assert.deepEqual(r.days.get("2026-09-03").counts, { attempts: 1, candidates: 722 });
  assert.equal(r.days.get("2026-09-04").counts, null);
  // Rows are stamped with their day and the plan flag, as before.
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.stopNbr, x.planMissing]),
    [
      ["2026-09-03", "007170001", false],
      ["2026-09-04", "007170002", false],
      ["2026-09-04", "007170003", false],
    ],
  );
  assert.equal(r.failed, 0);
  assert.equal(r.capped, false);
  for (const c of calls) {
    assert.equal(c.method, "GET");
    assert.ok(c.url.startsWith(`${ATTEMPTS_FEED_URL}?date=`), c.url);
  }
});

test("a failed request is a 'failed' day, counted, and never cached", async () => {
  failing.add("2026-09-03");
  const r = await fetchAttemptsRange("2026-09-03", "2026-09-04", { today: TODAY, now: 0 });
  assert.equal(r.days.get("2026-09-03").status, "failed");
  assert.equal(r.failed, 1);
  assert.equal(dayCache.has("2026-09-03"), false);
  failing.clear();
  calls = [];
  const again = await fetchAttemptsRange("2026-09-03", "2026-09-04", { today: TODAY, now: 0 });
  assert.equal(again.days.get("2026-09-03").status, "ok");
  assert.deepEqual(fetchedDays(), ["2026-09-03"], "only the failed day is asked for again");
});

test("today is never served from the cache", async () => {
  await fetchAttemptsRange("2026-10-06", TODAY, { today: TODAY, now: 0 });
  assert.equal(dayCache.has(TODAY), false);
  calls = [];
  const r = await fetchAttemptsRange("2026-10-06", TODAY, { today: TODAY, now: 1 });
  assert.deepEqual(fetchedDays(), [TODAY]);
  assert.equal(r.days.get(TODAY).status, "ok");
});

test("the trailing 14 days are read again after the TTL; older days stay cached", async () => {
  const old = "2026-09-03"; // well outside the trailing 14
  const recent = "2026-09-30"; // inside it
  await fetchAttemptsRange(old, old, { today: TODAY, now: 0 });
  await fetchAttemptsRange(recent, recent, { today: TODAY, now: 0 });
  calls = [];
  // Within the TTL: both from the cache.
  await fetchAttemptsRange(old, old, { today: TODAY, now: RECENT_TTL_MS - 1 });
  await fetchAttemptsRange(recent, recent, { today: TODAY, now: RECENT_TTL_MS - 1 });
  assert.deepEqual(fetchedDays(), []);
  // Past it: the recent day is read again — dispatch revises settled days.
  await fetchAttemptsRange(old, old, { today: TODAY, now: RECENT_TTL_MS + 1 });
  await fetchAttemptsRange(recent, recent, { today: TODAY, now: RECENT_TTL_MS + 1 });
  assert.deepEqual(fetchedDays(), [recent]);
});

test("the trailing-14 boundary: 14 days back revalidates, 15 days back does not", () => {
  const cache = createDayCache({ recentDays: 14, ttlMs: 10 });
  const entry = { status: "ok", rows: [] };
  cache.set("2026-09-23", entry, { today: TODAY, now: 0 }); // 14 days back
  cache.set("2026-09-22", entry, { today: TODAY, now: 0 }); // 15 days back
  assert.equal(cache.get("2026-09-23", { today: TODAY, now: 11 }), null);
  assert.equal(cache.get("2026-09-22", { today: TODAY, now: 11 }), entry);
  // And a day refused outright: today is never kept.
  cache.set(TODAY, entry, { today: TODAY, now: 0 });
  assert.equal(cache.has(TODAY), false);
});

test("invalidate drops a day, so the next look reads it again", async () => {
  await fetchAttemptsRange("2026-09-03", "2026-09-04", { today: TODAY, now: 0 });
  dayCache.invalidate("2026-09-04");
  calls = [];
  await fetchAttemptsRange("2026-09-03", "2026-09-04", { today: TODAY, now: 1 });
  assert.deepEqual(fetchedDays(), ["2026-09-04"]);
});

test("deleting an attempt invalidates its day — even when the delete fails", async () => {
  await fetchAttemptsRange("2026-09-04", "2026-09-04", { today: TODAY, now: 0 });
  assert.equal(dayCache.has("2026-09-04"), true);
  await deleteAttempt("2026-09-04", "007170002");
  assert.equal(dayCache.has("2026-09-04"), false);
  assert.equal(calls.at(-1).method, "DELETE");

  await fetchAttemptsRange("2026-09-04", "2026-09-04", { today: TODAY, now: 0 });
  failing.add("2026-09-04");
  await assert.rejects(deleteAttempt("2026-09-04", "007170003"), /HTTP 502/);
  assert.equal(dayCache.has("2026-09-04"), false);
});

test("over maxDays nothing is fetched and the range says it was capped", async () => {
  const r = await fetchAttemptsRange("2026-08-01", "2026-09-15", { today: TODAY });
  assert.equal(r.capped, true);
  assert.equal(r.totalDays, 46);
  assert.equal(r.days.size, 0);
  assert.deepEqual(calls, []);
});

test("days before the feed started aren't asked for", async () => {
  const r = await fetchAttemptsRange("2026-06-20", "2026-06-26", { today: TODAY });
  assert.equal(FEED_EPOCH, "2026-06-25");
  assert.deepEqual(fetchedDays(), ["2026-06-25", "2026-06-26"]);
  assert.equal(r.days.get("2026-06-20").status, "before_feed");
  assert.equal(r.days.size, 7);
  assert.equal(r.totalDays, 2, "only the feed's own days");
});

test("the 45-day cap counts only days the feed can be asked for", async () => {
  // 57 days, 16 of them from FEED_EPOCH on: asked for, not refused.
  const r = await fetchAttemptsRange("2026-05-15", "2026-07-10", { today: TODAY });
  assert.equal(r.capped, false);
  assert.equal(r.totalDays, 16);
  assert.equal(fetchedDays().length, 16);
  assert.equal(fetchedDays()[0], FEED_EPOCH);
  // 06/01–08/15 holds 52 feed days: refused, and says how many.
  calls = [];
  const wide = await fetchAttemptsRange("2026-06-01", "2026-08-15", { today: TODAY });
  assert.equal(wide.capped, true);
  assert.equal(wide.totalDays, 52);
  assert.deepEqual(calls, []);
});

test("days after today aren't asked for, so 'pending' means today alone", async () => {
  // This Mo on 10/07, after the 8 PM scan: 10/01–10/07 are asked for, never 10/08–10/31.
  RESPONSES[TODAY] = TODAY_SCANNED;
  try {
    const r = await fetchAttemptsRange("2026-10-01", "2026-10-31", { today: TODAY, now: 0 });
    assert.deepEqual(fetchedDays(), [
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", TODAY,
    ]);
    assert.equal(r.days.size, 7);
    assert.equal(r.totalDays, 7);
    const c = feedCoverage(r.days, "2026-10-01", "2026-10-31", { today: TODAY });
    assert.deepEqual([c.of, c.loaded, c.pending], [7, 7, false], "the scan has run: not pending");
    // The next load asks only for today, which is never cached.
    calls = [];
    await fetchAttemptsRange("2026-10-01", "2026-10-31", { today: TODAY, now: 1 });
    assert.deepEqual(fetchedDays(), [TODAY]);
    // Before the scan, today is pending and kept out of the day count.
    RESPONSES[TODAY] = { ok: true, manifest: null, attempts: [] };
    const before = await fetchAttemptsRange("2026-10-01", "2026-10-31", { today: TODAY, now: 1 });
    const p = feedCoverage(before.days, "2026-10-01", "2026-10-31", { today: TODAY });
    assert.deepEqual([p.of, p.loaded, p.pending], [6, 6, true]);
  } finally {
    delete RESPONSES[TODAY];
  }
});

test("a failed today stays out of the day count, as a pending one does", async () => {
  failing.add(TODAY);
  const r = await fetchAttemptsRange("2026-10-05", TODAY, { today: TODAY });
  assert.equal(r.days.get(TODAY).status, "failed");
  const c = feedCoverage(r.days, "2026-10-05", TODAY, { today: TODAY });
  assert.deepEqual(
    { of: c.of, loaded: c.loaded, noData: c.noData, todayFailed: c.todayFailed },
    { of: 2, loaded: 2, noData: [], todayFailed: true },
  );
});

test("noDataRuns: grouped by reason, back-to-back days run together", () => {
  // A whole month unreachable is one run, not 30 dates.
  const outage = [];
  for (let d = 8; d <= 30; d++) outage.push({ date: `2026-09-${String(d).padStart(2, "0")}`, status: "failed" });
  for (let d = 1; d <= 7; d++) outage.push({ date: `2026-10-0${d}`, status: "failed" });
  assert.deepEqual(noDataRuns(outage), [
    { status: "failed", days: 30, runs: [{ from: "2026-09-08", to: "2026-10-07", days: 30 }] },
  ]);
  // Mixed reasons keep their own groups, ordered by each one's first day.
  assert.deepEqual(
    noDataRuns([
      { date: "2026-09-08", status: "fetch_not_ok" },
      { date: "2026-09-02", status: "no_manifest" },
      { date: "2026-09-15", status: "no_manifest" },
      { date: "2026-09-16", status: "no_manifest" },
    ]),
    [
      {
        status: "no_manifest",
        days: 3,
        runs: [
          { from: "2026-09-02", to: "2026-09-02", days: 1 },
          { from: "2026-09-15", to: "2026-09-16", days: 2 },
        ],
      },
      { status: "fetch_not_ok", days: 1, runs: [{ from: "2026-09-08", to: "2026-09-08", days: 1 }] },
    ],
  );
  assert.deepEqual(noDataRuns([]), []);
});

test("coverage names the no-data days and counts the rest", async () => {
  failing.add("2026-09-10");
  const { days } = await fetchAttemptsRange("2026-09-01", "2026-09-13", { today: TODAY });
  const c = feedCoverage(days, "2026-09-01", "2026-09-13", { today: TODAY });
  assert.equal(c.of, 13);
  assert.equal(c.loaded, 10);
  assert.deepEqual(c.noData, [
    { date: "2026-09-02", status: "no_manifest" },
    { date: "2026-09-08", status: "fetch_not_ok" },
    { date: "2026-09-10", status: "failed" },
  ]);
  assert.equal(c.pending, false);
  // Only the window's own days count, and today before its scan is apart from them.
  const m = new Map([
    ["2026-06-24", { status: "before_feed" }],
    ["2026-10-06", { status: "ok" }],
    [TODAY, { status: "pending" }],
  ]);
  assert.deepEqual(feedCoverage(m, "2026-06-24", TODAY, { today: TODAY }), {
    of: 1,
    loaded: 1,
    noData: [],
    pending: true,
    todayFailed: false,
    beforeFeed: 1,
  });
  assert.equal(feedCoverage(m, "2026-10-06", "2026-10-06", { today: TODAY }).pending, false);
});
