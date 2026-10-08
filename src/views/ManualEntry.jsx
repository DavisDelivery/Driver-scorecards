import React from "react";
import { fetchStopData } from "../parsers/nuvizzClient.js";
import { hiddenDriverIds } from "../data/drivers.js";
import {
  generateDriverReport,
  driverReportFilename,
  allDriversReportFilename,
} from "../reports/driverReport.js";
import {
  saveIncident,
  deleteIncident,
  getIncidentPhotos,
} from "../data/firebase.js";
import { matchDriver } from "../data/driverMatch.js";
import {
  fetchAttemptsForDay,
  fetchAttemptsRange,
  deleteAttempt,
  todayET,
  yesterdayET,
  classifyDay,
  feedCoverage,
  noDataRuns,
  NO_DATA_STATUSES,
  DAY_STATUS_TEXT,
  FEED_EPOCH,
  shiftDay,
} from "../data/attemptsFeed.js";
import {
  groupAttemptLegs,
  unassignedReason,
  closedOutBy,
  UNASSIGNED_REASON_TEXT,
  UNASSIGNED_REASON_SHORT,
  fillFlags,
  fillLeftIndex,
  FILL_LEFT_REASON,
} from "../data/attemptLegs.js";
import {
  buildAttemptRecords,
  feedRecord,
  overrideIndex,
  feedAttribution,
  feedOrderIndex,
  feedOrderFor,
  ATTRIBUTED_BY_TEXT,
} from "../data/attemptRecords.js";
import { reassignAttempt, overridesFor as savedOverridesFor } from "../data/attemptReassign.js";
import { catColor, COUNTED8 } from "../data/categories.js";
import { csvName } from "../data/csv.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { useHashState } from "../data/hashState.js";
import { driverDrill } from "../data/drill.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { fmtIncidentDate } from "../data/incidentDate.js";
import { currentYmET, shiftYm, weekdayOfYmd } from "../data/period.js";
import { nameOfKey } from "../data/people.js";
import {
  recordDate,
  keyOf as recordKey,
  inWindow,
  activeFocus,
  focusOptions as buildFocusOptions,
  byDriver as buildByDriver,
  focusRank,
  ordinal,
  topDriver,
  fleetMean,
  weekdaySeries,
  busiest,
  trendSeries,
  classBreakdown,
  outcomeMix,
  perActiveDay,
  customerPatterns,
  lateByPro,
  ageDays,
  sortQueue,
  feedLoadPlan,
  attemptTiles,
  entriesDrill,
  applyChips,
  monthSpark,
  sparkSource,
  liveMonthCounts,
  weekSpark,
  dayDiff,
  printPeriodLabel,
  OUTCOME_LABEL,
  WEEKDAY_PLURAL,
  FEED_CHUNK,
} from "../data/manualAnalytics.js";
import { openDrill } from "./kit/drillNav.js";
import { AnalyticsGate, RosterGate } from "./kit/LoadState.jsx";
import StopDetailModal from "./StopDetailModal.jsx";
import ManualEntryAnalytics, { useTabPeriod, DriverCard } from "./ManualEntryAnalytics.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
import AttemptOrdersTable, { visibleOrders } from "./kit/AttemptOrdersTable.jsx";
import DriverLink from "./kit/DriverLink.jsx";
import { chartTable } from "./kit/shape.js";

// Normalize what's typed into "Pull Order". Uline PROs are numeric and
// zero-padded to 9 digits, so a purely-numeric entry gets that treatment
// (unchanged behavior). Every other carrier Davis delivers for lives in the
// SAME NuVizz account/company, but uses its own alphanumeric tracking number
// (e.g. an Averitt or Estes PRO) — stripping those down to digits and zero-
// padding mangles them into a bogus all-zero id NuVizz can never find, so
// anything containing a letter is passed through as-is (just trimmed/cased).
const normalizeOrderId = (raw) => {
  const cleaned = String(raw || "").trim().replace(/[\s-]/g, "");
  return /^\d+$/.test(cleaned) ? cleaned.padStart(9, "0") : cleaned.toUpperCase();
};

// Format an ISO date (YYYY-MM-DD…) as US month/day/year (MM/DD/YYYY). Parsed from
// the string directly so it never shifts a day from new Date() timezone handling.
const fmtMDY = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s || "").slice(0, 10);
};

// Format a NuVizz local datetime ("YYYY-MM-DDTHH:MM:SS") as MM/DD/YYYY h:mm AM/PM.
const fmtDateTime = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return String(s || "");
  let h = +m[4];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${m[2]}/${m[3]}/${m[1]} ${h}:${m[5]} ${ap}`;
};

// No chart click narrowing anything — one object, so it is stable between renders.
const NO_CHIPS = Object.freeze({});

// How many 45-day chunks before a window's own the Attempts tab has been asked to
// load, by window ("start|end"). Here rather than in the screen's state, which a tab
// switch throws away; the days themselves are in the feed's day cache, so coming back
// costs no new reads.
const feedExtraByWindow = new Map();

// Status badge for an auto-detected (feed) attempt: amber "Unplanned" when the
// stop is currently unplanned, else the raw status.
function AttemptStatusBadge({ a }) {
  const unplanned = a.currentlyUnplanned;
  return (
    <span
      className="chip"
      style={
        unplanned
          ? { background: "#fef3c7", color: "#b45309", border: "1px solid #fcd9a3" }
          : { background: "var(--bg-3)", color: "var(--text-2)" }
      }
    >
      {unplanned ? "Unplanned" : a.currentStatus || "—"}
    </span>
  );
}

// Config presets for the manual-entry tabs. Both pull a PRO from NuVizz, attribute
// it to a driver, and log it as a manual incident; they differ only in copy,
// category, and whether they carry a classification dropdown.
//
// A tab's colour is its category's, from categories.js — the configs used to carry
// their own, and Forgotten Freight's orange no longer matched the charts'. `ns` is the
// tab's namespace for its period in the URL hash (ff.p, att.p …).
// Its own category, so every existing chart, rollup and leaderboard ignores it by
// construction: they all enumerate the categories they count, and this isn't one.
export const UNABLE_TO_TRACK = "unable_to_track";

export const UNABLE_TO_TRACK_CONFIG = {
  category: UNABLE_TO_TRACK,
  ns: "utt",
  // Never a driver fault: the record is that we couldn't attribute the PRO, not that
  // somebody did something wrong.
  fault: "",
  heading: "Unable to Track",
  logTitle: "Unable-to-Track Log",
  leaderLabel: "Most unable-to-track",
  addLabel: "Log Unable to Track",
  recordNoun: "unable to track",
  deleteNoun: "unable-to-track",
  reasonLabel: "Unable to find / track driver",
  driverOptional: true,
  classify: {
    label: "What couldn't be found",
    field: "untracked_reason",
    placeholder: "— Select reason —",
    options: [
      "Driver could not find the PRO",
      "No driver on the stop",
      "PRO not in NuVizz",
      "Stop not found",
      "Multiple legs — driver unclear",
    ],
  },
};

export const FF_CONFIG = {
  category: "forgotten_freight",
  ns: "ff",
  heading: "Forgotten Freight",
  logTitle: "Forgotten Freight Log",
  // The driver with the most of these is the worst offender, not a top performer.
  leaderLabel: "Most forgottens",
  addLabel: "Add Forgotten Freight",
  recordNoun: "forgotten freight", // "…already logged as forgotten freight for…"
  deleteNoun: "forgotten-freight", // "Delete forgotten-freight entry…"
  reasonLabel: "Forgotten freight",
  classify: {
    label: "What was forgotten",
    field: "forgotten_item",
    placeholder: "— Select item —",
    options: ["Skid", "Peanut", "Bubble Wrap", "Foam", "Box", "Pallet Jack"],
  },
  // Not everything you look up is forgotten freight. When the PRO can't be tracked to
  // a driver — no driver on the stop, the PRO isn't in NuVizz, the driver can't find
  // the freight — picking this diverts the entry to its own category, so it is on
  // record without landing in the forgotten-freight counts, charts or leaderboard
  // (which read category === "forgotten_freight" and never see it).
  divert: {
    option: "Unable to find / track driver",
    category: UNABLE_TO_TRACK,
    reasonLabel: "Unable to find / track driver",
    // The whole point is that the driver may be unknown, so this one can save without.
    allowNoDriver: true,
    note: 'Logged under "Unable to Track" — kept out of Forgotten Freight counts and charts. A driver is optional here.',
  },
};

export const MISDELIVERY_CONFIG = {
  category: "misdelivery",
  ns: "mis",
  heading: "Mis-Deliveries",
  logTitle: "Mis-Delivery Log",
  leaderLabel: "Most mis-deliveries",
  addLabel: "Add Mis-Delivery",
  recordNoun: "a mis-delivery",
  deleteNoun: "mis-delivery",
  reasonLabel: "Mis-delivery",
  classify: {
    label: "What went wrong",
    field: "misdelivery_type",
    placeholder: "— Select issue —",
    options: ["Wrong Address", "Wrong Customer", "Wrong Item"],
  },
};

export const COMPLIMENTS_CONFIG = {
  category: "compliment",
  ns: "cmp",
  // A compliment is positive credit to the driver — NOT a fault. Empty fault keeps
  // it out of driver-fault counts while still crediting the compliment category.
  fault: "",
  heading: "Compliments",
  logTitle: "Compliments Log",
  // Compliments are positive, so the most-credited driver really is the top one.
  leaderLabel: "Top driver",
  addLabel: "Add Compliment",
  recordNoun: "a compliment",
  deleteNoun: "compliment",
  reasonLabel: "Compliment",
  classify: null,
};

export const ATTEMPTS_CONFIG = {
  category: "attempts",
  ns: "att",
  heading: "Attempts",
  logTitle: "Attempts Log",
  leaderLabel: "Most attempts",
  addLabel: "Add Attempt",
  recordNoun: "an attempt",
  deleteNoun: "attempt",
  reasonLabel: "Delivery attempt",
  classify: null,
  // Also load the dispatch app's automated attempts feed for the selected date,
  // merged into the log alongside manual entries (with a per-row delete).
  feed: true,
  feedDeletable: true,
};

// Generic manual-entry view: pull an order from NuVizz, charge it to a driver, and
// log it as a manual incident, plus an editable/deletable log. Driven by `config`
// so Forgotten Freight and Mis-Deliveries share one implementation.
export default function ManualEntry({ drivers, incidents, onSaved, config }) {
  const classifyField = config.classify?.field;

  const [pro, setPro] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const [pull, setPull] = React.useState(null); // { stop, photos, error }
  const [driverId, setDriverId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [classifyValue, setClassifyValue] = React.useState("");
  // One date new MANUAL entries are logged under; defaults to today (ET) and stays
  // put between entries. This does NOT drive the auto feed (see feedDate below).
  const [incidentDate, setIncidentDate] = React.useState(todayET);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState("");
  const [savedWarn, setSavedWarn] = React.useState(false);
  const analytics = useAnalytics();
  const incidentsFailed = analytics.blocking?.what === "incidents";
  const [logSearch, setLogSearch] = React.useState("");
  // The window + label the analytics panel is showing; the detail log scopes itself
  // to this so the log matches the charts (non-feed tabs). Both read the same period
  // from the URL hash, so they can't disagree.
  const { win: logWin, label: logLabel } = useTabPeriod(config.ns);
  const logPeriod = React.useMemo(() => ({ win: logWin, label: logLabel }), [logWin, logLabel]);
  const color = catColor(config.category);
  // Group the log's rows under driver headers.
  const [groupByDriver, setGroupByDriver] = React.useState(false);
  // The picked driver, as a driver key (attemptRecords.js): the whole tab follows it —
  // the tiles and charts, the order table, the log and Print. It lives in the hash
  // (att.driver, ff.driver …) so it survives a tab switch and travels with a link. A
  // deactivated driver can't be one; they still count in every total.
  //
  // Who may be one depends on the roster (CLAUDE.md, RosterGate): with its read failed
  // and no earlier copy, a deactivated driver can't be told apart and every feed name
  // reads as unmatched, so the picked driver waits, kept in the hash, until it's back.
  const rosterBlocked = analytics.rosterBlocking;
  const [focusRaw, setFocusRaw] = useHashState(`${config.ns}.driver`, "");
  const focus = rosterBlocked ? null : activeFocus(focusRaw, drivers);
  const setFocus = React.useCallback((k) => setFocusRaw(k || ""), [setFocusRaw]);
  // What a chart click narrowed the table or log to (manualAnalytics.js applyChips).
  // Kept with the window it was picked in, so a new period starts unnarrowed.
  const winKey = `${logWin.start}|${logWin.end}`;
  const [chipState, setChipState] = React.useState({ key: winKey, chips: {} });
  const chips = chipState.key === winKey ? chipState.chips : NO_CHIPS;
  // Clicking the chip that's already set (or passing null) takes it off. A chart click
  // replaces whatever narrowed the list before it (`only`), so the list's count is
  // always the bar's: stacked on a day, an outcome segment showing 72 would open on 0.
  // A customer picked in the table narrows the table further, so it stacks.
  const toggleChip = React.useCallback(
    (kind, chip, { only = false } = {}) =>
      setChipState((st) => {
        const cur = st.key === winKey ? st.chips : NO_CHIPS;
        if (!chip || cur[kind]?.key === chip.key) {
          const next = { ...cur };
          delete next[kind];
          return { key: winKey, chips: next };
        }
        return { key: winKey, chips: only ? { [kind]: chip } : { ...cur, [kind]: chip } };
      }),
    [winKey],
  );
  // The order table's search and sort live here, so Print prints the very rows shown.
  const [orderQuery, setOrderQuery] = React.useState("");
  const [orderSort, setOrderSort] = React.useState({ key: "date", dir: "desc" });
  // Handout PDF build state. `printing` is false | "one" | "all" so the two buttons
  // can label their own progress (photos for one driver, drivers for the pack).
  const [printing, setPrinting] = React.useState(false);
  const [printProgress, setPrintProgress] = React.useState({ done: 0, total: 0 });

  // Automated attempts feed (only when config.feed). It has its OWN date picker so
  // you can browse auto attempts for any day independent of the manual log date.
  const feedEnabled = !!config.feed;
  const [feedDate, setFeedDate] = React.useState(todayET);
  const [feed, setFeed] = React.useState({
    status: "idle",
    attempts: [],
    error: null,
    provisionalCount: 0,
    deriveError: null,
    // What the settled list says about the day (attemptsFeed.js classifyDay), so a
    // night the scan never ran reads as no data rather than as no attempts.
    dayStatus: null,
  });
  // Bump to refetch. `scan` forces live detection off the dispatch stop index (the
  // "Run scan" button); a plain date change settles for "auto" — detect only when the
  // evening scan hasn't written that day yet — so browsing history stays cheap.
  const [feedNonce, setFeedNonce] = React.useState(0);
  const [feedScan, setFeedScan] = React.useState(false);
  const [feedDeletingId, setFeedDeletingId] = React.useState(null);
  // The feed row whose detail/activity-history modal is open.
  const [stopDetail, setStopDetail] = React.useState(null);
  // Every attempt in the ANALYTICS period, not just the day the log is showing.
  // The auto attempts are the bulk of this tab and are NOT saved as incidents, so
  // without this the charts and totals only ever saw the handful that were — a
  // month with 132 real attempts across 38 drivers charted as a near-empty panel.
  // `days` holds each day's status beside its rows (see attemptsFeed.js), so a day
  // the feed has no data for is never counted as a day with no attempts. The days
  // themselves come from the feed's shared day cache, so moving between overlapping
  // periods — or leaving the tab and coming back — refetches only what's missing.
  const [periodFeed, setPeriodFeed] = React.useState({
    status: "idle",
    days: new Map(),
    fills: [],
  });
  // Bump to read the period again. A failed day and today are never cached, so this
  // asks for those again (and any recent day past its refresh time) and serves the
  // rest from the cache.
  const [periodNonce, setPeriodNonce] = React.useState(0);
  // The feed is read 45 days at a time (its own cap per request): the window's most
  // recent 45 first, then 45 more for each "Load 45 earlier days", back to the day the
  // feed started — past the window's start too, since those days are what the
  // Attempted orders tile compares against. Kept per window outside this screen
  // (feedExtraByWindow), so a tab switch doesn't drop a 3M view back to 45 days.
  const [, bumpFeedExtra] = React.useReducer((n) => n + 1, 0);
  const feedExtra = feedExtraByWindow.get(winKey) || 0;
  const loadEarlier = () => {
    feedExtraByWindow.set(winKey, feedExtra + 1);
    bumpFeedExtra();
  };
  const loadPlan = React.useMemo(
    () => (feedEnabled ? feedLoadPlan(logPeriod.win, { today: todayET(), epoch: FEED_EPOCH, extra: feedExtra }) : null),
    [feedEnabled, logPeriod.win, feedExtra],
  );

  React.useEffect(() => {
    if (!loadPlan) return;
    if (!loadPlan.chunks.length) {
      setPeriodFeed({ status: "ready", days: new Map(), fills: [] });
      return;
    }
    const controller = new AbortController();
    let active = true;
    setPeriodFeed((f) => ({ ...f, status: "loading" }));
    (async () => {
      const days = new Map();
      const fills = [];
      for (const [i, [start, end]] of loadPlan.chunks.entries()) {
        const r = await fetchAttemptsRange(start, end, { signal: controller.signal, maxDays: FEED_CHUNK });
        if (!active) return;
        for (const [d, entry] of r.days) days.set(d, entry);
        fills.push(...(r.fills || []));
        // Each chunk shows as it lands, the most recent first.
        setPeriodFeed({
          status: i === loadPlan.chunks.length - 1 ? "ready" : "loading",
          days: new Map(days),
          fills: [...fills],
        });
      }
    })().catch((e) => {
      if (!active || e.name === "AbortError") return;
      setPeriodFeed({ status: "error", days: new Map(), fills: [] });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadPlan, feedNonce, periodNonce]);

  // A feed day's status (attemptsFeed.js DAY_STATUS_TEXT), or "not_loaded" for a feed
  // day nobody has asked for yet and "before_feed" for a day before it started.
  const statusOf = React.useCallback(
    (d) => periodFeed.days.get(d)?.status || (d < FEED_EPOCH ? "before_feed" : "not_loaded"),
    [periodFeed.days],
  );

  React.useEffect(() => {
    if (!feedEnabled) return;
    const controller = new AbortController();
    let active = true;
    setFeed((f) => ({ ...f, status: "loading", error: null }));
    fetchAttemptsForDay(feedDate, {
      derive: feedScan ? true : "auto",
      // CS's reason for each failure. Same board fetch detection already uses, so on
      // a day that detects it costs nothing; on a settled day it is the one fetch
      // that turns "UNPLANNED" into "closed when the driver got there".
      notes: true,
      signal: controller.signal,
    })
      .then((j) => {
        if (!active) return;
        setFeed({
          status: "ready",
          attempts: j.attempts || [],
          error: null,
          provisionalCount: j.provisionalCount || 0,
          carriedOver: j.carriedOver || 0,
          deriveError: j.deriveError || null,
          dayStatus: classifyDay(j, { date: feedDate }),
        });
      })
      .catch((e) => {
        if (!active || e.name === "AbortError") return;
        setFeed({
          status: "error",
          attempts: [],
          error: e.message || "Failed to load",
          provisionalCount: 0,
          deriveError: null,
          dayStatus: "failed",
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [feedEnabled, feedDate, feedNonce, feedScan]);

  // Saved driver-reassignments for a feed attempt (attributed "attempts" incidents
  // keyed to a stop). Their presence overrides the feed's driver and makes the
  // attempt count toward that driver in the scorecard/analytics. See
  // attemptReassign.js for why every stop on the order is checked.
  const overridesFor = (a, date = feedDate) => savedOverridesFor(a, date, incidents);
  const overrideFor = (a, date = feedDate) => overridesFor(a, date)[0];

  // Reassign (or clear) the driver an auto attempt is attributed to. Persists as
  // a manual "attempts" incident so the correction sticks and counts; the feed
  // row then shows the chosen driver.
  //
  // `date` is the attempt's own day — the period's Unassigned list reassigns
  // attempts from days other than the one the log is showing.
  // The result of the last reassign, repeated beside the order table and the Unassigned
  // list, where it was made — the intake card's message is a screen away from them.
  const [reassignNote, setReassignNote] = React.useState(null);
  async function reassignAuto(a, driverId, date = feedDate) {
    const drv = driverId ? drivers.find((d) => d.id === driverId) : null;
    if (driverId && !drv) {
      setSavedWarn(true);
      setSavedMsg("Reassign failed: that driver isn't on the roster any more.");
      setReassignNote({ warn: true, text: "Reassign failed: that driver isn't on the roster any more." });
      return;
    }
    const r = await reassignAttempt({
      order: a,
      date,
      driver: drv,
      incidents,
      save: saveIncident,
      remove: deleteIncident,
      onSaved,
    });
    if (r.error) {
      setSavedWarn(true);
      setSavedMsg(`Reassign failed: ${r.error}`);
      setReassignNote({ warn: true, text: `Reassign failed: ${r.error}` });
    } else if (r.pendingSync) {
      const text = `⚠ ${a.shipmentNbr || a.stopNbr} reassigned to ${drv.name} on THIS DEVICE only — not synced to the server yet. It will retry automatically; other people won't see it until it syncs.`;
      setSavedWarn(true);
      setSavedMsg(text);
      setReassignNote({ warn: true, text });
    } else {
      // The row shows the result; just don't leave an earlier failure up.
      setSavedWarn(false);
      setSavedMsg("");
      setReassignNote(
        driverId
          ? { warn: false, text: `${a.shipmentNbr || a.stopNbr} on ${fmtMDY(date)} is now charged to ${drv.name}.` }
          : null,
      );
    }
  }

  // Removes the whole attempt: every stop on the order, so its "-1" copy can't stay
  // behind and resurface as an Unassigned attempt of its own.
  async function deleteAuto(a) {
    const legs = (a.legRows || [a]).filter((l) => !l.provisional);
    const which =
      legs.length > 1 ? ` — both stops (${legs.map((l) => l.stopNbr).join(", ")})` : "";
    if (
      !window.confirm(
        `Remove auto-detected attempt ${a.shipmentNbr || a.stopNbr} (${a.originalDriverName || "Unknown"})?\n\nThis deletes it from the dispatch feed for ${fmtMDY(feedDate)}${which}.`,
      )
    )
      return;
    setFeedDeletingId(a.stopNbr);
    try {
      for (const l of legs) await deleteAttempt(feedDate, l.stopNbr);
      // Drop any reassignment we saved for this attempt so it isn't orphaned.
      for (const existing of overridesFor(a)) {
        await deleteIncident(existing.id);
        onSaved && onSaved({ type: "delete", id: existing.id });
      }
      setFeedNonce((n) => n + 1); // refetch
      setSavedWarn(false);
      setSavedMsg("");
    } catch (e) {
      setSavedWarn(true);
      setSavedMsg(`Auto-attempt delete failed: ${e.message}`);
    } finally {
      setFeedDeletingId(null);
    }
  }

  // Inline edit / delete of an existing log entry.
  const [editingId, setEditingId] = React.useState(null);
  const [editDriverId, setEditDriverId] = React.useState("");
  const [editDate, setEditDate] = React.useState("");
  const [editNotes, setEditNotes] = React.useState("");
  const [editClassify, setEditClassify] = React.useState("");
  const [rowBusy, setRowBusy] = React.useState(false);

  const buildReason = (value) =>
    value
      ? `${config.reasonLabel} — ${value} (manual entry)`
      : `${config.reasonLabel} (manual entry)`;

  function startEdit(inc) {
    setEditingId(inc.id);
    setEditDriverId(inc.driver_id || "");
    setEditDate(recordDate(inc));
    setEditNotes(inc.notes || "");
    setEditClassify(classifyField ? inc[classifyField] || "" : "");
  }
  function cancelEdit() {
    setEditingId(null);
    setRowBusy(false);
  }
  async function saveEdit(inc) {
    if (!editDriverId) return;
    setRowBusy(true);
    const drv = drivers.find((d) => d.id === editDriverId);
    try {
      // Light log records carry no photo bytes; re-attach the stored photos so the
      // save doesn't blank out has_photos / wipe the photos:{id} side of the blob.
      const { photo_urls, photo_meta } = await getIncidentPhotos(inc.id);
      const patch = {
        ...inc,
        driver_id: drv.id,
        driver_name: drv.name,
        delivered_date: editDate || inc.delivered_date,
        notes: editNotes,
        reason: buildReason(editClassify),
        photo_urls,
        photo_meta,
        updated_at: new Date().toISOString(),
      };
      if (classifyField) patch[classifyField] = editClassify;
      const saved = await saveIncident(patch);
      setSavedWarn(false);
      setSavedMsg(`Updated — ${inc.pro_number} now charged to ${drv.name}.`);
      setEditingId(null);
      onSaved && onSaved({ type: "upsert", incident: saved || patch });
    } catch (err) {
      setSavedWarn(true);
      setSavedMsg(`Update failed: ${err.message}`);
    } finally {
      setRowBusy(false);
    }
  }
  async function deleteEntry(inc) {
    if (
      !window.confirm(
        `Delete ${config.deleteNoun} entry ${inc.pro_number} (${inc.driver_name || "unknown driver"})? This cannot be undone.`,
      )
    )
      return;
    setRowBusy(true);
    try {
      await deleteIncident(inc.id);
      setSavedWarn(false);
      setSavedMsg(`Deleted — ${inc.pro_number} removed from the log.`);
      if (editingId === inc.id) setEditingId(null);
      onSaved && onSaved({ type: "delete", id: inc.id });
    } catch (err) {
      setSavedWarn(true);
      setSavedMsg(`Delete failed: ${err.message}`);
    } finally {
      setRowBusy(false);
    }
  }

  const logIncidents = React.useMemo(
    () =>
      incidents
        .filter((i) => i.category === config.category)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [incidents, config.category],
  );

  // Manual rows for the log. Reassignment overrides (attempt_stop_nbr set) are
  // shown on their auto row, not duplicated here (they still count in analytics).
  // On the feed-backed tab (Attempts), the log is a per-day view scoped to the
  // selected feed date. Elsewhere the log follows the analytics period selector
  // (logPeriod.win) so it matches the charts above it. A row is dated by
  // incidentDateStr, the day the Scorecard files it under: a report's trace or return
  // used to land on the day its report was loaded.
  const manualForView = React.useMemo(() => {
    const base = logIncidents.filter((i) => !i.attempt_stop_nbr);
    if (feedEnabled) return base.filter((i) => recordDate(i) === feedDate);
    return inWindow(base, logPeriod.win);
  }, [logIncidents, feedEnabled, feedDate, logPeriod.win]);

  // Which driver a manual row belongs to, for grouping / the summary.
  const driverNameOf = React.useCallback(
    (i) =>
      i.driver_name ||
      drivers.find((d) => d.id === i.driver_id)?.name ||
      i.driver_raw ||
      "Unassigned",
    [drivers],
  );
  // The key the by-driver chart, the focus and the printouts all share — the same one
  // an attempt record carries, so a bar, the log and a print can't disagree.
  const keyOf = recordKey;

  // Every attempt the loaded feed days hold, one record per order: the feed's auto
  // attempts plus hand-logged ones, from the one builder every screen counts attempts
  // with (see attemptRecords.js for the rules — -1/-2 duplicates folded into their
  // original, a saved reassignment winning, reassignment rows not counted twice).
  const attemptBuild = React.useMemo(
    () =>
      feedEnabled
        ? buildAttemptRecords({ feedDays: periodFeed.days, incidents, drivers })
        : null,
    [feedEnabled, periodFeed.days, incidents, drivers],
  );
  const feedRecords = React.useMemo(
    () => (attemptBuild ? attemptBuild.records.filter((r) => r.from_feed) : []),
    [attemptBuild],
  );

  // Nights the dispatch app's driver lookup could not finish (its 10-call limit, a
  // stop with no NuVizz id, a failed request), inside the period on screen.
  const fillFlagsInPeriod = React.useMemo(() => {
    const { start, end } = logPeriod.win;
    return fillFlags(periodFeed.fills).filter((f) => f.date >= start && f.date <= end);
  }, [periodFeed.fills, logPeriod.win]);
  const fillLeft = React.useMemo(() => fillLeftIndex(periodFeed.fills), [periodFeed.fills]);

  // The period's attempts that still have nobody, and why — so "Unassigned" on the
  // chart is a queue someone can work through, oldest first, rather than an
  // unexplained bar.
  const unassignedFeed = React.useMemo(() => {
    if (!feedEnabled) return { rows: [], byReason: {}, withLead: 0, copies: 0 };
    const { start, end } = logPeriod.win;
    const inWin = (d) => d && d >= start && d <= end;
    const today = todayET();
    const rows = sortQueue(
      feedRecords
        .filter((r) => inWin(r.delivered_date) && !r.driver_name)
        .map((r) => {
          const leadName = closedOutBy(r.order);
          return {
            ...r,
            why: unassignedReason(r.order) || "not_in_plan",
            leadName,
            lead: leadName ? matchDriver(leadName, drivers) : null,
            age: ageDays(r.delivered_date, today),
            // The nightly lookup's own report, when it could not read this one.
            fillLeft: fillLeft.get(`${r.delivered_date}|${r.order?.stopNbr}`) || null,
          };
        }),
    );
    const byReason = {};
    for (const r of rows) byReason[r.why] = (byReason[r.why] || 0) + 1;
    // Stops folded into another stop's attempt — what dispatch's own total counts
    // on top of ours.
    const copies = feedRecords
      .filter((r) => inWin(r.delivered_date))
      .reduce((n, r) => n + (r.order.legRows?.length || 1) - 1, 0);
    return { rows, byReason, withLead: rows.filter((r) => r.lead).length, copies };
  }, [feedEnabled, feedRecords, logPeriod.win, drivers, fillLeft]);

  // What the analytics panel counts. On the feed tab that's every attempt record
  // (auto plus hand-entered); elsewhere, the category's incidents.
  const analyticsRecords = React.useMemo(
    () => (attemptBuild ? attemptBuild.records : logIncidents),
    [attemptBuild, logIncidents],
  );

  // How much of the period the dispatch feed actually covers, for the line above
  // the analytics: a day it has no data for is named, never counted as a quiet day,
  // and the days not loaded yet are said as a count.
  const coverage = React.useMemo(() => {
    const { start, end } = logPeriod.win;
    const out = feedCoverage(periodFeed.days, start, end);
    const from = start > FEED_EPOCH ? start : FEED_EPOCH;
    out.notLoaded = loadPlan?.start && loadPlan.start > from ? dayDiff(from, loadPlan.start) : 0;
    // Days of the window before the feed started; only fetched days are in the map.
    const lastBefore = shiftDay(FEED_EPOCH, -1);
    out.beforeFeed = start < FEED_EPOCH ? dayDiff(start, end < lastBefore ? end : lastBefore) + 1 : 0;
    return out;
  }, [periodFeed.days, logPeriod.win, loadPlan]);

  // When the period has no feed data to count at all, every number in the panel is
  // the hand-logged attempts alone — so it says that, rather than a bare 0 over "No
  // records in this period" while the feed's ~100 attempts a month go unseen. Days the
  // feed couldn't be reached for are an outage, not a feed with nothing to say, and
  // are called one (`feedFailed`).
  //   feedGap  { why, empty } — `why` for a tile's hover, `empty` for an empty panel
  const feedFailed =
    feedEnabled &&
    (periodFeed.status === "error" ||
      (periodFeed.status === "ready" &&
        coverage.loaded === 0 &&
        (coverage.noData.length > 0 || coverage.todayFailed) &&
        coverage.noData.every((d) => d.status === "failed")));
  const feedGap = React.useMemo(() => {
    if (!feedEnabled || periodFeed.status === "loading" || periodFeed.status === "idle")
      return null;
    const why = feedFailed
      ? "Couldn't reach the dispatch feed for this period"
      : coverage.of > 0 && coverage.loaded === 0
        ? "The dispatch feed has no data for this period"
        : coverage.of === 0 && (coverage.pending || coverage.todayFailed)
          ? "Today's 8 PM scan hasn't run yet"
          : coverage.of === 0 && logPeriod.win.end < FEED_EPOCH
            ? `This period is before the dispatch feed started (${fmtMDY(FEED_EPOCH)})`
            : null;
    return why
      ? { why: `${why} — only hand-logged attempts are counted.`, empty: `${why} — only hand-logged attempts are counted, and none were logged.` }
      : null;
  }, [feedEnabled, periodFeed.status, coverage, logPeriod.win, feedFailed]);
  // The period's feed is still on its way and none of its days are in yet: what the
  // tiles would count is the hand-logged attempts alone, which isn't the period's number.
  const feedPending =
    feedEnabled &&
    (periodFeed.status === "loading" || periodFeed.status === "idle") &&
    ![...periodFeed.days.keys()].some((d) => d >= logPeriod.win.start && d <= logPeriod.win.end);

  // The drill-down drawer counts a tile's orders from these same records, once the
  // period has loaded (AnalyticsProvider). Taken back when the tab closes, so a drawer
  // never counts from a copy nobody is keeping fresh. A period the feed couldn't be
  // read for publishes what there is — the hand-logged attempts — and says why, so a
  // drawer shows the failure instead of waiting for orders that aren't coming.
  const { publishAttempts } = analytics;
  React.useEffect(() => {
    if (!feedEnabled) return;
    if (periodFeed.status === "ready" || periodFeed.status === "error") {
      publishAttempts(attemptBuild.records, { error: feedFailed ? "couldn't reach the feed" : null });
    } else {
      publishAttempts(null);
    }
  }, [feedEnabled, periodFeed.status, attemptBuild, feedFailed, publishAttempts]);
  React.useEffect(() => (feedEnabled ? () => publishAttempts(null) : undefined), [feedEnabled, publishAttempts]);

  // ── The panel: the period's records (R), the picked driver's (F), and every number
  // drawn from them (manualAnalytics.js). On the feed tab R includes the reassignment
  // rows' orders under the driver they were reassigned to, since that is where an auto
  // attempt's driver lives.
  const hidden = React.useMemo(() => hiddenDriverIds(drivers), [drivers]);
  const periodRows = React.useMemo(
    () => inWindow(analyticsRecords, logPeriod.win),
    [analyticsRecords, logPeriod.win],
  );
  const focusRows = React.useMemo(
    () => (focus ? periodRows.filter((r) => keyOf(r) === focus) : periodRows),
    [periodRows, focus, keyOf],
  );
  // Deactivated drivers are left out of this chart — it's "who am I managing", not a
  // record of the period. Their rows stay in the log and in every count, said as a
  // footnote.
  const byDriver = React.useMemo(
    () => buildByDriver(periodRows, { hidden, nameOf: driverNameOf }),
    [periodRows, hidden, driverNameOf],
  );
  const focusChoices = React.useMemo(
    () =>
      buildFocusOptions(periodRows, {
        drivers,
        nameOf: driverNameOf,
        nameNote: feedEnabled ? "feed name" : "no roster match",
      }),
    [periodRows, drivers, driverNameOf, feedEnabled],
  );
  const focusLabel = focus
    ? focusChoices.find((o) => o.key === focus)?.name || nameOfKey(analytics.people, focus)
    : "";
  const today = todayET();
  const weekday = React.useMemo(() => weekdaySeries(periodRows, focus), [periodRows, focus]);
  const trend = React.useMemo(
    () => trendSeries(periodRows, logPeriod.win, { focus, today, statusOf: feedEnabled ? statusOf : null }),
    [periodRows, logPeriod.win, focus, today, feedEnabled, statusOf],
  );
  const classes = React.useMemo(() => classBreakdown(focusRows, classifyField), [focusRows, classifyField]);
  const outcome = React.useMemo(() => (feedEnabled ? outcomeMix(focusRows) : null), [feedEnabled, focusRows]);
  const attTiles = React.useMemo(
    () =>
      feedEnabled
        ? attemptTiles({ rows: periodRows, records: analyticsRecords, win: logPeriod.win, focus, hidden, statusOf, today })
        : null,
    [feedEnabled, periodRows, analyticsRecords, logPeriod.win, focus, hidden, statusOf, today],
  );
  // Months of the window this tab can't list because they exist only as monthly
  // totals in imported history: said in one line, rather than the panel quietly
  // understating them. Unable to Track isn't in history, so it never has any.
  const historyOnly = React.useMemo(() => {
    if (!COUNTED8.includes(config.category) || analytics.historyLoading || analytics.historyError) return [];
    const blend = analytics.blend(null);
    const out = [];
    for (let ym = logPeriod.win.start.slice(0, 7); ym <= logPeriod.win.end.slice(0, 7); ym = shiftYm(ym, 1)) {
      const n = blend.isLive(ym) ? 0 : blend.companyCell(ym, config.category);
      if (n > 0) out.push({ ym, n });
    }
    return out;
  }, [config.category, analytics, logPeriod.win]);

  const historyMonths = React.useMemo(() => new Map(historyOnly.map((m) => [m.ym, m.n])), [historyOnly]);

  // The order table on the feed tab: the picked driver's orders (or everyone's),
  // narrowed by whatever a chart click set, then searched and sorted — the rows on
  // screen, which is exactly what Print prints.
  const tableRows = React.useMemo(
    () => (feedEnabled ? applyChips(focusRows, chips) : []),
    [feedEnabled, focusRows, chips],
  );
  const tableVisible = React.useMemo(
    () => visibleOrders(tableRows, { query: orderQuery, sort: orderSort }),
    [tableRows, orderQuery, orderSort],
  );
  const patterns = React.useMemo(
    () => (feedEnabled ? customerPatterns(analyticsRecords) : null),
    [feedEnabled, analyticsRecords],
  );
  const lateIndex = React.useMemo(() => (feedEnabled ? lateByPro(incidents) : null), [feedEnabled, incidents]);

  // Free-text search, the picked driver and any chart chip, over the manual rows. On
  // the feed tab the log is one day and the chips belong to the order table instead.
  const filteredLog = React.useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    const base = feedEnabled ? manualForView : applyChips(manualForView, chips, { classifyField });
    return base.filter((i) => {
      if (focus && keyOf(i) !== focus) return false;
      if (!q) return true;
      return [
        i.pro_number,
        i.driver_name,
        i.customer,
        classifyField ? i[classifyField] : "",
        i.notes,
        fmtMDY(recordDate(i)),
        fmtMDY(i.created_at),
      ].some((f) => String(f || "").toLowerCase().includes(q));
    });
  }, [manualForView, logSearch, classifyField, focus, keyOf, feedEnabled, chips]);

  // filteredLog grouped under driver-name headers (only used when groupByDriver).
  const logGroups = React.useMemo(() => {
    const m = new Map();
    for (const i of filteredLog) {
      const name = driverNameOf(i);
      if (!m.has(name)) m.set(name, []);
      m.get(name).push(i);
    }
    return [...m.entries()]
      .map(([name, rows]) => ({ name, rows }))
      .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  }, [filteredLog, driverNameOf]);

  // What Print prints: exactly the rows on screen — the order table on the feed tab,
  // the log elsewhere. Print all makes one handout per driver from those rows, in the
  // by-driver chart's order; deactivated drivers are already absent from it, so they're
  // not printed — and, per the same rule, no total on screen changes because of that.
  const printable = feedEnabled ? tableVisible : filteredLog;
  const printTargets = React.useMemo(
    () =>
      byDriver.rows
        .map((row) => ({ row, entries: printable.filter((i) => keyOf(i) === row.key) }))
        .filter((t) => t.entries.length),
    [byDriver, printable, keyOf],
  );
  // The printed tally: the classification on an incident tab; on Attempts, what
  // happened after each one.
  const printBreakdown = feedEnabled
    ? { label: "After the attempt", of: (r) => (r.outcome ? OUTCOME_LABEL[r.outcome] : "Hand-logged") }
    : null;

  // What narrowed the rows on screen past the period and the driver: the chips a chart
  // click set, and the search. A printout names them (printPeriodLabel).
  const printQuery = (feedEnabled ? orderQuery : logSearch).trim();
  const narrowing = [...Object.values(chips).map((c) => c.label), printQuery ? `matching “${printQuery}”` : null];
  // A driver's whole count for the period, for "6 of 10".
  const periodCountOf = (key) => periodRows.filter((r) => keyOf(r) === key).length;

  // Build a handout PDF for the picked driver: the rows on screen for them, over the
  // period the charts are showing.
  async function printDriverReport() {
    if (!focus) return;
    const entries = printable.filter((i) => keyOf(i) === focus);
    if (!entries.length) {
      alert("Nothing on screen for that driver to print.");
      return;
    }
    setPrinting("one");
    setPrintProgress({ done: 0, total: 0 });
    try {
      const { win } = logPeriod;
      const rangeText =
        win?.start && win?.end ? `${fmtMDY(win.start)} – ${fmtMDY(win.end)}` : "";
      const of = periodCountOf(focus);
      const periodLabel = printPeriodLabel(logPeriod.label, { narrowing, shown: entries.length, of });
      const doc = await generateDriverReport({
        driverName: focusLabel || driverNameOf(entries[0]),
        entries,
        config,
        periodLabel,
        rangeText,
        breakdown: printBreakdown,
        periodTotal: of,
        onProgress: ({ done, total }) => setPrintProgress({ done, total }),
      });
      doc.save(driverReportFilename(focusLabel || "driver", config.heading, periodLabel));
    } catch (err) {
      alert("Could not build the report: " + (err?.message || err));
    } finally {
      setPrinting(false);
      setPrintProgress({ done: 0, total: 0 });
    }
  }

  // One PDF holding every driver's handout from the rows on screen, in the order the
  // by-driver chart shows them. Each driver starts on a fresh page and keeps its own
  // page numbering, so the pack prints once and splits cleanly into handouts.
  async function printAllDriverReports() {
    const targets = printTargets;
    if (!targets.length) {
      alert("Nothing on screen to print.");
      return;
    }
    setPrinting("all");
    setPrintProgress({ done: 0, total: targets.length });
    try {
      const { win } = logPeriod;
      const rangeText =
        win?.start && win?.end ? `${fmtMDY(win.start)} – ${fmtMDY(win.end)}` : "";
      let doc = null;
      for (const [i, t] of targets.entries()) {
        const of = periodCountOf(t.row.key);
        // Feeding the previous doc back in appends this driver to the same file.
        doc = await generateDriverReport({
          driverName: t.row.name,
          entries: t.entries,
          config,
          periodLabel: printPeriodLabel(logPeriod.label, { narrowing, shown: t.entries.length, of }),
          rangeText,
          breakdown: printBreakdown,
          periodTotal: of,
          doc,
        });
        setPrintProgress({ done: i + 1, total: targets.length });
      }
      doc.save(allDriversReportFilename(config.heading, printPeriodLabel(logPeriod.label, { narrowing })));
    } catch (err) {
      alert("Could not build the report: " + (err?.message || err));
    } finally {
      setPrinting(false);
      setPrintProgress({ done: 0, total: 0 });
    }
  }

  // The day's auto attempts, one per order — the original stop and dispatch's "-1"
  // copy are one failure (see attemptLegs.js). Stamped with the day so a provisional
  // leg groups with its settled sibling.
  const feedOrders = React.useMemo(
    () =>
      feedEnabled
        ? groupAttemptLegs(feed.attempts.map((a) => ({ ...a, date: feedDate })))
        : [],
    [feedEnabled, feed.attempts, feedDate],
  );

  // Same search applied to the auto (feed) rows — by PRO/driver/customer/route/stop —
  // and the same picked driver, keyed by the driver the order is counted under (a
  // saved reassignment included), so a bar's count and the day's rows agree.
  const feedDayKeys = React.useMemo(() => {
    if (!feedEnabled) return new Map();
    const overrides = overrideIndex(incidents);
    return new Map(
      feedOrders.map((a) => [a, keyOf(feedRecord(a, { overrides, drivers }))]),
    );
  }, [feedEnabled, feedOrders, incidents, drivers, keyOf]);
  const filteredFeed = React.useMemo(() => {
    if (!feedEnabled) return [];
    const q = logSearch.trim().toLowerCase();
    const forDriver = focus
      ? feedOrders.filter((a) => feedDayKeys.get(a) === focus)
      : feedOrders;
    if (!q) return forDriver;
    return forDriver.filter((a) =>
      [
        a.shipmentNbr,
        ...a.legRows.map((l) => l.stopNbr),
        a.originalDriverName,
        a.originalDriverUserName,
        a.businessName,
        a.city,
        a.state,
        a.routeName,
      ].some((f) => String(f || "").toLowerCase().includes(q)),
    );
  }, [feedEnabled, feedOrders, feedDayKeys, focus, logSearch]);

  async function doPull() {
    const p = normalizeOrderId(pro);
    if (!p) {
      setPull({ error: "Enter a PRO or tracking number." });
      return;
    }
    setPulling(true);
    setPull(null);
    setSavedMsg("");
    try {
      const res = await fetchStopData(p);
      setPull({ ...res, pro: p });
      const auto = matchDriver(res?.stop?.driverName, drivers);
      setDriverId(auto ? auto.id : "");
      // Date intentionally left as the batch date (see incidentDate) — it is not
      // pulled from NuVizz so a day's entries all land on the chosen/today date.
    } catch (err) {
      setPull({ error: err.message || "Pull failed", pro: p });
    } finally {
      setPulling(false);
    }
  }

  // Picking the divert option turns this entry into a different kind of record: its
  // own category, no fault, and a driver that may be unknown.
  const diverted = !!(config.divert && classifyValue === config.divert.option);
  const driverOptional = !!config.driverOptional || (diverted && config.divert.allowNoDriver);
  const saveCategory = diverted ? config.divert.category : config.category;

  async function doSave() {
    if (!pull) return;
    if (!driverId && !driverOptional) return;
    // Flag a duplicate PRO before saving: list who it's already charged to and the
    // date(s) it was logged under, then confirm whether to add it again.
    const dups = incidents.filter(
      (i) => i.category === saveCategory && i.pro_number === pull.pro,
    );
    if (dups.length) {
      const lines = dups
        .map(
          (d) =>
            `  • ${d.driver_name || "a driver"} — ${fmtMDY(d.delivered_date || d.created_at)}`,
        )
        .join("\n");
      const proceed = window.confirm(
        `PRO ${pull.pro} is already logged as ${config.recordNoun}` +
          (dups.length > 1 ? ` ${dups.length} times` : "") +
          `:\n${lines}\n\nAdd it again anyway?`,
      );
      if (!proceed) return;
    }
    setSaving(true);
    setSavedMsg("");
    const drv = drivers.find((d) => d.id === driverId);
    const s = pull.stop || {};
    const now = new Date().toISOString();
    // The batch date (defaults to today, sticky between entries) is what every
    // entry is logged under; falls back to today if somehow cleared.
    const delivered = incidentDate || now.slice(0, 10);
    const photos = (pull.photos || []).map((p) => p.dataUri || p.url).filter(Boolean);
    const incident = {
      id: `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      pro_number: pull.pro,
      category: saveCategory,
      fault: diverted ? "" : config.fault ?? "driver",
      no_fault: false,
      driver_id: drv?.id || "",
      driver_name: drv?.name || "",
      driver_raw: s.driverName || drv?.name || "",
      nuvizz_driver_id: s.driverId || null,
      nuvizz_load_nbr: s.loadNbr || null,
      nuvizz_vehicle: s.vehicleNbr || null,
      customer: s.to?.name || "",
      to_city: s.to?.city || "",
      to_state: s.to?.state || "",
      zip_code: s.to?.zip || "",
      delivered_date: delivered,
      reason: diverted
        ? `${config.divert.reasonLabel} (manual entry)`
        : buildReason(classifyValue),
      notes: notes || "",
      sources: [],
      report_id: null,
      manual_entry: true,
      photo_urls: photos,
      has_photos: photos.length > 0,
      photo_count: photos.length,
      created_at: now,
      ingested_at: now,
    };
    if (classifyField) incident[classifyField] = classifyValue;
    try {
      const saved = await saveIncident(incident);
      if (saved && saved._pendingSync) {
        // The write never reached the server — say so plainly instead of a
        // false green "Saved", so it can't silently go missing for others.
        setSavedWarn(true);
        setSavedMsg(
          `⚠ ${pull.pro} saved on THIS DEVICE only — not synced to the server. Check your connection and that you're on the real site URL. It will retry automatically; other people won't see it until it syncs.`,
        );
      } else {
        setSavedWarn(false);
        const who = drv ? `charged to ${drv.name}` : "logged with no driver";
        // A diverted entry does NOT appear in this tab's log — say where it went, or
        // it reads as a save that vanished.
        const where = diverted ? ' — find it under "Unable to Track"' : "";
        setSavedMsg(
          saved?.photos_dropped_oversize
            ? `Saved — ${pull.pro} ${who} under ${fmtMDY(delivered)}, but its ${photos.length} photo${photos.length === 1 ? "" : "s"} were too large to store${where}.`
            : `Saved — ${pull.pro} ${who} under ${fmtMDY(delivered)} (${photos.length} photo${photos.length === 1 ? "" : "s"})${where}.`,
        );
      }
      // Jump the log view to the date just logged so the new entry is visible.
      if (feedEnabled) setFeedDate(delivered);
      setPull(null);
      setPro("");
      setNotes("");
      setDriverId("");
      setClassifyValue("");
      onSaved && onSaved({ type: "upsert", incident: saved || incident });
    } catch (err) {
      setSavedWarn(true);
      setSavedMsg(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const matched = drivers.find((d) => d.id === driverId);
  const s = pull?.stop;
  // Existing log entries for the pulled PRO — surfaced as a heads-up in the preview.
  const existingForPro = pull
    ? incidents.filter(
        (i) => i.category === config.category && i.pro_number === pull.pro,
      )
    : [];

  const feedRows = feedOrders;

  // Hand-logged rows on this day that the feed has too — same PRO, same day. The
  // period counts each once, as the feed order (attemptRecords.js), so the log tags
  // the hand-logged row and leaves it out of the day's count rather than disagree
  // with the charts by one.
  const handOnFeed = React.useMemo(() => {
    if (!feedEnabled) return new Map();
    const index = feedOrderIndex(feedOrders);
    const m = new Map();
    for (const i of manualForView) {
      const o = feedOrderFor(i, index);
      if (o) m.set(i.id, o);
    }
    return m;
  }, [feedEnabled, feedOrders, manualForView]);

  // Open an attempt in the detail modal with every stop on its order. A duplicate
  // order (-1/-2) listed without its original opens as itself: its original has
  // nothing to do with it (Chad, 2026-10-01), so its history is not pulled in.
  const openAttempt = (a) => setStopDetail({ row: a, legs: a.legRows || [a] });
  // Counts for the current view. On the feed-backed tab everything is scoped to
  // the selected day (manualForView is already date-filtered); elsewhere it's the
  // all-time manual total.
  const manualCounted = manualForView.length - handOnFeed.size;
  const totalOnRecord = manualCounted + feedRows.length;
  // A day the feed has no data for (or that is before it, or whose request failed)
  // must not read as "0 auto" in the heading.
  const feedDayMissing =
    feedEnabled &&
    (feed.status === "error" ||
      (feed.status === "ready" &&
        (NO_DATA_STATUSES.has(feed.dayStatus) || feed.dayStatus === "before_feed")));
  const totalShown = filteredLog.length + filteredFeed.length;
  const allTimeManual = logIncidents.filter((i) => !i.attempt_stop_nbr).length;

  const driverOptions = drivers
    .slice()
    .sort(
      (a, b) =>
        (a.active === false ? 1 : 0) - (b.active === false ? 1 : 0) ||
        a.name.localeCompare(b.name),
    )
    .map((d) => (
      <option key={d.id} value={d.id}>
        {d.name}
        {d.role === "loader" ? " (loader)" : ""}
        {d.active === false ? " (inactive)" : ""}
      </option>
    ));

  // Inline edit form for a log entry (shared by the feed and non-feed layouts).
  const renderEditRow = (inc) =>
    editingId === inc.id ? (
      <div className="ff-edit-row" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="dd-k">Charge to driver</div>
          <select value={editDriverId} onChange={(e) => setEditDriverId(e.target.value)}>
            <option value="">— Select driver —</option>
            {driverOptions}
          </select>
        </div>
        <div>
          <div className="dd-k">Incident date</div>
          <input
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            style={{ fontFamily: "var(--mono)" }}
          />
        </div>
        {config.classify && (
          <div>
            <div className="dd-k">{config.classify.label}</div>
            <select value={editClassify} onChange={(e) => setEditClassify(e.target.value)}>
              <option value="">{config.classify.placeholder}</option>
              {config.classify.options.map((it) => (
                <option key={it} value={it}>
                  {it}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div className="dd-k">Notes</div>
          <input
            type="text"
            placeholder="Optional notes…"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
          />
        </div>
        <button
          className="btn primary"
          onClick={() => saveEdit(inc)}
          disabled={!editDriverId || rowBusy}
        >
          {rowBusy ? "Saving…" : "Save Changes"}
        </button>
        <button className="btn ghost" onClick={cancelEdit} disabled={rowBusy}>
          Cancel
        </button>
      </div>
    ) : null;

  // Actions cell (Edit / Delete), shared by both layouts.
  const renderRowActions = (inc) => (
    <span className="ff-row-actions" onClick={(e) => e.stopPropagation()}>
      <button
        className="btn ghost sm"
        onClick={() => (editingId === inc.id ? cancelEdit() : startEdit(inc))}
        title="Edit this entry"
      >
        {editingId === inc.id ? "Close" : "Edit"}
      </button>
      <button
        className="btn ghost sm"
        onClick={() => deleteEntry(inc)}
        disabled={rowBusy}
        title="Delete this entry"
        style={{ color: "var(--accent-red)" }}
      >
        Delete
      </button>
    </span>
  );

  // A row opens its driver's record: every counted category over all time and this
  // year, from the same blend as the Scorecard (it used to be a popup of live rows only,
  // with none of the driver's imported history), opened on this tab's category. An entry
  // with no driver has no record to open.
  //
  // Unable to Track counts toward nothing, so the blend has none of it: that tab opens
  // the driver's own Unable to Track entries as a plain list instead, the row clicked
  // among them, with nothing framed as a failure.
  const driverStateFor = (inc) => {
    if (!inc.driver_id) return null;
    if (!COUNTED8.includes(config.category)) {
      return {
        spec: {
          kind: "incidents",
          driverId: inc.driver_id,
          categoryIds: [config.category],
          ids: incidents.filter((i) => i.driver_id === inc.driver_id && i.category === config.category).map((i) => i.id),
        },
      };
    }
    const year = todayET().slice(0, 4);
    return driverDrill(
      inc.driver_id,
      {
        categoryIds: COUNTED8,
        scopes: [
          { label: "All time", months: analytics.blend(null).months },
          { label: `YTD ${year}`, months: monthsOfYear(Number(year)) },
        ],
      },
      { category: config.category },
    );
  };
  const openDriver = (inc) => {
    const state = driverStateFor(inc);
    if (state) openDrill(state);
  };
  // A row's driver name opens the same record (DriverLink), so the name reads as the
  // way in; a row with no driver id shows its name as plain text.
  const driverCell = (inc) => (
    <DriverLink id={inc.driver_id || null} drill={driverStateFor(inc)} className="ff-cell-link">
      {inc.driver_name || inc.driver_raw || "—"}
    </DriverLink>
  );

  // Aligned, column-headed row for the non-feed log (Forgotten Freight, etc.).
  const gridClass = `ff-log-grid ${classifyField ? "has-item" : ""}`;
  const renderManualRow = (inc) => (
    <div key={inc.id} className="ff-log-entry">
      <div className={`${gridClass} ff-log-row`} onClick={() => openDriver(inc)}>
        <span className="pro-num">{inc.pro_number}</span>
        <span className="ff-cell-ellipsis" title={driverNameOf(inc)}>
          {driverCell(inc)}
        </span>
        <span className="ff-cell-ellipsis ff-cell-muted" title={inc.customer || ""}>
          {inc.customer || "—"}
        </span>
        {classifyField && (
          <span>
            {inc[classifyField] ? (
              <span className="ff-item-chip">{inc[classifyField]}</span>
            ) : (
              <span className="ff-cell-muted">—</span>
            )}
          </span>
        )}
        <span className="ff-cell-date">{fmtIncidentDate(inc)}</span>
        <span className="ff-cell-date">{fmtMDY(inc.created_at)}</span>
        <span className="ff-cell-photo" title={inc.has_photos ? "Has photo" : ""}>
          {inc.has_photos ? "📸" : ""}
        </span>
        {renderRowActions(inc)}
      </div>
      {renderEditRow(inc)}
    </div>
  );

  // ── What the panel draws ───────────────────────────────────────────────────────
  const logRef = React.useRef(null);
  const noun = feedEnabled ? "attempts" : "entries";
  // Unable to Track records a lookup nobody could attribute: nothing about it is a
  // failure, so it gets no rank and no "worst" framing.
  const neutral = config.category === UNABLE_TO_TRACK;
  // An Attempts drawer is stamped with the data on screen when it's clicked: the
  // period's orders may still be loading, and what arrives after the click is the data
  // moving, not the drawer disagreeing with the tile (drill.js drillVerdict). Entry
  // tabs count incidents, which are already in when their tiles are drawn.
  const openTileDrill = (spec, expected) =>
    openDrill(feedEnabled ? { spec, expected, at: analytics.dataStamp } : { spec, expected });
  const drillTile = (t) => (t ? () => openTileDrill(t.drill, t.expected) : null);
  const rankInfo = attTiles ? attTiles.rank : focusRank(periodRows, focus, { hidden });
  const rankText = rankInfo.rank ? `${rankInfo.tied ? "tied " : ""}${ordinal(rankInfo.rank)}` : "—";
  const rankWhy = {
    unassigned: "Unassigned isn't a driver",
    unmatched: "not on the roster, so not ranked",
    none: `no ${noun} this period`,
  };
  const detailState = focus
    ? feedEnabled
      ? { spec: attTiles.orders.drill, expected: attTiles.orders.expected, at: analytics.dataStamp }
      : entriesDrill(periodRows, focus, { category: config.category, who: focusLabel, label: logPeriod.label })
    : null;
  // A tile that splits by driver or hides deactivated ones needs the roster: with its
  // read failed and no earlier copy, it says so rather than counting everyone as an
  // active driver (RosterGate). Totals don't need it and stay.
  const rosterTile = (tile) =>
    rosterBlocked
      ? { ...tile, value: "—", sub: "needs the roster", title: `The driver roster couldn't be read (${rosterBlocked.message || "error"}).`, onClick: null }
      : tile;

  let tiles;
  if (attTiles) {
    const t = attTiles;
    const d = t.orders.delta;
    const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
    const deltaText = !d
      ? null
      : d.delta === null
        ? `— vs previous ${d.days} days`
        : `${sign(d.delta)} vs previous ${d.days} days${d.throughYesterday ? " to yesterday" : ""}`;
    const deltaWhy = {
      not_loaded: "The previous days aren't loaded: use “Load earlier days for the comparison” under the period.",
      no_data: "Some of the previous days have no feed data, so the two wouldn't compare like with like.",
      before_feed: "The previous days are before the dispatch feed started.",
      window_not_loaded: "Not all of this period is loaded yet: use “Load 45 earlier days” under the period.",
    };
    // With no feed data to count (feedGap), a tile's 0 isn't a count of anything: it
    // reads "—" with the reason, and opens nothing. A number it does have is the
    // hand-logged attempts', and says so. While the period is still on its way, every
    // tile waits.
    // (A tile that opens nothing drops its "Click for …" from the hover.)
    const inert = (title) => title.replace(/\s*Click[^.\n]*\.|\nNo change shown:[^\n]*/g, "");
    const feedTile = (tile, n) =>
      feedPending
        ? { ...tile, value: "…", sub: "loading the period", title: "Loading the period from the dispatch feed…", onClick: null }
        : feedGap && !n
          ? { ...tile, value: "—", sub: "no feed data", title: `${feedGap.why}\n${inert(tile.title)}`, onClick: null }
          : feedGap
            ? { ...tile, sub: "hand-logged only", title: `${feedGap.why}\n${tile.title}` }
            : tile;
    tiles = [
      feedTile(
        {
          label: feedGap ? "Hand-logged only" : "Attempted orders",
          value: t.orders.value,
          sub: [focus ? `of ${t.orders.fleet} fleet` : null, deltaText].filter(Boolean).join(" · ") || null,
          title:
            "Orders attempted in the period: one per shipment per day, -1/-2 duplicates counted once with the original. Click for the orders." +
            (d && d.delta === null ? `\nNo change shown: ${deltaWhy[d.reason] || ""}` : ""),
          onClick: drillTile(t.orders),
        },
        t.orders.value,
      ),
      rosterTile(
        focus
          ? feedTile(
              {
                label: "Rank",
                value: rankText,
                sub: rankInfo.rank ? `of ${rankInfo.of} drivers` : rankWhy[rankInfo.reason],
                title: "Among drivers with at least one attempt this period (Unassigned and unmatched feed names aren't ranked). Click for every driver's count.",
                onClick: drillTile(t.rank),
              },
              rankInfo.rank || 0,
            )
          : feedTile(
              {
                label: "Drivers with attempts",
                value: rankInfo.drivers,
                sub: "Unassigned and unmatched names aside",
                title: "Roster drivers with at least one attempt this period. Click for every driver's count.",
                onClick: drillTile(t.rank),
              },
              rankInfo.drivers,
            ),
      ),
      feedTile(
        {
          label: "Busiest workday",
          value: t.busiest ? t.busiest.label : "—",
          sub: t.busiest ? `${t.busiest.count} attempt${t.busiest.count === 1 ? "" : "s"}` : null,
          title: "The weekday with the most attempts. Click for those orders.",
          onClick: drillTile(t.busiest),
        },
        t.busiest ? t.busiest.count : 0,
      ),
      feedTile(
        {
          label: "Per active day",
          value: t.perDay.days ? t.perDay.value.toFixed(1) : "0",
          sub: `${t.perDay.days} day${t.perDay.days === 1 ? "" : "s"} with attempts`,
          title: "Attempts per day that had any. Click for the orders.",
          onClick: drillTile(t.perDay),
        },
        t.perDay.days,
      ),
      feedTile(
        {
          label: "Repeat-customer orders",
          value: t.repeat.value,
          sub: "same customer twice or more",
          title: "Orders at a customer that comes up at least twice in these orders. Click for them.",
          onClick: drillTile(t.repeat),
        },
        t.repeat.value,
      ),
      focus
        ? feedTile(
            {
              label: "Still open at scan",
              value: t.open.value,
              sub: "rescheduled or still unplanned",
              title: "Orders the 8 PM scan saw rescheduled or still unplanned. Click for them.",
              onClick: drillTile(t.open),
            },
            t.open.value,
          )
        : feedTile(
            {
              label: "Unassigned",
              value: t.open.value,
              sub: "no driver yet",
              title: "Orders with no driver. Click for them; the Unassigned list below assigns them.",
              onClick: drillTile(t.open),
            },
            t.open.value,
          ),
    ];
  } else {
    const top = busiest(weekday);
    const per = perActiveDay(focusRows);
    const leader = topDriver(periodRows, { hidden, nameOf: driverNameOf });
    const group = focus && drivers.find((x) => x.id === focus)?.role === "loader" ? "loader" : "driver";
    const mean = rosterBlocked ? null : fleetMean(periodRows, { drivers, group });
    // Unable to Track is not something a driver does, so it gets no per-driver benchmark.
    // The mean is over the active roster drivers (or loaders) in the group, and counts
    // only the entries charged to one of them.
    const meanText =
      mean && !neutral ? `mean ${mean.mean.toFixed(mean.mean < 1 ? 2 : 1)} per active ${group}` : null;
    const meanWhy =
      meanText && mean.counted < periodRows.length
        ? ` It counts the ${mean.counted} entries charged to one of the ${mean.peers} active roster ${group}s; the other ${periodRows.length - mean.counted} (${group === "loader" ? "drivers'" : "loaders'"}, deactivated drivers', unassigned, names not on the roster) aren't in it.`
        : meanText
          ? ` It counts the entries charged to the ${mean.peers} active roster ${group}s.`
          : "";
    const meanSub = rosterBlocked && !neutral ? "fleet mean needs the roster" : meanText;
    const drillRows = (rows, label) => () =>
      openDrill(
        entriesDrill(rows, focus, {
          category: config.category,
          who: focusLabel,
          label: label ? `${logPeriod.label} · ${label}` : logPeriod.label,
        }),
      );
    tiles = [
      {
        label: focus ? "Total" : "Total this period",
        value: focusRows.length,
        sub: focus ? [`of ${periodRows.length}`, meanText && `fleet ${meanText}`].filter(Boolean).join(" · ") : meanSub,
        title: `Entries in the period, by the date each is filed under.${meanWhy} Click for the entries.`,
        onClick: drillRows(periodRows),
      },
      {
        label: "Busiest workday",
        value: top ? top.label : "—",
        sub: top ? `${top.count} entr${top.count === 1 ? "y" : "ies"}` : null,
        title: "The weekday with the most entries. Click for them.",
        onClick: top ? drillRows(periodRows.filter((r) => weekdayOfYmd(recordDate(r)) === top.wd), WEEKDAY_PLURAL[top.wd]) : null,
      },
      {
        label: "Avg / active day",
        value: per.days ? per.value.toFixed(1) : "0",
        sub: `${per.days} day${per.days === 1 ? "" : "s"} with entries`,
        title: "Entries per day that had any. Click for the entries.",
        onClick: drillRows(periodRows),
      },
      rosterTile({
        label: config.leaderLabel,
        value: leader ? `${leader.name} (${leader.count})` : "—",
        title: "The fleet's most, deactivated drivers and entries with no driver aside.",
      }),
      rosterTile(
        neutral
          ? {
              label: "Drivers named",
              value: byDriver.rows.filter((r) => r.key !== "unassigned").length,
              sub: "on an entry this period",
            }
          : focus
            ? {
                label: "Rank",
                value: rankText,
                sub: rankInfo.rank ? `of ${rankInfo.of} drivers` : rankWhy[rankInfo.reason],
                title: "Among drivers with at least one entry this period (Unassigned and names not on the roster aren't ranked).",
              }
            : {
                label: "Drivers with entries",
                value: rankInfo.drivers,
                sub: "on the roster",
              },
      ),
    ];
  }

  // The inline driver card under the Drivers chart.
  let card = null;
  if (focus) {
    // Read from the key itself, so a focus with nothing in this period (a link, a
    // period changed under it) is still described right.
    const onRoster = drivers.find((x) => x.id === focus);
    const sub =
      focus === "unassigned"
        ? `${feedEnabled ? "ORDERS" : "ENTRIES"} WITH NO DRIVER`
        : focus.startsWith("name:")
          ? `${feedEnabled ? "FEED NAME" : "NAME ON THE ENTRY"} · ${focusChoices.find((o) => o.key === focus)?.linked ? "NOT LINKED TO THE ROSTER" : "NO ROSTER MATCH"}`
          : !onRoster
            ? "NOT ON THE ROSTER"
            : `${(onRoster.role || "driver").toUpperCase()} · ${logPeriod.label}`;
    // On Attempts with no feed data to count, a 0 here would be the outage, not the driver.
    const count = feedPending ? "…" : feedGap && !focusRows.length ? "—" : focusRows.length;
    const stats = [{ label: `${noun} · ${logPeriod.label}`, value: count }];
    if (!neutral && rankInfo.rank) stats.push({ label: `rank, of ${rankInfo.of}`, value: rankText });
    if (feedEnabled) {
      const mine = analyticsRecords.filter((r) => keyOf(r) === focus);
      const weeks = loadPlan?.start ? weekSpark(mine, { start: loadPlan.start, end: loadPlan.end, statusOf }) : [];
      const by = new Map();
      for (const r of focusRows) {
        const k = ATTRIBUTED_BY_TEXT[r.attributedBy] || "no driver";
        by.set(k, (by.get(k) || 0) + 1);
      }
      const dups = focusRows.filter((r) => (r.order?.legRows?.length || 1) > 1).length;
      const leads = unassignedFeed.rows.filter((r) => r.lead?.id === focus).length;
      card = {
        sub,
        stats,
        spark: {
          title: `Per week · loaded ${fmtMDY(loadPlan?.start)} – ${fmtMDY(loadPlan?.end)}`,
          rows: weeks.map((w) => ({
            key: w.key,
            label: `Week of ${fmtMDY(w.key)}`,
            short: w.label,
            n: w.n,
            faint: w.partial,
            note: w.partial ? "part of the week has no feed data or isn't loaded" : "",
          })),
        },
        breakdown: {
          title: "After the attempt",
          rows: [
            ...outcome.parts.filter((p) => p.count).map((p) => ({ label: p.label, count: p.count })),
            ...(outcome.unscanned ? [{ label: "Hand-logged", count: outcome.unscanned }] : []),
          ],
        },
        notes: [
          by.size ? `Attributed by: ${[...by].map(([k, n]) => `${k} ${n}`).join(" · ")}` : null,
          dups
            ? `${dups} of these orders had a -1/-2 duplicate — counted once with the original, never charged to this driver.`
            : null,
          leads
            ? `${leads} Unassigned order${leads === 1 ? " was" : "s were"} closed out by ${focusLabel} — see the Unassigned list.`
            : null,
        ].filter(Boolean),
      };
    } else {
      const blend = analytics.historyLoading || analytics.historyError ? null : analytics.blend(null);
      // The Scorecard's own count when the blend has one for this driver; Unable to
      // Track and a driver with no roster id only have their live entries.
      const viaBlend = !!blend && COUNTED8.includes(config.category) && focus !== "unassigned" && !focus.startsWith("name:");
      const live = viaBlend ? null : liveMonthCounts(logIncidents.filter((r) => keyOf(r) === focus));
      const first = logPeriod.win.start.slice(0, 7);
      const last = logPeriod.win.end.slice(0, 7);
      const months = monthSpark({
        endYm: currentYmET(),
        cellOf: viaBlend ? (ym) => blend.cell(ym, focus, config.category) : (ym) => live.get(ym) || 0,
        sourceOf: viaBlend ? (ym) => sparkSource(blend, ym, config.category) : () => null,
      });
      // The key lists only the sources the twelve months actually have.
      const has = new Set(months.map((m) => m.source));
      card = {
        sub,
        stats,
        spark: {
          title: viaBlend ? "Last 12 months · as the Scorecard counts them" : "Last 12 months · logged entries",
          rows: months.map((m) => ({
            key: m.ym,
            label: m.label,
            short: m.label.slice(0, 3),
            n: m.n,
            source: m.source,
            faint: m.ym < first || m.ym > last,
          })),
          key: viaBlend
            ? [
                ["live", "●", "live entries"],
                ["history", "○", "imported history"],
                ["not_tracked", "⊘", "not captured"],
                ["none", "–", "no data"],
              ]
                .filter(([src]) => has.has(src))
                .map(([, glyph, text]) => [glyph, text])
            : null,
        },
        breakdown: classifyField
          ? { title: config.classify.label, rows: classes.map((c) => ({ label: c.label, count: c.count })) }
          : null,
        recent: {
          title: "Latest",
          rows: [...focusRows]
            .sort((a, b) => recordDate(b).localeCompare(recordDate(a)))
            .slice(0, 5)
            .map((r) => ({ key: r.id, date: fmtIncidentDate(r), pro: r.pro_number, item: classifyField ? r[classifyField] : "" })),
        },
      };
    }
  }

  // Chart clicks. A column narrows the order table (or the log) to its day, week or
  // month; on Attempts a day the feed has no data for opens that day in the daily log
  // instead, which is the one place that can say what it holds.
  const showDayInLog = (d) => {
    setFeedScan(false);
    setFeedDate(d);
    logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onBucket = (b) => {
    // Nothing to list for a no-data day: the daily log is what can say what it holds.
    // A no-data day with hand-logged attempts on it narrows like any other.
    if (feedEnabled && b.gap && b.start === b.end && !b.count) {
      showDayInLog(b.start);
      return;
    }
    const label =
      b.start === b.end
        ? fmtMDY(b.start)
        : logPeriod.win.bucket === "week"
          ? `Week of ${fmtMDY(b.key)}`
          : b.label;
    toggleChip("bucket", { key: b.key, start: b.start, end: b.end, label, fleet: b.fleet }, { only: true });
  };
  const onWeekday = (w) =>
    toggleChip("weekday", { key: w.key, wd: w.wd, label: WEEKDAY_PLURAL[w.wd], fleet: w.fleet }, { only: true });
  const chipCount = feedEnabled ? tableRows.length : applyChips(focusRows, chips, { classifyField }).length;
  const chipNoun = feedEnabled ? `order${chipCount === 1 ? "" : "s"}` : `entr${chipCount === 1 ? "y" : "ies"}`;
  // With a driver picked a column is the driver plus the rest of the fleet, and the
  // number on it is the column's; the list is the driver's part of it, said as such.
  const chartChip = chips.bucket || chips.weekday;
  const chipCountText =
    focus && chartChip && chartChip.fleet !== undefined
      ? `${chipCount} ${chipNoun} — ${focusLabel}'s, of the column's ${chartChip.fleet}`
      : `${chipCount} ${chipNoun}`;
  const chipBar = (where) => (
    <ChipRow
      chips={chips}
      onClear={(kind) => toggleChip(kind, null)}
      lead={where === "panel" ? `${feedEnabled ? "Order table" : "Log"} below narrowed to` : "Showing"}
      count={where === "panel" ? chipCountText : null}
    >
      {feedEnabled && chips.bucket && chips.bucket.start === chips.bucket.end && (
        <button type="button" className="btn ghost sm" onClick={() => showDayInLog(chips.bucket.start)}>
          Open {fmtMDY(chips.bucket.start)} in the daily log
        </button>
      )}
    </ChipRow>
  );
  const printLabel =
    printing === "one" || printing === "all"
      ? printProgress.total
        ? `Building PDF… ${printProgress.done}/${printProgress.total}`
        : "Building PDF…"
      : focus
        ? `Print ${focusLabel}`
        : `Print all (${printTargets.length})`;

  return (
    <div>
      <div className="page-title">Manual Entry</div>
      <h1 className="page-heading">
        {config.heading}
        {/* Counts from incidents: none while their read has failed (the gate below says so). */}
        <span className="meta">
          {incidentsFailed
            ? ""
            : !feedEnabled
              ? ` · ${manualForView.length} in ${logPeriod.label} · ${allTimeManual} all-time`
              : feedDayMissing
                ? ` · no feed data on ${fmtMDY(feedDate)} (${manualCounted} manual) · ${allTimeManual} logged all-time`
                : ` · ${totalOnRecord} on ${fmtMDY(feedDate)} (${feedRows.length} auto, ${manualCounted} manual${handOnFeed.size ? `, ${handOnFeed.size} also on the feed` : ""}) · ${allTimeManual} logged all-time`}
        </span>
      </h1>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="ff-input-row">
            <input
              type="text"
              placeholder="PRO or tracking #…"
              value={pro}
              onChange={(e) => setPro(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pulling && doPull()}
              style={{ maxWidth: 220, fontFamily: "var(--mono)" }}
              title="Uline PRO (digits) or another carrier's tracking number — same NuVizz account"
            />
            <button className="btn primary" onClick={doPull} disabled={pulling}>
              {pulling ? "Pulling from NuVizz…" : "Pull Order"}
            </button>
            <div className="ff-date-field">
              <span className="dd-k">Log entries under</span>
              <input
                type="date"
                value={incidentDate}
                max={todayET()}
                onChange={(e) => setIncidentDate(e.target.value)}
                style={{ fontFamily: "var(--mono)" }}
                title="Every new entry is logged under this date"
              />
            </div>
          </div>
          <div className="meta" style={{ marginTop: 6 }}>
            All new entries are logged under this date (defaults to today). Change it
            once and the whole batch follows.
          </div>
          {incidentDate && incidentDate !== todayET() && (
            <div className="ff-error" style={{ marginTop: 6 }}>
              ⚠ Logging under {fmtMDY(incidentDate)}, not today ({fmtMDY(todayET())}).
              Entries dated outside the view's period won't show until you widen the
              range — set this back to today unless you're intentionally back-dating.
            </div>
          )}

          {pull?.error && !s && (
            <div className="ff-error">NuVizz: {pull.error}</div>
          )}

          {s && (
            <div className="ff-preview">
              {existingForPro.length > 0 && (
                <div className="ff-dup-warning">
                  ⚠ PRO {pull.pro} is already logged as {config.recordNoun}
                  {existingForPro.length > 1 ? ` ${existingForPro.length} times` : ""}:{" "}
                  {existingForPro
                    .map(
                      (d) =>
                        `${d.driver_name || "a driver"} (${fmtMDY(d.delivered_date || d.created_at)})`,
                    )
                    .join(", ")}
                  . Saving will add another entry.
                </div>
              )}
              <div className="ff-preview-top" style={{ marginTop: 14 }}>
                <div className="dd-meta-grid" style={{ flex: 1, marginBottom: 0 }}>
                  <div><span className="dd-k">PRO</span><span className="dd-v" style={{ fontFamily: "var(--mono)" }}>{pull.pro}</span></div>
                  <div><span className="dd-k">NuVizz Driver</span><span className="dd-v">{s.driverName || "—"}</span></div>
                  <div><span className="dd-k">Customer</span><span className="dd-v">{s.to?.name || "—"}</span></div>
                  <div><span className="dd-k">Destination</span><span className="dd-v">{[s.to?.city, s.to?.state].filter(Boolean).join(", ") || "—"}</span></div>
                  <div><span className="dd-k">Route</span><span className="dd-v">{s.routeName || "—"}</span></div>
                  <div><span className="dd-k">Status</span><span className="dd-v">{s.stopStatus || "—"}</span></div>
                </div>
                <div className="ff-order-contents">
                  <div className="dd-k" style={{ marginBottom: 8 }}>Order Contents</div>
                  <div className="ff-oc-stats">
                    <div className="ff-oc">
                      <span className="ff-oc-num">{s.pieces?.skids ?? "—"}</span>
                      <span className="ff-oc-lbl">Pallets</span>
                    </div>
                    <div className="ff-oc">
                      <span className="ff-oc-num">{s.pieces?.total ?? "—"}</span>
                      <span className="ff-oc-lbl">Total Pieces</span>
                    </div>
                    <div className="ff-oc">
                      <span className="ff-oc-num">{s.pieces?.loose ?? "—"}</span>
                      <span className="ff-oc-lbl">Loose</span>
                    </div>
                  </div>
                </div>
              </div>

              {(s.timeline || []).length > 0 && (
                <details className="ff-timeline">
                  <summary>
                    Activity Timeline · {s.timeline.length} events
                    {s.deliveryAttempt
                      ? ` · ${s.deliveryAttempt} delivery attempt${s.deliveryAttempt === 1 ? "" : "s"}`
                      : ""}
                  </summary>
                  <div className="ff-timeline-body">
                    {s.timeline.map((e, i) => (
                      <div key={i} className={`ff-tl-row ff-tl-${e.kind}`}>
                        <span className="ff-tl-time">{fmtDateTime(e.t)}</span>
                        <span className="ff-tl-label">{e.label}</span>
                        {e.detail && <span className="ff-tl-detail">{e.detail}</span>}
                        {e.by && <span className="ff-tl-by">{e.by}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {(s.exceptions || []).length > 0 && (
                <div className="dd-notes" style={{ marginTop: 10 }}>
                  {s.exceptions.map((ex, i) => (
                    <div key={i}><span className="dd-k">Exception</span> {ex.code} — {ex.desc} {ex.comment ? `(${ex.comment})` : ""}</div>
                  ))}
                </div>
              )}

              {(pull.photos || []).length > 0 && (
                <div className="dd-photos" style={{ marginTop: 10 }}>
                  {pull.photos.map((p, i) => (
                    <img key={i} src={p.dataUri || p.url} alt={`POD ${i + 1}`} className="dd-photo" />
                  ))}
                </div>
              )}
              {(pull.photos || []).length === 0 && (
                <div className="meta" style={{ marginTop: 10 }}>No POD photos on this stop.</div>
              )}

              <div className="ff-charge-row">
                {config.classify && (
                  <div>
                    <div className="dd-k">{config.classify.label}</div>
                    <select
                      value={classifyValue}
                      onChange={(e) => setClassifyValue(e.target.value)}
                    >
                      <option value="">{config.classify.placeholder}</option>
                      {config.classify.options.map((it) => (
                        <option key={it} value={it}>
                          {it}
                        </option>
                      ))}
                      {config.divert && (
                        <option value={config.divert.option}>{config.divert.option}</option>
                      )}
                    </select>
                    {diverted && (
                      <div className="meta" style={{ marginTop: 4, maxWidth: 260 }}>
                        {config.divert.note}
                      </div>
                    )}
                  </div>
                )}
                <div className="ff-charge-col">
                  <div className="dd-k">
                    {driverOptional ? "Driver (optional)" : "Charge to driver"}
                  </div>
                  <div className="ff-charge-driver">
                    <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                      <option value="">
                        {driverOptional ? "— Unknown driver —" : "— Select driver —"}
                      </option>
                      {driverOptions}
                    </select>
                    {matched && s.driverName && (
                      <span className="meta ff-charge-note">
                        {matchDriver(s.driverName, drivers)?.id === matched.id
                          ? "Auto-matched from NuVizz"
                          : "Manual override"}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="dd-k">Notes</div>
                  <input
                    type="text"
                    placeholder="Optional notes…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <button
                  className="btn primary"
                  onClick={doSave}
                  disabled={(!driverId && !driverOptional) || saving}
                >
                  {saving ? "Saving…" : diverted ? "Log Unable to Track" : config.addLabel}
                </button>
              </div>
            </div>
          )}

          {savedMsg && (
            <div className={`ff-saved ${savedWarn ? "warn" : ""}`}>{savedMsg}</div>
          )}
        </div>
      </div>

      {/* Everything below counts from incidents: with no copy of them it would read as
          zero, so it waits for them. The form above still logs new entries. */}
      <AnalyticsGate history={false}>
        <ManualEntryAnalytics
          title={config.heading}
          color={color}
          ns={config.ns}
          sourceLabel={feedEnabled ? "dispatch feed + hand-logged" : "logged entries"}
          feedGap={feedGap}
          total={periodRows.length}
          statusLine={
            feedEnabled ? (
              <FeedCoverage
                periodFeed={periodFeed}
                coverage={coverage}
                plan={loadPlan}
                wantEarlier={
                  coverage.notLoaded > 0
                    ? "period"
                    : !feedGap && attTiles?.orders.delta?.reason === "not_loaded"
                      ? "comparison"
                      : null
                }
                onRetry={() => setPeriodNonce((n) => n + 1)}
                onEarlier={loadEarlier}
                onDay={showDayInLog}
              />
            ) : null
          }
          notice={historyOnlyNotice(historyOnly, noun)}
          focus={focus}
          focusLabel={focusLabel}
          focusOptions={rosterBlocked ? [] : focusChoices}
          focusBlocked={rosterBlocked ? "The driver roster couldn't be read, so no driver can be picked yet." : null}
          onFocus={setFocus}
          print={{
            label: printLabel,
            onClick: focus ? printDriverReport : printAllDriverReports,
            // A handout per driver hides deactivated drivers, which needs the roster.
            disabled:
              !!printing ||
              !!rosterBlocked ||
              (focus ? !printable.some((i) => keyOf(i) === focus) : !printTargets.length),
            title: rosterBlocked
              ? "The driver roster couldn't be read, so the handouts can't be split by driver yet."
              : focus
                ? `A PDF of exactly the ${feedEnabled ? "orders" : "entries"} on screen for ${focusLabel}`
                : `One PDF with a handout per driver, from exactly the ${feedEnabled ? "orders" : "entries"} on screen — each driver starts on a new page`,
          }}
          tiles={tiles}
          weekday={weekday}
          trend={trend}
          bucket={logPeriod.win.bucket}
          chips={chips}
          onWeekday={onWeekday}
          onBucket={onBucket}
          classify={
            config.classify
              ? {
                  label: config.classify.label,
                  rows: classes,
                  onPick: (c) => toggleChip("cls", { key: c.key, value: c.value, label: c.label }, { only: true }),
                }
              : null
          }
          outcome={
            outcome
              ? { ...outcome, onPick: (p) => toggleChip("outcome", { key: p.id, id: p.id, label: p.label }, { only: true }) }
              : null
          }
          chipBar={chipBar("panel")}
          historyMonths={historyMonths}
        />

        {(byDriver.rows.length > 0 || focus) && (
          <div className="card ff-bydriver-card">
            <div className="card-body">
              <div className="ff-bydriver-head">
                Drivers · {logPeriod.label}
                <span className="meta">
                  {" "}· {rosterBlocked ? "" : `${byDriver.rows.length} driver${byDriver.rows.length === 1 ? "" : "s"}, `}
                  {periodRows.length} {feedEnabled ? `order${periodRows.length === 1 ? "" : "s"}` : `entr${periodRows.length === 1 ? "y" : "ies"}`}
                </span>
              </div>
              {/* Who's on the chart, and who can be picked from it, needs the roster:
                  without it deactivated drivers would be back on it (RosterGate). The
                  duplicate note, the lookup flags and the Unassigned queue below don't. */}
              <RosterGate>
              {byDriver.rows.length > 0 && (
                <ChartCard
                  inset
                  title={feedEnabled ? "Attempts by driver" : "Entries by driver"}
                  table={chartTable({
                    rows: byDriver.rows,
                    x: { key: "name", label: "Driver" },
                    series: [{ id: "count", label: config.heading }],
                    source: feedEnabled ? "dispatch feed + hand-logged" : "logged entries",
                  })}
                  csv={csvName(config.heading, "by driver", logPeriod.label)}
                  height={Math.max(120, byDriver.rows.length * 30 + 16)}
                >
                  <EmphasisBars
                    layout="bars"
                    data={byDriver.rows}
                    xKey="name"
                    valueName={feedEnabled ? "Attempts" : "Entries"}
                    color={color}
                    highlightKey={focus}
                    onMark={(d) => setFocus(focus === d.key ? null : d.key)}
                    labelAll
                  />
                </ChartCard>
              )}
              <div className="ff-bydriver-hint">
                {byDriver.hiddenCount > 0 && (
                  <>
                    +{byDriver.hiddenCount} {byDriver.hiddenCount === 1 ? noun.replace(/ies$/, "y").replace(/s$/, "") : noun} from
                    inactive drivers — counted in every total, not listed.{" "}
                  </>
                )}
                {!focus && "Click a bar, or pick a driver above, and the whole page follows that driver."}
              </div>
              {card && (
                <DriverCard
                  name={focusLabel}
                  sub={card.sub}
                  color={color}
                  stats={card.stats}
                  spark={card.spark}
                  breakdown={card.breakdown}
                  notes={card.notes}
                  recent={card.recent}
                  onDetail={() => openDrill(detailState)}
                  onPrint={printDriverReport}
                  printLabel={printing === "one" ? printLabel : "Print handout"}
                  printing={!!printing}
                  onClear={() => setFocus(null)}
                />
              )}
              </RosterGate>
              {feedEnabled && periodFeed.status === "ready" && unassignedFeed.copies > 0 && (
                <div className="ff-bydriver-hint">
                  {unassignedFeed.copies} duplicate order
                  {unassignedFeed.copies === 1 ? "" : "s"} (-1/-2) counted once with the original
                  stop — not another attempt, and never charged to the original&apos;s driver.
                  Dispatch&apos;s own total counts {unassignedFeed.copies === 1 ? "it" : "them"}{" "}
                  separately.
                </div>
              )}
              {feedEnabled && fillFlagsInPeriod.length > 0 && (
                <div className="ff-fill-flag" role="alert">
                  <strong>⚠ The nightly driver lookup couldn&apos;t finish</strong>
                  {fillFlagsInPeriod.map((f) => (
                    <div key={f.date} className="ff-fill-flag-day">
                      {fmtMDY(f.date)} — {f.left} attempt{f.left === 1 ? "" : "s"} still need a
                      driver:{" "}
                      {Object.entries(
                        f.stops.reduce((m, x) => ((m[x.reason] = (m[x.reason] || 0) + 1), m), {}),
                      )
                        .map(([why, n]) => `${n} ${FILL_LEFT_REASON[why] || why}`)
                        .join(", ")}
                      . It reads at most {f.maxCalls} a night by design; assign these below, or ask
                      for them to be looked up.
                    </div>
                  ))}
                </div>
              )}
              {feedEnabled && unassignedFeed.rows.length > 0 && (
                <UnassignedAttempts
                  data={unassignedFeed}
                  periodLabel={logPeriod.label}
                  driverOptions={driverOptions}
                  onOpen={openAttempt}
                  onAssign={(r, driverId) => reassignAuto(r.order, driverId, r.delivered_date)}
                  note={reassignNote}
                />
              )}
            </div>
          </div>
        )}

        {feedEnabled && (
          <>
            <div className="section-head">
              Attempted orders · {focus ? `${focusLabel} · ` : ""}
              {logPeriod.label}
              <span className="meta"> · every order in the period, one row each</span>
            </div>
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-body">
                {chipBar("table")}
                {reassignNote && (
                  <div className={`ff-saved ${reassignNote.warn ? "warn" : ""}`} role="status">
                    {reassignNote.text}
                  </div>
                )}
                {periodFeed.status === "loading" && <div className="meta aot-loading">Loading the period…</div>}
                <AttemptOrdersTable
                  rows={tableRows}
                  query={orderQuery}
                  onQuery={setOrderQuery}
                  sort={orderSort}
                  onSort={setOrderSort}
                  onOpenStop={(r) => openAttempt(r.order)}
                  onReassign={(r, driverId) => reassignAuto(r.order, driverId, r.date)}
                  driverOptions={driverOptions}
                  patterns={patterns}
                  lateIndex={lateIndex}
                  onLate={(late) =>
                    openDrill({
                      spec: { kind: "incidents", ids: late.map((i) => i.id), categoryIds: ["late"] },
                      expected: late.length,
                    })
                  }
                  onCustomer={(r) => toggleChip("customer", { key: r.customerKey, label: r.customer || r.customerKey })}
                  onDriver={rosterBlocked ? null : (r) => setFocus(keyOf(r))}
                  hidden={hidden}
                  csv={csvName("Attempted orders", focus ? focusLabel : "", logPeriod.label)}
                  empty={feedGap?.empty || (focus ? `No attempted orders for ${focusLabel} in ${logPeriod.label}.` : `No attempted orders in ${logPeriod.label}.`)}
                />
              </div>
            </div>
          </>
        )}

        <div className="section-head" ref={logRef}>
          {config.logTitle}
          {feedEnabled ? (
            <span className="meta"> · one day, live</span>
          ) : (
            <span className="meta">
              {" "}· {logPeriod.label} ·{" "}
              {focus || logSearch.trim() || Object.keys(chips).length
                ? `${filteredLog.length} of ${manualForView.length}`
                : manualForView.length}
            </span>
          )}
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: "4px 14px" }}>
            <div className="ff-log-search-wrap">
              {feedEnabled && (
                <div className="ff-feed-date">
                  <span className="dd-k">Attempts for</span>
                  <input
                    type="date"
                    value={feedDate}
                    max={todayET()}
                    onChange={(e) => {
                      // A new day starts from the settled list again; only the button
                      // below opts into the heavy live-detection pass.
                      setFeedScan(false);
                      setFeedDate(e.target.value || todayET());
                    }}
                    style={{ fontFamily: "var(--mono)" }}
                    title="Show the attempts log (auto + manual) for this day"
                  />
                  {/* Yesterday is the day worth jumping to: its 8 PM scan has run, so
                      every attempt is already attributed to the driver who had it. */}
                  <button
                    type="button"
                    className={`btn ghost sm ${feedDate === yesterdayET() ? "active" : ""}`}
                    onClick={() => {
                      setFeedScan(false);
                      setFeedDate(yesterdayET());
                    }}
                    disabled={feedDate === yesterdayET()}
                    title="Jump to yesterday, whose attempts the evening scan has already attributed"
                  >
                    Yesterday
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => {
                      setFeedScan(true);
                      setFeedNonce((n) => n + 1);
                    }}
                    disabled={feed.status === "loading"}
                    title="Detect this day's attempts from the live dispatch board now, without waiting for the 8 PM scan"
                    style={{ marginLeft: 8 }}
                  >
                    {feed.status === "loading" ? "Scanning…" : "↻ Run scan"}
                  </button>
                </div>
              )}
              <input
                type="text"
                className="ff-log-search"
                placeholder="Search PRO, driver, customer…"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
              />
              {!feedEnabled && (
                <button
                  type="button"
                  className={`btn ghost sm ${groupByDriver ? "active" : ""}`}
                  onClick={() => setGroupByDriver((g) => !g)}
                  title="Group the log under each driver"
                >
                  {groupByDriver ? "☑ Grouped by driver" : "Group by driver"}
                </button>
              )}
              {focus && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setFocus(null)}
                  title="Back to the whole fleet"
                >
                  ✕ {focusLabel}
                </button>
              )}
            </div>
            {!feedEnabled && chipBar("log")}
            {feedEnabled && feed.status === "loading" && (
              <div className="empty-state">Loading attempts for {fmtMDY(feedDate)}…</div>
            )}
            {feedEnabled && feed.status === "error" && (
              <div className="empty-state" style={{ color: "var(--accent-red)" }}>
                Couldn't load auto attempts for {fmtMDY(feedDate)} ({feed.error}).
              </div>
            )}
            {/* A night the evening scan never ran (or couldn't read NuVizz) is not a
                night with no attempts — say which it is. */}
            {feedEnabled && feed.status === "ready" && NO_DATA_STATUSES.has(feed.dayStatus) && (
              <div className="empty-state" style={{ color: "#b45309" }}>
                No data from the dispatch feed for {fmtMDY(feedDate)}:{" "}
                {DAY_STATUS_TEXT[feed.dayStatus]}. That isn&apos;t the same as no attempts —
                only hand-logged ones can show here.
              </div>
            )}
            {feedEnabled && feed.status === "ready" && feed.dayStatus === "before_feed" && (
              <div className="empty-state">
                {fmtMDY(feedDate)} is before the dispatch feed started ({fmtMDY(FEED_EPOCH)}) —
                only hand-logged attempts can show here.
              </div>
            )}
            {feedEnabled && feed.status === "ready" && feed.deriveError && (
              <div className="empty-state" style={{ color: "var(--accent-amber, #b45309)" }}>
                Showing the settled list only — couldn't reach the live dispatch board
                ({feed.deriveError}).
              </div>
            )}
            {feedEnabled && feed.status === "ready" && feed.carriedOver > 0 && (
              <div className="empty-state">
                {feed.carriedOver} earlier failure{feed.carriedOver === 1 ? " is" : "s are"} still
                on the board awaiting redelivery, marked ATT but due before {fmtMDY(feedDate)}.
                They belong to the day they were attempted and aren't counted here.
              </div>
            )}
            {feedEnabled && feed.status === "ready" && feed.provisionalCount > 0 && (
              <div className="empty-state">
                {feed.provisionalCount} attempt{feed.provisionalCount === 1 ? "" : "s"} detected
                live on the dispatch board and marked <strong>LIVE</strong>. Once a stop is
                re-routed, dispatch no longer shows who attempted it — the 8 PM scan recovers
                that from the morning plan. Attribute one now with its driver dropdown, or
                leave it for the scan.
              </div>
            )}
            {totalOnRecord === 0 &&
              !(
                feedEnabled &&
                (feed.status === "loading" || feedDayMissing)
              ) && (
                <div className="empty-state">
                  {feedEnabled
                    ? `No attempts (auto or manual) for ${fmtMDY(feedDate)}.`
                    : `Nothing logged in ${logPeriod.label}.`}
                </div>
              )}
            {totalOnRecord > 0 &&
              totalShown === 0 &&
              (logSearch.trim() || focus || (!feedEnabled && Object.keys(chips).length > 0)) && (
                <div className="empty-state">
                  No entries match{logSearch.trim() ? ` “${logSearch.trim()}”` : ""}
                  {focus ? ` for ${focusLabel}` : ""}
                  {!feedEnabled && Object.keys(chips).length ? " on what the chart picked" : ""}.
                </div>
              )}

            {/* Auto-detected attempts from the dispatch feed (selected date). */}
            {filteredFeed.map((a) => {
              const ov = overrideFor(a);
              const why = ov ? null : unassignedReason(a);
              const leadName = why ? closedOutBy(a) : null;
              const lead = leadName ? matchDriver(leadName, drivers) : null;
              return (
              <div key={`auto-${a.shipmentNbr || a.stopNbr}`} className="ff-log-entry">
                <div className="dd-incident-head" style={{ cursor: "default" }}>
                  <span
                    className="ff-src-chip auto"
                    title={
                      a.provisional
                        ? "Detected from the live dispatch board — the 8 PM scan hasn't attributed it to a driver yet"
                        : "Attributed by the dispatch app's evening scan"
                    }
                  >
                    {a.provisional ? "LIVE" : "AUTO"}
                  </span>
                  {/* Every stop on this order goes with it, so a split can be inspected
                      leg by leg — the driver events usually sit on the ORIGINAL stop
                      while the "-1" copy has none. */}
                  <button
                    type="button"
                    className="pro-num pro-num-link"
                    onClick={() => openAttempt(a)}
                    title="Open this order — details and, if you want it, the activity history showing who had it"
                  >
                    {a.shipmentNbr || "—"}
                  </button>
                  {a.legs > 1 && (
                    <span
                      className="ff-item-chip"
                      title={`This order has ${a.legs - 1} duplicate order${a.legs === 2 ? "" : "s"} on the list (${a.legRows.map((l) => l.stopNbr).join(", ")}). A -1/-2 is a duplicate: it's counted once with the original here and never charged to the original's driver. Dispatch's own totals count each stop.`}
                    >
                      {a.legs} stops · 1 attempt
                    </span>
                  )}
                  <span
                    className="ff-auto-driver"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <select
                      value={ov?.driver_id || ""}
                      onChange={(e) => reassignAuto(a, e.target.value)}
                      title={
                        a.provisional
                          ? "Attribute this attempt now, or leave it for the 8 PM scan"
                          : "Attribute this attempt to a driver"
                      }
                    >
                      <option value="">
                        {a.originalDriverName
                          ? `${a.originalDriverName} · ${ATTRIBUTED_BY_TEXT[feedAttribution(a)]}`
                          : a.provisional
                            ? `Not yet attributed${a.currentDriverName ? ` · now on ${a.currentDriverName}` : ""}`
                            : "Unassigned — pick a driver"}
                      </option>
                      {driverOptions}
                    </select>
                    {lead && (
                      <button
                        type="button"
                        className="btn ghost sm ff-lead-btn"
                        onClick={() => reassignAuto(a, lead.id)}
                        title={`${leadName} closed this stop out. On attempts that did have a morning driver, the driver who closed the stop was that driver 24 times in 26 — a strong lead, but check it.`}
                      >
                        → {lead.name}
                      </button>
                    )}
                    {ov && (
                      <span className="ff-reassigned" title={`Feed said ${a.originalDriverName || "Unknown"}`}>
                        reassigned
                      </span>
                    )}
                  </span>
                  <span className="meta">
                    {a.businessName || "—"}
                    {a.city || a.state
                      ? ` · ${[a.city, a.state].filter(Boolean).join(", ")}`
                      : ""}
                  </span>
                  <span className="meta">
                    Stop {(a.legRows || [a]).map((l) => l.stopNbr).join(" + ") || "—"}
                    {a.routeName ? ` · ${a.routeName}` : ""}
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    <AttemptStatusBadge a={a} />
                  </span>
                  {/* Delete removes a row from the dispatch app's stored attempts list.
                      A LIVE row isn't in that list yet, so "deleting" it would report
                      success and change nothing — it would reappear on the next scan.
                      Withheld until the evening scan has actually recorded it. */}
                  {config.feedDeletable && !a.provisional && (
                    <span className="ff-row-actions">
                      <button
                        className="btn ghost sm"
                        onClick={() => deleteAuto(a)}
                        disabled={feedDeletingId === a.stopNbr}
                        title="Remove this auto-detected attempt from the feed"
                        style={{ color: "var(--accent-red)" }}
                      >
                        {feedDeletingId === a.stopNbr ? "…" : "Delete"}
                      </button>
                    </span>
                  )}
                </div>
                {why && why !== "provisional" && (
                  <div className="ff-att-why">
                    No driver: {UNASSIGNED_REASON_TEXT[why]}.
                    {leadName ? ` Closed out by ${leadName}.` : ""}
                  </div>
                )}
                {a.note && <div className="ff-att-note">{a.note}</div>}
              </div>
              );
            })}

            {/* Manually-logged entries. Feed tab keeps the compact flat rows;
                elsewhere they render as a column-headed, optionally grouped table. */}
            {feedEnabled
              ? filteredLog.map((inc) => {
                  const onFeed = handOnFeed.get(inc.id);
                  return (
                  <div key={inc.id} className="ff-log-entry">
                    <div className="dd-incident-head" onClick={() => openDriver(inc)}>
                      <span className="ff-src-chip manual">MANUAL</span>
                      <span className="pro-num">{inc.pro_number}</span>
                      {onFeed && (
                        <span
                          className="ff-item-chip"
                          title={`The dispatch feed has this order on the same day, so it is counted once, as the feed's order — under ${overrideFor(onFeed)?.driver_name || onFeed.originalDriverName || "nobody yet"}. To charge someone else, reassign the feed's row above.`}
                        >
                          counted with feed order {onFeed.shipmentNbr || onFeed.stopNbr}
                        </span>
                      )}
                      <span className="lb-name" style={{ width: "auto" }}>{driverCell(inc)}</span>
                      <span className="meta">{inc.customer || ""}</span>
                      {classifyField && inc[classifyField] && (
                        <span className="ff-item-chip">{inc[classifyField]}</span>
                      )}
                      <span className="meta" style={{ marginLeft: "auto" }}>
                        {fmtIncidentDate(inc)}
                        {inc.has_photos ? " · 📸" : ""}
                      </span>
                      {renderRowActions(inc)}
                    </div>
                    {renderEditRow(inc)}
                  </div>
                  );
                })
              : filteredLog.length > 0 && (
                  <>
                    <div className={`${gridClass} ff-log-head`}>
                      <span>PRO#</span>
                      <span>Driver</span>
                      <span>Customer</span>
                      {classifyField && <span>{config.classify?.label || "Item"}</span>}
                      <span>Incident</span>
                      <span>Entered</span>
                      <span />
                      <span />
                    </div>
                    {groupByDriver
                      ? logGroups.map((g) => (
                          <React.Fragment key={g.name}>
                            <div className="ff-log-group">
                              {g.name}
                              <span className="meta"> · {g.rows.length}</span>
                            </div>
                            {g.rows.map(renderManualRow)}
                          </React.Fragment>
                        ))
                      : filteredLog.map(renderManualRow)}
                    <div className="aot-foot">
                      {filteredLog.length} entr{filteredLog.length === 1 ? "y" : "ies"}
                      {focus ? ` · ${focusLabel}` : ""}
                      {Object.values(chips).map((c) => ` · ${c.label}`).join("")}
                    </div>
                  </>
                )}
          </div>
        </div>
      </AnalyticsGate>

      {stopDetail && (
        <StopDetailModal
          row={stopDetail.row}
          legs={stopDetail.legs}
          onClose={() => setStopDetail(null)}
        />
      )}
    </div>
  );
}

// One line above the Attempts analytics: how much of the period the dispatch feed
// covers, and which days it has no data for. A night the scan never ran must not look
// like a quiet day, so no-data days are named — grouped by reason and run together, so
// a week-long outage is one range rather than seven dates — and days not loaded yet are
// said as a count, with the button that loads 45 more.
//
//   plan          feedLoadPlan: what is being loaded
//   wantEarlier   what needs days not loaded yet: "period" (the window itself), or
//                 "comparison" (only the tile's change against the days before it)
//   onDay         (date) — a no-data day clicked: show it in the daily log
function FeedCoverage({ periodFeed, coverage, plan, wantEarlier, onRetry, onEarlier, onDay }) {
  const retry = (
    <button type="button" className="btn ghost sm" onClick={onRetry}>
      Try again
    </button>
  );
  // With the period all in, the earlier days only serve the tile's comparison, and
  // may not make it computable (a day before them with no scan still blocks it), so the
  // button says that's what it is for.
  const earlier =
    plan?.more && wantEarlier ? (
      <button
        type="button"
        className="btn ghost sm"
        onClick={onEarlier}
        title={
          wantEarlier === "comparison"
            ? `The whole period is loaded. Read the 45 days before ${fmtMDY(plan.start)} so the Attempted orders tile can compare against the days before the period — it can only if each of them has feed data.`
            : `Read the 45 days before ${fmtMDY(plan.start)} from the dispatch feed (back to ${fmtMDY(FEED_EPOCH)} at most)`
        }
      >
        {wantEarlier === "comparison" ? "Load earlier days for the comparison" : "Load 45 earlier days"}
      </button>
    ) : null;
  let body;
  if (periodFeed.status === "loading" || periodFeed.status === "idle") {
    body = <span>loading the period…</span>;
  } else if (periodFeed.status === "error") {
    body = (
      <>
        <span className="ff-feed-coverage-gap">
          couldn&apos;t load the period — only hand-logged attempts are counted below
        </span>
        {retry}
      </>
    );
  } else {
    const { of, loaded, noData, pending, todayFailed, beforeFeed, notLoaded } = coverage;
    const groups = noDataRuns(noData);
    body = (
      <>
        {of > 0 && (
          <span>
            {loaded} of {of} day{of === 1 ? "" : "s"}
          </span>
        )}
        {groups.length > 0 && (
          <span
            className="ff-feed-coverage-gap"
            title={noData.map((d) => `${fmtMDY(d.date)}: ${DAY_STATUS_TEXT[d.status]}`).join("\n")}
          >
            no data on{" "}
            {groups.map((g, i) => (
              <React.Fragment key={g.status}>
                {i ? "; " : ""}
                <Runs runs={g.runs} onDay={onDay} /> (
                {g.days > 1 ? `${g.days} days, ` : ""}
                {DAY_STATUS_TEXT[g.status]})
              </React.Fragment>
            ))}{" "}
            — not counted as zero
          </span>
        )}
        {pending && <span>{DAY_STATUS_TEXT.pending}</span>}
        {todayFailed && (
          <span className="ff-feed-coverage-gap">
            today: {DAY_STATUS_TEXT.failed}
          </span>
        )}
        {notLoaded > 0 && (
          <span className="ff-feed-coverage-gap">
            {notLoaded} earlier day{notLoaded === 1 ? "" : "s"} of the period not loaded yet — hand-logged
            attempts only
          </span>
        )}
        {beforeFeed > 0 && (
          <span>before {fmtMDY(FEED_EPOCH)}: hand-logged attempts only</span>
        )}
        {(todayFailed || noData.some((d) => d.status === "failed")) && retry}
        {earlier}
      </>
    );
  }
  return (
    <div className="ff-feed-coverage" role="status">
      <span className="ff-feed-coverage-k">Dispatch feed</span>
      {body}
    </div>
  );
}

// "09/02/2026, 09/08–10/07/2026": a single day in full, a run as MM/DD–MM/DD/YYYY.
// Past three runs the rest are counted; every date is in the line's tooltip. Each run
// opens its first day in the daily log, the one place that says what that day holds.
function Runs({ runs, onDay }) {
  const one = (r) =>
    r.from === r.to ? fmtMDY(r.from) : `${fmtMDY(r.from).slice(0, 5)}–${fmtMDY(r.to)}`;
  const rest = runs.slice(3).reduce((n, r) => n + r.days, 0);
  return (
    <>
      {runs.slice(0, 3).map((r, i) => (
        <React.Fragment key={r.from}>
          {i ? ", " : ""}
          <button
            type="button"
            className="ff-feed-coverage-day"
            onClick={() => onDay(r.from)}
            title={`Open ${fmtMDY(r.from)} in the daily log`}
          >
            {one(r)}
          </button>
        </React.Fragment>
      ))}
      {rest ? ` and ${rest} more` : ""}
    </>
  );
}

// The period's attempts with no driver, each with the reason and, when the feed has
// one, a lead — so the "Unassigned" bar is a queue to work through, not a mystery.
// Oldest first, with each one's age, since the oldest is the one most likely to stay
// unassigned for good. Assigning here saves the same reassignment the log's dropdown
// does, on the attempt's own day; its result (or failure) is shown right here.
function UnassignedAttempts({ data, periodLabel, driverOptions, onOpen, onAssign, note = null }) {
  const [open, setOpen] = React.useState(false);
  const [dir, setDir] = React.useState("oldest");
  const [reason, setReason] = React.useState("");
  const { rows, byReason, withLead } = data;
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${n} ${UNASSIGNED_REASON_SHORT[why] || why}`);
  const shown = React.useMemo(
    () => sortQueue(reason ? rows.filter((r) => r.why === reason) : rows, dir),
    [rows, reason, dir],
  );
  const oldest = rows.length ? Math.max(...rows.map((r) => r.age ?? 0)) : 0;
  return (
    <div className="ff-unassigned">
      <button
        type="button"
        className="ff-unassigned-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          <strong>Unassigned · {rows.length}</strong>
          <span className="meta">
            {" "}· {periodLabel} · {parts.join(" · ")}
            {withLead ? ` · ${withLead} with a lead` : ""}
            {rows.length ? ` · oldest ${oldest} day${oldest === 1 ? "" : "s"}` : ""}
          </span>
        </span>
        <span className="meta">{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open && (
        <>
          <div className="ff-unassigned-explain">
            The evening scan names a driver by matching each attempt to the 8:30 AM route
            plan. These couldn't be matched: the stop wasn't on anyone's route that
            morning, or only a duplicate order (-1/-2) is on the list. Open a PRO and load
            its activity history to see who had it, or take the lead where the feed has
            one — the driver who closed the stop out.
          </div>
          {note && <div className={`ff-saved ${note.warn ? "warn" : ""}`} role="status">{note.text}</div>}
          <div className="ff-unassigned-tools">
            <label className="dd-k">
              Reason{" "}
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">All ({rows.length})</option>
                {Object.entries(byReason).map(([why, n]) => (
                  <option key={why} value={why}>
                    {UNASSIGNED_REASON_SHORT[why] || why} ({n})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setDir((d) => (d === "oldest" ? "newest" : "oldest"))}
              aria-label={`Sorted ${dir} first; switch`}
            >
              Age: {dir === "oldest" ? "oldest first ▾" : "newest first ▴"}
            </button>
          </div>
          {shown.map((r) => (
            <div key={r.id} className="ff-unassigned-row">
              <span className="dd-date">
                {fmtMDY(r.delivered_date)}
                <span className="ff-unassigned-age"> · {r.age === 0 ? "today" : `${r.age}d`}</span>
              </span>
              <button
                type="button"
                className="pro-num pro-num-link"
                onClick={() => onOpen(r.order)}
                title="Open this order — details and its activity history"
              >
                {r.pro_number}
              </button>
              <span className="meta ff-unassigned-cust">{r.customer || "—"}</span>
              <span className="ff-unassigned-why" title={UNASSIGNED_REASON_TEXT[r.why]}>
                {UNASSIGNED_REASON_SHORT[r.why]}
                {r.leadName ? ` · closed out by ${r.leadName}` : ""}
                {r.fillLeft ? ` · nightly lookup skipped (${FILL_LEFT_REASON[r.fillLeft] || r.fillLeft})` : ""}
              </span>
              <span className="ff-unassigned-act">
                {r.lead && (
                  <button
                    type="button"
                    className="btn ghost sm ff-lead-btn"
                    onClick={() => onAssign(r, r.lead.id)}
                    title={`${r.leadName} closed this stop out — a strong lead, but check it`}
                  >
                    → {r.lead.name}
                  </button>
                )}
                <select
                  value=""
                  onChange={(e) => e.target.value && onAssign(r, e.target.value)}
                  aria-label={`Assign ${r.pro_number} to a driver`}
                >
                  <option value="">Assign…</option>
                  {driverOptions}
                </select>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// The chips a chart click set, each one a button that takes it off. `lead` says what
// they narrow; `count` is how many rows that leaves.
function ChipRow({ chips, onClear, lead = "Showing", count = null, children }) {
  const list = Object.entries(chips);
  if (!list.length) return null;
  return (
    <div className="me-chips" role="status">
      <span className="me-chips-lead">{lead}</span>
      {list.map(([kind, c]) => (
        <button key={kind} type="button" className="me-chip" onClick={() => onClear(kind)} title="Take this off">
          {c.label} <span aria-hidden="true">✕</span>
        </button>
      ))}
      {count && <span className="meta">· {count}</span>}
      {children}
    </div>
  );
}

// "Nov–Dec 2025 and Feb–Mar 2026 exist only as monthly totals…": the months of the
// window this tab can't list, said in one line rather than understated in silence.
// Back-to-back months run together; a live month between them splits the run.
function historyOnlyNotice(months, noun) {
  if (!months.length) return null;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const f = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const runs = [];
  for (const { ym } of months) {
    const last = runs[runs.length - 1];
    if (last && shiftYm(last.to, 1) === ym) last.to = ym;
    else runs.push({ from: ym, to: ym });
  }
  const text = runs.map((r) => (r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`));
  const list = text.length > 1 ? `${text.slice(0, -1).join(", ")} and ${text[text.length - 1]}` : text[0];
  const n = months.reduce((a, m) => a + m.n, 0);
  const one = months.length === 1;
  return `${list} ${one ? "exists" : "exist"} only as monthly totals in imported history (${n} ${noun}), with no entries to list here — the Scorecard counts ${n === 1 ? "it" : "them"}.`;
}
