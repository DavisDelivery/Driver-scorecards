// Company History's numbers: the window, the month-by-month series, the headline and
// what it is compared against, with the guards that keep noise from being narrated.
//
// Every count is a blend cell (blend.js) read through the coverage model (coverage.js):
// a cell nothing captured is a gap, never a 0, and every number a mark draws resolves
// to the same drill-down spec the click opens (test/drill-reconcile.test.mjs).
import { FAILURES, ATTEMPTS, catLabel } from "./categories.js";
import { shiftYm, comparisonWindow, workdaysInMonth, addDays, weekdayOfYmd } from "./period.js";
import { tally } from "./blend.js";
import { faultSplit } from "./faultGroups.js";
import { likeForLike, fmtYm, SOURCE_FROM, unattributedByMonth } from "./coverage.js";
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
