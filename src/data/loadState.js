// What a checked read left us with. A failed read must never look like an empty store:
// the app's first bug was a save that failed and reported success, and its read-side
// twin is a load that fails and shows zeros. Every analytics screen decides what to draw
// from this state, not from "is the array empty".
//
// status
//   loading  nothing yet
//   error    the read failed and there is nothing earlier to show
//   empty    the read succeeded and the store holds nothing (a new install)
//   ready    the read succeeded with data
// A refresh that fails after a good load keeps the good copy and carries the failure as
// `refreshError`, so the screens keep their numbers and say they may be stale.

export const HISTORY_MAX_AGE_MS = 30 * 60 * 1000;

export const initialLoadState = () => ({
  status: "loading",
  records: [],
  monthIds: [],
  newestUpdatedAt: null,
  loadedAt: 0,
  error: null,
  refreshError: null,
});

// result: what loadHistoryChecked() returned — { records, monthIds, newestUpdatedAt,
// error, offline? }. An `offline` answer came from this browser's cache (readResult):
// with nothing better on screen its records are shown, as an old copy (`offline`, and
// the error as `refreshError`); an empty one is a plain failure.
export function historyLoadState(result, previous = initialLoadState(), now = Date.now()) {
  if (!result || result.error) {
    const error = (result && result.error) || "no response";
    if (previous && (previous.status === "ready" || previous.status === "empty")) {
      return { ...previous, refreshError: error };
    }
    if (result?.offline && Array.isArray(result.records) && result.records.length) {
      return {
        ...initialLoadState(),
        status: "ready",
        records: result.records,
        monthIds: Array.isArray(result.monthIds) ? result.monthIds : [],
        newestUpdatedAt: result.newestUpdatedAt || null,
        loadedAt: now,
        refreshError: error,
        offline: true,
      };
    }
    return { ...initialLoadState(), status: "error", error };
  }
  const records = Array.isArray(result.records) ? result.records : [];
  return {
    status: records.length ? "ready" : "empty",
    records,
    monthIds: Array.isArray(result.monthIds) ? result.monthIds : [],
    newestUpdatedAt: result.newestUpdatedAt || null,
    loadedAt: now,
    error: null,
    refreshError: null,
  };
}

// True when a loaded copy is old enough that regaining focus should re-read it.
export function isStale(state, now = Date.now(), maxAgeMs = HISTORY_MAX_AGE_MS) {
  return !!state && state.loadedAt > 0 && now - state.loadedAt > maxAgeMs;
}

// ── Checked reads of incidents, the roster and reports ───────────────────────
//
// Firestore doesn't throw when the server can't be reached: with the offline cache on,
// getDocs/getDoc answer from this browser's cache instead — on a new device, nothing at
// all, which every screen would draw as zeros. So an answer from the cache is a failed
// read that may carry an old copy:
//   { data, error: null }                        the server answered
//   { data: cached, error, offline: true }       it didn't; data is this browser's copy
export const SERVER_UNREACHABLE = "the server couldn't be reached";

export function readResult(rows, fromCache) {
  if (!fromCache) return { data: rows, error: null };
  return { data: rows, error: SERVER_UNREACHABLE, offline: true };
}

// What App does with a checked read, given whether a good copy is already on screen:
//   data   what to put on screen (undefined: keep what is there)
//   error  the read error to show, null to clear it; `stale` means a copy is on screen
//          and may be out of date, otherwise the screens built on it are hidden
//   loaded whether a copy is on screen afterwards
// A failed first read shows this browser's offline copy when there is one, said as
// old; with no copy it is a failure, never an empty list.
export function applyReadResult(result, loadedOnce = false) {
  if (result && !result.error) return { data: result.data || [], error: null, loaded: true };
  const message = (result && result.error) || "no response";
  if (loadedOnce) return { data: undefined, error: { message, stale: true }, loaded: true };
  if (result?.offline && Array.isArray(result.data) && result.data.length) {
    return { data: result.data, error: { message, stale: true, offline: true }, loaded: true };
  }
  return { data: undefined, error: { message, stale: false }, loaded: false };
}
