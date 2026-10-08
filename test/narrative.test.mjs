// "What changed" (narrative.js): the sentences are a deterministic snapshot of the data,
// and every count they state opens a drawer that counts exactly it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlend } from "../src/data/blend.js";
import { ulineCoverage, buildCoverage, monthsText } from "../src/data/coverage.js";
import { companyWindow, comparisonMonths, basketCategories } from "../src/data/companyMetrics.js";
import { whatChanged, summaryText } from "../src/data/narrative.js";
import { resolveDrill, drillLevels, encodeDrill, decodeDrill } from "../src/data/drill.js";
import { personIndex, nameOf } from "../src/data/people.js";
import { hiddenDriverIds } from "../src/data/drivers.js";
import * as F from "./compare-fixture.mjs";
import * as G from "./coverage-fixture.mjs";

function setup(fx) {
  const blend = buildBlend({ incidents: fx.incidents, history: fx.history });
  const cov = buildCoverage({
    blend,
    historyMonthIds: fx.monthIds,
    uline: ulineCoverage(fx.reports, fx.incidents),
    today: fx.TODAY,
    incidents: fx.incidents,
  });
  const people = personIndex({ drivers: fx.drivers, incidents: fx.incidents, history: fx.history });
  const ctx = { blend: () => blend, history: fx.history, incidents: fx.incidents, roleOf: () => "driver" };
  const run = (range, mode = "yoy", opts = {}) => {
    const w = companyWindow(range, { through: opts.through || "2026-09", from: opts.from, to: opts.to });
    const cmp = comparisonMonths(w.months, mode);
    return whatChanged({
      cov,
      blend,
      months: w.months,
      cmpMonths: cmp,
      cats: opts.cats || basketCategories(),
      lfl: opts.lfl ?? true,
      allowSourceChange: !!opts.src,
      today: fx.TODAY,
      label: w.label,
      cmpLabel: monthsText(cmp),
      nameOf: (id) => nameOf(people, id),
      hidden: opts.hidden || hiddenDriverIds(fx.drivers),
      rosterReady: opts.rosterReady ?? true,
      incidents: opts.incidents || fx.incidents,
    });
  };
  return { blend, cov, ctx, run };
}

const A = setup(F);

test("2025 against 2024: the snapshot", () => {
  const out = A.run("ly");
  assert.deepEqual(
    out.sentences.map((s) => s.text),
    [
      "Like-for-like, counted failures fell 6.6%: 323 this period against 346 in Jan 2024 – Dec 2024 (−23) — within normal variation.",
      "By category: Damage 80 against 93 (−13, 57% of the fall) and Forgotten Freight 180 against 190 (−10, 43% of the fall).",
      "323 failures came from 5 drivers (64.6 each) against 346 from 4 drivers (86.5 each).",
      "Rose most: Eve Ernst 53 (+53) and Dee Dent 53 (+34). Fell most: Ann Able 99 (−55) and Bo Baker 106 (−5). Inactive drivers, not named: −50 between them.",
      "New this period — none in Jan 2024 – Dec 2024, 3 or more now: Eve Ernst 53.",
    ],
  );
  assert.deepEqual(
    out.caveats.map((c) => c.text),
    [
      "Left out: Damage · Jul 2025, Dec 2025 · no data on file this period.",
      "Left out: Forgotten Freight · Jul 2025, Dec 2025 · no data on file this period.",
      "Left out: Misdelivery · Jul 2025, Dec 2025 · no data on file this period.",
      "Left out: Late · Jan 2025 – Dec 2025 · not tracked.",
      "Left out: Lost/Missing · Jan 2025 – Dec 2025 · not tracked in Jan 2024 – Dec 2024.",
    ],
  );
  // The categories that moved are what the monthly chart brings forward on hover.
  assert.deepEqual(out.sentences[1].focus, ["damage", "forgotten_freight"]);
  assert.equal(out.sentences[0].focus, null);
});

test("two live months against the two before: the reasons, from the live entries", () => {
  const out = A.run("custom", "prior", { from: "2026-08", to: "2026-09" });
  assert.deepEqual(
    out.sentences.map((s) => s.text),
    [
      "Like-for-like, counted failures rose 7.1%: 30 this period against 28 in Jun 2026 – Jul 2026 (+2) — within normal variation.",
      "30 failures came from 5 drivers (6.0 each) against 28 from 5 drivers (5.6 each).",
      "Rose most: Eve Ernst 7 (+4) and Bo Baker 8 (+1). Fell most: Dee Dent 5 (−2) and Ann Able 8 (−1).",
      "From the live entries: Skid went from 50% to 80% of Forgotten Freight (8 of 10, against 5 of 10) and Attempted went from 50% to 79% of Late (11 of 14, against 6 of 12).",
    ],
  );
  assert.deepEqual(out.sentences.at(-1).focus, ["forgotten_freight", "late"]);
  // The late row with no driver counts nowhere, and is said.
  assert.deepEqual(out.caveats.map((c) => c.text), ["1 failure with no driver in Aug 2026 – Sep 2026 is in no total."]);
});

test("the year to date: what moved against the trend, the mix, and every exclusion named", () => {
  const out = A.run("ytd");
  const texts = out.sentences.map((s) => s.text);
  assert.equal(texts[0], "Like-for-like, counted failures fell 7.2%: 90 this period against 97 in Jan 2025 – Sep 2025 (−7) — within normal variation.");
  assert.equal(
    texts[1],
    "By category: Misdelivery 17 against 28 (−11, more than the whole fall), Lost/Missing 21 against 17 (+4, against the fall) and Damage 21 against 24 (−3, 43% of the fall).",
  );
  assert.equal(
    texts.at(-1),
    "The mix moved: Misdelivery went from 29% to 19% of the compared failures (17 of 90) and Lost/Missing went from 18% to 23% of the compared failures (21 of 90).",
  );
  const cav = out.caveats.map((c) => c.text);
  // Jan 2026's forgotten freight is a conflict: left out, with both its numbers.
  assert.ok(cav.includes("Left out: Forgotten Freight · Jan 2026 · live and history disagree this period."));
  assert.ok(cav.includes("Live and history disagree for Forgotten Freight, Jan 2026: 3 live, 28 in history."));
  // App months against spreadsheet months are left out unless a source change is allowed.
  assert.ok(cav.includes("Left out: Damage · Apr 2026 – Jun 2026, Aug 2026 – Sep 2026 · spreadsheet vs app."));
  // A caveat chip knows where Data Coverage should open.
  const conflict = out.caveats.find((c) => c.text.startsWith("Left out: Forgotten Freight · Jan 2026"));
  assert.deepEqual([conflict.ym, conflict.cat], ["2026-01", "forgotten_freight"]);
});

test("every count a sentence states opens a drawer on exactly that count", () => {
  const cases = [];
  for (const fx of [F, G]) {
    const S = fx === F ? A : setup(G);
    for (const range of ["12", "24", "ytd", "ly", "all"]) {
      for (const mode of ["yoy", "prior"]) {
        for (const opts of [{}, { src: true }, { lfl: false }, { cats: ["late"] }, { cats: ["damage", "missing"] }]) {
          cases.push([S, range, mode, opts]);
        }
      }
    }
    cases.push([S, "custom", "prior", { from: "2026-08", to: "2026-09" }]);
    cases.push([S, "custom", "prior", { from: "2026-07", to: "2026-09" }]);
  }
  let checked = 0;
  for (const [S, range, mode, opts] of cases) {
    const out = S.run(range, mode, opts);
    for (const s of out.sentences) {
      const where = `${range} ${mode} ${JSON.stringify(opts)}: ${s.text}`;
      for (const seg of s.segments.filter((g) => g.drill)) {
        // Through the hash and back, as the drawer gets it.
        const state = decodeDrill(encodeDrill(seg.drill));
        const level = drillLevels(state).at(-1);
        assert.equal(level.expected, seg.n, where);
        assert.equal(resolveDrill(level.spec, S.ctx).total, seg.n, `${where} — "${seg.text}"`);
        assert.equal(seg.text, seg.n.toLocaleString(), where);
        checked++;
      }
      if (s.drill) {
        // "Open →" opens what the whole sentence is about, at the number it says.
        const level = drillLevels(s.drill).at(-1);
        assert.equal(level.expected, s.expectedTotal, where);
        assert.equal(resolveDrill(level.spec, S.ctx).total, s.expectedTotal, where);
        const counts = s.segments.filter((g) => g.drill).map((g) => g.n);
        const byCat = new Map(out.result.byCat.map((b) => [b.cat, b]));
        const breadth = out.sentences.find((x) => x.id === "breadth");
        if (s.id === "total" || s.id === "breadth") assert.equal(s.expectedTotal, counts[0], where);
        // The categories named, together: this period's count of each.
        if (s.id === "category" || s.id === "mix") {
          assert.equal(s.expectedTotal, s.focus.reduce((a, c) => a + (byCat.get(c)?.X || 0), 0) || counts[0], where);
        }
        // Each reason named, this period's entries (every other count).
        if (s.id === "why") assert.equal(s.expectedTotal, counts.filter((_, i) => i % 2 === 0).reduce((a, n) => a + n, 0), where);
        // The drivers named, among every driver's compared failures.
        if (s.id === "drivers" || s.id === "new") assert.equal(s.expectedTotal, breadth.expectedTotal, where);
      }
      assert.ok(!/significan/i.test(s.text), `never "significant": ${where}`);
    }
    assert.ok(out.sentences.length <= 7);
  }
  assert.ok(checked > 400, `${checked} counts checked`);
});

test("new means none at all in the comparison months, not just none in the cells compared", () => {
  // Fay Fox: 4 damage in Feb 2026 (spreadsheet, compared) and 2 in Aug 2025 — a month
  // left out of the comparison (spreadsheet vs app). Not new this year to date.
  const extra = [
    { year: 2026, month: 2, driver_id: "d6", driver_name: "Fay Fox", category: "damage", count: 4, source: "backfill" },
    { year: 2025, month: 8, driver_id: "d6", driver_name: "Fay Fox", category: "damage", count: 2, source: "backfill" },
  ];
  const S = setup({ ...F, history: [...F.history, ...extra] });
  const ytd = S.run("ytd");
  const fresh = ytd.sentences.find((s) => s.id === "new");
  assert.ok(!fresh || !fresh.text.includes("Fay Fox"), fresh?.text);
  // Without the August failures she is new, and named.
  const S2 = setup({ ...F, history: [...F.history, extra[0]] });
  const named = S2.run("ytd").sentences.find((s) => s.id === "new");
  assert.equal(named.text, "New this period — none in Jan 2025 – Sep 2025, 3 or more now: Fay Fox 4.");
});

test("like-for-like off: a category on file on one side only is part of the split", () => {
  // 2026 against 2025 over every covered cell: Late is on file in 2026 only.
  const out = A.run("custom", "yoy", { from: "2026-06", to: "2026-09", lfl: false });
  const cat = out.sentences.find((s) => s.id === "category");
  assert.ok(cat.text.includes("Late 26 against nothing on file (+26"), cat.text);
  assert.ok(cat.focus.includes("late"));
});

test("a window longer than a year shares months with its comparison, and says so", () => {
  const out = A.run("24");
  assert.equal(out.caveats[0].text, "Oct 2024 – Sep 2025 are in both periods: their failures count on both sides.");
  assert.ok(!A.run("12").caveats.some((c) => c.text.includes("both periods")));
});

test("a like-for-like total opens on each category's own months", () => {
  // Year to date: Jan 2026's forgotten freight is a conflict, so that category is
  // compared on Feb–Mar while the others run Jan–Mar.
  const out = A.run("ytd");
  const total = out.sentences[0].segments.find((s) => s.drill);
  const spec = drillLevels(total.drill).at(-1).spec;
  assert.deepEqual(spec.cells.forgotten_freight, ["2026-02", "2026-03"]);
  assert.deepEqual(spec.cells.damage, ["2026-01", "2026-02", "2026-03"]);
  assert.equal(spec.cells.late, undefined, "a category with nothing compared counts nothing");
  assert.equal(resolveDrill(spec, A.ctx).total, 90);
  // Without the cells the same months and categories would count Jan's forgotten freight.
  const { cells, ...block } = spec; // eslint-disable-line no-unused-vars
  assert.equal(resolveDrill(block, A.ctx).total, 90 + 3);
  // The drawer is named by the months it counts, and its coverage speaks only of the
  // cells it counts: Jan's forgotten freight (the conflict) isn't one of them.
  assert.equal(total.drill.scopes[0].label, "Jan 2026 – Mar 2026");
  const detail = resolveDrill(spec, A.ctx);
  assert.equal(detail.countsCell("2026-01", "forgotten_freight"), false);
  assert.deepEqual(detail.cellsOf("2026-01").live, []);
  // Over 24 months, a month nothing was compared in reads "not compared", not its source.
  const wide = drillLevels(A.run("24").sentences[0].drill).at(-1).spec;
  const d24 = resolveDrill(wide, A.ctx);
  assert.equal(d24.sourceOf("2025-07"), "left_out");
  assert.equal(d24.sourceOf("2025-03"), "history");
});

test("inactive drivers are never named and stay in every number; an id with no roster row is named", () => {
  const out = A.run("ly");
  const drivers = out.sentences.find((s) => s.id === "drivers").text;
  assert.ok(!drivers.includes("Cy Cole"));
  // Cy Cole (inactive) is in the total and the driver count all the same.
  assert.ok(out.sentences.find((s) => s.id === "breadth").text.startsWith("323 failures came from 5 drivers"));
  // Nobody hidden: Cy Cole is named.
  const all = A.run("ly", "yoy", { hidden: new Set() });
  assert.ok(all.sentences.find((s) => s.id === "drivers").text.includes("Cy Cole"));
  // d9 has no roster row: never hidden, named from the data. (Ann and Bo hidden here only
  // to make room for it among the three who rose most.)
  const late = A.run("custom", "prior", { from: "2026-06", to: "2026-09", cats: ["late"], hidden: new Set(["d1", "d2"]) });
  assert.equal(
    late.sentences.find((s) => s.id === "drivers").text,
    "Rose most: Dee Dent 2 (+2), Eve Ernst 2 (+2) and Zed Zulu 2 (+2). Inactive drivers, not named: +8 between them.",
  );
});

test("with no roster nobody is named, and the card says why", () => {
  const out = A.run("ly", "yoy", { rosterReady: false, hidden: new Set() });
  assert.deepEqual(
    out.sentences.map((s) => s.id),
    ["total", "category", "breadth"],
  );
  assert.ok(out.caveats.some((c) => c.text === "The driver roster couldn't be read, so no driver is named here."));
});

test("nothing to compare says so, and opens nothing", () => {
  // Late alone, 2025 against 2024: tracked in neither.
  const out = A.run("ly", "yoy", { cats: ["late"] });
  assert.equal(out.sentences.length, 1);
  assert.equal(out.sentences[0].text, "Nothing in Jan 2025 – Dec 2025 could be compared like-for-like with Jan 2024 – Dec 2024.");
  assert.equal(out.sentences[0].drill, null);
  assert.ok(out.caveats.some((c) => c.text === "Left out: Late · Jan 2025 – Dec 2025 · not tracked."));
});

test("across a source change the verdict is withheld, and the sentence says so", () => {
  const out = A.run("custom", "yoy", { from: "2026-06", to: "2026-08", src: true });
  assert.match(out.sentences[0].text, /^Across a change of source, counted failures/);
  assert.match(out.sentences[0].text, /no verdict \(different source\)\.$/);
  const off = A.run("ly", "yoy", { lfl: false });
  assert.match(off.sentences[0].text, /^Over every covered cell, not like-for-like,/);
  assert.match(off.sentences[0].text, /no verdict \(not like-for-like\)\.$/);
});

test("the reasons read only live months, with ten or more on each side, and never 'Not set'", () => {
  // Jun–Jul against Apr–May: forgotten freight wasn't captured before June, and Late has
  // no rows in April or May — fewer than ten.
  const early = A.run("custom", "prior", { from: "2026-06", to: "2026-07" });
  assert.ok(!early.sentences.some((s) => s.id === "why"));
  // 2025 against 2024: spreadsheet months hold counts only.
  assert.ok(!A.run("ly").sentences.some((s) => s.id === "why"));
  // Aug–Sep's late row with no reason is in the denominator (14), never a cause.
  const why = A.run("custom", "prior", { from: "2026-08", to: "2026-09" }).sentences.at(-1);
  assert.ok(!why.text.includes("Not set"));
  assert.ok(why.text.includes("(11 of 14, against 6 of 12)"));
});

test("the same data in another order reads the same words", () => {
  const shuffled = setup({ ...F, incidents: [...F.incidents].reverse(), history: [...F.history].reverse() });
  for (const [range, mode, opts] of [["ly", "yoy", {}], ["ytd", "yoy", {}], ["custom", "prior", { from: "2026-08", to: "2026-09" }]]) {
    assert.deepEqual(
      shuffled.run(range, mode, opts).sentences.map((s) => s.text),
      A.run(range, mode, opts).sentences.map((s) => s.text),
    );
  }
});

test("the copied summary is the card in plain text", () => {
  const out = A.run("custom", "prior", { from: "2026-08", to: "2026-09" });
  const text = summaryText({ ...out, label: "Aug 2026 – Sep 2026", cmpLabel: "Jun 2026 – Jul 2026" });
  const lines = text.split("\n");
  assert.equal(lines[0], "What changed — Aug 2026 – Sep 2026 against Jun 2026 – Jul 2026");
  assert.equal(lines[2], `• ${out.sentences[0].text}`);
  assert.ok(lines.includes("Caveats:"));
  assert.equal(lines.at(-1), "• 1 failure with no driver in Aug 2026 – Sep 2026 is in no total.");
});
