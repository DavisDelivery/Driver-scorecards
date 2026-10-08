// One resolver behind every clickable number.
//
// A chart, a tile or a leaderboard row hands the drawer the SPEC of what it counted and
// the number it showed; the drawer resolves the spec here and refuses to quietly show
// anything else — a different total raises "numbers disagree" (DrillDrawer.jsx).
// test/drill-reconcile.test.mjs walks every chart builder's marks and checks that each
// one resolves to the value it drew.
//
// Spec kinds:
//   blend      { months, categoryIds, driverId?, roleGroup?, fault?, unattributed? }
//              month grain, the blend (each category of each month live or history);
//              `unattributed` adds history records that carry no driver (a company
//              total, as the Reports analytics counts it)
//   window     { start, end, categoryIds, driverId?, roleGroup?, fault? } day grain, same rule
//   incidents  { ids, months?, categoryIds?, driverId?, who? }           an explicit live list;
//              `who` heads one driver's list
// Any spec may carry a `title` for the drawer's heading (a Scorecard tile: "Driver
// fault") and a `label` for its sub-line; neither changes what it counts.
//   attempts   { start, end, driverId?, driverKey?, filter?, label? }      attempt orders
//              driverKey is attemptRecords.js's key, so Unassigned and a feed name the
//              roster doesn't match can be drilled into too; filter narrows the way the
//              tile did (manualAnalytics.js filterAttempts; `filter.within` is the driver
//              key whose list a repeat customer was found in, null for the window's);
//              label says how, for the drawer's heading
//
// ctx: { blend: (fault) => blend (blend.js), history, incidents, roleOf: id => role,
//        attemptRecords } — attemptRecords is null until the Attempts tab has loaded them
import { buildCategoryDetail, buildWindowDetail } from "./scorecardDetail.js";
import { incidentYm, incidentDateStr } from "./incidentDate.js";
import { shiftYm } from "./period.js";
import { driverKey } from "./attemptRecords.js";
import { filterAttempts } from "./manualAnalytics.js";

// The Scorecard's role groups: "loader" is loaders, "driver" everyone else. An id with
// no roster row reads as a driver.
export function groupFilter(roleGroup, roleOf = () => "driver") {
  if (!roleGroup) return () => true;
  return (id) => {
    const role = roleOf(id) || "driver";
    return roleGroup === "loader" ? role === "loader" : role !== "loader";
  };
}

// Tallies for a plain list (incidents or attempt orders), in the detail's shape.
// `idOf` is who a row counts under in byDriver (the driver id, or an attempt's key).
function listDetail(rows, { ymOf, catOf, nameOf, idOf = (r) => r.driver_id || "" }) {
  const out = {
    incidents: [],
    historyRows: [],
    orders: [],
    byDriver: new Map(),
    byMonth: new Map(),
    byCategory: new Map(),
    byMonthCategory: new Map(),
    total: rows.length,
  };
  for (const r of rows) {
    const ym = ymOf(r);
    const cat = catOf(r);
    const id = idOf(r);
    out.byMonth.set(ym, (out.byMonth.get(ym) || 0) + 1);
    out.byCategory.set(cat, (out.byCategory.get(cat) || 0) + 1);
    const mc = out.byMonthCategory.get(ym) || out.byMonthCategory.set(ym, new Map()).get(ym);
    mc.set(cat, (mc.get(cat) || 0) + 1);
    const e = out.byDriver.get(id) || { id, name: "", count: 0 };
    e.count += 1;
    if (!e.name) e.name = nameOf(r) || "";
    out.byDriver.set(id, e);
  }
  return out;
}

export function resolveDrill(spec, ctx = {}) {
  const kind = spec?.kind;
  const inGroup = groupFilter(spec?.roleGroup, ctx.roleOf);

  if (kind === "blend" || kind === "window") {
    const blend = ctx.blend(spec.fault || null);
    // A history month the blend doesn't serve (Driver-fault scope under the newer rule)
    // contributes nothing here either: its cells read 0, and so does its drill-down.
    const history = blend.historyServed ? ctx.history || [] : [];
    const common = {
      liveByYm: blend.liveByYm,
      isLive: blend.isLive,
      history,
      categoryIds: spec.categoryIds || [],
      driverId: spec.driverId || null,
      inGroup,
      unattributed: !!spec.unattributed && !spec.driverId,
    };
    const detail =
      kind === "blend"
        ? buildCategoryDetail({ ...common, scopeMonths: spec.months || [] })
        : buildWindowDetail({ ...common, start: spec.start, end: spec.end });
    const months = kind === "blend" ? [...new Set(spec.months || [])].sort() : monthsOfWindow(spec.start, spec.end);
    // Where a month's number comes from is decided per category (blend.js), so it is
    // asked over this spec's categories: a month can be part live, part history.
    const cats = spec.categoryIds || [];
    return {
      ...detail,
      orders: [],
      months,
      sourceOf: (ym) => blend.monthSource(ym, cats),
      cellsOf: (ym) => blend.monthCells(ym, cats),
      liveOnly: false,
    };
  }

  if (kind === "incidents") {
    const ids = new Set(spec.ids || []);
    const months = spec.months ? new Set(spec.months) : null;
    const rows = (ctx.incidents || []).filter(
      (inc) =>
        ids.has(inc.id) &&
        (!spec.driverId || inc.driver_id === spec.driverId) &&
        (!spec.categoryIds || spec.categoryIds.includes(inc.category)) &&
        (!months || months.has(incidentYm(inc))) &&
        inGroup(inc.driver_id),
    );
    rows.sort((a, b) => incidentDateStr(b).localeCompare(incidentDateStr(a)));
    const detail = listDetail(rows, {
      ymOf: (r) => incidentYm(r) || "undated",
      catOf: (r) => r.category,
      nameOf: (r) => r.driver_name || r.driver_raw,
    });
    detail.incidents = rows;
    const all = [...detail.byMonth.keys()].filter((ym) => ym !== "undated").sort();
    return { ...detail, months: all, sourceOf: () => "live", liveOnly: true };
  }

  if (kind === "attempts") {
    const months = spec.months ? new Set(spec.months) : null;
    const keyOf = (o) => o.key || driverKey(o);
    const inWindow = (ctx.attemptRecords || []).filter(
      (o) => (!spec.start || o.date >= spec.start) && (!spec.end || o.date <= spec.end),
    );
    const scoped = inWindow.filter(
      (o) =>
        (!spec.driverId || o.driver_id === spec.driverId) &&
        (!spec.driverKey || keyOf(o) === spec.driverKey) &&
        (!months || months.has(String(o.date).slice(0, 7))),
    );
    // A repeat customer is one the tile's own list saw twice (the window, or the
    // driver the tile was counting), not one seen twice in what is left after a
    // driver or a month is picked inside the drawer.
    const within = spec.filter?.within;
    const pool = within ? inWindow.filter((o) => keyOf(o) === within) : inWindow;
    const rows = [...filterAttempts(scoped, spec.filter, { pool })];
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const detail = listDetail(rows, {
      ymOf: (o) => String(o.date).slice(0, 7),
      catOf: () => "attempts",
      nameOf: (o) => o.driver_name,
      idOf: keyOf,
    });
    detail.orders = rows;
    return { ...detail, months: [...detail.byMonth.keys()].sort(), sourceOf: () => "live", liveOnly: true };
  }

  throw new Error(`Unknown drill kind: ${kind}`);
}

const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const lastDay = (ym) => `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;

function monthsOfWindow(start, end) {
  const out = [];
  if (!/^\d{4}-\d{2}/.test(start || "") || !/^\d{4}-\d{2}/.test(end || "")) return out;
  for (let ym = start.slice(0, 7); ym <= end.slice(0, 7) && out.length < 600; ym = shiftYm(ym, 1)) out.push(ym);
  return out;
}

// ── Drill state: what the drawer is showing, and how it got there ─────────────
//
// { spec, scopes?, scope?, expected?, path? }
//   scopes    [{ label, months, expected? }] — a blend spec's alternative periods (the
//             Scorecard's period and YTD, Trends' year and all time). The spec's months
//             come from the selected scope.
//   expected  the number that was clicked, when there are no scopes
//   path      narrowing steps taken inside the drawer: { category } | { categories,
//             label } | { driverId } | { month }, each with the number that was clicked
//             (x: a number, or one per scope), so every level is checked, not just the
//             first. `categories` is a set narrower than the screen's (a Scorecard tile
//             counts the six failures), `label` its crumb
//   vocab     the screen's whole category set, when the spec is narrower (a Scorecard
//             chart is one category): a driver opened from it gets all of them
//   at        the data stamp (drillStamp) the clicked numbers were counted under; the
//             drawer checks them only against a count from the same data

// A spec narrowed by one step.
export function narrowSpec(spec, op) {
  if (!op) return spec;
  if (op.category) return { ...spec, categoryIds: [op.category] };
  if (op.categories) return { ...spec, categoryIds: op.categories };
  if (op.driverId) return { ...spec, driverId: op.driverId };
  if (op.driverKey) return { ...spec, driverKey: op.driverKey };
  if (op.month) {
    if (spec.kind === "window") {
      const start = spec.start > `${op.month}-01` ? spec.start : `${op.month}-01`;
      const end = spec.end < lastDay(op.month) ? spec.end : lastDay(op.month);
      return { ...spec, start, end };
    }
    return { ...spec, months: [op.month] };
  }
  return spec;
}

const pick = (x, scope) => (Array.isArray(x) ? x[scope] : x);

// Every breadcrumb level: [{ spec, expected, op }], root first.
export function drillLevels(state) {
  if (!state || !state.spec) return [];
  const scope = state.scopes?.length ? Math.min(Math.max(0, state.scope || 0), state.scopes.length - 1) : 0;
  const sc = state.scopes?.[scope];
  const root = sc ? { ...state.spec, months: sc.months } : state.spec;
  const levels = [{ spec: root, expected: sc ? sc.expected : state.expected, op: null }];
  for (const op of state.path || []) {
    const prev = levels[levels.length - 1].spec;
    // A count pushed as a plain number belongs to the scope it was clicked under.
    const x = Array.isArray(op.x) ? op.x[scope] : (op.s ?? 0) === scope ? op.x : undefined;
    levels.push({ spec: narrowSpec(prev, op), expected: x, op });
  }
  return levels;
}

// A driver's drawer: the driver's whole record over a scope, optionally opened narrowed
// to one category (the row that was clicked) so the breadcrumb can pop back out to
// every category.
//   base  { categoryIds, scopes, scope, fault }
//   then  { category, x } — the category row clicked and the number(s) it showed: one
//         per scope, or a single number for the scope it was clicked under
export function driverDrill(driverId, base = {}, then = null) {
  const scope = base.scope || 0;
  const state = {
    spec: { kind: "blend", driverId, categoryIds: base.categoryIds || [], fault: base.fault || null },
    scopes: base.scopes || [],
    scope,
  };
  if (then && then.category && (base.categoryIds || []).includes(then.category)) {
    state.path = [{ category: then.category, x: then.x, s: scope }];
  }
  return state;
}

// A driver opened from inside a drawer (its By-driver list, or a row's name): their
// record over the same scopes, on this drawer's categories and month when it is
// narrower than the screen's, carrying the count that was clicked. A drawer over a set
// of categories (the Scorecard's failure tiles: six of its eight) opens the driver on
// that set, so the count clicked is the count shown — not the driver's attempts and
// compliments added in.
//
// The drawer's own scope totals are left behind. They are the whole chart's (every
// driver in the category), never this driver's, and carried over they checked the
// driver's root level against the company figure and raised a false "numbers
// disagree". What the driver's drawer vouches for is only the count on the row clicked.
export function driverFromDrawer(state, driverId, x) {
  const levels = drillLevels(state);
  const level = levels[levels.length - 1];
  // A day window or a list has no month scopes to carry: narrow it to the driver.
  if (level.spec.kind !== "blend") return pushStep(state, { driverId, x });
  const root = levels[0].spec;
  const cats = level.spec.categoryIds || [];
  const monthOp = [...(state.path || [])].reverse().find((op) => op.month);
  const scope = state.scopes?.length ? Math.min(Math.max(0, state.scope || 0), state.scopes.length - 1) : 0;
  // A drawer opened on its own months, with no scopes, hands them on as the driver's one
  // scope: a driver's drawer takes its months from its scopes, and without them it
  // counted nothing.
  const scopes = state.scopes?.length
    ? state.scopes
    : root.months
      ? [{ label: root.label || "", months: root.months }]
      : [];
  const base = {
    // The screen's whole vocabulary, so the breadcrumb can pop back out to every category.
    categoryIds: state.vocab?.length ? state.vocab : root.categoryIds || [],
    scopes: scopes.map(({ expected, ...s }) => s), // eslint-disable-line no-unused-vars
    scope,
    fault: root.fault || null,
  };
  let next = driverDrill(driverId, base, cats.length === 1 ? { category: cats[0], x: monthOp ? undefined : x } : null);
  const vocab = new Set(base.categoryIds);
  if (cats.length > 1 && (cats.length !== vocab.size || cats.some((c) => !vocab.has(c)))) {
    const label = level.spec.title || root.title || `${cats.length} categories`;
    next = pushStep(next, { categories: cats, label, x: monthOp ? undefined : x });
  }
  if (monthOp) next = pushStep(next, { month: monthOp.month, x });
  return next;
}

// Every month from the first to the last, gaps included. "All time" is every month
// with data, which skips the empty ones; a strip drawn over that list puts Oct next
// to Dec. Counting never needs the gaps (an empty month adds nothing); drawing does.
export function spanMonths(months) {
  const sorted = [...new Set(months || [])].filter((ym) => /^\d{4}-\d{2}$/.test(ym)).sort();
  if (!sorted.length) return [];
  const out = [];
  const last = sorted[sorted.length - 1];
  for (let ym = sorted[0]; ym <= last && out.length < 600; ym = shiftYm(ym, 1)) out.push(ym);
  return out;
}

// A short fingerprint of everything a drill-down counts from: the live rows' counting
// fields, the history records and the roster's roles. A drawer state remembers the
// stamp its clicked numbers were counted under (`at`), and only checks them against a
// fresh count made from the same data. Anything else — a link opened tomorrow, a Back
// after someone logged an entry, a refresh while the drawer is open — is the data
// having moved, not the numbers disagreeing.
//
// Order-independent (rows are summed, not chained), so the same data read in another
// order, or in another browser, stamps the same.
export function drillStamp({ incidents = [], history = [], drivers = [] } = {}) {
  let sum = 0;
  let mix = 0;
  const add = (s) => {
    const h = fnv(s);
    sum = (sum + h) >>> 0;
    mix = (mix ^ Math.imul(h, 2654435761)) >>> 0;
  };
  for (const i of incidents) {
    add(`i|${i.id}|${i.driver_id || ""}|${i.category || ""}|${i.fault || ""}|${i.no_fault ? 1 : 0}|${incidentDateStr(i)}`);
  }
  for (const r of history) add(`h|${r.year}|${r.month}|${r.driver_id || ""}|${r.category || ""}|${r.count}`);
  for (const d of drivers) add(`d|${d.id}|${d.role || ""}`);
  const n = incidents.length + history.length + drivers.length;
  return `${n.toString(36)}.${sum.toString(36)}.${mix.toString(36)}`;
}

// The same fingerprint for the attempt records the Attempts tab has loaded: which
// orders, on which days, under whom, and how each one ended. A drawer opened on them is
// checked only against a count of the same orders.
export function attemptStamp(records = []) {
  let sum = 0;
  let mix = 0;
  for (const r of records) {
    const h = fnv(`a|${r.id}|${r.date}|${r.key || ""}|${r.outcome || ""}`);
    sum = (sum + h) >>> 0;
    mix = (mix ^ Math.imul(h, 2654435761)) >>> 0;
  }
  return `${records.length.toString(36)}.${sum.toString(36)}.${mix.toString(36)}`;
}

// Everything a drill-down counts from, as the one stamp a drawer state carries
// (`at`): drillStamp's data, plus the attempt orders the Attempts tab has published,
// once it has. Before they're published the stamp says so by leaving them out, so a
// tile clicked while its period was still loading is never checked against the
// orders that arrive after it.
export function dataStamp({ incidents = [], history = [], drivers = [], attemptRecords = null } = {}) {
  return drillStamp({ incidents, history, drivers }) + (attemptRecords ? `~${attemptStamp(attemptRecords)}` : "");
}

// What the drawer says about the number that was clicked, given what it counts now:
//   null        nothing to say: no number was clicked, or the two agree
//   "mismatch"  they differ, counted from the same data — a real disagreement
//   "moved"     they differ, but the data has changed since the click
// A state with no stamp was opened just now, from the data on screen (DrillHost
// stamps it); a screen whose numbers can be on screen before the drawer's data is in
// (the Attempts tab, while its period loads) stamps the state itself when clicked.
export function drillVerdict({ expected, total, at = null, stamp }) {
  if (typeof expected !== "number" || typeof total !== "number" || total === expected) return null;
  return !at || at === stamp ? "mismatch" : "moved";
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Push a narrowing step (and the number clicked to take it).
export function pushStep(state, op) {
  return { ...state, path: [...(state.path || []), { ...op, s: state.scope || 0 }] };
}

// Pop back to breadcrumb level `i` (0 = root).
export function popTo(state, i) {
  return { ...state, path: (state.path || []).slice(0, Math.max(0, i)) };
}

// ── Hash encoding ─────────────────────────────────────────────────────────────
// The drawer lives in the URL (#drill=…) so Back closes it and a link reopens it. Runs
// of consecutive months are written "2026-01~2026-12" to keep the link short.

function packMonths(months) {
  if (!Array.isArray(months)) return months;
  const parts = [];
  let i = 0;
  while (i < months.length) {
    let j = i;
    while (j + 1 < months.length && shiftYm(months[j], 1) === months[j + 1]) j++;
    parts.push(j > i ? `${months[i]}~${months[j]}` : months[i]);
    i = j + 1;
  }
  return parts.join(",");
}

function unpackMonths(s) {
  if (typeof s !== "string") return undefined;
  const out = [];
  for (const part of s.split(",").filter(Boolean)) {
    const [a, b] = part.split("~");
    if (!/^\d{4}-\d{2}$/.test(a)) return undefined;
    if (b === undefined) {
      out.push(a);
      continue;
    }
    if (!/^\d{4}-\d{2}$/.test(b) || b < a) return undefined;
    for (let ym = a; ym <= b && out.length < 600; ym = shiftYm(ym, 1)) out.push(ym);
  }
  return out;
}

export function encodeDrill(state) {
  if (!state || !state.spec) return "";
  const spec = { ...state.spec };
  if (spec.months) spec.months = packMonths(spec.months);
  const out = { spec };
  if (state.scopes?.length) {
    out.scopes = state.scopes.map((s) => ({ ...s, months: packMonths(s.months) }));
    out.scope = state.scope || 0;
  }
  if (state.expected !== undefined && state.expected !== null) out.expected = state.expected;
  if (state.path?.length) out.path = state.path;
  if (state.vocab?.length) out.vocab = state.vocab;
  if (state.at) out.at = state.at;
  return JSON.stringify(out);
}

const KINDS = new Set(["blend", "window", "incidents", "attempts"]);

// The state back from the hash, or null for anything malformed — a hand-edited link
// must never blank the screen.
export function decodeDrill(str) {
  if (!str) return null;
  let raw;
  try {
    raw = JSON.parse(str);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || !raw.spec || !KINDS.has(raw.spec.kind)) return null;
  const spec = { ...raw.spec };
  if (spec.months !== undefined) {
    spec.months = unpackMonths(spec.months);
    if (!spec.months) return null;
  }
  const state = { spec };
  if (Array.isArray(raw.scopes) && raw.scopes.length) {
    state.scopes = [];
    for (const s of raw.scopes) {
      const months = unpackMonths(s?.months);
      if (!months) return null;
      state.scopes.push({ ...s, months });
    }
    state.scope = Number(raw.scope) || 0;
  }
  if (typeof raw.expected === "number") state.expected = raw.expected;
  if (Array.isArray(raw.path)) state.path = raw.path.filter((op) => op && typeof op === "object");
  if (Array.isArray(raw.vocab)) state.vocab = raw.vocab.filter((c) => typeof c === "string");
  if (typeof raw.at === "string" && raw.at) state.at = raw.at;
  return state;
}
