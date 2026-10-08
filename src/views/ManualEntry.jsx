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
  driverKey,
  ATTRIBUTED_BY_TEXT,
} from "../data/attemptRecords.js";
import { reassignAttempt, overridesFor as savedOverridesFor } from "../data/attemptReassign.js";
import { catColor, COUNTED8 } from "../data/categories.js";
import { csvName } from "../data/csv.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { driverDrill } from "../data/drill.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { openDrill } from "./kit/drillNav.js";
import { AnalyticsGate } from "./kit/LoadState.jsx";
import StopDetailModal from "./StopDetailModal.jsx";
import ManualEntryAnalytics, { useTabPeriod } from "./ManualEntryAnalytics.jsx";
import ChartCard from "./kit/ChartCard.jsx";
import EmphasisBars from "./kit/charts/EmphasisBars.jsx";
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
  // Log view controls: group rows under driver headers, and/or filter to one
  // driver (set by clicking a driver in the By-Driver summary).
  const [groupByDriver, setGroupByDriver] = React.useState(false);
  const [driverFilter, setDriverFilter] = React.useState(null);
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
    capped: false,
    totalDays: 0,
  });
  // Bump to read the period again. A failed day and today are never cached, so this
  // asks for those again (and any recent day past its refresh time) and serves the
  // rest from the cache.
  const [periodNonce, setPeriodNonce] = React.useState(0);

  React.useEffect(() => {
    if (!feedEnabled) return;
    const { start, end } = logPeriod.win;
    if (!start || !end) return;
    const controller = new AbortController();
    let active = true;
    setPeriodFeed((f) => ({ ...f, status: "loading" }));
    fetchAttemptsRange(start, end, { signal: controller.signal })
      .then((r) => {
        if (!active) return;
        setPeriodFeed({
          status: "ready",
          days: r.days,
          fills: r.fills || [],
          capped: r.capped,
          totalDays: r.totalDays,
        });
      })
      .catch((e) => {
        if (!active || e.name === "AbortError") return;
        setPeriodFeed({ status: "error", days: new Map(), capped: false, totalDays: 0 });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [feedEnabled, logPeriod.win, feedNonce, periodNonce]);

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
  async function reassignAuto(a, driverId, date = feedDate) {
    const drv = driverId ? drivers.find((d) => d.id === driverId) : null;
    if (driverId && !drv) {
      setSavedWarn(true);
      setSavedMsg("Reassign failed: that driver isn't on the roster any more.");
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
    } else if (r.pendingSync) {
      setSavedWarn(true);
      setSavedMsg(
        `⚠ ${a.shipmentNbr || a.stopNbr} reassigned to ${drv.name} on THIS DEVICE only — not synced to the server yet. It will retry automatically; other people won't see it until it syncs.`,
      );
    } else {
      // The row's dropdown shows the result; just don't leave an earlier failure up.
      setSavedWarn(false);
      setSavedMsg("");
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
    setEditDate((inc.delivered_date || inc.created_at || "").slice(0, 10));
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
  // (logPeriod.win) so it matches the charts above it.
  const manualForView = React.useMemo(() => {
    const base = logIncidents.filter((i) => !i.attempt_stop_nbr);
    if (feedEnabled) {
      return base.filter(
        (i) => (i.delivered_date || i.created_at || "").slice(0, 10) === feedDate,
      );
    }
    const { start, end } = logPeriod.win;
    return base.filter((i) => {
      const d = (i.delivered_date || i.created_at || "").slice(0, 10);
      return d && d >= start && d <= end;
    });
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
  // The key the by-driver chart, the driver filter and the printouts all share — the
  // same one an attempt record carries, so a bar, the log and a print can't disagree.
  const keyOf = driverKey;

  // Every attempt in the period, one record per order: the feed's auto attempts plus
  // hand-logged ones, from the one builder every screen counts attempts with (see
  // attemptRecords.js for the rules — -1/-2 duplicates folded into their original,
  // a saved reassignment winning, reassignment rows not counted twice).
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
  // chart is a list someone can work through rather than an unexplained bar.
  const unassignedFeed = React.useMemo(() => {
    if (!feedEnabled) return { rows: [], byReason: {}, withLead: 0, copies: 0 };
    const { start, end } = logPeriod.win;
    const inWin = (d) => d && d >= start && d <= end;
    const rows = feedRecords
      .filter((r) => inWin(r.delivered_date) && !r.driver_name)
      .map((r) => {
        const leadName = closedOutBy(r.order);
        return {
          ...r,
          why: unassignedReason(r.order) || "not_in_plan",
          leadName,
          lead: leadName ? matchDriver(leadName, drivers) : null,
          // The nightly lookup's own report, when it could not read this one.
          fillLeft: fillLeft.get(`${r.delivered_date}|${r.order?.stopNbr}`) || null,
        };
      })
      .sort(
        (a, b) =>
          b.delivered_date.localeCompare(a.delivered_date) ||
          String(a.pro_number).localeCompare(String(b.pro_number)),
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
  // the analytics: a day it has no data for is named, never counted as a quiet day.
  const coverage = React.useMemo(() => {
    const { start, end } = logPeriod.win;
    return feedCoverage(periodFeed.days, start, end);
  }, [periodFeed.days, logPeriod.win]);

  // When the period has no feed data to count at all, every number in the panel is
  // the hand-logged attempts alone — so it says that, rather than a bare 0 over "No
  // records in this period" while the feed's ~100 attempts a month go unseen.
  const feedGap = React.useMemo(() => {
    if (!feedEnabled || periodFeed.status === "loading" || periodFeed.status === "idle")
      return null;
    const why =
      periodFeed.status === "error"
        ? "Couldn't reach the dispatch feed for this period"
        : periodFeed.capped
          ? "The dispatch feed isn't loaded for a period this long"
          : coverage.of > 0 && coverage.loaded === 0
            ? "The dispatch feed has no data for this period"
            : coverage.of === 0 && (coverage.pending || coverage.todayFailed)
              ? "Today's 8 PM scan hasn't run yet"
              : coverage.of === 0 && coverage.beforeFeed > 0
                ? `This period is before the dispatch feed started (${fmtMDY(FEED_EPOCH)})`
                : null;
    return why ? `${why} — only hand-logged attempts are counted, and none were logged.` : null;
  }, [feedEnabled, periodFeed.status, periodFeed.capped, coverage]);

  // Rows for the ANALYTICS period, whatever the log below happens to be showing.
  // On the feed-backed tab the log is a single day, but the by-driver breakdown has
  // to cover the selected period like every other stat in the panel above it — and
  // it deliberately keeps the reassignment overrides (attempt_stop_nbr) that the log
  // hides, because those rows are exactly where an auto attempt's driver lives.
  const periodRows = React.useMemo(() => {
    const { start, end } = logPeriod.win;
    return analyticsRecords.filter((i) => {
      const d = (i.delivered_date || i.created_at || "").slice(0, 10);
      return d && d >= start && d <= end;
    });
  }, [analyticsRecords, logPeriod.win]);

  // Per-driver rollup for the current period: who made mistakes, and how many.
  // Deactivated drivers are left out — this chart is "who am I managing", not a
  // record of the period. Their rows stay in the log and in every count below.
  const byDriver = React.useMemo(() => {
    const hidden = hiddenDriverIds(drivers);
    const m = new Map();
    for (const i of periodRows) {
      if (i.driver_id && hidden.has(i.driver_id)) continue;
      const name = driverNameOf(i);
      const key = keyOf(i);
      if (!m.has(key)) m.set(key, { key, id: i.driver_id || null, name, count: 0 });
      m.get(key).count += 1;
    }
    return [...m.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
  }, [periodRows, driverNameOf, drivers, keyOf]);

  // Build a handout PDF for the currently selected driver, covering exactly the
  // period the charts and log are showing. Uses the same driver key the chart
  // filters on, so what prints is what's on screen.
  async function printDriverReport() {
    if (!driverFilter) return;
    const row = byDriver.find((d) => d.key === driverFilter);
    const entries = periodRows.filter(
      (i) => keyOf(i) === driverFilter,
    );
    if (!entries.length) {
      alert("No entries for that driver in this period.");
      return;
    }
    setPrinting("one");
    setPrintProgress({ done: 0, total: 0 });
    try {
      const { win } = logPeriod;
      const rangeText =
        win?.start && win?.end ? `${fmtMDY(win.start)} – ${fmtMDY(win.end)}` : "";
      const doc = await generateDriverReport({
        driverName: row?.name || driverNameOf(entries[0]),
        entries,
        config,
        periodLabel: logPeriod.label,
        rangeText,
        onProgress: ({ done, total }) => setPrintProgress({ done, total }),
      });
      doc.save(
        driverReportFilename(
          row?.name || "driver",
          config.heading,
          logPeriod.label,
        ),
      );
    } catch (err) {
      alert("Could not build the report: " + (err?.message || err));
    } finally {
      setPrinting(false);
      setPrintProgress({ done: 0, total: 0 });
    }
  }

  // One PDF holding every driver's handout for the same period, in the order the
  // by-driver chart shows them. Each driver starts on a fresh page and keeps its own
  // page numbering, so the pack prints once and splits cleanly into handouts.
  // Deactivated drivers are already absent from byDriver, so they're not printed —
  // and, per the same rule, no total on screen changes because of that.
  async function printAllDriverReports() {
    const targets = byDriver
      .map((row) => ({
        row,
        entries: periodRows.filter(
          (i) => keyOf(i) === row.key,
        ),
      }))
      .filter((t) => t.entries.length);
    if (!targets.length) {
      alert("No entries in this period.");
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
        // Feeding the previous doc back in appends this driver to the same file.
        doc = await generateDriverReport({
          driverName: t.row.name,
          entries: t.entries,
          config,
          periodLabel: logPeriod.label,
          rangeText,
          doc,
        });
        setPrintProgress({ done: i + 1, total: targets.length });
      }
      doc.save(allDriversReportFilename(config.heading, logPeriod.label));
    } catch (err) {
      alert("Could not build the report: " + (err?.message || err));
    } finally {
      setPrinting(false);
      setPrintProgress({ done: 0, total: 0 });
    }
  }

  // Free-text + optional single-driver filter over the manual rows.
  const filteredLog = React.useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return manualForView.filter((i) => {
      if (driverFilter) {
        if (keyOf(i) !== driverFilter) return false;
      }
      if (!q) return true;
      return [
        i.pro_number,
        i.driver_name,
        i.customer,
        classifyField ? i[classifyField] : "",
        i.notes,
        fmtMDY(i.delivered_date || i.created_at),
        fmtMDY(i.created_at),
      ].some((f) => String(f || "").toLowerCase().includes(q));
    });
  }, [manualForView, logSearch, classifyField, driverFilter, keyOf]);

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
  // and the same driver filter, keyed by the driver the order is counted under (a
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
    const forDriver = driverFilter
      ? feedOrders.filter((a) => feedDayKeys.get(a) === driverFilter)
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
  }, [feedEnabled, feedOrders, feedDayKeys, driverFilter, logSearch]);

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
  const openDriver = (inc) => {
    if (!inc.driver_id) return;
    if (!COUNTED8.includes(config.category)) {
      openDrill({
        spec: {
          kind: "incidents",
          driverId: inc.driver_id,
          categoryIds: [config.category],
          ids: incidents.filter((i) => i.driver_id === inc.driver_id && i.category === config.category).map((i) => i.id),
        },
      });
      return;
    }
    const year = todayET().slice(0, 4);
    openDrill(
      driverDrill(
        inc.driver_id,
        {
          categoryIds: COUNTED8,
          scopes: [
            { label: "All time", months: analytics.blend(null).months },
            { label: `YTD ${year}`, months: monthsOfYear(Number(year)) },
          ],
        },
        { category: config.category },
      ),
    );
  };

  // Aligned, column-headed row for the non-feed log (Forgotten Freight, etc.).
  const gridClass = `ff-log-grid ${classifyField ? "has-item" : ""}`;
  const renderManualRow = (inc) => (
    <div key={inc.id} className="ff-log-entry">
      <div className={`${gridClass} ff-log-row`} onClick={() => openDriver(inc)}>
        <span className="pro-num">{inc.pro_number}</span>
        <span className="ff-cell-ellipsis" title={driverNameOf(inc)}>
          {inc.driver_name || inc.driver_raw || "—"}
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
        <span className="ff-cell-date">{fmtMDY(inc.delivered_date || inc.created_at)}</span>
        <span className="ff-cell-date">{fmtMDY(inc.created_at)}</span>
        <span className="ff-cell-photo" title={inc.has_photos ? "Has photo" : ""}>
          {inc.has_photos ? "📸" : ""}
        </span>
        {renderRowActions(inc)}
      </div>
      {renderEditRow(inc)}
    </div>
  );

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
          records={analyticsRecords}
          drivers={drivers}
          ns={config.ns}
          sourceLabel={feedEnabled ? "dispatch feed + hand-logged" : "logged entries"}
          leaderLabel={config.leaderLabel}
          feedGap={feedGap}
          statusLine={
            feedEnabled ? (
              <FeedCoverage
                periodFeed={periodFeed}
                coverage={coverage}
                onRetry={() => setPeriodNonce((n) => n + 1)}
              />
            ) : null
          }
        />

        {byDriver.length > 0 && (
          <div className="card ff-bydriver-card">
            <div className="card-body">
              <div
                className="ff-bydriver-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Drivers · {logPeriod.label}
                  <span className="meta">
                    {" "}· {byDriver.length} driver{byDriver.length === 1 ? "" : "s"},{" "}
                    {periodRows.length} entr{periodRows.length === 1 ? "y" : "ies"}
                  </span>
                </span>
                {/* Always-visible way to print one driver's report. Bound to the
                    same driverFilter the chart sets, so clicking a bar and picking
                    from here are the same selection. */}
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    value={driverFilter || ""}
                    onChange={(e) => setDriverFilter(e.target.value || null)}
                    style={{ maxWidth: 230 }}
                    aria-label="Driver to print a report for"
                  >
                    <option value="">— Select a driver —</option>
                    {byDriver.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name} ({d.count})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn primary sm"
                    onClick={printDriverReport}
                    disabled={!driverFilter || printing}
                    title={
                      driverFilter
                        ? "Build a PDF of this driver's entries for the selected period"
                        : "Pick a driver first"
                    }
                  >
                    {printing === "one"
                      ? printProgress.total
                        ? `Building PDF… ${printProgress.done}/${printProgress.total}`
                        : "Building PDF…"
                      : "📄 Print driver report"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={printAllDriverReports}
                    disabled={!byDriver.length || !!printing}
                    title={`One PDF with every driver's report for ${logPeriod.label} — each driver starts on a new page`}
                  >
                    {printing === "all"
                      ? `Building PDF… driver ${printProgress.done}/${printProgress.total}`
                      : `📄 Print all (${byDriver.length})`}
                  </button>
                </span>
              </div>
              <ChartCard
                inset
                title="Entries by driver"
                table={chartTable({
                  rows: byDriver,
                  x: { key: "name", label: "Driver" },
                  series: [{ id: "count", label: config.heading }],
                  source: feedEnabled ? "dispatch feed + hand-logged" : "logged entries",
                })}
                csv={csvName(config.heading, "by driver", logPeriod.label)}
                height={Math.max(120, byDriver.length * 30 + 16)}
              >
                <EmphasisBars
                  layout="bars"
                  data={byDriver}
                  xKey="name"
                  valueName="Entries"
                  color={color}
                  highlightKey={driverFilter}
                  onMark={(d) => setDriverFilter(driverFilter === d.key ? null : d.key)}
                  labelAll
                />
              </ChartCard>
              <div className="ff-bydriver-hint">
                {driverFilter ? (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setDriverFilter(null)}
                  >
                    ✕ Clear filter · {byDriver.find((d) => d.key === driverFilter)?.name || "driver"}
                  </button>
                ) : (
                  "Click a bar to filter the log to that driver, or pick one above to print their report."
                )}
              </div>
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
                />
              )}
            </div>
          </div>
        )}

        <div className="section-head">
          {config.logTitle}
          {!feedEnabled && (
            <span className="meta">
              {" "}· {logPeriod.label} ·{" "}
              {driverFilter || logSearch.trim()
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
              {driverFilter && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setDriverFilter(null)}
                  title="Clear the driver filter"
                >
                  ✕ {byDriver.find((d) => d.key === driverFilter)?.name || "driver"}
                </button>
              )}
            </div>
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
              (logSearch.trim() || driverFilter) && (
                <div className="empty-state">
                  No entries match{logSearch.trim() ? ` “${logSearch.trim()}”` : ""}
                  {driverFilter
                    ? ` for ${byDriver.find((d) => d.key === driverFilter)?.name || "that driver"}`
                    : ""}
                  .
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
                      <span className="lb-name" style={{ width: "auto" }}>{inc.driver_name}</span>
                      <span className="meta">{inc.customer || ""}</span>
                      {classifyField && inc[classifyField] && (
                        <span className="ff-item-chip">{inc[classifyField]}</span>
                      )}
                      <span className="meta" style={{ marginLeft: "auto" }}>
                        {fmtMDY(inc.delivered_date || inc.created_at)}
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
// covers, and which days it has no data for. The charts draw only the days that had
// attempts, so without this a night the scan never ran looked exactly like a quiet
// day. No-data days are grouped by reason and run together, so a week-long outage
// is one range rather than seven dates.
function FeedCoverage({ periodFeed, coverage, onRetry }) {
  const retry = (
    <button type="button" className="btn ghost sm" onClick={onRetry}>
      Try again
    </button>
  );
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
  } else if (periodFeed.capped) {
    // A multi-month window would be hundreds of requests, so it isn't asked for.
    body = (
      <span className="ff-feed-coverage-gap">
        not loaded — {periodFeed.totalDays} feed days is more than it can be asked for at
        once (45). Pick a month or less; only hand-logged attempts are counted below.
      </span>
    );
  } else {
    const { of, loaded, noData, pending, todayFailed, beforeFeed } = coverage;
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
                <strong>{fmtRuns(g.runs)}</strong> (
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
        {beforeFeed > 0 && (
          <span>before {fmtMDY(FEED_EPOCH)}: hand-logged attempts only</span>
        )}
        {(todayFailed || noData.some((d) => d.status === "failed")) && retry}
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
// Past three runs the rest are counted; every date is in the line's tooltip.
function fmtRuns(runs) {
  const one = (r) =>
    r.from === r.to ? fmtMDY(r.from) : `${fmtMDY(r.from).slice(0, 5)}–${fmtMDY(r.to)}`;
  const shown = runs.slice(0, 3).map(one).join(", ");
  const rest = runs.slice(3).reduce((n, r) => n + r.days, 0);
  return rest ? `${shown} and ${rest} more` : shown;
}

// The period's attempts with no driver, each with the reason and, when the feed has
// one, a lead — so the "Unassigned" bar is a list to work through, not a mystery.
// Assigning here saves the same reassignment the log's dropdown does, on the
// attempt's own day.
function UnassignedAttempts({ data, periodLabel, driverOptions, onOpen, onAssign }) {
  const [open, setOpen] = React.useState(false);
  const { rows, byReason, withLead } = data;
  const parts = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${n} ${UNASSIGNED_REASON_SHORT[why] || why}`);
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
          </span>
        </span>
        <span className="meta">{open ? "Hide ▴" : "Why? ▾"}</span>
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
          {rows.map((r) => (
            <div key={r.id} className="ff-unassigned-row">
              <span className="dd-date">{fmtMDY(r.delivered_date)}</span>
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
