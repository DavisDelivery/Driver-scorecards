// Company History's numbers: the window, the month-by-month series, the headline and
// what it is compared against, with the guards that keep noise from being narrated.
//
// Every count is a blend cell (blend.js) read through the coverage model (coverage.js):
// a cell nothing captured is a gap, never a 0, and every number a mark draws resolves
// to the same drill-down spec the click opens (test/drill-reconcile.test.mjs).
import { FAILURES, ATTEMPTS, catLabel, category } from "./categories.js";
import { shiftYm, comparisonWindow, workdaysInMonth, addDays, weekdayOfYmd } from "./period.js";
import { tally } from "./blend.js";
import { faultSplit } from "./faultGroups.js";
import { likeForLike, fmtYm, monthsText, SOURCE_FROM, unattributedByMonth } from "./coverage.js";
import { NO_DATA_STATUSES } from "./attemptsFeed.js";

// The Range presets, in the order the filter row shows them.
export const RANGES = [
  ["12", "12M"],
  ["24", "24M"],
  ["ytd", "YTD"],
  ["ly", "Last year"],
  ["all", "All"],
  ["custom", "Custom"],
];

// The first month anything is on file for (the 2023 spreadsheet).
export const FIRST_YM = "2023-01";

// The month a fresh view runs through: the last complete ET month.
export const lastCompleteYm = (today) => shiftYm(String(today).slice(0, 7), -1);

// The months a Range covers, ending with `through` (YYYY-MM):
//   12 / 24   that many months ending with it
//   ytd       January of its year through it
//   ly        the whole calendar year before its year
//   all       from the first month on file through it
//   custom    from..to, swapped if picked backwards; a missing end falls back to 24M
// → { months, label }
export function companyWindow(range, { through, from, to, first = FIRST_YM } = {}) {
  const t = /^\d{4}-\d{2}$/.test(through || "") ? through : first;
  const run = (a, b) => {
    const out = [];
    for (let ym = a; ym <= b && out.length < 240; ym = shiftYm(ym, 1)) out.push(ym);
    return out;
  };
  const label = (months) =>
    months.length === 1 ? fmtYm(months[0]) : `${fmtYm(months[0])} – ${fmtYm(months[months.length - 1])}`;
  let months;
  if (range === "ytd") months = run(`${t.slice(0, 4)}-01`, t);
  else if (range === "ly") {
    const y = Number(t.slice(0, 4)) - 1;
    months = run(`${y}-01`, `${y}-12`);
  } else if (range === "all") months = run(first < t ? first : t, t);
  else if (range === "custom" && /^\d{4}-\d{2}$/.test(from || "") && /^\d{4}-\d{2}$/.test(to || "")) {
    months = from <= to ? run(from, to) : run(to, from);
  } else {
    const n = range === "12" ? 12 : 24;
    months = run(shiftYm(t, -(n - 1)), t);
  }
  return { months, label: label(months) };
}

// The months a window is compared with, aligned month for month (period.js):
// "yoy" the same months a year earlier, "prior" the same length just before.
export const comparisonMonths = (months, mode) => comparisonWindow({ months }, mode === "prior" ? "prior" : "yoy").months;

// The basket's categories: the failures, in the registry's order — complaints only when
// any are on file (they draw as "Other").
export function basketCategories({ hasComplaints = false } = {}) {
  return FAILURES.filter((c) => c !== "complaint" || hasComplaints);
}

// Mon–Fri days in a month; the month still in progress counts the days it has had.
export const workdaysOf = (ym, today) =>
  workdaysInMonth(ym, ym === String(today).slice(0, 7) ? { throughDay: String(today).slice(0, 10) } : {});

// What a month's basket number is made of, as a short key: each category that holds a
// number, with how it was captured and whether whole. Two months with different keys
// were captured differently — Late starting in April 2026 triples the total by capture
// alone — so no line is drawn from one to the other. It is about the number drawn: a
// July 2026 cell whose history rollup went stale is still the app's whole count.
export function monthSignature(cov, ym, cats) {
  return cats
    .map((cat) => {
      const c = cov.cell(ym, cat);
      if (c.value === null) return c.state === "no_data" ? `${cat}:-` : "";
      const whole = c.state !== "partial" && !c.reasons.length;
      return `${cat}:${c.instrument}${whole ? "" : "~"}`;
    })
    .filter(Boolean)
    .join(",");
}

const round2 = (n) => Math.round(n * 100) / 100;

// The basket month by month — one row per month of the window:
//   { ym, label, [cat]: value | null, __total, counts: { cat: n | null }, states,
//     workdays, sig, roll3 }
// measure "count" draws counts; "workday" draws each count per Mon–Fri day of its month.
// A month with no number in any category is a gap: every value null.
// roll3 is the mean of the three monthly totals ending at the month, so the window's
// first two months take theirs from the two months before it, when those were captured
// the same way; only the window's own rows come back.
export function monthlySeries(cov, months, cats, { measure = "count", today } = {}) {
  const lead = months.length ? [shiftYm(months[0], -2), shiftYm(months[0], -1)].filter((ym) => ym >= FIRST_YM) : [];
  const rows = [...lead, ...months].map((ym) => {
    const workdays = workdaysOf(ym, today);
    const row = { ym, label: fmtYm(ym), counts: {}, states: {}, workdays };
    let total = null;
    let count = null;
    for (const cat of cats) {
      const c = cov.cell(ym, cat);
      row.states[cat] = c.state;
      row.counts[cat] = c.value;
      if (c.value === null) {
        row[cat] = null;
        continue;
      }
      count = (count || 0) + c.value;
      const v = measure === "workday" ? (workdays ? round2(c.value / workdays) : null) : c.value;
      row[cat] = v;
      if (v !== null) total = (total || 0) + v;
    }
    row.count = count;
    row.__total = total === null ? null : round2(total);
    row.sig = monthSignature(cov, ym, cats);
    return row;
  });
  const roll = rolling3(
    rows.map((r) => r.__total),
    rows.map((r) => r.sig),
  );
  rows.forEach((r, i) => {
    r.roll3 = roll[i] === null ? null : round2(roll[i]);
  });
  return rows.slice(lead.length);
}

// The 3-month rolling mean of a series: the mean of a value and the two before it, or
// null unless all three are there and were captured the same way (sigs). It never
// bridges a gap or a change in what was captured.
export function rolling3(values, sigs = null) {
  return values.map((v, i) => {
    if (i < 2) return null;
    const w = [values[i - 2], values[i - 1], v];
    if (w.some((x) => x === null || x === undefined)) return null;
    if (sigs && (sigs[i - 2] !== sigs[i] || sigs[i - 1] !== sigs[i])) return null;
    return (w[0] + w[1] + w[2]) / 3;
  });
}

// A sparkline's runs: consecutive points with a value and the same signature. A run of
// one is drawn as a dot; nothing joins two runs.
//   → [[{ i, v }]]
export function sparkRuns(values, sigs = null) {
  const runs = [];
  let cur = null;
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      cur = null;
      return;
    }
    if (cur && sigs && sigs[i] !== sigs[i - 1]) cur = null;
    if (!cur) runs.push((cur = []));
    cur.push({ i, v });
  });
  return runs;
}

// The headline over a window: every number the window's cells hold — the full covered
// total, the one the monthly columns add up to and its drill-down counts.
export function coveredTotal(cov, months, cats) {
  let n = 0;
  for (const ym of months) for (const cat of cats) n += cov.cell(ym, cat).value || 0;
  return n;
}

// The headline against the comparison window.
//   lfl                like-for-like (default): only the aligned cells captured whole and
//                      the same way on both sides; every cell left out is listed
//   allowSourceChange  keep spreadsheet-vs-app pairs — the verdict is then withheld
// → { A, X, Cmp, delta, pct, byCat: [{ cat, X, Cmp, months, cmpMonths }], exclusions,
//     pairs, sourceChange, lfl, eA, eC, verdict }
// eA / eC: the Mon–Fri days of the months holding a compared cell, on each side.
// A is the full covered total; X the part of it that was compared ("compared on X of A").
export function compareWindows(cov, P, C, cats, { lfl = true, allowSourceChange = false, today } = {}) {
  const A = coveredTotal(cov, P, cats);
  let pairs;
  let exclusions = [];
  if (lfl) {
    ({ pairs, exclusions } = likeForLike(P, C, cats, cov, { allowSourceChange }));
  } else {
    // Every covered cell on each side, aligned or not.
    pairs = [];
    const n = Math.min(P.length, C.length);
    for (const cat of cats) {
      for (let i = 0; i < n; i++) {
        const a = cov.cell(P[i], cat);
        const b = cov.cell(C[i], cat);
        pairs.push({ cat, cur: P[i], cmp: C[i], a: a.value, b: b.value, sourceChange: a.instrument !== b.instrument });
      }
    }
  }
  const byCat = new Map();
  let X = 0;
  let Cmp = 0;
  for (const p of pairs) {
    const e = byCat.get(p.cat) || byCat.set(p.cat, { cat: p.cat, X: 0, Cmp: 0, months: [], cmpMonths: [] }).get(p.cat);
    if (p.a !== null) {
      e.X += p.a;
      X += p.a;
      e.months.push(p.cur);
    }
    if (p.b !== null) {
      e.Cmp += p.b;
      Cmp += p.b;
      e.cmpMonths.push(p.cmp);
    }
  }
  const sourceChange = pairs.some((p) => p.sourceChange && p.a !== null && p.b !== null);
  // Exposure: the workdays of the months that hold a compared cell, on each side.
  const curMonths = [...new Set(pairs.filter((p) => p.a !== null).map((p) => p.cur))].sort();
  const cmpMonths = [...new Set(pairs.filter((p) => p.b !== null).map((p) => p.cmp))].sort();
  const eA = curMonths.reduce((t, ym) => t + workdaysOf(ym, today), 0);
  const eC = cmpMonths.reduce((t, ym) => t + workdaysOf(ym, today), 0);
  // The swing to judge against: the compared current months, the last 12 of them, each
  // category against its own mean. Which categories were compared changes from month to
  // month (Jan 2026's forgotten freight is a conflict, Lost/Missing pairs only in Jan–Mar),
  // and month totals over a changing set would read that change as swing.
  const last12 = new Set(curMonths.slice(-12));
  const byCatRates = new Map();
  for (const p of pairs) {
    if (p.a === null || !last12.has(p.cur)) continue;
    (byCatRates.get(p.cat) || byCatRates.set(p.cat, []).get(p.cat)).push({ n: p.a, e: workdaysOf(p.cur, today) });
  }
  const verdict = quasiPoissonVerdict({ A: X, eA, C: Cmp, eC, groups: [...byCatRates.values()], sourceChange, lfl });
  return {
    A,
    X,
    Cmp,
    delta: X - Cmp,
    pct: Cmp ? (X - Cmp) / Cmp : null,
    byCat: [...byCat.values()].filter((e) => e.months.length || e.cmpMonths.length),
    exclusions,
    pairs,
    sourceChange,
    lfl,
    eA,
    eC,
    verdict,
  };
}

// Is a change bigger than the usual month-to-month swing?
//   r = n / e (per workday);  φ = max(1, Pearson χ² / df) over the monthly rates
//   z = (rA − rC) / √(φ · (A/eA² + C/eC²))
//   "swing"     |z| ≥ 2 — bigger than the usual swing
//   "normal"    within it
//   "withheld"  fewer than 30 failures on both sides together, no exposure, a
//               comparison across a source change, or not like-for-like
// Counts are overdispersed (the top 10 drivers hold 37% of them), hence φ.
//   monthlyRates  [{ n, e }] one series, against its own mean (df = K − 1)
//   groups        [[{ n, e }]] several (one per category), each against its own mean,
//                 pooled (df = Σ (K − 1)) — used over monthlyRates when given
export function quasiPoissonVerdict({ A, eA, C, eC, monthlyRates = [], groups = null, sourceChange = false, lfl = true }) {
  const phi = dispersion(groups || [monthlyRates]);
  const out = { z: null, phi, verdict: "withheld", why: null };
  if (!lfl) return { ...out, why: "not like-for-like" };
  if (sourceChange) return { ...out, why: "different source" };
  if (!(eA > 0) || !(eC > 0)) return { ...out, why: "nothing compared" };
  if (A + C < 30) return { ...out, why: "too few to judge" };
  const se = Math.sqrt(phi * (A / eA ** 2 + C / eC ** 2));
  const z = se > 0 ? (A / eA - C / eC) / se : 0;
  return { z, phi, verdict: Math.abs(z) >= 2 ? "swing" : "normal", why: null };
}

// φ from series of monthly { n, e }: each series' Pearson χ² against its own rate,
// pooled over their degrees of freedom; 1 when there's nothing to measure, never less.
export function dispersion(groups = []) {
  let chi2 = 0;
  let df = 0;
  for (const g of groups || []) {
    const rates = (g || []).filter((m) => m && m.e > 0);
    if (rates.length < 2) continue;
    const N = rates.reduce((t, m) => t + m.n, 0);
    const E = rates.reduce((t, m) => t + m.e, 0);
    const rbar = E ? N / E : 0;
    if (!(rbar > 0)) continue;
    chi2 += rates.reduce((t, m) => t + (m.n - m.e * rbar) ** 2 / (m.e * rbar), 0);
    df += rates.length - 1;
  }
  return df ? Math.max(1, chi2 / df) : 1;
}

export const VERDICT_TEXT = {
  swing: "bigger than the usual month-to-month swing",
  normal: "within normal variation",
};

// Drivers with any failure in the window's basket — inactive drivers and ids with no
// roster row included (they are in the total; nothing here names them).
export function driversInvolved(blend, months, cats) {
  const ids = [];
  for (const [id, byCat] of tally(blend, months, cats)) {
    let n = 0;
    for (const v of byCat.values()) n += v;
    if (n > 0) ids.push(id);
  }
  return ids;
}

// The fault split of the window's counted live failures in the basket (faultGroups.js),
// and the months of it only history serves — which has no fault to split.
export function basketFaultSplit(blend, months, cats) {
  const want = new Set(cats);
  const rows = [...new Set(months)].flatMap((ym) => (blend.liveByYm[ym] || []).filter((inc) => want.has(inc.category)));
  const historyMonths = [...new Set(months)].filter((ym) => cats.some((c) => blend.cellSource(ym, c) === "history"));
  return { ...faultSplit(rows), historyMonths };
}

// ── The Overview's tiles ─────────────────────────────────────────────────────

// Every tile on the Overview over one window: the number it shows — null where the
// window captured none of it, with the words for why in `reason`, never a 0 — and the
// drawer it opens (null when there is nothing to open).
//   counted       the full covered total, the hero; it opens exactly that
//   perWorkday    counted over the Mon–Fri days of the window's months that hold a number
//   drivers       ids with a counted failure, inactive and off-roster ids included
//   unattributed  live failures with no driver, not marked no-fault. Only live entries
//                 carry them (the spreadsheets and the rollup hold attributed counts), so
//                 a window with no live month can't show any; `liveOnly` when only some
//                 of its months are live
//   fault         the driver-fault share of the counted live failures (faultGroups.js)
//   compliments, attempts  the entry tabs' counts. The tabs began in June 2026: a
//                 window wholly before it captured none ("not captured"), and one that
//                 starts before it says from when (`from`)
export function overviewTiles({ cov, blend, incidents = [], months, cats, today, label = "" }) {
  const A = coveredTotal(cov, months, cats);
  const workdays = months
    .filter((ym) => cats.some((c) => cov.cell(ym, c).value !== null))
    .reduce((t, ym) => t + workdaysOf(ym, today), 0);
  const ids = driversInvolved(blend, months, cats);
  const liveMonths = months.filter((ym) => cats.some((c) => blend.isLive(ym, c)));
  const un = unattributedByMonth(incidents, months, cats);
  const unCounted = un.reduce((t, m) => t + m.counted, 0);
  const fault = basketFaultSplit(blend, months, cats);
  const entryTab = (cat) => {
    const captured = months.some((ym) => cov.cell(ym, cat).value !== null);
    const n = coveredTotal(cov, months, [cat]);
    return {
      value: captured ? n : null,
      reason: captured ? null : `not captured before ${fmtYm(SOURCE_FROM.manual)}`,
      from: captured && months[0] < SOURCE_FROM.manual ? SOURCE_FROM.manual : null,
      drill: captured && n ? companyDrill([cat], months, n, label, { vocab: cats }) : null,
    };
  };
  return {
    counted: { value: A, drill: companyDrill(cats, months, A, label, { title: "Counted failures", vocab: cats }) },
    perWorkday: { value: workdays ? A / workdays : null, workdays, reason: workdays ? null : "nothing on file" },
    drivers: { value: ids.length, perDriver: ids.length ? A / ids.length : null },
    unattributed: {
      value: liveMonths.length ? unCounted : null,
      noFault: un.reduce((t, m) => t + m.noFault, 0),
      liveOnly: liveMonths.length > 0 && liveMonths.length < months.length,
      reason: liveMonths.length ? null : "not tracked in imported history",
      drill:
        liveMonths.length && unCounted
          ? incidentsDrill(
              un.flatMap((m) => m.countedIds),
              { categoryIds: cats, months, title: "Unattributed failures", label },
            )
          : null,
    },
    fault: {
      value: fault.total ? fault.groups.driver.n / fault.total : null,
      n: fault.groups.driver.n,
      total: fault.total,
      reviewed: fault.total ? fault.reviewed / fault.total : null,
      historyMonths: fault.historyMonths,
      reason: fault.total ? null : "not tracked in imported history",
    },
    compliments: entryTab("compliment"),
    attempts: entryTab(ATTEMPTS),
  };
}

// ── What each number opens ───────────────────────────────────────────────────
// The drawer states (drill.js) behind Company History's numbers, each carrying the
// number shown, so the drawer can prove it counts the same thing
// (test/drill-reconcile.test.mjs walks every mark through these).

// Every company cell of these categories in these months — history records with no
// driver included, as the cells count them. One scope, so a driver opened inside the
// drawer keeps the months.
//   vocab  the screen's basket: a driver opened from a failure drawer gets all of it,
//          so the breadcrumb can pop back out to every failure. Compliments and logged
//          attempts aren't failures — their drawer keeps its own category, and a driver
//          opened from it shows that driver's compliments, never their failures.
export function companyDrill(categoryIds, months, expected, label, { title = null, vocab = categoryIds } = {}) {
  return {
    spec: { kind: "blend", categoryIds, unattributed: true, ...(title ? { title } : {}) },
    scopes: [{ label, months, expected }],
    scope: 0,
    vocab: categoryIds.every((c) => vocab.includes(c)) ? vocab : categoryIds,
  };
}

// An explicit list of live entries (the unattributed failures), headed by what they are.
export function incidentsDrill(ids, { categoryIds = null, months = null, title, label }) {
  return {
    spec: { kind: "incidents", ids, ...(categoryIds ? { categoryIds } : {}), ...(months ? { months } : {}), title, label },
    expected: ids.length,
  };
}

// One week of attempted orders: the days the week's column counted.
export const weekDrill = (w) => ({
  spec: { kind: "attempts", start: w.start, end: w.end, label: `Week of ${w.label}` },
  expected: w.n,
});

// ── Attempted orders, a week at a time ───────────────────────────────────────

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (ymd) => `${MONTH_ABBR[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

// The Monday on or before a day.
export const mondayOfYmd = (ymd) => addDays(ymd, -((weekdayOfYmd(ymd) + 6) % 7));

// The attempted orders (attemptRecords.js) of the loaded feed days, one row per
// Monday-start ET week. Each week is clamped to the loaded days, so a week that is only
// partly loaded counts — and drills into — the loaded part alone.
//   records   buildAttemptRecords(...).records
//   days      Map(date -> { status }) — the loaded feed days
//   start/end the loaded span (YYYY-MM-DD)
// → [{ key, label, start, end, n, noData, unassigned, gap, __notes }]
export function weeklyAttempts(records = [], days = new Map(), { start, end } = {}) {
  if (!start || !end || start > end) return [];
  const out = [];
  for (let wk = mondayOfYmd(start); wk <= end; wk = addDays(wk, 7)) {
    const s = wk < start ? start : wk;
    const lastDay = addDays(wk, 6);
    const e = lastDay > end ? end : lastDay;
    const inWeek = (records || []).filter((r) => r.date >= s && r.date <= e);
    let noData = 0;
    for (let d = s; d <= e; d = addDays(d, 1)) {
      const st = days.get(d)?.status;
      if (st && NO_DATA_STATUSES.has(st)) noData++;
    }
    const unassigned = inWeek.filter((r) => (r.key || "") === "unassigned").length;
    const notes = [];
    if (noData) notes.push(`${noData} day${noData === 1 ? "" : "s"} no data`);
    if (unassigned) notes.push(`${unassigned} unassigned`);
    if (s !== wk || e !== lastDay) notes.push(`${shortDay(s)} – ${shortDay(e)} loaded`);
    out.push({
      key: wk,
      label: shortDay(wk),
      start: s,
      end: e,
      n: inWeek.length,
      noData,
      unassigned,
      gap: noData ? `${noData}d no data` : null,
      __notes: notes,
    });
  }
  return out;
}

// A month list's categories in words, for headings: "Damage, Forgotten Freight".
export const catsText = (cats) => cats.map(catLabel).join(", ");

// ── Compare: what each side of a comparison counted ─────────────────────────
//
// A like-for-like total adds each category over its own months — Jan 2026's forgotten
// freight is a conflict, so that category is compared on Feb–Mar while the rest run
// Jan–Mar — so it is no one block of months × categories. These say which cells each
// side counted, and open the drawer on exactly those (drill.js `cells`).

const sortYms = (ms) => [...new Set(ms)].sort();

// The cells a comparison counted, per category and side:
//   → { cur: { cat: [months] }, cmp: { cat: [months] } }
// from compareWindows' pairs: a side's month is in only when its cell holds a number.
export function comparedCells(pairs = []) {
  const cur = {};
  const cmp = {};
  for (const p of pairs) {
    if (p.a !== null && p.a !== undefined) (cur[p.cat] || (cur[p.cat] = [])).push(p.cur);
    if (p.b !== null && p.b !== undefined) (cmp[p.cat] || (cmp[p.cat] = [])).push(p.cmp);
  }
  for (const side of [cur, cmp]) for (const c of Object.keys(side)) side[c] = sortYms(side[c]);
  return { cur, cmp };
}

// The cells of these categories only.
export const pickCells = (cells, cats) =>
  Object.fromEntries(cats.filter((c) => cells[c]?.length).map((c) => [c, cells[c]]));

// The drawer on a set of cells: each category over its own months, with the number shown.
// When every category runs over the same months it is a plain block (companyDrill), so
// the link stays short. With no `label` the scope is named by the months it counts.
//   driverId      one driver's share of the cells (their count, no unattributed records)
//   unattributed  history records with no driver count too: the company total. Off for a
//                 count over drivers (breadth: the drivers' failures add up to it)
//   vocab         the screen's basket (companyDrill)
export function cellsDrill(cells, expected, label, { title = null, driverId = null, unattributed = !driverId, vocab = null, note = null } = {}) {
  const cats = Object.keys(cells)
    .filter((c) => cells[c]?.length)
    .sort((a, b) => (category(a)?.order ?? 99) - (category(b)?.order ?? 99) || a.localeCompare(b));
  const months = sortYms(cats.flatMap((c) => cells[c]));
  const block = cats.every((c) => cells[c].length === months.length);
  const spec = {
    kind: "blend",
    categoryIds: cats,
    ...(driverId ? { driverId } : {}),
    ...(unattributed && !driverId ? { unattributed: true } : {}),
    ...(block ? {} : { cells: pickCells(cells, cats) }),
    ...(title ? { title } : {}),
    ...(note ? { label: note } : {}),
  };
  const v = vocab || cats;
  return {
    spec,
    scopes: [{ label: label || monthsText(months), months, expected }],
    scope: 0,
    vocab: cats.every((c) => v.includes(c)) ? v : cats,
  };
}

// Every attributed driver's count over a set of cells: Map(driverId -> n). History
// records with no driver belong to nobody here (they are in the company total only).
export function driverTotals(blend, cells) {
  const out = new Map();
  for (const [cat, months] of Object.entries(cells || {})) {
    for (const ym of months) {
      for (const e of blend.entries(ym)) {
        if (e.category !== cat || !e.n || !e.driverId) continue;
        out.set(e.driverId, (out.get(e.driverId) || 0) + e.n);
      }
    }
  }
  return out;
}

// The drivers whose count moved between two sides: [{ id, cur, cmp, delta }], drivers at
// 0 on both sides left out. `up` rose most first, `down` fell most first; ties go to the
// larger current count, then the id, so the order never depends on how the data arrived.
export function movers(cur = new Map(), cmp = new Map()) {
  const ids = new Set([...cur.keys(), ...cmp.keys()]);
  const rows = [];
  for (const id of ids) {
    const a = cur.get(id) || 0;
    const b = cmp.get(id) || 0;
    if (!a && !b) continue;
    rows.push({ id, cur: a, cmp: b, delta: a - b });
  }
  const tie = (x, y) => y.cur - x.cur || String(x.id).localeCompare(String(y.id));
  return {
    rows,
    up: rows.filter((r) => r.delta > 0).sort((x, y) => y.delta - x.delta || tie(x, y)),
    down: rows.filter((r) => r.delta < 0).sort((x, y) => x.delta - y.delta || tie(x, y)),
  };
}

// Did the total move because more drivers had failures (breadth) or because each had
// more (intensity)? T = D × (T/D), so ln(T_A/T_C) = ln(D_A/D_C) + ln(I_A/I_C), and
// breadth's part is ln(D_A/D_C) / ln(T_A/T_C).
// Answered only when all four are above 0, the total moved by at least 10% on the log
// scale, and the driver count moved the same way as the total; otherwise null, and only
// D and T/D are shown.
export function breadthIntensity({ D_A, D_C, T_A, T_C }) {
  const out = { D_A, D_C, T_A, T_C, I_A: D_A ? T_A / D_A : null, I_C: D_C ? T_C / D_C : null, breadthShare: null };
  if (!(D_A > 0 && D_C > 0 && T_A > 0 && T_C > 0)) return out;
  const lt = Math.log(T_A / T_C);
  const ld = Math.log(D_A / D_C);
  if (Math.abs(lt) < 0.1 || Math.sign(lt) !== Math.sign(ld)) return out;
  return { ...out, breadthShare: ld / lt };
}

// How much of the total's change each category carries: [{ cat, X, Cmp, delta, share }],
// share = delta / ΔT (null when the total didn't move).
export function decomposeByCategory(byCat = [], totalDelta = 0) {
  return byCat.map((b) => ({
    cat: b.cat,
    X: b.X,
    Cmp: b.Cmp,
    delta: b.X - b.Cmp,
    share: totalDelta ? (b.X - b.Cmp) / totalDelta : null,
  }));
}

// ── Compare › by category ────────────────────────────────────────────────────

// One row per category of the basket, in its order, for the dumbbell and its table:
//   { cat, compared, X, Cmp, delta, pct, value, cmpValue, eA, eC, months, cmpMonths,
//     verdict, sourceChange, exclusions, drill, cmpDrill }
// `compared` false: nothing of it could be compared — never a 0. The row says why: its
// exclusions (like-for-like), or, with like-for-like off, `why` — what the empty side
// held ("not tracked in Oct 2023 – Sep 2025"). A category on file on one side only is in
// the total all the same (compareWindows counts every covered cell then), so its row
// carries that side (`oneSided`: "current" | "comparison"), its count `n`, `value` per
// the measure and the drawer on it: the rows always add up to X and Cmp.
// value / cmpValue are what is drawn: counts, or per Mon–Fri day of the compared months.
// The verdict is the category's own (its compared months, the last 12 of them for the
// swing); a source change or not being like-for-like withholds it. drill / cmpDrill open
// each dot on the months it counted (test/drill-reconcile.test.mjs).
export function compareByCategory(cov, r, cats, { today, measure = "count" } = {}) {
  const by = new Map(r.byCat.map((b) => [b.cat, b]));
  const rate = (n, e) => (e ? round2(n / e) : null);
  const workdays = (ms) => ms.reduce((t, ym) => t + workdaysOf(ym, today), 0);
  const dotDrill = (cat, ms, n) => companyDrill([cat], ms, n, monthsText(ms), { vocab: cats });
  return cats.map((cat) => {
    const b = by.get(cat);
    const exclusions = r.exclusions.filter((e) => e.cat === cat);
    const pairs = r.pairs.filter((p) => p.cat === cat && p.a !== null && p.b !== null);
    if (!b || !b.months.length || !b.cmpMonths.length) {
      const months = b?.months || [];
      const cmpMonths = b?.cmpMonths || [];
      const row = { cat, compared: false, exclusions, months, cmpMonths, why: null, oneSided: null };
      if (exclusions.length) return row;
      // Like-for-like off: every aligned cell was taken, so an empty side held nothing —
      // in words, from what its cells were: "not tracked in Oct 2023 – Sep 2025".
      const all = r.pairs.filter((p) => p.cat === cat);
      const emptyWord = (side) => {
        const states = new Set(all.map((p) => cov.cell(p[side], cat).state));
        if (states.size !== 1) return "nothing on file";
        return states.has("not_tracked") ? "not tracked" : states.has("no_data") ? "no data on file" : "nothing on file";
      };
      const held = (side, n, ms, empty) => ({
        ...row,
        oneSided: side,
        n,
        value: measure === "workday" ? rate(n, workdays(ms)) : n,
        why: `${emptyWord(empty)} in ${monthsText(all.map((p) => p[empty]))}`,
        drill: dotDrill(cat, ms, n),
      });
      if (months.length) return held("current", b.X, months, "cmp");
      if (cmpMonths.length) return held("comparison", b.Cmp, cmpMonths, "cur");
      const word = emptyWord("cur");
      return { ...row, why: word === emptyWord("cmp") ? `${word} in either period` : "nothing on file in either period" };
    }
    const eA = workdays(b.months);
    const eC = workdays(b.cmpMonths);
    const sourceChange = pairs.some((p) => p.sourceChange);
    const last12 = new Set(b.months.slice(-12));
    const rates = pairs.filter((p) => last12.has(p.cur)).map((p) => ({ n: p.a, e: workdaysOf(p.cur, today) }));
    const verdict = quasiPoissonVerdict({ A: b.X, eA, C: b.Cmp, eC, monthlyRates: rates, sourceChange, lfl: r.lfl });
    return {
      cat,
      compared: true,
      X: b.X,
      Cmp: b.Cmp,
      delta: b.X - b.Cmp,
      pct: b.Cmp ? (b.X - b.Cmp) / b.Cmp : null,
      value: measure === "workday" ? rate(b.X, eA) : b.X,
      cmpValue: measure === "workday" ? rate(b.Cmp, eC) : b.Cmp,
      eA,
      eC,
      months: b.months,
      cmpMonths: b.cmpMonths,
      verdict,
      sourceChange,
      exclusions,
      drill: dotDrill(cat, b.months, b.X),
      cmpDrill: dotDrill(cat, b.cmpMonths, b.Cmp),
    };
  });
}

// The two totals of a comparison, each opening exactly the cells it added up
// (cellsDrill): → { cur, cmp } drawer states for X and Cmp.
//   note  how the cells were picked ("like-for-like"), for the drawer's heading
export function comparedTotalsDrill(r, cats, note = null) {
  const cells = comparedCells(r.pairs);
  return {
    cur: cellsDrill(cells.cur, r.X, null, { title: "Counted failures", vocab: cats, note }),
    cmp: cellsDrill(cells.cmp, r.Cmp, null, { title: "Counted failures", vocab: cats, note }),
  };
}

// The months a window and its comparison share: a window longer than a year against
// the same months a year earlier has the overlap on both sides — the same failures
// counted in both totals. → [ym], sorted.
export const sharedMonths = (months = [], cmpMonths = []) => {
  const c = new Set(cmpMonths);
  return sortYms(months.filter((ym) => c.has(ym)));
};

// ── Compare › month by month, years as series ────────────────────────────────

const MONTH_ABBR_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INSTRUMENT_WORDS = { backfill: "spreadsheet", app: "app" };

// One category (or the basket's total) month by month, one series per year, on one axis.
//   through  the last month of the selected year (the window's end): the selected year
//            runs Jan..through, the years before it Jan..Dec
//   years    how many years to plot, the selected one first (2 by default)
//   cats     one category, or several: their total over the categories tracked in every
//            plotted year (B*) — a category one year didn't track would read as a jump.
//            When no category was tracked in every year, the oldest years are dropped
//            until one is (`dropped`)
//   lfl, allowSourceChange  as the filter row has them (compareWindows)
// A year that tracked none of it is left out and said (`left`, `dropped`). A month with
// no number for any of B* is a gap.
//
// Like-for-like (the default), a point is on its year's line only when it can be
// compared: captured whole (not partly captured, not live and history disagreeing) and,
// for an earlier year, captured the same way as the newest year's same month where that
// month holds a number — 2025's spreadsheet June isn't drawn against 2026's app June.
// Every other point is still drawn, hollow and off the line, and named (`notCompared`).
// Allowing a source change keeps those on the line, marked "different source"; with
// like-for-like off every point is on its line, the ones not captured whole marked.
// A run of months breaks where what was captured changes (monthSignature), so a line
// never joins a spreadsheet month to an app month.
// → { years: [y], cats: B*, left: [{ cat, years }], dropped: [y], rows, runs: { y: n },
//     notCompared: [{ year, why, months }], otherSource: [{ year, why, months }] }
//   rows: [{ m, label, ["y"+Y]: value, ["y"+Y+"_"+k]: value on run k, ["y"+Y+"_x"]:
//            value of a point off the line, ym: { Y: ym }, count: { Y: n },
//            state: { Y: text }, off: { Y: bool }, marked: { Y: bool }, drill: { Y },
//            __notes }]
//   state  why a point isn't a plain like-for-like value, in words, or null
//   off    drawn hollow, off its line; marked: on its line, but not captured whole
export function yearLines(
  cov,
  { through, years = 2, cats = [], measure = "count", today, first = FIRST_YM, lfl = true, allowSourceChange = false } = {},
) {
  const Y = Number(String(through).slice(0, 4));
  const candidates = [];
  for (let k = 0; k < years; k++) if (`${Y - k}-12` >= first) candidates.push(Y - k);
  const monthsOf = (y) => {
    const last = y === Y ? Number(String(through).slice(5, 7)) : 12;
    return Array.from({ length: last }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`).filter((ym) => ym >= first);
  };
  const whole = (ym, c) => {
    const s = cov.cell(ym, c).state;
    return s === "live" || s === "history";
  };
  const covered = (y, c) => monthsOf(y).some((ym) => whole(ym, c));
  let plotted = candidates;
  let use = cats;
  const left = [];
  if (cats.length === 1) {
    plotted = candidates.filter((y) => covered(y, cats[0]));
  } else {
    // The most years over which some category was tracked in every one, newest first.
    let k = candidates.length;
    for (; k > 0; k--) {
      use = cats.filter((c) => candidates.slice(0, k).every((y) => covered(y, c)));
      if (use.length) break;
    }
    plotted = candidates.slice(0, k);
    for (const c of cats) {
      if (use.includes(c)) continue;
      left.push({ cat: c, years: plotted.filter((y) => !covered(y, c)) });
    }
  }
  const dropped = candidates.filter((y) => !plotted.includes(y));
  const rows = MONTH_ABBR_.map((label, i) => ({
    m: i + 1,
    label,
    ym: {},
    count: {},
    state: {},
    off: {},
    marked: {},
    drill: {},
    __notes: [],
  }));
  const runs = {};
  if (!use.length || !plotted.length) return { years: [], cats: use, left, dropped: candidates, rows, runs, notCompared: [], otherSource: [] };

  // Each point's count and how it was captured: null for a gap.
  const pointOf = (ym) => {
    let n = 0;
    const notWhole = [];
    const inst = [];
    for (const c of use) {
      const cell = cov.cell(ym, c);
      if (cell.value === null) return null;
      n += cell.value;
      inst.push(cell.instrument);
      if (cell.state !== "live" && cell.state !== "history") notWhole.push(cell.state);
    }
    return { ym, n, notWhole, inst: inst.join(","), how: [...new Set(inst)].map((i) => INSTRUMENT_WORDS[i] || i).join(" and ") };
  };
  const ref = plotted[0];
  const refPoints = new Map(monthsOf(ref).map((ym) => [Number(ym.slice(5, 7)), pointOf(ym)]));
  // Points named by year and why: those left off their line, and those on it though
  // captured differently from the newest year (a source change allowed, or not
  // like-for-like).
  const groups = new Map();
  const differ = new Map();
  const name = (into, y, why, ym) => {
    const key = `${y}|${why}`;
    (into.get(key) || into.set(key, { year: y, why, months: [] }).get(key)).months.push(ym);
  };
  const title = use.length > 1 ? "Basket total" : null;

  for (const y of plotted) {
    let run = -1;
    let prevSig = null;
    let prevHad = false;
    for (const ym of monthsOf(y)) {
      const m = Number(ym.slice(5, 7));
      const row = rows[m - 1];
      const p = y === ref ? refPoints.get(m) : pointOf(ym);
      row.ym[y] = ym;
      if (!p) {
        const states = use.map((c) => cov.cell(ym, c).state);
        row[`y${y}`] = null;
        row.count[y] = null;
        row.state[y] = states.includes("no_data") ? "no data on file" : "not tracked";
        prevHad = false;
        continue;
      }
      const v = measure === "workday" ? (workdaysOf(ym, today) ? round2(p.n / workdaysOf(ym, today)) : null) : p.n;
      const r = refPoints.get(m);
      const otherSource = y !== ref && r && r.inst !== p.inst ? `${p.how} vs ${ref}'s ${r.how}` : null;
      const notes = [];
      let off = false;
      if (p.notWhole.length) {
        notes.push(notWholeText(p.notWhole));
        off = lfl;
      }
      if (otherSource) {
        if (lfl && !allowSourceChange) {
          notes.push(otherSource);
          off = true;
        } else {
          notes.push(`different source (${otherSource})`);
          name(differ, y, otherSource, ym);
        }
      }
      row[`y${y}`] = v;
      row.count[y] = p.n;
      row.drill[y] = companyDrill(use, [ym], p.n, fmtYm(ym), { title, vocab: cats });
      row.state[y] = notes.length ? notes.join(", ") : null;
      row.off[y] = off;
      row.marked[y] = !off && p.notWhole.length > 0;
      if (off) {
        row[`y${y}_x`] = v;
        name(groups, y, notes.join(", "), ym);
        prevHad = false;
      } else {
        const sig = monthSignature(cov, ym, use);
        if (!prevHad || sig !== prevSig) run++;
        prevSig = sig;
        prevHad = true;
        row[`y${y}_${run}`] = v;
      }
      if (row.state[y]) row.__notes.push(`${y}: ${row.state[y]}${off ? " — not compared" : ""}`);
    }
    runs[y] = run + 1;
  }
  const order = (g) => [...g.values()].sort((a, b) => b.year - a.year || a.months[0].localeCompare(b.months[0]));
  return { years: plotted, cats: use, left, dropped, rows, runs, notCompared: order(groups), otherSource: order(differ) };
}

const STATE_WORDS = { partial: "partly captured", conflict: "live and history disagree", no_data: "no data on file" };
const notWholeText = (states) => [...new Set(states)].map((s) => STATE_WORDS[s] || s).join(", ");

// ── Compare › category mix by quarter ────────────────────────────────────────

// Each calendar quarter's failures split by category, as shares of 100.
//
// A share only means something beside another quarter's over the same categories,
// each captured whole. So the chart draws the categories (B*, two or more of the
// picked ones) and the quarters for which every cell is whole — live or imported
// history, none partly captured, missing, in dispute or untracked — choosing the set
// that draws the most quarter-and-category cells (then the most failures, then the
// registry's order). Every quarter left undrawn says why ("incomplete"), every category
// left out says why, and a drawn quarter whose cells mix spreadsheet and app months
// says so.
//   → { cats: B*, left: [{ cat, why }], quarters: [{ key, label, months, drawn, why,
//        counts: { cat: n }, total, shares: { cat: pct }, mixed, drills: { cat }, drill }] }
export function quarterMix(cov, months = [], cats = []) {
  const inRange = new Set(months);
  const keys = sortYms(months.map((ym) => quarterKey(ym)));
  const quarters = keys.map((key) => {
    const [y, q] = key.split("-Q").map(Number);
    const qm = [1, 2, 3].map((k) => `${y}-${String((q - 1) * 3 + k).padStart(2, "0")}`);
    return { key, label: `Q${q} ${y}`, months: qm, whole: qm.every((ym) => inRange.has(ym)) };
  });
  // Is a quarter's cell of a category whole? → null, or why not: { state, ym }.
  const fault = (q, c) => {
    if (!q.whole) return { state: "range" };
    for (const ym of q.months) {
      const s = cov.cell(ym, c).state;
      if (s !== "live" && s !== "history") return { state: s, ym };
    }
    return null;
  };
  const countOf = (q, c) => q.months.reduce((t, ym) => t + (cov.cell(ym, c).value || 0), 0);
  // Every set of two or more picked categories, scored by the cells it would draw.
  let best = null;
  const n = cats.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const set = cats.filter((_, i) => mask & (1 << i));
    if (set.length < 2) continue;
    const drawn = quarters.filter((q) => set.every((c) => !fault(q, c)));
    const cells = drawn.length * set.length;
    const total = drawn.reduce((t, q) => t + set.reduce((u, c) => u + countOf(q, c), 0), 0);
    // A full tie keeps the set met first, so the pick depends on nothing but the order
    // the categories came in (the registry's).
    if (!best || cells > best.cells || (cells === best.cells && total > best.total)) best = { set, drawn, cells, total };
  }
  const use = best && best.cells ? best.set : [];
  const drawnKeys = new Set(best && best.cells ? best.drawn.map((q) => q.key) : []);
  const out = quarters.map((q) => {
    const counts = Object.fromEntries(use.map((c) => [c, countOf(q, c)]));
    const total = use.reduce((t, c) => t + counts[c], 0);
    const drawn = drawnKeys.has(q.key) && total > 0;
    let why = null;
    if (!drawn) {
      if (!q.whole) why = "only part of the quarter is in the range";
      else if (drawnKeys.has(q.key)) why = "no failures";
      else {
        for (const c of use.length ? use : cats) {
          const f = fault(q, c);
          if (f) {
            why = `${catLabel(c)}: ${STATE_WORDS[f.state] || "not tracked"}${f.ym ? ` (${fmtYm(f.ym)})` : ""}`;
            break;
          }
        }
      }
    }
    const instruments = new Set();
    if (drawn) for (const ym of q.months) for (const c of use) instruments.add(cov.cell(ym, c).instrument);
    return {
      key: q.key,
      label: q.label,
      months: q.months,
      drawn,
      why,
      counts,
      total,
      shares: drawn ? roundShares(counts, total) : null,
      mixed: instruments.size > 1,
      // A segment opens its category over the quarter; the column, every category drawn.
      drills: drawn ? Object.fromEntries(use.map((c) => [c, companyDrill([c], q.months, counts[c], q.label, { vocab: cats })])) : null,
      drill: drawn ? companyDrill(use, q.months, total, q.label, { title: "Counted failures", vocab: cats }) : null,
    };
  });
  const drawnQs = out.filter((q) => q.drawn);
  const left = cats
    .filter((c) => !use.includes(c))
    .map((c) => {
      for (const q of drawnQs) {
        const f = fault(quarters.find((x) => x.key === q.key), c);
        if (f) return { cat: c, why: `${STATE_WORDS[f.state] || "not tracked"} in ${q.label}` };
      }
      return { cat: c, why: "not captured whole in the quarters drawn" };
    });
  return { cats: use, left, quarters: out };
}

export const quarterKey = (ym) => `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;

// Shares of 100 to one decimal that add up to exactly 100 (largest remainder), so a
// 100% column never overshoots its axis.
export function roundShares(counts, total) {
  const ids = Object.keys(counts);
  if (!total) return Object.fromEntries(ids.map((c) => [c, 0]));
  const raw = ids.map((c) => ({ c, v: (counts[c] / total) * 1000 }));
  const floor = raw.map((r) => ({ ...r, f: Math.floor(r.v) }));
  let left = 1000 - floor.reduce((t, r) => t + r.f, 0);
  [...floor]
    .sort((a, b) => b.v - b.f - (a.v - a.f) || ids.indexOf(a.c) - ids.indexOf(b.c))
    .forEach((r) => {
      if (left > 0) {
        r.f += 1;
        left--;
      }
    });
  return Object.fromEntries(floor.map((r) => [r.c, r.f / 10]));
}
