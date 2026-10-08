// What the numbers on file cover (coverage.js): capture windows, the Uline reports'
// coverage by day, each cell's state, like-for-like pairing, and the reconciliation the
// Data Coverage page lists. The fixture is shaped like production (coverage-fixture.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend } from "../src/data/blend.js";
import {
  APP_ERA,
  CAPTURE_WINDOWS,
  instrument,
  ulineCoverage,
  ulineShare,
  buildCoverage,
  likeForLike,
  exclusionText,
  monthsText,
  suspiciousZeros,
  unattributedByMonth,
  rollupStatus,
  reconcile,
  causeText,
  reportLag,
  captureEvidence,
  offRosterCounts,
} from "../src/data/coverage.js";
import { personIndex } from "../src/data/people.js";
import { FAILURES, COUNTED8 } from "../src/data/categories.js";
import { companyWindow } from "../src/data/companyMetrics.js";
import { TODAY, incidents, history, monthIds, reports, contribs, drivers } from "./coverage-fixture.mjs";

const blend = buildBlend({ incidents, history });
const uline = ulineCoverage(reports, incidents);
const cov = buildCoverage({ blend, historyMonthIds: monthIds, uline, today: TODAY, incidents });
const ALL = companyWindow("all", { through: "2026-10" }).months;
const state = (ym, cat) => cov.cell(ym, cat).state;

test("capture windows: the owner's 10/07 dates", () => {
  // 2023 held lost/missing only; 2024 none of it.
  assert.equal(instrument("2023-05", "missing"), "backfill");
  assert.equal(instrument("2023-05", "damage"), null);
  assert.equal(instrument("2024-05", "missing"), null);
  assert.equal(instrument("2025-05", "missing"), "backfill");
  // Late was never in a spreadsheet; everything from April 2026 is the app's.
  assert.equal(instrument("2026-03", "late"), null);
  assert.equal(instrument(APP_ERA, "late"), "app");
  assert.equal(instrument("2026-03", "forgotten_freight"), "backfill");
  // The entry tabs began in June; the Uline categories with the reports.
  assert.deepEqual(CAPTURE_WINDOWS.forgotten_freight.app, ["manual"]);
  assert.deepEqual(CAPTURE_WINDOWS.misdelivery.app, ["uline", "manual"]);
  for (const c of COUNTED8) assert.ok(CAPTURE_WINDOWS[c], `${c} has a capture window`);
});

test("Uline coverage by day: the April report's rows give its span, and the gap after it", () => {
  assert.deepEqual(uline.intervals, [
    { start: "2026-04-07", end: "2026-04-13" },
    { start: "2026-05-05", end: "2026-09-22" },
  ]);
  assert.deepEqual(uline.gaps, [{ start: "2026-04-14", end: "2026-05-04", days: 21 }]);
  assert.equal(uline.through, "2026-09-22");
  assert.equal(uline.first, "2026-04-07");
  // April: 5 of 22 weekdays. May: 19 of 21 (May 1 and 4 fall in the gap) — whole enough.
  assert.equal(ulineShare("2026-04", uline), 5 / 22);
  assert.equal(ulineShare("2026-05", uline), 19 / 21);
  assert.equal(ulineShare("2026-09", uline), 16 / 22);
  assert.deepEqual(ulineCoverage([], []), { intervals: [], gaps: [], first: null, through: null });
});

test("a report row's lag is days from its date to the ET day it was entered", () => {
  // 04-07 → 04-17: 10 days; 04-13 → 04-17: 4; 05-12 → 06-02: 21; … fourteen report
  // rows, sorted 4 9 10 17 21 23 24 25 27 39 40 41 42 43 (nearest rank).
  const lag = reportLag(incidents);
  assert.deepEqual(lag, { n: 14, median: 24, p90: 42 });
  assert.equal(reportLag([]).median, null);
  // A manual entry is not a report row.
  assert.equal(reportLag(incidents.filter((i) => i.manual_entry)).n, 0);
});

test("every cell's state", () => {
  assert.equal(state("2023-11", "missing"), "no_data");
  assert.equal(state("2025-07", "damage"), "no_data");
  assert.equal(state("2025-12", "forgotten_freight"), "no_data");
  assert.equal(state("2023-05", "missing"), "history");
  assert.equal(state("2023-05", "damage"), "not_tracked");
  assert.equal(state("2024-05", "missing"), "not_tracked");
  // Late before the app is not tracked, never zero.
  assert.equal(state("2026-03", "late"), "not_tracked");
  assert.equal(cov.cell("2026-03", "late").value, null);
  // Jan 2026: the back-dated forgotten freight disagree with the spreadsheet; the other
  // categories are the spreadsheet's.
  assert.equal(state("2026-01", "forgotten_freight"), "conflict");
  assert.deepEqual(
    { value: cov.cell("2026-01", "forgotten_freight").value, live: cov.cell("2026-01", "forgotten_freight").live, history: cov.cell("2026-01", "forgotten_freight").history },
    { value: 3, live: 3, history: 5 },
  );
  assert.equal(cov.cell("2026-01", "forgotten_freight").instrument, "app");
  assert.equal(state("2026-01", "damage"), "history");
  assert.equal(cov.cell("2026-01", "damage").instrument, "backfill");
  // April: the reports cover 5 of 22 weekdays; the one forgotten freight was back-dated
  // into a month the tab wasn't logging yet. May has no forgotten freight: not captured.
  assert.equal(state("2026-04", "late"), "partial");
  assert.deepEqual(cov.cell("2026-04", "late").reasons, ["uline_partial"]);
  assert.equal(state("2026-04", "forgotten_freight"), "partial");
  assert.deepEqual(cov.cell("2026-04", "forgotten_freight").reasons, ["outside"]);
  assert.equal(cov.cell("2026-04", "forgotten_freight").value, 1);
  assert.equal(state("2026-05", "forgotten_freight"), "not_tracked");
  assert.equal(state("2026-05", "attempts"), "not_tracked");
  assert.equal(state("2026-05", "compliment"), "not_tracked");
  // May misdeliveries: the reports' only — the tab began in June.
  assert.equal(state("2026-05", "misdelivery"), "partial");
  assert.deepEqual(cov.cell("2026-05", "misdelivery").reasons, ["pending"]);
  assert.equal(state("2026-05", "late"), "live");
  // June on, a captured month with none is a real zero.
  assert.deepEqual([state("2026-06", "misdelivery"), cov.cell("2026-06", "misdelivery").value], ["live", 0]);
  assert.deepEqual([state("2026-06", "attempts"), cov.cell("2026-06", "attempts").value], ["live", 0]);
  // A stale rollup: history holds counts the report's rows no longer have.
  assert.equal(state("2026-07", "late"), "conflict");
  // August's misdeliveries: one report row, rolled up, and two hand-logged entries that
  // never roll up. History is short by exactly them — expected, so the live 3 is whole.
  assert.deepEqual(
    [state("2026-08", "misdelivery"), cov.cell("2026-08", "misdelivery").value, cov.cell("2026-08", "misdelivery").history],
    ["live", 3, 1],
  );
  // Without the live rows to tell them apart, every difference reads as a conflict.
  const blind = buildCoverage({ blend, historyMonthIds: monthIds, uline, today: TODAY });
  assert.equal(blind.cell("2026-08", "misdelivery").state, "conflict");
  // September: the reports stop on the 22nd. October is still in progress.
  assert.equal(state("2026-09", "late"), "partial");
  assert.equal(state("2026-09", "forgotten_freight"), "live");
  assert.deepEqual(cov.cell("2026-10", "forgotten_freight").reasons, ["in_progress"]);
  // 2024-09 misdelivery: the spreadsheet tracked it and holds none — a zero, not a gap.
  assert.deepEqual([state("2024-09", "misdelivery"), cov.cell("2024-09", "misdelivery").value], ["history", 0]);
});

test("a cell that holds a count is never a gap, so the cells add up to the blend", () => {
  for (const ym of ALL) {
    for (const cat of COUNTED8) {
      const c = cov.cell(ym, cat);
      if (c.value === null) assert.equal(blend.companyCell(ym, cat), 0, `${ym} ${cat}`);
      else assert.equal(c.value, blend.companyCell(ym, cat), `${ym} ${cat}`);
      assert.ok(c.value === null || ["live", "history", "partial", "conflict"].includes(c.state));
    }
  }
});

test("like-for-like keeps whole cells captured the same way, and names every one it drops", () => {
  const P = ["2026-01", "2026-02", "2026-06"];
  const C = ["2025-01", "2025-02", "2025-06"];
  const { pairs, exclusions } = likeForLike(P, C, ["damage", "forgotten_freight", "late"], cov);
  const kept = pairs.map((p) => `${p.cat}:${p.cur}`);
  // Jan and Feb damage are spreadsheet against spreadsheet; Feb FF too. Jan FF is a
  // conflict; June is app against spreadsheet; Late isn't tracked in 2025.
  assert.deepEqual(kept.sort(), ["damage:2026-01", "damage:2026-02", "forgotten_freight:2026-02"]);
  const by = Object.fromEntries(exclusions.map((e) => [`${e.cat}|${e.reason}|${e.side}`, e]));
  assert.deepEqual(by["forgotten_freight|conflict|current"].months, ["2026-01"]);
  assert.deepEqual(by["damage|source_change|both"].months, ["2026-06"]);
  // Late: not tracked on either side in Jan–Feb; in June only 2025 lacks it.
  assert.deepEqual(by["late|not_tracked|both"].months, ["2026-01", "2026-02"]);
  assert.deepEqual(by["late|not_tracked|comparison"].cmpMonths, ["2025-06"]);
  assert.equal(
    exclusionText(by["forgotten_freight|conflict|current"]),
    "Forgotten Freight · Jan 2026 · live and history disagree this period",
  );
  assert.equal(exclusionText(by["late|not_tracked|comparison"]), "Late · Jun 2026 · not tracked in Jun 2025");
  // Allowing a source change keeps June's app-vs-spreadsheet pairs, marked.
  const allowed = likeForLike(P, C, ["damage"], cov, { allowSourceChange: true });
  const june = allowed.pairs.find((p) => p.cur === "2026-06");
  assert.ok(june && june.sourceChange);
  // A no-data month on either side is dropped with that reason.
  const gap = likeForLike(["2025-07"], ["2024-07"], ["damage"], cov);
  assert.deepEqual(gap.exclusions.map((e) => [e.reason, e.side]), [["no_data", "current"]]);
});

test("months in words run together", () => {
  assert.equal(monthsText(["2025-12", "2025-10", "2025-11", "2026-03"]), "Oct 2025 – Dec 2025, Mar 2026");
  assert.equal(monthsText([]), "");
});

test("a history zero where the category usually runs at 4+ is suspicious", () => {
  assert.deepEqual(suspiciousZeros(cov, ALL, FAILURES), [{ ym: "2024-09", category: "misdelivery", median: 6, prior: 8 }]);
});

test("unattributed failures by month: counted apart from the no-fault, with the names they carry", () => {
  const rows = unattributedByMonth(incidents, null, FAILURES);
  assert.equal(rows.length, 1);
  const [jul] = rows;
  assert.equal(jul.ym, "2026-07");
  assert.deepEqual([jul.total, jul.counted, jul.noFault], [3, 2, 1]);
  assert.deepEqual(jul.byCat, { late: 3 });
  // Spacing differences are one name.
  assert.deepEqual(jul.names, [{ name: "JEAN DELSOIN", n: 2 }, { name: "KOBE BOAKYE", n: 1 }]);
  assert.equal(jul.countedIds.length, 2);
  assert.deepEqual(unattributedByMonth(incidents, ["2026-06"], FAILURES), []);
});

test("each report's rollup against what its rows roll up today", () => {
  const status = Object.fromEntries(rollupStatus(reports, incidents, contribs).map((r) => [r.id, r]));
  assert.equal(status.r_apr.status, "never");
  assert.equal(status.r_may.status, "never");
  assert.equal(status.r_aug.status, "ok");
  assert.equal(status.r_none.status, "empty");
  assert.equal(status.r_jul.status, "stale");
  assert.deepEqual(status.r_jul.diffs, [
    { ym: "2026-07", category: "late", snapshot: 4, current: 2 },
    { ym: "2026-07", category: "missing", snapshot: 0, current: 1 },
  ]);
  assert.deepEqual([status.r_jul.snapshot, status.r_jul.current], [4, 3]);
  // Checked against history: everything rolled up is still there.
  const held = Object.fromEntries(rollupStatus(reports, incidents, contribs, history).map((r) => [r.id, r]));
  assert.equal(held.r_aug.status, "ok");
  assert.equal(held.r_jul.status, "stale");
  assert.equal(held.r_jul.cleared, false);
});

test("a rollup history no longer holds — an import replaced the records, the snapshots stayed", () => {
  // A History Import with replace clears every month's records and keeps the snapshots
  // (firebase.js saveHistoryBatch): the spreadsheet months come back, the rollups don't.
  const imported = history.filter((r) => r.source !== "report");
  const status = Object.fromEntries(rollupStatus(reports, incidents, contribs, imported).map((r) => [r.id, r]));
  assert.equal(status.r_aug.status, "cleared");
  assert.equal(status.r_aug.cleared, true);
  // A stale report history lost stays stale — it needs the same Re-sync — and says both.
  assert.equal(status.r_jul.status, "stale");
  assert.equal(status.r_jul.cleared, true);
  assert.equal(status.r_apr.status, "never");
  // A record imported over a rollup's: history holds the import's count for another
  // driver, and none of what August's report rolled up for Ann.
  const over = history
    .filter((r) => !(r.source === "report" && r.category === "misdelivery"))
    .concat([{ year: 2026, month: 8, driver_id: "d2", category: "misdelivery", count: 1, source: "import" }]);
  const rollups = rollupStatus(reports, incidents, contribs, over);
  assert.equal(rollups.find((r) => r.id === "r_aug").status, "cleared");
  // The cleared report is named where its month's live and history now disagree.
  const b2 = buildBlend({ incidents, history: over });
  const aug = reconcile({ conflicts: b2.conflicts, incidents, history: over, rollups }).find(
    (r) => r.ym === "2026-08" && r.category === "misdelivery",
  );
  const cleared = aug.causes.find((c) => c.kind === "cleared_rollup");
  assert.deepEqual(cleared.reports.map((r) => r.id), ["r_aug"]);
  assert.equal(causeText(cleared), "1 report rollup no longer in history — an import or a delete cleared it");
});

test("reconciliation names why live and history disagree", () => {
  const rollups = rollupStatus(reports, incidents, contribs);
  const rows = Object.fromEntries(
    reconcile({ conflicts: blend.conflicts, incidents, history, rollups }).map((r) => [`${r.ym}|${r.category}`, r]),
  );
  const jan = rows["2026-01|forgotten_freight"];
  assert.deepEqual([jan.live, jan.history, jan.delta], [3, 5, -2]);
  assert.deepEqual(jan.causes, [{ kind: "back_dated", n: 3, enteredIn: "2026-08" }]);
  assert.equal(causeText(jan.causes[0]), "back-dated entries: 3 entered in Aug 2026");
  const jul = rows["2026-07|late"];
  assert.deepEqual([jul.live, jul.history], [2, 4]);
  assert.equal(jul.causes[0].kind, "stale_rollup");
  assert.equal(causeText(jul.causes[0]), "stale report rollup: 1 report rolled up 4, their rows now count 2");
  const aug = rows["2026-08|misdelivery"];
  assert.deepEqual([aug.live, aug.history], [3, 1]);
  assert.deepEqual(aug.causes, [{ kind: "manual_not_rolled", n: 2 }]);
  assert.equal(aug.ids.length, 3);
  // Without the snapshots, a report-backed conflict says its rollups weren't checked.
  const unchecked = reconcile({ conflicts: blend.conflicts, incidents, history, rollups: null });
  assert.deepEqual(unchecked.find((r) => r.category === "late").causes, [{ kind: "unchecked" }]);
});

test("the evidence beside the capture windows, and the ids on file with no roster row", () => {
  const ev = captureEvidence(blend, ALL, ["missing", "late", "compliment"]);
  // Lost/missing: 2023 (but November) and 2025 on in history; July 2026's one live row.
  assert.equal(ev.missing.hist[0], "2023-01");
  assert.ok(!ev.missing.hist.includes("2023-11"));
  assert.ok(!ev.missing.hist.some((ym) => ym.startsWith("2024")));
  assert.deepEqual(ev.missing.live, ["2026-07"]);
  assert.deepEqual(ev.late.hist, ["2026-07"]);
  assert.deepEqual(ev.compliment, { hist: [], live: ["2026-06"] });
  // Zed Zulu (d9) has no roster row: listed with what he counts, never hidden. Cy Cole
  // is inactive but on the roster, so he isn't.
  const off = offRosterCounts(personIndex({ drivers, incidents, history }), blend);
  assert.deepEqual(
    off.map((p) => [p.id, p.n, p.firstOnFile]),
    [["d9", 1, "2026-07"]],
  );
});
