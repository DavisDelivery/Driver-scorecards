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
import { CATEGORIES, catLabel, catTitle, catColor } from "../../data/categories.js";
import { nameOf, nameOfKey } from "../../data/people.js";
import { rankable } from "../../data/manualAnalytics.js";
import { incidentDateStr } from "../../data/incidentDate.js";
import { currentYmET } from "../../data/period.js";
import { downloadCsv, csvName } from "../../data/csv.js";
import { BRAND } from "./chartTheme.js";
import EntryList, { fmtMonth } from "./EntryList.jsx";
import { DataTable } from "./ChartCard.jsx";
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

const fmtDay = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
};

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

const SOURCE_GLYPH = { live: "●", mixed: "◐", history: "○", not_tracked: "⊘", none: "–" };
const SOURCE_TEXT = {
  live: "live entries",
  mixed: "part live, part history",
  history: "imported history",
  not_tracked: "not tracked (history has no fault)",
  none: "no data",
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

// A month that is part live, part history is named with its split; past this many the
// rest are counted in one chip.
const MIXED_CHIPS = 3;

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
  // name the roster doesn't match. An incidents list can name its own heading (`who`).
  const who = root.driverId
    ? person(root.driverId)
    : root.driverKey
      ? nameOfKey(a.people, root.driverKey)
      : root.who
        ? root.who
        : root.roleGroup === "loader"
          ? "Loaders"
          : root.roleGroup === "driver"
            ? "Drivers"
            : "Company";
  const crumbs = [
    {
      label: root.categoryIds?.length === 1 && root.kind !== "attempts" ? `${who} › ${catLabel(root.categoryIds[0])}` : who,
    },
    ...path.map((op) => ({
      label: op.category
        ? catLabel(op.category)
        : op.driverId
          ? person(op.driverId)
          : op.driverKey
            ? nameOfKey(a.people, op.driverKey)
            : fmtMonth(op.month),
    })),
  ];
  const cats = level.spec.categoryIds || [];
  const title = level.spec.driverId
    ? person(level.spec.driverId)
    : level.spec.driverKey
      ? nameOfKey(a.people, level.spec.driverKey)
      : level.spec.who
        ? level.spec.who
        : cats.length === 1
          ? catTitle(cats[0])
          : level.spec.kind === "attempts"
            ? "Attempted orders"
            : "All categories";
  const inactive = level.spec.driverId && a.people.get(level.spec.driverId)?.active === false;
  const scopeLabel = monthOp
    ? fmtMonth(monthOp.month)
    : state.scopes?.[scope]?.label ||
      (level.spec.start ? `${fmtDay(level.spec.start)} – ${fmtDay(level.spec.end)}` : "");
  const sub = [
    level.spec.driverId ? (a.people.get(level.spec.driverId)?.role || "driver").toUpperCase() : null,
    inactive ? "INACTIVE" : null,
    root.roleGroup && !level.spec.driverId ? (root.roleGroup === "loader" ? "LOADERS" : "DRIVERS") : null,
    level.spec.fault === "driver" ? "DRIVER FAULT ONLY" : null,
    level.spec.kind === "attempts" && (level.spec.driverId || level.spec.driverKey) ? "ATTEMPTED ORDERS" : null,
    scopeLabel,
    level.spec.label || null,
  ].filter(Boolean);

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
            <nav className="dr-crumbs" aria-label="Drill-down path">
              {crumbs.map((c, i) =>
                i < crumbs.length - 1 ? (
                  <React.Fragment key={i}>
                    <button type="button" className="dr-crumb" onClick={() => go(popTo(state, i))}>
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
            </nav>
            <div className="modal-title cd-title">
              {cats.length === 1 && !level.spec.driverId && (
                <span className="cc-dot" style={{ background: catColor(cats[0]) }} />
              )}
              {title}
            </div>
            <div className="dm-sub">{sub.join(" · ")}</div>
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
  const maxCat = Math.max(1, ...byCategory.map(([, n]) => n));

  // A long strip (all time) opens scrolled to its latest months, where the scope is.
  const stripRef = React.useRef(null);
  const [stripView, setStripView] = React.useState("chart");
  const [peek, setPeek] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [strip.months.length, stripView]);

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
  const stripMax = Math.max(1, ...strip.months.map((ym) => strip.byMonth.get(ym) || 0));
  const stripSources = new Set(strip.months.map((ym) => strip.sourceOf(ym)));
  const conflictMonths = new Set(coverage.all.map((c) => c.ym));
  const { counts } = coverage;
  const moreMixed = coverage.mixed.length - MIXED_CHIPS;
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
  const readout = (ym, opts) =>
    `${fmtMonth(ym)}: ${(strip.byMonth.get(ym) || 0).toLocaleString()} · ${sourceText(ym, opts)}`;

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

      <div className="dm-stats">
        {scopeTotals.length > 1 ? (
          state.scopes.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={`dm-stat dm-stat-btn ${i === scope ? "active" : ""}`}
              aria-pressed={i === scope}
              onClick={() => go({ ...state, scope: i })}
            >
              <div className="dm-stat-num">{scopeTotals[i].toLocaleString()}</div>
              <div className="dm-stat-lbl">{s.label}</div>
            </button>
          ))
        ) : (
          <div className="dm-stat active">
            <div className="dm-stat-num">{detail.total.toLocaleString()}</div>
            <div className="dm-stat-lbl">{scopeLabel || "Total"}</div>
          </div>
        )}
        {!oneDriver && (
          <div className="dm-stat">
            {/* Attempts count roster drivers only, as the Attempts tab's tile does:
                Unassigned and a feed name the roster doesn't match are listed, not counted. */}
            <div className="dm-stat-num">
              {[...detail.byDriver.keys()].filter((k) => (attempts ? rankable(k, a.hidden) : k)).length}
            </div>
            <div className="dm-stat-lbl">
              {attempts ? "Roster drivers" : "Drivers"} · {scopeLabel || "total"}
            </div>
          </div>
        )}
        {spec.kind !== "attempts" && (
          <div className="dm-stat">
            <div className="dm-stat-num">{withPhotos}</div>
            <div className="dm-stat-lbl">With photos{q ? " · matching" : ""}</div>
          </div>
        )}
      </div>

      <div className="dr-chips">
        {detail.liveOnly && <span className="dr-chip">live entries only</span>}
        {!detail.liveOnly && counts.live > 0 && (
          <span className="dr-chip">● {counts.live} live month{counts.live === 1 ? "" : "s"}</span>
        )}
        {coverage.mixed.slice(0, MIXED_CHIPS).map((m) => (
          <span key={m.ym} className="dr-chip">
            ◐ {fmtMonth(m.ym)}: {m.text}
          </span>
        ))}
        {moreMixed > 0 && (
          <span className="dr-chip">
            ◐ {moreMixed} more month{moreMixed === 1 ? "" : "s"} part live, part history
          </span>
        )}
        {counts.history > 0 && (
          <span className="dr-chip">
            ○ {counts.history} history month{counts.history === 1 ? "" : "s"} · monthly totals only
          </span>
        )}
        {counts.not_tracked > 0 && (
          <span className="dr-chip">
            ⊘ {counts.not_tracked} history month{counts.not_tracked === 1 ? "" : "s"} not tracked by fault
          </span>
        )}
        {counts.none > 0 && !detail.liveOnly && (
          <span className="dr-chip">– {counts.none} month{counts.none === 1 ? "" : "s"} with no data</span>
        )}
        {coverage.conflicts.map((c) => (
          <span key={`${c.ym}-${c.category}`} className="dr-chip warn" title="A category with live entries in a month is counted from them; the history that month also holds for it is not added.">
            ⚠ {fmtMonth(c.ym)} {catLabel(c.category)}: live {c.live}, history {c.history} — live shown
          </span>
        ))}
        {unsplittable.map((u) => (
          <span key={u.ym} className="dr-chip warn">
            {fmtMonth(u.ym)}: {u.count} in history, only part of the month is in range — not counted
          </span>
        ))}
      </div>

      {strip.months.length > 0 && stripView === "table" && (
        <DataTable
          columns={[
            { key: "month", label: "Month" },
            { key: "n", label: "Count", num: true },
            { key: "source", label: "Source" },
          ]}
          rows={strip.months.map((ym) => ({
            month: fmtMonth(ym),
            n: strip.byMonth.get(ym) || 0,
            source: sourceText(ym),
          }))}
        />
      )}
      {strip.months.length > 0 && stripView === "chart" && (
        <div className="dr-strip-wrap" ref={stripRef}>
          <div
            className="cd-strip dr-strip"
            style={{ "--n": strip.months.length }}
            aria-label="By month"
          >
            {strip.months.map((ym, i) => {
              const n = strip.byMonth.get(ym) || 0;
              const src = strip.sourceOf(ym);
              const active = monthOp?.month === ym;
              const inScope = strip.inScope.has(ym);
              const glyph = conflictMonths.has(ym) ? "⚠" : SOURCE_GLYPH[src] || "";
              return (
                <button
                  key={ym}
                  type="button"
                  className={`cd-month ${active ? "active" : ""} ${inScope ? "in-period" : ""}`}
                  onClick={() => pickMonth(ym, n)}
                  onMouseEnter={() => setPeek(ym)}
                  onMouseLeave={() => setPeek(null)}
                  onFocus={() => setPeek(ym)}
                  onBlur={() => setPeek(null)}
                  aria-label={readout(ym)}
                  aria-pressed={active}
                  disabled={n === 0 && !active}
                >
                  <span className="cd-month-n">{n || ""}</span>
                  <span className="cd-month-bar">
                    <span
                      style={{
                        height: `${(n / stripMax) * 100}%`,
                        background: color,
                        opacity: active || (!monthOp && inScope) ? 1 : 0.35,
                      }}
                    />
                  </span>
                  <span className="cd-month-lbl">
                    {fmtMonth(ym).slice(0, 3)}
                    {ym.endsWith("-01") || i === 0 ? <i>{ym.slice(2, 4)}</i> : null}
                  </span>
                  <span className={`dr-src src-${src}`} aria-hidden="true">{glyph}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {strip.months.length > 0 && (
        <div className="dr-strip-key">
          {stripView === "chart" &&
            [...stripSources].filter((s) => SOURCE_GLYPH[s]).map((s) => (
              <span key={s}>
                {SOURCE_GLYPH[s]} {SOURCE_TEXT[s]}
              </span>
            ))}
          {stripView === "chart" && conflictMonths.size > 0 && <span>⚠ live and history disagree</span>}
          <span className="dr-peek" aria-live="polite">
            {stripView === "chart" && peek ? readout(peek, { brief: true }) : ""}
          </span>
          <span className="cc-view" role="group" aria-label="Months as">
            {["chart", "table"].map((v) => (
              <button
                key={v}
                type="button"
                className={stripView === v ? "active" : ""}
                aria-pressed={stripView === v}
                onClick={() => setStripView(v)}
              >
                {v === "chart" ? "Chart" : "Table"}
              </button>
            ))}
          </span>
        </div>
      )}

      <div className={`cd-grid ${oneDriver && !(cats.length > 1 && byCategory.length > 0) ? "dr-one" : ""}`}>
        {(cats.length > 1 || !oneDriver) && (
          <section className="cd-drivers">
            {cats.length > 1 && byCategory.length > 0 && (
              <>
                <div className="cd-h">By category{scopeSuffix}</div>
                <div className="dr-cats">
                  {byCategory.map(([cat, n]) => (
                    <button key={cat} type="button" className="dr-cat" onClick={() => narrow({ category: cat, x: n })}>
                      <span className="dr-cat-name">
                        <i style={{ background: catColor(cat) }} aria-hidden="true" />
                        {catLabel(cat)}
                      </span>
                      <span className="dr-cat-track">
                        <span style={{ width: `${(n / maxCat) * 100}%`, background: catColor(cat) }} />
                      </span>
                      <span className="cd-driver-n">{n}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!oneDriver && (
              <>
                <div className="cd-h" style={cats.length > 1 ? { marginTop: 14 } : undefined}>
                  By driver{scopeSuffix}
                </div>
                {drivers.rows.length === 0 && <div className="empty-state">No drivers counted.</div>}
                {drivers.rows.map((r, i) => (
                  <div key={r.id || "unattributed"} className="cd-driver dr-driver">
                    <span className="lb-rank">{i + 1}</span>
                    <span className="cd-driver-name">
                      {/* An attempts list stays on attempts: a name narrows it, like the count. */}
                      {r.linkable && !attempts ? (
                        <DriverLink id={r.id} name={r.name} drill={driverState(r.id, r.count)} />
                      ) : (
                        r.name
                      )}
                    </span>
                    {r.id ? (
                      <button
                        type="button"
                        className="dr-count"
                        onClick={() => narrow(attempts ? { driverKey: r.id, x: r.count } : { driverId: r.id, x: r.count })}
                        title={`Only ${r.name}`}
                      >
                        {r.count}
                      </button>
                    ) : (
                      <span className="cd-driver-n">{r.count}</span>
                    )}
                  </div>
                ))}
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
              {attempts ? "Orders" : "Entries"}{scopeSuffix} · {detail.total}
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
                <button type="button" className="cc-csv" onClick={csv} title="Download these rows as CSV">
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
