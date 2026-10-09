import React from "react";
import { createPortal } from "react-dom";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { useHashState } from "../../data/hashState.js";
import {
  resolveDrill,
  drillLevels,
  pushStep,
  popTo,
  encodeDrill,
  decodeDrill,
  driverFromDrawer,
  spanMonths,
  drillVerdict,
} from "../../data/drill.js";
import { CATEGORIES, catLabel, catColor } from "../../data/categories.js";
import { nameOf, nameOfKey } from "../../data/people.js";
import { rankable } from "../../data/manualAnalytics.js";
import { incidentDateStr } from "../../data/incidentDate.js";
import { currentYmET, fmtDate, fmtDateRange } from "../../data/period.js";
import { downloadCsv, csvName } from "../../data/csv.js";
import { BRAND, WASH, GRID, PARTIAL_OPACITY } from "./chartTheme.js";
import { fmtHead } from "./shape.js";
import EntryList, { fmtMonth } from "./EntryList.jsx";
import ChartCard from "./ChartCard.jsx";
import StackedColumns from "./charts/StackedColumns.jsx";
import BarList from "./charts/BarList.jsx";
import StatTile, { TileStrip } from "./StatTile.jsx";
import Icon from "./Icon.jsx";
import DriverLink from "./DriverLink.jsx";
import AttemptOrdersTable from "./AttemptOrdersTable.jsx";
import StopDetailModal from "../StopDetailModal.jsx";
import { LoadError } from "./LoadState.jsx";
import { DRILL_KEY, openDrill, closeDrill, stampDrill } from "./drillNav.js";

// The one drill-down behind every clickable number.
//
// A screen opens it with the SPEC of what it counted and the number it showed
// (drill.js); the drawer resolves the spec from the same blend and, if its total isn't
// the number that was clicked, says so in a banner rather than quietly showing another
// figure. The state lives in the URL hash (#drill=…): Back closes it or steps back out,
// and a link opens the same drawer for someone else.
//
// The clicked numbers are only held to account against the data they were counted
// from (the state's `at` stamp). A link opened after an entry was logged, or a refresh
// while the drawer is open, moves the count honestly; that gets a plain note saying
// the data changed, not the alarm.
//
// It replaces the Scorecard's category detail and driver popup, and the roster popup
// that disagreed with the card it was opened from.

const ORDER = new Map(CATEGORIES.map((c) => [c.id, c.order]));

// An attempts drill-down counts the orders the Attempts tab has loaded from the
// dispatch feed (AnalyticsProvider publishAttempts); until they're in, it waits.
const attemptsPending = (spec, a) => spec?.kind === "attempts" && !a.drillCtx.attemptRecords;

// A day in the drawer's heading: "Sep 18", or "Sep 18, 2025" outside this year.
const fmtDay = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? fmtDate(s) : "");

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// Rendered once, by App: shows whatever drill the hash holds.
export function DrillHost() {
  const a = useAnalytics();
  const [raw] = useHashState(DRILL_KEY, "");
  const state = React.useMemo(() => decodeDrill(raw), [raw]);
  const ready = !a.historyLoading && !a.blocking && !attemptsPending(state?.spec, a);
  // A drawer just opened by a click carries no stamp yet: it was counted from the data
  // on screen now, so it gets this data's stamp (in place, without a history entry).
  React.useEffect(() => {
    if (state && !state.at && ready) stampDrill(state, a.dataStamp);
  }, [state, ready, a.dataStamp]);
  if (!state) return null;
  return <DrillDrawer state={state} onChange={openDrill} onClose={closeDrill} />;
}

const SOURCE_TEXT = {
  live: "live entries",
  mixed: "part live, part history",
  history: "imported history",
  not_tracked: "not tracked (history has no fault)",
  none: "no data",
  left_out: "not compared",
};

// Where each category of a month comes from (blend.js monthCells), in words: "Forgotten
// Freight live · Damage, Misdelivery, Lost/Missing from history".
const cellsText = (cells) =>
  [
    cells.live.length && `${cells.live.map(catLabel).join(", ")} live`,
    cells.history.length && `${cells.history.map(catLabel).join(", ")} from history`,
    cells.not_tracked.length && `${cells.not_tracked.map(catLabel).join(", ")} not tracked`,
  ]
    .filter(Boolean)
    .join(" · ");

export default function DrillDrawer({ state, onChange, onClose }) {
  const a = useAnalytics();
  const dialogRef = React.useRef(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const key = encodeDrill(state);
  const levels = React.useMemo(() => drillLevels(state), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const level = levels[levels.length - 1];
  const root = levels[0].spec;
  const scope = state.scopes?.length ? Math.min(state.scope || 0, state.scopes.length - 1) : 0;
  const path = state.path || [];
  const monthOp = [...path].reverse().find((op) => op.month);

  // A Drivers or Loaders split needs the roster's roles; without it everyone reads as a
  // driver, and the split would be wrong rather than missing.
  const blockedBy = a.blocking || (state.spec.roleGroup ? a.rosterBlocking : null);
  const waitingForOrders = attemptsPending(level.spec, a);
  const ready = !a.historyLoading && !blockedBy && !waitingForOrders;
  const detail = React.useMemo(
    () => (ready ? resolveDrill(level.spec, a.drillCtx) : null),
    [ready, key, a.drillCtx], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Each alternative scope's total at this level, for the scope buttons.
  const scopeTotals = React.useMemo(() => {
    if (!ready || !state.scopes?.length || monthOp) return [];
    return state.scopes.map((_, i) => {
      const ls = drillLevels({ ...state, scope: i });
      return resolveDrill(ls[ls.length - 1].spec, a.drillCtx).total;
    });
  }, [ready, key, a.drillCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // The month strip covers every scope's months (a period that crosses Jan 1 shows the
  // year before too), counted at this level but without any month narrowing. It runs
  // over every month from first to last: "All time" lists only months with data, and a
  // strip drawn over that would put Oct next to Dec with nothing to say a month is
  // missing. A gap month counts nothing, so no total moves.
  const strip = React.useMemo(() => {
    if (!ready) return null;
    const base = drillLevels({ ...state, path: path.filter((op) => !op.month) });
    const spec = base[base.length - 1].spec;
    if (spec.kind === "blend") {
      const all = new Set(spec.months || []);
      for (const s of state.scopes || []) for (const ym of s.months) all.add(ym);
      const months = spanMonths([...all]);
      const d = resolveDrill({ ...spec, months }, a.drillCtx);
      return {
        months,
        byMonth: d.byMonth,
        inScope: new Set(spanMonths(spec.months)),
        sourceOf: d.sourceOf,
        cellsOf: d.cellsOf,
      };
    }
    const d = resolveDrill(spec, a.drillCtx);
    // An attempts window covers its months whether or not each one had an order.
    const months =
      spec.kind === "attempts" && spec.start && spec.end
        ? spanMonths([...d.months, spec.start.slice(0, 7), spec.end.slice(0, 7)])
        : spanMonths(d.months);
    return { months, byMonth: d.byMonth, inScope: new Set(months), sourceOf: d.sourceOf, cellsOf: d.cellsOf };
  }, [ready, key, a.drillCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // A clicked number checked against a count from the same data: a difference is a real
  // disagreement. Against data that has moved since (a link, a Back, a refresh, the
  // Attempts period finishing loading after the click), it is only a change, and is
  // said as one (drill.js drillVerdict).
  const verdict = detail
    ? drillVerdict({ expected: level.expected, total: detail.total, at: state.at, stamp: a.dataStamp })
    : null;
  const mismatch = verdict === "mismatch";
  const moved = verdict === "moved";
  React.useEffect(() => {
    if (mismatch) {
      console.error(
        `Drill-down disagrees with the number clicked: expected ${level.expected}, got ${detail.total}`,
        level.spec,
      );
    }
  }, [mismatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => {
    setQuery("");
    onChange(next);
  };
  const person = (id) => nameOf(a.people, id);
  // An attempts drawer can be one driver KEY (attemptRecords.js): Unassigned, or a feed
  // name the roster doesn't match. A spec can name its own heading: `who` when it is
  // one driver's list, `title` when it is a group of entries (a Scorecard tile's) — a
  // title gives way to the category once the drawer is narrowed to one.
  const who = root.driverId
    ? person(root.driverId)
    : root.driverKey
      ? nameOfKey(a.people, root.driverKey)
      : root.who
        ? root.who
        : root.title
          ? root.title
          : root.roleGroup === "loader"
            ? "Loaders"
            : root.roleGroup === "driver"
              ? "Drivers"
              : "Company";
  // A drawer opened on a step (a driver opened from a leaderboard row, on that row's
  // category: drill.js driverDrill marks it `o`) is one level: "Steven Adjetey · Forgotten
  // Freight", with no breadcrumb until a step is taken from it (spec §15).
  const opened = state.path?.[0]?.o ? 1 : 0;
  const allCrumbs = [
    {
      label: root.categoryIds?.length === 1 && root.kind !== "attempts" ? `${who} › ${catLabel(root.categoryIds[0])}` : who,
    },
    ...path.map((op) => ({
      label: op.category
        ? catLabel(op.category)
        : op.categories
          ? op.label || `${op.categories.length} categories`
          : op.driverId
            ? person(op.driverId)
            : op.driverKey
              ? nameOfKey(a.people, op.driverKey)
              : fmtMonth(op.month),
    })),
  ];
  // Crumb j pops to path length j + opened; the opened step folds into the root's crumb.
  const crumbs = opened
    ? [{ label: `${allCrumbs[0].label} · ${allCrumbs[1].label}` }, ...allCrumbs.slice(2)]
    : allCrumbs;
  const cats = level.spec.categoryIds || [];
  const onOpened = opened > 0 && path.length === opened;
  const title = level.spec.driverId
    ? onOpened && cats.length === 1
      ? `${person(level.spec.driverId)} · ${catLabel(cats[0])}`
      : person(level.spec.driverId)
    : level.spec.driverKey
      ? nameOfKey(a.people, level.spec.driverKey)
      : level.spec.who
        ? level.spec.who
        : cats.length === 1
          ? catLabel(cats[0]) // the category's one name, as on every chart and legend
          : level.spec.title
            ? level.spec.title
            : level.spec.kind === "attempts"
              ? "Attempted orders"
              : "All categories";
  const inactive = level.spec.driverId && a.people.get(level.spec.driverId)?.active === false;
  const scopeLabel = monthOp
    ? fmtMonth(monthOp.month)
    : state.scopes?.[scope]?.label ||
      (level.spec.start ? fmtDateRange(level.spec.start, level.spec.end) : "");
  const sub = [
    level.spec.driverId ? cap((a.people.get(level.spec.driverId)?.role || "driver").toLowerCase()) : null,
    inactive ? "inactive" : null,
    root.roleGroup && !level.spec.driverId ? (root.roleGroup === "loader" ? "Loaders" : "Drivers") : null,
    level.spec.fault === "driver" ? "driver fault only" : null,
    level.spec.kind === "attempts" && (level.spec.driverId || level.spec.driverKey) ? "attempted orders" : null,
    scopeLabel,
    level.spec.label || null,
  ].filter(Boolean);
  // Sentence case: the first word capitalised, the rest as written (spec §2.2).
  if (sub.length) sub[0] = cap(String(sub[0]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide drill"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} detail`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div className="dr-head">
            {/* The path only once there is one: at the first level it would repeat the title. */}
            {crumbs.length > 1 && <nav className="dr-crumbs" aria-label="Drill-down path">
              {crumbs.map((c, i) =>
                i < crumbs.length - 1 ? (
                  <React.Fragment key={i}>
                    <button type="button" className="dr-crumb" onClick={() => go(popTo(state, i + opened))}>
                      {c.label}
                    </button>
                    <span className="dr-sep" aria-hidden="true">›</span>
                  </React.Fragment>
                ) : (
                  <span key={i} className="dr-crumb current" aria-current="page">
                    {c.label}
                  </span>
                ),
              )}
            </nav>}
            <div className="modal-title cd-title">
              {cats.length === 1 && !level.spec.driverId && (
                <span className="lb-swatch" style={{ background: catColor(cats[0]) }} />
              )}
              {title}
            </div>
            <div className="dm-sub">
              {sub.join(" · ")}
              {/* Opened on one category: the way back out to all of the driver's. */}
              {onOpened && (root.categoryIds || []).length > 1 && (
                <>
                  {sub.length ? " · " : ""}
                  <button type="button" className="text-link dr-allcats" onClick={() => go(popTo(state, 0))}>
                    Every category
                  </button>
                </>
              )}
            </div>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {!ready ? (
            blockedBy ? (
              <LoadError what={blockedBy.what} message={blockedBy.message} retry={blockedBy.retry} />
            ) : waitingForOrders ? (
              <div className="empty-state">
                Loading the attempted orders from the dispatch feed… They come from the Attempts tab&apos;s
                period; open that tab if this doesn&apos;t finish.
              </div>
            ) : (
              <div className="empty-state">Loading history…</div>
            )
          ) : (
            <DrawerBody
              a={a}
              state={state}
              level={level}
              detail={detail}
              strip={strip}
              scope={scope}
              scopeTotals={scopeTotals}
              monthOp={monthOp}
              mismatch={mismatch}
              moved={moved}
              query={query}
              setQuery={setQuery}
              go={go}
              scopeLabel={scopeLabel}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DrawerBody({
  a,
  state,
  level,
  detail,
  strip,
  scope,
  scopeTotals,
  monthOp,
  mismatch,
  moved,
  query,
  setQuery,
  go,
  scopeLabel,
}) {
  const spec = level.spec;
  const cats = spec.categoryIds || [];
  const person = (id) => (id ? nameOf(a.people, id) : "Unattributed");
  // One driver's list, whether named by id, by an attempt's driver key, or by `who`.
  const oneDriver = !!(spec.driverId || spec.driverKey || spec.who);

  // Coverage: where this level's months come from, and what the blend can't show. A
  // month still to come is neither data nor a gap, so it isn't counted as "no data";
  // a month inside the span with nothing on record is (spanMonths). The blend decides
  // live or history per category, so a month can be both: each such month is named
  // with its split.
  // Conflicts are the driver's own when the drawer is one driver's, the company's
  // otherwise; the strip marks them across all its months.
  const coverage = React.useMemo(() => {
    const counts = { live: 0, mixed: 0, history: 0, not_tracked: 0, none: 0 };
    const mixed = [];
    const now = currentYmET();
    const months = spec.kind === "blend" ? spanMonths(spec.months) : detail.months;
    for (const ym of months) {
      const src = detail.sourceOf(ym);
      if (src === "none" && ym > now) continue;
      counts[src] = (counts[src] || 0) + 1;
      if (src === "mixed" && detail.cellsOf) mixed.push({ ym, text: cellsText(detail.cellsOf(ym)) });
    }
    let all = [];
    if (spec.kind === "blend" || spec.kind === "window") {
      const blend = a.blend(spec.fault || null);
      all = (spec.driverId ? blend.driverConflicts(spec.driverId) : blend.conflicts).filter((c) =>
        cats.includes(c.category),
      );
    }
    // A like-for-like drawer (cells) counts some categories in some months only: a
    // conflict in a cell it left out isn't one of its numbers.
    if (detail.countsCell) all = all.filter((c) => detail.countsCell(c.ym, c.category));
    const inMonths = new Set(months);
    return { counts, mixed, conflicts: all.filter((c) => inMonths.has(c.ym)), all };
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows, filtered by the search box; the photo count follows the search.
  const q = query.trim().toLowerCase();
  const hit = (...fields) => !q || fields.some((f) => String(f || "").toLowerCase().includes(q));
  const incidents = detail.incidents.filter((i) =>
    hit(i.pro_number, i.driver_name, i.driver_raw, i.customer, i.to_name, i.notes, i.reason),
  );
  const historyRows = detail.historyRows.filter((r) => hit(r.driver_name, person(r.driver_id), catLabel(r.category)));
  const withPhotos = incidents.filter((i) => i.has_photos).length;
  // The order a row of the attempts list opens, over the drawer.
  const [stop, setStop] = React.useState(null);

  // By driver: inactive drivers stay in every total but leave the list, said as a count.
  // An attempts list is keyed like the Attempts tab's bars (a driver key), so Unassigned
  // and a feed name the roster doesn't match are rows of their own.
  const attempts = spec.kind === "attempts";
  const drivers = React.useMemo(() => {
    const rows = [];
    let hiddenCount = 0;
    for (const [id, e] of detail.byDriver) {
      if (id && a.hidden.has(id)) {
        hiddenCount += e.count;
        continue;
      }
      const name = attempts ? nameOfKey(a.people, id) : id ? nameOf(a.people, id) : "Unattributed";
      rows.push({ id, name, count: e.count, linkable: !!id && (!attempts || a.people.has(id)) });
    }
    rows.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
    return { rows, hiddenCount };
  }, [detail, a.hidden, a.people, attempts]);

  const byCategory = [...detail.byCategory]
    .filter(([, n]) => n > 0)
    .sort((x, y) => (ORDER.get(x[0]) ?? 99) - (ORDER.get(y[0]) ?? 99));


  const narrow = (op) => go(pushStep(state, op));
  const pickMonth = (ym, n) => {
    const path = state.path || [];
    const last = path[path.length - 1];
    if (last && last.month) {
      // Switching months replaces the month step; clicking the open month steps back out.
      const out = popTo(state, path.length - 1);
      go(last.month === ym ? out : pushStep(out, { month: ym, x: n }));
    } else {
      narrow({ month: ym, x: n });
    }
  };

  // A driver opened from here: their record over the same scopes, carrying only the
  // count that was clicked (drill.js driverFromDrawer).
  const driverState = (id, x) => driverFromDrawer(state, id, x);

  const csv = () =>
    downloadCsv(
      csvName("Drill-down", level.spec.driverId ? person(level.spec.driverId) : "", cats.length === 1 ? catLabel(cats[0]) : "", scopeLabel),
      [
        ...incidents.map((i) => ({
          month: fmtMonth(incidentDateStr(i).slice(0, 7)),
          date: incidentDateStr(i).slice(0, 10),
          pro: i.pro_number || "",
          driver: i.driver_name || i.driver_raw || "",
          category: catLabel(i.category),
          fault: i.fault || "",
          count: 1,
          source: "live entry",
        })),
        ...historyRows.map((r) => ({
          month: fmtMonth(r.ym),
          date: "",
          pro: "",
          driver: r.driver_name || person(r.driver_id),
          category: catLabel(r.category),
          fault: "",
          count: r.count,
          source: "imported history (monthly total)",
        })),
      ],
      [
        { key: "month", label: "Month" },
        { key: "date", label: "Date" },
        { key: "pro", label: "PRO" },
        { key: "driver", label: "Driver" },
        { key: "category", label: "Category" },
        { key: "fault", label: "Fault" },
        { key: "count", label: "Count" },
        { key: "source", label: "Source" },
      ],
    );

  const color = attempts ? catColor("attempts") : cats.length === 1 ? catColor(cats[0]) : BRAND;
  const conflictMonths = new Set(coverage.all.map((c) => c.ym));
  const { counts } = coverage;
  const unsplittable = detail.unsplittable || [];
  const scopeSuffix = scopeLabel ? ` · ${scopeLabel}` : "";
  // Where a month's number comes from, for the table view, the hover or focus readout
  // and a screen reader. Every value is also on its bar and in the table. A part-live
  // month is named with its split, except in the hover readout, which shares a line with
  // the key and the view toggle: there it is "part live, part history", and the split is
  // in its chip and the table.
  const sourceText = (ym, { brief = false } = {}) => {
    const src = strip.sourceOf(ym);
    const split = src === "mixed" && strip.cellsOf && !brief;
    const text = split ? cellsText(strip.cellsOf(ym)) : SOURCE_TEXT[src] || src;
    return `${text}${conflictMonths.has(ym) ? " · live and history disagree" : ""}`;
  };

  // The strip's months as the rest of the app draws them: a month with nothing on
  // record (no data) or not tracked under this scope is drawn shaded with no label, and
  // the month in progress is faded. Display only: the shading is drawn from a key of its
  // own (__draw); the table, the hover and a click read the month's count (n), which
  // stays what it counted — "0 · no data", as it always read.
  const nowYm = currentYmET();
  const stripRows = strip.months.map((ym) => {
    const n = strip.byMonth.get(ym) || 0;
    const src = strip.sourceOf ? strip.sourceOf(ym) : "live";
    const noNumber = n === 0 && (src === "none" || src === "not_tracked");
    const toDate = ym === nowYm;
    return {
      ym,
      n,
      __draw: noNumber ? null : n,
      // Months outside the drawer's period stay in view, quieter.
      __dim: !monthOp && !strip.inScope.has(ym),
      __partial: toDate && n > 0,
      __head: `${fmtHead(ym, "month")}${toDate ? " · to date" : ""}`,
      __notes: [sourceText(ym)],
    };
  });
  const stripNote = [];
  if (stripRows.some((r) => r.__draw === null)) {
    stripNote.push(
      <span key="band">
        <i className="cc-note-swatch" style={{ background: WASH, boxShadow: `inset 0 0 0 1px ${GRID}` }} />
        Shaded: {[...new Set(stripRows.filter((r) => r.__draw === null).map((r) => SOURCE_TEXT[strip.sourceOf(r.ym)] || "no data"))].join(", ")}
      </span>,
    );
  }
  if (stripRows.some((r) => r.__partial)) {
    stripNote.push(
      <span key="faded">
        <i className="cc-note-swatch" style={{ background: color, opacity: PARTIAL_OPACITY }} />
        Faded: {fmtMonth(nowYm)} to date
      </span>,
    );
  }

  return (
    <>
      {mismatch && (
        <div className="dr-disagree" role="alert">
          ⚠ Numbers disagree: you clicked {level.expected.toLocaleString()}, this drill-down counts{" "}
          {detail.total.toLocaleString()}. Treat both as suspect and report it.
        </div>
      )}
      {moved && (
        <div className="dr-moved" role="status">
          This was {level.expected.toLocaleString()} when it was opened. The entries, history or loaded
          attempts have changed since, so it now counts {detail.total.toLocaleString()}.
        </div>
      )}
      {spec.kind === "attempts" && a.attemptsError && (
        <div className="load-stale" role="status">
          Couldn&apos;t reach the dispatch feed for this period — only hand-logged attempts are
          listed.
        </div>
      )}

      {/* The drawer's numbers in the app's one tile strip (label, value, sub): each scope
          a tile that picks it, the one shown marked. Written out whole ("12,345", never
          "12.3K"), so the drawer shows exactly the number that was clicked. */}
      <TileStrip className="card-strip dr-tiles">
        {scopeTotals.length > 1
          ? state.scopes.map((s, i) => (
              <StatTile
                key={s.label}
                label={s.label}
                value={scopeTotals[i].toLocaleString()}
                selected={i === scope}
                title={i === scope ? "Shown below" : `Show ${s.label}`}
                onClick={() => go({ ...state, scope: i })}
              />
            ))
          : [<StatTile key="total" label={scopeLabel || "Total"} value={detail.total.toLocaleString()} />]}
        {!oneDriver && (
          // Attempts count roster drivers only, as the Attempts tab's tile does:
          // Unassigned and a feed name the roster doesn't match are listed, not counted.
          <StatTile
            label={attempts ? "Roster drivers" : "Drivers"}
            value={[...detail.byDriver.keys()].filter((k) => (attempts ? rankable(k, a.hidden) : k)).length.toLocaleString()}
            sub={scopeLabel || "total"}
          />
        )}
        {spec.kind !== "attempts" && <StatTile label="With photos" value={Number(withPhotos).toLocaleString()} sub={q ? "matching the search" : null} />}
      </TileStrip>

      {(() => {
        // What the numbers are made of and what they leave out: the warnings (live and
        // history disagree, a month only partly in range) in the open, the rest behind
        // one quiet "N notes" disclosure.
        const notes = [
          ...coverage.conflicts.map((c) => ({
            key: `c-${c.ym}-${c.category}`,
            warn: true,
            text: `${fmtMonth(c.ym)} ${catLabel(c.category)}: live ${c.live}, history ${c.history} — live shown`,
          })),
          ...unsplittable.map((u) => ({
            key: `u-${u.ym}`,
            warn: true,
            text: `${fmtMonth(u.ym)}: ${u.count} in history, only part of the month is in range — not counted`,
          })),
          detail.liveOnly ? { key: "live-only", text: "Live entries only" } : null,
          !detail.liveOnly && counts.live > 0 ? { key: "live", text: `${counts.live} live month${counts.live === 1 ? "" : "s"}` } : null,
          ...coverage.mixed.map((m) => ({ key: `m-${m.ym}`, text: `${fmtMonth(m.ym)}: ${m.text}` })),
          counts.history > 0
            ? { key: "history", text: `${counts.history} history month${counts.history === 1 ? "" : "s"} · monthly totals only` }
            : null,
          counts.not_tracked > 0
            ? { key: "nt", text: `${counts.not_tracked} history month${counts.not_tracked === 1 ? "" : "s"} not tracked by fault` }
            : null,
          counts.none > 0 && !detail.liveOnly ? { key: "none", text: `${counts.none} month${counts.none === 1 ? "" : "s"} with no data` } : null,
          counts.left_out > 0
            ? { key: "lo", text: `${counts.left_out} month${counts.left_out === 1 ? "" : "s"} not compared — nothing counted` }
            : null,
        ].filter(Boolean);
        if (!notes.length) return null;
        // What to check — live and history disagree, a month only partly in range — is
        // listed in the open, next to the numbers it explains, as it always was; the
        // rest of the notes wait behind one quiet disclosure.
        const warns = notes.filter((n) => n.warn);
        const info = notes.filter((n) => !n.warn);
        return (
          <>
            {warns.length > 0 && (
              <ul className="dr-warns" role="note" aria-label="To check">
                {warns.map((n) => (
                  <li key={n.key}>
                    <Icon name="alert-triangle" className="dr-warn-icon" />
                    <span>{n.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {info.length > 0 && (
              <details className="dr-notes">
                <summary>
                  <Icon name="chevron-right" className="dr-notes-chev" />
                  {info.length} note{info.length === 1 ? "" : "s"}
                </summary>
                <ul>
                  {info.map((n) => (
                    <li key={n.key}>{n.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        );
      })()}

      {/* One month: no strip — the heading names the month (spec §15). Several: plain
          columns, the drawer's months in colour and the rest of the strip quieter. */}
      {strip.months.length > 1 && strip.inScope.size > 1 && (
        <div className="dr-strip">
          <ChartCard
            inset
            title="By month"
            subtitle="Click a month for its entries"
            table={{
              columns: [
                { key: "month", label: "Month" },
                { key: "n", label: "Count", num: true },
                { key: "source", label: "Source" },
              ],
              rows: stripRows.map((r) => ({
                month: fmtMonth(r.ym),
                n: r.n,
                source: sourceText(r.ym),
              })),
            }}
            note={stripNote.length ? stripNote : null}
            height={160}
          >
            <StackedColumns
              data={stripRows}
              xKey="ym"
              grain="month"
              keyOf={(r) => r.ym}
              series={[{ id: "__draw", tip: "n", label: "Counted", color }]}
              selectedKey={monthOp?.month ?? null}
              onMark={(r) => {
                if (r.n > 0 || monthOp?.month === r.ym) pickMonth(r.ym, r.n);
              }}
            />
          </ChartCard>
        </div>
      )}

      <div className={`cd-grid ${oneDriver && !(cats.length > 1 && byCategory.length > 0) ? "dr-one" : ""}`}>
        {(cats.length > 1 || !oneDriver) && (
          <section className="cd-drivers">
            {cats.length > 1 && byCategory.length > 0 && (
              <>
                <div className="cd-h">
                  <span>
                    By category<span className="cd-h-sub">{scopeSuffix}</span>
                  </span>
                </div>
                <BarList
                  rows={byCategory.map(([cat, n]) => ({ key: cat, label: catLabel(cat), value: n }))}
                  order="given"
                  limit={0}
                  colorOf={(r) => catColor(r.key)}
                  onMark={(r) => narrow({ category: r.key, x: r.value })}
                  rowTitle={(r) => `Only ${r.label}: ${r.value}`}
                  ariaLabel="By category"
                />
              </>
            )}
            {!oneDriver && (
              <>
                <div className="cd-h" style={cats.length > 1 && byCategory.length > 0 ? { marginTop: 16 } : undefined}>
                  <span>
                    By driver<span className="cd-h-sub">{scopeSuffix}</span>
                  </span>
                </div>
                {drivers.rows.length === 0 ? (
                  <div className="empty-state">No drivers counted.</div>
                ) : (
                  // The app's bar list: a name opens the driver, the count narrows this
                  // drawer to them — two actions, so the row itself isn't a button.
                  <BarList
                    rows={drivers.rows.map((r) => ({ ...r, key: r.id || "unattributed", label: r.name, value: r.count, notSet: !r.id }))}
                    order="given"
                    color={color}
                    noun="drivers"
                    labelNode={(r) =>
                      /* An attempts list stays on attempts: a name narrows it, like the count. */
                      r.linkable && !attempts ? <DriverLink id={r.id} name={r.name} drill={driverState(r.id, r.count)} /> : r.name
                    }
                    valueNode={(r) =>
                      r.id ? (
                        <button
                          type="button"
                          className="dr-count"
                          onClick={() => narrow(attempts ? { driverKey: r.id, x: r.count } : { driverId: r.id, x: r.count })}
                          title={`Only ${r.name}`}
                        >
                          {r.count}
                        </button>
                      ) : (
                        r.count
                      )
                    }
                    rowTitle={(r) => `${r.name}: ${r.count}`}
                    ariaLabel="By driver"
                  />
                )}
                {drivers.hiddenCount > 0 && (
                  <div className="cd-note">
                    +{drivers.hiddenCount} from inactive drivers — counted in the totals, not listed.
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <section className="cd-incidents">
          <div className="cd-h cd-h-row">
            <span>
              {attempts ? "Orders" : "Entries"}
              <span className="cd-h-sub">
                {scopeSuffix} · {detail.total}
              </span>
            </span>
            {!attempts && (
              <span className="dr-row-tools">
                <input
                  type="search"
                  className="cd-search"
                  placeholder="PRO, driver or customer"
                  aria-label="Search entries"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="button" className="btn ghost sm" onClick={csv} title="Download these rows as CSV">
                  <Icon name="download" />
                  CSV
                </button>
              </span>
            )}
          </div>
          {attempts ? (
            <>
              {/* The Attempts tab's own table, read-only: its search, sort and CSV. */}
              <AttemptOrdersTable
                rows={detail.orders}
                compact
                onOpenStop={(r) => setStop(r.order)}
                csv={csvName("Attempted orders", spec.driverId ? person(spec.driverId) : spec.driverKey ? nameOfKey(a.people, spec.driverKey) : "", scopeLabel)}
                empty="No orders."
              />
              {stop &&
                createPortal(
                  <StopDetailModal row={stop} legs={stop.legRows || [stop]} onClose={() => setStop(null)} />,
                  document.body,
                )}
            </>
          ) : (
            <EntryList
              incidents={incidents}
              historyRows={historyRows}
              showDriver={!spec.driverId}
              hideCategory={cats.length === 1}
              onDriver={(id) => id && go(driverState(id))}
              empty={q ? "Nothing matches that search." : "Nothing counted here."}
            />
          )}
        </section>
      </div>
    </>
  );
}
