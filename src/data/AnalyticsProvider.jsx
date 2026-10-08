// One place every analytics screen gets its numbers from.
//
// History is read ONCE here and shared. The Scorecard, Trends, Reports and the roster
// each used to read every dds_history document on every visit, and each turned a failed
// read into an empty list, which charts as zero. Here a failed read is an error the
// screens show (loadState.js), and the blend (blend.js) and the people index are built
// once per data change for all of them.
//
// History is re-read:
//   - after this browser writes it (a report rollup, a re-sync, an import, a delete):
//     firebase.js announces every history write, and the screens that make one also
//     await refreshHistory() so what they show next is already fresh — one read answers
//     both, because a read that started after the latest write already covers it
//   - from the Refresh button beside the history note (writes made in another browser)
//   - on focus, once the copy is 30 minutes old
//   - from the "Try again" on a failed load
import React from "react";
import { loadHistoryChecked, onHistoryWritten, historyWriteSeq } from "./firebase.js";
import { buildBlend } from "./blend.js";
import { personIndex } from "./people.js";
import { hiddenDriverIds } from "./drivers.js";
import { dataStamp as stampOf } from "./drill.js";
import { historyLoadState, initialLoadState, isStale } from "./loadState.js";

// Today's Driver-fault rule (blend.js): under Driver-fault scope a month qualifies on
// driver-fault rows, and a month with none falls back to all-fault history. Flipping it
// here moves everything that reads the blend together — the Scorecard's YTD tile, its
// leaderboards and every drill-down. The Scorecard's three month tiles (This Month,
// Driver Fault, Exonerated) still count raw incidents with their own rule and would not
// move with it; they come onto the blend with the KPI fix.
const LEGACY_DRIVER_SCOPE = true;

const AnalyticsContext = React.createContext(null);

export function useAnalytics() {
  const ctx = React.useContext(AnalyticsContext);
  if (!ctx) throw new Error("useAnalytics must be used inside <AnalyticsProvider>");
  return ctx;
}

// incidents / drivers / reports   App's live copies (App owns their loading)
// loading     App's first load is still running (nothing above is real yet)
// readErrors  { incidents, drivers, reports }: null, or { message, stale } where stale
//             means an earlier good copy is still on screen
// reload      { incidents, drivers, reports }: App's checked re-reads
export function AnalyticsProvider({
  incidents,
  drivers,
  reports,
  loading = false,
  readErrors = {},
  reload = {},
  children,
}) {
  const [hist, setHist] = React.useState(initialLoadState);
  const histRef = React.useRef(hist);
  histRef.current = hist;

  // One read at a time. A read that started after the latest history write already
  // answers a call (the write's own announcement and the screen that wrote both ask);
  // otherwise one more read is queued behind the running one, so a write that lands
  // mid-read is never answered with the read that started before it.
  const running = React.useRef(null); // { promise, seq }: seq = writes made before it began
  const queued = React.useRef(null);
  const refreshHistory = React.useCallback(() => {
    if (running.current && running.current.seq >= historyWriteSeq()) return running.current.promise;
    if (queued.current) return queued.current;
    const start = () => {
      const seq = historyWriteSeq();
      const promise = loadHistoryChecked()
        .then((result) => setHist((prev) => historyLoadState(result, prev)))
        .finally(() => {
          running.current = null;
        });
      running.current = { promise, seq };
      return promise;
    };
    if (!running.current) return start();
    queued.current = running.current.promise.then(() => {
      queued.current = null;
      return start();
    });
    return queued.current;
  }, []);

  React.useEffect(() => {
    refreshHistory();
    const off = onHistoryWritten(() => refreshHistory());
    const onFocus = () => {
      if (document.visibilityState === "visible" && isStale(histRef.current)) refreshHistory();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshHistory]);

  const records = hist.records;
  // Built lazily, once per fault scope, and thrown away when the data changes.
  const blends = React.useMemo(() => new Map(), [incidents, records]);
  const blend = React.useCallback(
    (fault = null) => {
      const key = fault === "driver" ? "driver" : "all";
      if (!blends.has(key)) {
        blends.set(
          key,
          buildBlend({
            incidents,
            history: records,
            faultFilter: key === "driver" ? "driver" : null,
            legacyQualifyWithFault: LEGACY_DRIVER_SCOPE,
          }),
        );
      }
      return blends.get(key);
    },
    [blends, incidents, records],
  );

  const people = React.useMemo(
    () => personIndex({ drivers, incidents, history: records }),
    [drivers, incidents, records],
  );
  const hidden = React.useMemo(() => hiddenDriverIds(drivers), [drivers]);
  const roleOf = React.useCallback((id) => people.get(id)?.role || "driver", [people]);

  // The attempt records the Attempts tab has loaded (attemptRecords.js), so a drawer
  // opened from one of its tiles counts the very same orders. Only that tab can load
  // them — they come from the dispatch feed a period at a time — so it publishes them
  // once its period is in, and takes them back (null) when it closes.
  //
  // `error` is set when the feed couldn't be reached for the period: the records are
  // then the hand-logged attempts alone, and a drawer says so rather than waiting for
  // orders that aren't coming.
  const [published, setPublished] = React.useState({ records: null, error: null });
  const publishAttempts = React.useCallback(
    (recs, { error = null } = {}) => setPublished({ records: recs || null, error: recs ? error : null }),
    [],
  );
  const attemptRecords = published.records;

  // What resolveDrill (drill.js) needs.
  const drillCtx = React.useMemo(
    () => ({ blend, history: records, incidents, roleOf, attemptRecords }),
    [blend, records, incidents, roleOf, attemptRecords],
  );
  // The data every drill-down counts from, as a stamp: a drawer checks the number that
  // was clicked only against a count from the same data (drill.js dataStamp), the
  // loaded attempt orders included.
  const dataStamp = React.useMemo(
    () => stampOf({ incidents, history: records, drivers, attemptRecords }),
    [incidents, records, drivers, attemptRecords],
  );

  // A read that failed with nothing earlier to fall back on: the numbers built on it
  // would be wrong, so the screens show this instead of them.
  const blocking =
    (readErrors.incidents && !readErrors.incidents.stale && { what: "incidents", ...readErrors.incidents, retry: reload.incidents }) ||
    (hist.status === "error" && { what: "history", message: hist.error, retry: refreshHistory }) ||
    null;
  // The roster, likewise, for what depends on it: a Drivers / Loaders split (without
  // roles everyone reads as a driver) and anything that hides inactive drivers (without
  // the roster nobody is hidden). Totals don't depend on it, so it blocks only those
  // (RosterGate in LoadState.jsx).
  const rosterBlocking =
    readErrors.drivers && !readErrors.drivers.stale
      ? { what: "the driver roster", ...readErrors.drivers, retry: reload.drivers }
      : null;

  const value = {
    incidents,
    drivers,
    reports,
    history: records,
    historyState: hist,
    // Either half still on its first read: nothing built on them can be shown yet. (A
    // drawer opened from a link would otherwise count history against no incidents.)
    historyLoading: loading || hist.status === "loading",
    historyError: hist.status === "error" ? hist.error : null,
    blocking,
    rosterBlocking,
    readErrors,
    blend,
    people,
    hidden,
    roleOf,
    drillCtx,
    dataStamp,
    publishAttempts,
    attemptsError: published.error,
    refreshHistory,
    reload,
  };
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}
