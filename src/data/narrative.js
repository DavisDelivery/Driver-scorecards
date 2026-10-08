// "What changed": a handful of plain sentences about a comparison — Company History's
// window against its comparison months — each carrying the drawer of exactly what it
// counted. No language model: the same data always reads the same words.
//
// Every sentence is about the cells compared (compareWindows, like-for-like by
// default): a category or a month left out of the comparison is in none of them, and
// the caveats under them name what was left out and why. Every count a sentence states
// opens the drawer on the cells it was counted from (drill.js), and
// test/narrative.test.mjs holds each one to resolveDrill's total.
//
// The sentences, in this order, each only when it has something to say:
//   total     the compared total against its comparison, with the verdict
//   category  the categories that moved most: |Δc| ≥ max(3, 15% of |ΔT|)
//   breadth   more drivers with failures, or more each (breadthIntensity, guarded)
//   drivers   the three visible drivers who rose and fell most
//   new       drivers with no counted failure anywhere in the comparison months (left
//             out of the comparison or not) and 3 or more now
//   mix       a category whose share of the compared failures moved 5 points or more
//   why       from the live entries only: a late reason, forgotten item or misdelivery
//             type whose share moved 10 points or more, with 10 or more on each side
// Inactive drivers are never named, but stay in every number; an id with no roster row
// is named from the data.
//
// A sentence's "Open →" opens everything it is about: the total's and breadth's their
// first count; the categories', the mix's and the reasons' every count they name
// together; the drivers' and new names' the compared failures by driver.
import { catLabel } from "./categories.js";
import { tally } from "./blend.js";
import { LATE_REASON_LABELS } from "./drivers.js";
import { APP_ERA, fmtYm, monthsText, exclusionText, unattributedByMonth } from "./coverage.js";
import {
  compareWindows,
  comparedCells,
  sharedMonths,
  pickCells,
  cellsDrill,
  driverTotals,
  movers,
  breadthIntensity,
  decomposeByCategory,
  incidentsDrill,
  VERDICT_TEXT,
} from "./companyMetrics.js";

export const MOVER_MIN = 3;
export const MOVER_SHARE = 0.15;
export const TOP_DRIVERS = 3;
export const NEW_NAME_MIN = 3;
export const NEW_NAMES_SHOWN = 5;
export const MIX_POINTS = 5;
export const CAUSE_POINTS = 10;
export const CAUSE_MIN_N = 10;

// The live fields a category's "why" is read from.
export const CAUSE_FIELDS = [
  ["late", "late_reason"],
  ["forgotten_freight", "forgotten_item"],
  ["misdelivery", "misdelivery_type"],
];

const fmtPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x * 1000) / 10)}%`;
const fmtDelta = (n) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${Math.abs(n).toLocaleString()}` : "±0");
const share = (x) => `${Math.round(x * 100)}%`;
const each = (x) => (Math.round(x * 10) / 10).toFixed(1);
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
// Percentage points, rounded off the float noise (60% − 50% is 9.999… in binary) so a
// shift exactly on a threshold counts as reaching it.
const points = (a, b) => Math.round(100 * (a - b) * 1e6) / 1e6;

// A sentence's pieces: plain text, a stressed figure (a change, a share), or a count
// with the drawer it opens.
const t = (text) => ({ text });
const strong = (text) => ({ text, strong: true });
const count = (n, drill) => ({ text: n.toLocaleString(), n, drill, strong: true });

// A sentence opens on its first count — or on `open` ({ drill, n }), what the whole
// sentence is about: `drill` and `expectedTotal`.
function sentence(id, segments, focus = null, open = null) {
  const first = open || segments.find((s) => s.drill);
  return {
    id,
    text: segments.map((s) => s.text).join(""),
    segments,
    drill: first ? first.drill : null,
    expectedTotal: first ? first.n : null,
    focus,
  };
}

// A list in words: "a", "a and b", "a, b and c".
function joinSegs(parts) {
  const out = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(t(i === parts.length - 1 ? " and " : ", "));
    out.push(...p);
  });
  return out;
}

//   cov, blend        coverage (coverage.js) and the all-fault blend it was built on
//   months, cmpMonths the window and its comparison, aligned month for month
//   cats              the basket
//   lfl, allowSourceChange  as the filter row has them (compareWindows)
//   label, cmpLabel   the two windows in words
//   nameOf            id -> name (people.js); hidden: the inactive ids (never named)
//   rosterReady       false when the roster couldn't be read: nobody can be told
//                     inactive, so no driver is named at all
//   incidents         the live rows, for the unattributed count
// → { sentences: [{ id, text, segments, drill, expectedTotal, focus }], caveats:
//     [{ text, ym?, cat? }], result } — `focus` is the categories a sentence is about
//   (the monthly chart greys the rest while it is hovered), null for all of them.
export function whatChanged({
  cov,
  blend,
  months = [],
  cmpMonths = [],
  cats = [],
  lfl = true,
  allowSourceChange = false,
  today,
  label = "",
  cmpLabel = "",
  nameOf = (id) => id,
  hidden = new Set(),
  rosterReady = true,
  incidents = [],
}) {
  const r = compareWindows(cov, months, cmpMonths, cats, { lfl, allowSourceChange, today });
  const cells = comparedCells(r.pairs);
  const caveats = caveatsOf({ cov, r, months, cmpMonths, cats, today, label, lfl, incidents });
  const sentences = [];
  const vocab = cats;
  const note = lfl ? (r.sourceChange ? "compared across a change of source" : "the cells compared like-for-like") : "every covered cell";
  // Each drawer is named by the months it counts, which can be fewer than the window's.
  const curDrill = (c, n, opts = {}) => cellsDrill(c, n, null, { vocab, note, ...opts });
  const cmpDrill = (c, n, opts = {}) => cellsDrill(c, n, null, { vocab, note, ...opts });

  if (!Object.keys(cells.cur).length || !Object.keys(cells.cmp).length) {
    sentences.push(sentence("total", [t(`Nothing in ${label} could be compared${lfl ? " like-for-like" : ""} with ${cmpLabel}.`)]));
    if (!rosterReady) caveats.push({ text: "The driver roster couldn't be read, so no driver is named here." });
    return { sentences, caveats, result: r };
  }

  // ── The total ───────────────────────────────────────────────────────────────
  const how = !lfl ? "Over every covered cell, not like-for-like," : r.sourceChange ? "Across a change of source," : "Like-for-like,";
  const verdict = r.verdict.verdict === "withheld" ? `no verdict (${r.verdict.why})` : VERDICT_TEXT[r.verdict.verdict];
  const X = count(r.X, curDrill(cells.cur, r.X, { title: "Counted failures" }));
  const C = count(r.Cmp, cmpDrill(cells.cmp, r.Cmp, { title: "Counted failures" }));
  const d = r.delta;
  sentences.push(
    sentence("total", [
      t(`${how} counted failures `),
      ...(d === 0
        ? [t("held level: "), X, t(" this period against "), C]
        : r.pct === null
          ? [t(`${d > 0 ? "rose" : "fell"}: `), X, t(" this period against "), C]
          : [t(`${d > 0 ? "rose" : "fell"} `), strong(fmtPct(r.pct).replace(/^[+−]/, "")), t(": "), X, t(" this period against "), C]),
      t(` in ${cmpLabel}${d ? " (" : ""}`),
      ...(d ? [strong(fmtDelta(d)), t(")")] : []),
      t(` — ${verdict}.`),
    ]),
  );

  // ── The categories that moved most ──────────────────────────────────────────
  // Like-for-like, every category in the total was compared on both sides. With it off,
  // a category on file on one side only is in the total too, so it is in the split: a
  // move from (or to) nothing on file.
  const decomposed = decomposeByCategory(r.byCat, d);
  if (decomposed.length > 1) {
    const bar = Math.max(MOVER_MIN, MOVER_SHARE * Math.abs(d));
    const moved = decomposed
      .filter((b) => Math.abs(b.delta) >= bar)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || cats.indexOf(x.cat) - cats.indexOf(y.cat))
      .slice(0, 3);
    // A side's count, opening its cells — "nothing on file" where it held none.
    const curCount = (c, n) => (cells.cur[c]?.length ? count(n, curDrill(pickCells(cells.cur, [c]), n)) : t("nothing on file"));
    const cmpCount = (c, n) => (cells.cmp[c]?.length ? count(n, cmpDrill(pickCells(cells.cmp, [c]), n)) : t("nothing on file"));
    if (moved.length) {
      const named = pickCells(cells.cur, moved.map((b) => b.cat));
      const namedN = moved.reduce((a, b) => a + b.X, 0);
      sentences.push(
        sentence(
          "category",
          [
            t(moved.length === 1 ? "By category, " : "By category: "),
            ...joinSegs(
              moved.map((b) => [
                t(`${catLabel(b.cat)} `),
                curCount(b.cat, b.X),
                t(" against "),
                cmpCount(b.cat, b.Cmp),
                t(" ("),
                strong(fmtDelta(b.delta)),
                t(
                  b.share === null
                    ? ")"
                    : b.share > 1
                      ? `, more than the whole ${d > 0 ? "rise" : "fall"})`
                      : b.share > 0
                        ? `, ${share(b.share)} of the ${d > 0 ? "rise" : "fall"})`
                        : `, against the ${d > 0 ? "rise" : "fall"})`,
                ),
              ]),
            ),
            t("."),
          ],
          moved.map((b) => b.cat),
          namedN && Object.keys(named).length ? { drill: curDrill(named, namedN), n: namedN } : null,
        ),
      );
    }
  }

  // ── Breadth × intensity ─────────────────────────────────────────────────────
  const dCur = driverTotals(blend, cells.cur);
  const dCmp = driverTotals(blend, cells.cmp);
  const sum = (m) => [...m.values()].reduce((a, n) => a + n, 0);
  const bi = breadthIntensity({ D_A: dCur.size, D_C: dCmp.size, T_A: sum(dCur), T_C: sum(dCmp) });
  // The compared failures by driver: what the breadth, drivers and new-names sentences
  // are about.
  const byDriver =
    bi.T_A > 0 ? { drill: curDrill(cells.cur, bi.T_A, { unattributed: false, title: "Counted failures by driver" }), n: bi.T_A } : null;
  if (bi.T_A > 0 && bi.T_C > 0) {
    const segs = [
      count(bi.T_A, byDriver.drill),
      t(` failures came from ${plural(bi.D_A, "driver")} (`),
      strong(each(bi.I_A)),
      t(" each) against "),
      count(bi.T_C, cmpDrill(cells.cmp, bi.T_C, { unattributed: false, title: "Counted failures by driver" })),
      t(` from ${plural(bi.D_C, "driver")} (`),
      strong(each(bi.I_C)),
      t(" each)"),
    ];
    const s = bi.breadthShare;
    const up = bi.T_A > bi.T_C;
    if (s === null) segs.push(t("."));
    else if (s >= 1) {
      segs.push(t(`: ${up ? "more" : "fewer"} drivers had failures, each ${up ? "fewer" : "more"} — the ${up ? "rise" : "fall"} is all breadth.`));
    } else if (s >= 0.5) {
      segs.push(t(`: mostly ${up ? "more" : "fewer"} drivers with failures, rather than ${up ? "more" : "fewer"} each.`));
    } else {
      segs.push(t(`: mostly ${up ? "more" : "fewer"} failures each, rather than ${up ? "more" : "fewer"} drivers with them.`));
    }
    sentences.push(sentence("breadth", segs));
  }

  // ── Drivers ─────────────────────────────────────────────────────────────────
  if (rosterReady) {
    const mv = movers(dCur, dCmp);
    const visible = (row) => !hidden.has(row.id);
    const name = (id) => nameOf(id) || id;
    const driverSeg = (row) => [
      t(`${name(row.id)} `),
      count(row.cur, curDrill(pickCells(cells.cur, cats), row.cur, { driverId: row.id })),
      t(" ("),
      strong(fmtDelta(row.delta)),
      t(")"),
    ];
    const up = mv.up.filter(visible).slice(0, TOP_DRIVERS);
    const down = mv.down.filter(visible).slice(0, TOP_DRIVERS);
    const hiddenDelta = mv.rows.filter((row) => !visible(row)).reduce((a, row) => a + row.delta, 0);
    const hiddenMoved = mv.rows.some((row) => !visible(row) && row.delta);
    if (up.length || down.length) {
      const segs = [];
      if (up.length) segs.push(t("Rose most: "), ...joinSegs(up.map(driverSeg)), t("."));
      if (down.length) segs.push(t(`${up.length ? " " : ""}Fell most: `), ...joinSegs(down.map(driverSeg)), t("."));
      if (hiddenMoved) segs.push(t(` Inactive drivers, not named: ${fmtDelta(hiddenDelta)} between them.`));
      sentences.push(sentence("drivers", segs, null, byDriver));
    }

    // ── New names ─────────────────────────────────────────────────────────────
    // New means none at all in the comparison months — not merely none in the cells
    // compared: a driver whose failures there were all left out (spreadsheet vs app)
    // isn't new.
    const before = new Set();
    for (const [id, byCat] of tally(blend, cmpMonths, cats)) {
      for (const n of byCat.values()) if (n > 0) before.add(id);
    }
    const fresh = mv.rows
      .filter((row) => row.cmp === 0 && !before.has(row.id) && row.cur >= NEW_NAME_MIN)
      .sort((x, y) => y.cur - x.cur || name(x.id).localeCompare(name(y.id)) || x.id.localeCompare(y.id));
    const shown = fresh.filter(visible);
    if (shown.length) {
      const list = shown.slice(0, NEW_NAMES_SHOWN);
      const more = shown.length - list.length;
      const inactive = fresh.length - shown.length;
      sentences.push(
        sentence(
          "new",
          [
            t(`New this period — none in ${cmpLabel}, ${NEW_NAME_MIN} or more now: `),
            ...joinSegs(
              list.map((row) => [
                t(`${name(row.id)} `),
                count(row.cur, curDrill(pickCells(cells.cur, cats), row.cur, { driverId: row.id })),
              ]),
            ),
            t(more ? `, and ${more} more` : ""),
            t(inactive ? ` (${plural(inactive, "inactive driver")} not named)` : ""),
            t("."),
          ],
          null,
          byDriver,
        ),
      );
    }
  } else {
    caveats.push({ text: "The driver roster couldn't be read, so no driver is named here." });
  }

  // ── The mix ─────────────────────────────────────────────────────────────────
  const both = r.byCat.filter((b) => b.months.length && b.cmpMonths.length);
  const X2 = both.reduce((a, b) => a + b.X, 0);
  const C2 = both.reduce((a, b) => a + b.Cmp, 0);
  if (both.length > 1 && X2 > 0 && C2 > 0) {
    const shifts = both
      .map((b) => ({ ...b, s: b.X / X2, cs: b.Cmp / C2, pts: points(b.X / X2, b.Cmp / C2) }))
      .filter((b) => Math.abs(b.pts) >= MIX_POINTS)
      .sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts) || cats.indexOf(x.cat) - cats.indexOf(y.cat))
      .slice(0, 2);
    if (shifts.length) {
      const shiftN = shifts.reduce((a, b) => a + b.X, 0);
      sentences.push(
        sentence(
          "mix",
          [
            t("The mix moved: "),
            ...joinSegs(
              shifts.map((b) => [
                t(`${catLabel(b.cat)} went from ${share(b.cs)} to `),
                strong(share(b.s)),
                // Like-for-like off, the shares are over the categories on file on both
                // sides only — not the whole total.
                t(` of the ${lfl ? "compared failures" : "failures in categories on file on both sides"} (`),
                count(b.X, curDrill(pickCells(cells.cur, [b.cat]), b.X)),
                t(` of ${X2.toLocaleString()})`),
              ]),
            ),
            t("."),
          ],
          shifts.map((b) => b.cat),
          shifts.length > 1 ? { drill: curDrill(pickCells(cells.cur, shifts.map((b) => b.cat)), shiftN), n: shiftN } : null,
        ),
      );
    }
  }

  // ── Why, from the live entries ──────────────────────────────────────────────
  const causes = [];
  for (const [cat, field] of CAUSE_FIELDS) {
    if (!cats.includes(cat)) continue;
    const a = liveRows(blend, cat, cells.cur[cat]);
    const b = liveRows(blend, cat, cells.cmp[cat]);
    if (!a || !b || a.length < CAUSE_MIN_N || b.length < CAUSE_MIN_N) continue;
    const byA = facet(a, field);
    const byB = facet(b, field);
    let best = null;
    // "Not set" moving says how entries were filled in, not why things went wrong: it
    // stays in the denominators and out of the candidates.
    for (const key of new Set([...byA.keys(), ...byB.keys()])) {
      if (!key) continue;
      const ra = byA.get(key) || [];
      const rb = byB.get(key) || [];
      const pts = points(ra.length / a.length, rb.length / b.length);
      if (Math.abs(pts) < CAUSE_POINTS) continue;
      const lbl = facetLabel(field, key);
      if (!best || Math.abs(pts) > Math.abs(best.pts) || (Math.abs(pts) === Math.abs(best.pts) && (ra.length > best.ids.length || (ra.length === best.ids.length && lbl < best.label)))) {
        best = { cat, field, key, label: lbl, pts, ids: ra.map((inc) => inc.id), idsB: rb.map((inc) => inc.id), nA: a.length, nB: b.length };
      }
    }
    if (best) causes.push(best);
  }
  causes.sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts));
  if (causes.length) {
    const list = causes.slice(0, 2);
    sentences.push(
      sentence(
        "why",
        [
          t("From the live entries: "),
          ...joinSegs(
            list.map((c) => [
              t(`${c.label} went from ${share(c.idsB.length / c.nB)} to `),
              strong(share(c.ids.length / c.nA)),
              t(` of ${catLabel(c.cat)} (`),
              count(c.ids.length, causeDrill(c, c.ids, cells.cur[c.cat], label)),
              t(` of ${c.nA.toLocaleString()}, against `),
              count(c.idsB.length, causeDrill(c, c.idsB, cells.cmp[c.cat], cmpLabel)),
              t(` of ${c.nB.toLocaleString()})`),
            ]),
          ),
          t("."),
        ],
        list.map((c) => c.cat),
        list.length > 1
          ? {
              drill: incidentsDrill(
                list.flatMap((c) => c.ids),
                {
                  categoryIds: list.map((c) => c.cat),
                  months: [...new Set(list.flatMap((c) => cells.cur[c.cat]))].sort(),
                  title: list.map((c) => `${catLabel(c.cat)} · ${c.label}`).join(", "),
                  label,
                },
              ),
              n: list.reduce((a, c) => a + c.ids.length, 0),
            }
          : null,
      ),
    );
  }

  return { sentences, caveats, result: r };
}

// The counted live rows of one category over some months — or null when any of those
// months isn't the app's live capture (before April 2026, or served from a rollup),
// where there are no rows to read a reason from.
function liveRows(blend, cat, months) {
  if (!months || !months.length) return null;
  const rows = [];
  for (const ym of months) {
    if (ym < APP_ERA || blend.cellSource(ym, cat) === "history") return null;
    for (const inc of blend.liveByYm[ym] || []) if (inc.category === cat) rows.push(inc);
  }
  return rows;
}

// The live entries behind a reason's count, headed by the category and the reason.
const causeDrill = (c, ids, months, label) =>
  incidentsDrill(ids, { categoryIds: [c.cat], months, title: `${catLabel(c.cat)} · ${c.label}`, label });

// Rows by a field's value ("" for not set): Map(key -> [row]).
function facet(rows, field) {
  const out = new Map();
  for (const inc of rows) {
    const key = String(inc?.[field] ?? "").replace(/\s+/g, " ").trim();
    (out.get(key) || out.set(key, []).get(key)).push(inc);
  }
  return out;
}

const facetLabel = (field, key) =>
  !key ? "Not set" : field === "late_reason" ? LATE_REASON_LABELS[key] || key : key;

// What the sentences can't say, in the order a reader needs it: months on both sides of
// the comparison, what was left out of it, the month still in progress, months the
// Uline reports only partly cover, cells where live entries and history disagree, and
// failures with no driver.
function caveatsOf({ cov, r, months, cmpMonths, cats, today, label, lfl, incidents }) {
  const out = [];
  // A window longer than a year against the same months a year earlier shares months
  // with it: their failures are on both sides. First, since it is about every number.
  const shared = sharedMonths(months, cmpMonths);
  if (shared.length) {
    const one = shared.length === 1;
    out.push({ text: `${monthsText(shared)} ${one ? "is" : "are"} in both periods: ${one ? "its" : "their"} failures count on both sides.` });
  }
  if (lfl) {
    for (const e of r.exclusions) {
      out.push({ text: `Left out: ${exclusionText(e)}.`, ym: e.side === "comparison" ? e.cmpMonths[0] : e.months[0], cat: e.cat });
    }
  }
  const nowYm = String(today || "").slice(0, 7);
  if (months.includes(nowYm)) out.push({ text: `${fmtYm(nowYm)} is still in progress.` });
  const uline = months.filter((ym) =>
    cats.some((c) => {
      const cell = cov.cell(ym, c);
      return cell.reasons.includes("uline_partial") || cell.reasons.includes("uline_none");
    }),
  );
  if (uline.length) out.push({ text: `The Uline reports cover only part of ${monthsText(uline)}.`, ym: uline[0] });
  for (const ym of months) {
    for (const c of cats) {
      const cell = cov.cell(ym, c);
      if (cell.state !== "conflict") continue;
      out.push({
        text: `Live and history disagree for ${catLabel(c)}, ${fmtYm(ym)}: ${cell.live.toLocaleString()} live, ${cell.history.toLocaleString()} in history.`,
        ym,
        cat: c,
      });
    }
  }
  const un = unattributedByMonth(incidents, months, cats).reduce((a, m) => a + m.counted, 0);
  if (un) out.push({ text: `${plural(un, "failure")} with no driver in ${label} ${un === 1 ? "is" : "are"} in no total.` });
  return out;
}

// The card as plain text, for an email or a Slack post.
export function summaryText({ sentences = [], caveats = [], label = "", cmpLabel = "" }) {
  const lines = [`What changed — ${label} against ${cmpLabel}`, ""];
  for (const s of sentences) lines.push(`• ${s.text}`);
  if (caveats.length) {
    lines.push("", "Caveats:");
    for (const c of caveats) lines.push(`• ${c.text}`);
  }
  return lines.join("\n");
}
