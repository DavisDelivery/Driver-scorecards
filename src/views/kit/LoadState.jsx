import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";

// What an analytics screen shows when its data isn't there. A failed read is never drawn
// as zeros: the screen says what failed and offers to try again, and a refresh that
// failed after a good load keeps the good numbers and says how old they are.

const clock = (t) =>
  t ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "earlier";

export function LoadError({ what, message, retry }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="load-error" role="alert">
      <b>Couldn't load {what} from the server.</b> {message ? `(${message}) ` : ""}
      The numbers on this screen are hidden rather than shown wrong.
      {retry && (
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await retry();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Trying…" : "Try again"}
        </button>
      )}
    </div>
  );
}

// Wraps the part of a screen built on the blend. `history` false for a view that reads
// live data only (the Reports weekly list), which needs incidents but not history.
export function AnalyticsGate({ history = true, children }) {
  const a = useAnalytics();
  const block = a.blocking && (history || a.blocking.what !== "history") ? a.blocking : null;
  if (block) return <LoadError what={block.what} message={block.message} retry={block.retry} />;
  if (history && a.historyLoading) return <div className="empty-state">Loading history…</div>;
  const stale = history ? a.historyState.refreshError : null;
  return (
    <>
      {stale && (
        <div className="load-stale" role="status">
          {a.historyState.offline
            ? `History couldn't be read from the server (${stale}); these numbers use the copy saved in this browser, which may be out of date.`
            : `History couldn't be refreshed (${stale}); these numbers use the copy loaded at ${clock(a.historyState.loadedAt)}.`}{" "}
          <button type="button" className="btn ghost sm" onClick={() => a.refreshHistory()}>
            Try again
          </button>
        </div>
      )}
      {children}
    </>
  );
}

// The part of a screen that needs the roster: a Drivers / Loaders split, or a list
// that hides inactive drivers. A failed roster read with no earlier copy would make
// every loader a driver and bring deactivated drivers back, so these say so instead.
export function RosterGate({ children }) {
  const a = useAnalytics();
  const block = a.rosterBlocking;
  if (block) return <LoadError what={block.what} message={block.message} retry={block.retry} />;
  return children;
}

// "History as of 10:42 · Refresh": history is read once per session, so a rollup or an
// import made in another browser shows up here when asked for (or on focus once the
// copy is half an hour old). This browser's own writes refresh it by themselves.
export function HistoryRefresh() {
  const a = useAnalytics();
  const [busy, setBusy] = React.useState(false);
  const h = a.historyState;
  if (h.status !== "ready" && h.status !== "empty") return null;
  return (
    <span className="hist-refresh">
      History as of {clock(h.loadedAt)}
      <button
        type="button"
        className="btn ghost sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await a.refreshHistory();
          } finally {
            setBusy(false);
          }
        }}
        title="Read imported history again — picks up rollups and imports made in another browser"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </span>
  );
}
