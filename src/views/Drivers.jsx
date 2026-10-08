import React from "react";
import { updateRoster, saveIncidentsBatch } from "../data/firebase.js";
import { ROLES, newDriverId } from "../data/drivers.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { tally, tallyTotal } from "../data/blend.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { currentYmET } from "../data/period.js";
import { LoadError } from "./kit/LoadState.jsx";
import { openDrill } from "./kit/drillNav.js";

// Categories that count against a driver (negative events). Compliments are
// tracked but never counted "against" a driver.
const NEG_CATS = ["damage","late","missing","misdelivery","forgotten_freight","attempts","complaint"];
const CAT_LABEL = {
  damage: "Damage", late: "Late", missing: "Missing", misdelivery: "Misdeliv",
  forgotten_freight: "Forgot Frt", attempts: "Attempts", complaint: "Complaint",
};
const STRIP = ["damage", "late", "missing", "misdelivery", "forgotten_freight"];

export default function Drivers({ drivers, incidents, onUpdate }) {
  const data = useAnalytics();
  const history = data.history;
  // The card counts need history. Until it is in (or if it failed) they read "—", and
  // anything that decides from "has no records" waits: offering Remove on a driver
  // whose history simply hasn't loaded would orphan it.
  const countsReady = !data.historyLoading && !data.blocking;
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("all");
  const [showInactive, setShowInactive] = React.useState(false);
  // Roster editor: "add" | the driver object being edited | null.
  const [formOpen, setFormOpen] = React.useState(null);
  const [formName, setFormName] = React.useState("");
  const [formRole, setFormRole] = React.useState("driver");
  const [formError, setFormError] = React.useState("");
  const [savingRoster, setSavingRoster] = React.useState(false);

  // The cards count from the shared blend (blend.js), the same month-by-month rule as
  // the Scorecard, so a card and the drawer it opens can't disagree. Each card used to
  // run its own per-driver version of the rule: a month counted live for a driver as
  // soon as they had ANY live row in it — a compliment, a no-fault row — and that
  // driver's history for the month vanished.
  const blend = data.blend(null);
  const curMonth = currentYmET();
  const curYear = curMonth.slice(0, 4);
  const counts = React.useMemo(
    () => ({
      mo: tally(blend, [curMonth], NEG_CATS),
      ytd: tally(blend, monthsOfYear(Number(curYear)), NEG_CATS),
      all: tally(blend, blend.months, NEG_CATS),
    }),
    [blend, curMonth, curYear],
  );

  const enriched = React.useMemo(() => {
    return drivers.map((driver) => {
      const sum = (t) => tallyTotal(t, { driverId: driver.id });
      const monthAgainst = sum(counts.mo);

      const srcVol = { traces: 0, returns: 0, laters: 0 };
      for (const inc of incidents) {
        if (inc.driver_id !== driver.id || inc.no_fault) continue;
        for (const s of Array.isArray(inc.sources) ? inc.sources : [])
          if (s in srcVol) srcVol[s] += 1;
      }

      return {
        ...driver,
        againstTotal: sum(counts.all),
        ytdAgainst: sum(counts.ytd),
        monthAgainst,
        strip: STRIP.map((c) => ({ cat: c, label: CAT_LABEL[c], n: counts.all.get(driver.id)?.get(c) || 0 })),
        srcVol,
        heat: monthAgainst >= 3 ? "hot" : monthAgainst >= 1 ? "warm" : "cool",
      };
    });
  }, [drivers, incidents, counts]);

  // A card opens the driver's drawer over all time, this year and this month — the
  // card's three numbers, each checked against what the drawer counts.
  const openCard = (driver) =>
    openDrill({
      spec: { kind: "blend", driverId: driver.id, categoryIds: NEG_CATS },
      scopes: [
        { label: "All time", months: blend.months, expected: driver.againstTotal },
        { label: `YTD ${curYear}`, months: monthsOfYear(Number(curYear)), expected: driver.ytdAgainst },
        { label: "This month", months: [curMonth], expected: driver.monthAgainst },
      ],
    });

  const filtered = React.useMemo(() => {
    let list = enriched;
    if (!showInactive) list = list.filter((d) => d.active !== false);
    if (roleFilter !== "all") list = list.filter((d) => d.role === roleFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }
    return list.sort(
      (a, b) =>
        b.monthAgainst - a.monthAgainst ||
        b.againstTotal - a.againstTotal ||
        a.name.localeCompare(b.name),
    );
  }, [enriched, search, roleFilter, showInactive]);

  const hasRecords = (driverId) =>
    !countsReady ||
    incidents.some((i) => i.driver_id === driverId) ||
    history.some((r) => r.driver_id === driverId);

  function openAdd() {
    setFormOpen("add");
    setFormName("");
    setFormRole("driver");
    setFormError("");
  }
  function openEdit(driver) {
    setFormOpen(driver);
    setFormName(driver.name);
    setFormRole(driver.role || "driver");
    setFormError("");
  }
  function closeForm() {
    setFormOpen(null);
    setFormError("");
  }

  async function submitForm() {
    const name = formName.trim();
    if (!name) {
      setFormError("Name is required.");
      return;
    }
    const isEdit = formOpen !== "add";
    setSavingRoster(true);
    try {
      // The mutator runs on the roster AS IT IS ON THE SERVER, not this tab's
      // possibly-stale copy — so a duplicate added seconds ago by someone else is
      // caught, and this save can't erase anyone else's concurrent change.
      await updateRoster((current) => {
        const dupe = current.find(
          (d) =>
            d.name.trim().toLowerCase() === name.toLowerCase() &&
            (!isEdit || d.id !== formOpen.id),
        );
        if (dupe) {
          throw new Error(
            dupe.active === false
              ? `${dupe.name} already exists but is inactive — reactivate them instead of adding a duplicate.`
              : `${dupe.name} is already on the roster.`,
          );
        }
        return isEdit
          ? current.map((d) =>
              d.id === formOpen.id ? { ...d, name, role: formRole } : d,
            )
          : [...current, { id: newDriverId(), name, role: formRole, active: true }];
      });
      onUpdate && onUpdate();
      closeForm();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSavingRoster(false);
    }
  }

  // Mark a driver inactive: hidden from new assignments and pickers, but their
  // history stays intact and they can be reactivated anytime. This is the normal
  // way to retire a driver — permanent removal is reserved for zero-history rows.
  async function deactivateDriver(driver) {
    if (
      !confirm(
        `Deactivate ${driver.name}? They'll be hidden from new assignments and driver pickers. Their history stays intact and you can reactivate them anytime.`,
      )
    )
      return;
    setSavingRoster(true);
    try {
      await updateRoster((current) =>
        current.map((d) => (d.id === driver.id ? { ...d, active: false } : d)),
      );
      onUpdate && onUpdate();
    } catch (err) {
      alert(`Could not deactivate ${driver.name} — the change was NOT saved.\n\n${err.message}`);
    } finally {
      setSavingRoster(false);
    }
  }

  // Permanently delete a driver. Only offered for rows with no incident history,
  // so nothing is lost; drivers with history are deactivated instead.
  async function removeDriver(driver) {
    if (hasRecords(driver.id)) {
      // Safety net — the UI only shows Remove on zero-history rows, but never
      // hard-delete a driver whose incidents would be orphaned.
      await deactivateDriver(driver);
      return;
    }
    if (
      !confirm(
        `Permanently remove ${driver.name}? They have no incidents on record, so this can't be undone.`,
      )
    ) {
      return;
    }
    setSavingRoster(true);
    try {
      await updateRoster((current) => current.filter((d) => d.id !== driver.id));
      onUpdate && onUpdate();
    } catch (err) {
      alert(`Could not remove ${driver.name} — the change was NOT saved.\n\n${err.message}`);
    } finally {
      setSavingRoster(false);
    }
  }

  // --- single-name cleanup -------------------------------------------------
  // The roster carried a tail of bare first names (Scott, Marcus, Kazeem, …) that
  // duplicate drivers already on it under their full names. They are not just
  // untidy: a bare first name BREAKS attribution, because matchDriver's first-name
  // fallback only fires when exactly one driver shares that first name — with both
  // "Scott" and "Scott Hart" present, a NuVizz "Scott" resolves to the stub and that
  // driver's record silently splits in two.
  const nameTokens = (n) =>
    String(n || "").toLowerCase().replace(/[^a-z ]/g, "").trim().split(/\s+/).filter(Boolean);

  const stubRows = React.useMemo(() => {
    const full = drivers.filter((d) => nameTokens(d.name).length > 1);
    return drivers
      .filter((d) => nameTokens(d.name).length === 1)
      .map((d) => {
        const tok = nameTokens(d.name)[0];
        // Whoever on the roster carries this word as a first OR last name.
        const candidates = full.filter((f) => nameTokens(f.name).includes(tok));
        return {
          driver: d,
          candidates,
          // A single full-name owner is used to move entries before the row goes.
          // With two candidates there is no safe answer — "Terrance" is Taylor or
          // Hawk — so those entries are left on their own driver_id rather than
          // guessed onto the wrong person's record.
          target: candidates.length === 1 ? candidates[0] : null,
          entries: incidents.filter((i) => i.driver_id === d.id),
          historyRows: history.filter((r) => r.driver_id === d.id).length,
        };
      });
  }, [drivers, incidents, history]);

  // Remove EVERY single-name row. Entries sitting on one are moved to its full-name
  // owner first where there is exactly one, so the delete can't cost any attribution;
  // where the name is ambiguous the entries keep their own driver_id and stay counted
  // (an unknown driver_id is never hidden — see the reporting rules), they just show
  // as unattributed until someone reassigns them.
  async function cleanUpStubRows() {
    if (!stubRows.length) return;
    const line = (s) => {
      const n = s.entries.length + s.historyRows;
      const where = s.target
        ? `entries → ${s.target.name}`
        : s.candidates.length
          ? `ambiguous (${s.candidates.map((c) => c.name).join(" / ")}) — entries left unattributed`
          : "no full-name match";
      return `  • ${s.driver.name}${n ? ` (${n} on record; ${where})` : ""}`;
    };
    const moving = stubRows.filter((s) => s.target && s.entries.length);
    const stranding = stubRows.filter((s) => !s.target && (s.entries.length || s.historyRows));
    const movedCount = moving.reduce((a, s) => a + s.entries.length, 0);
    const msg =
      `Remove all ${stubRows.length} single-name row${stubRows.length === 1 ? "" : "s"}:\n` +
      stubRows.map(line).join("\n") +
      (movedCount
        ? `\n\n${movedCount} entr${movedCount === 1 ? "y" : "ies"} will be moved to the matching full-name driver first.`
        : "") +
      (stranding.length
        ? `\n\n${stranding.length} row${stranding.length === 1 ? " has" : "s have"} records but no single obvious owner. Those records stay counted in every total, but will show as unattributed until you reassign them.`
        : "") +
      `\n\nThis can't be undone. Remove them?`;
    if (!confirm(msg)) return;
    setSavingRoster(true);
    try {
      // Entries first: if this fails, the roster is untouched and nothing is lost.
      if (movedCount) {
        await saveIncidentsBatch(
          moving.flatMap((s) =>
            s.entries.map((i) => ({
              ...i,
              driver_id: s.target.id,
              driver_name: s.target.name,
            })),
          ),
        );
      }
      const drop = new Set(stubRows.map((s) => s.driver.id));
      // Filter by id on the FRESH roster: rows someone added since this screen
      // loaded survive, and already-removed ids are a no-op.
      await updateRoster((current) => current.filter((d) => !drop.has(d.id)));
      onUpdate && onUpdate();
    } catch (err) {
      alert(`Cleanup failed — the roster was NOT changed.\n\n${err.message}`);
    } finally {
      setSavingRoster(false);
    }
  }

  async function reactivateDriver(driver) {
    setSavingRoster(true);
    try {
      await updateRoster((current) =>
        current.map((d) => (d.id === driver.id ? { ...d, active: true } : d)),
      );
      onUpdate && onUpdate();
    } catch (err) {
      alert(`Could not reactivate ${driver.name} — the change was NOT saved.\n\n${err.message}`);
    } finally {
      setSavingRoster(false);
    }
  }

  return (
    <div>
      <div className="page-title">Driver Roster</div>
      <h1 className="page-heading">
        Drivers <span className="meta">· {filtered.length} / {drivers.length}</span>
      </h1>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Search drivers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <div className="month-picker">
          {["all", "driver", "loader", "non-driver"].map((r) => (
            <button
              key={r}
              className={`month-btn ${roleFilter === r ? "active" : ""}`}
              onClick={() => setRoleFilter(r)}
            >
              {r === "all" ? "All" : r === "driver" ? "Drivers" : r === "loader" ? "Loaders" : "Non-Driver"}
            </button>
          ))}
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <div className="toolbar-spacer" />
        {countsReady && stubRows.length > 0 && (
          <button
            className="btn ghost"
            onClick={cleanUpStubRows}
            disabled={savingRoster}
            title="Remove every roster row that is only a first name — they duplicate drivers already listed with their full names"
          >
            ⚠ Remove {stubRows.length} single-name row{stubRows.length === 1 ? "" : "s"}
          </button>
        )}
        <button className="btn" onClick={openAdd}>
          + Add Driver/Loader
        </button>
      </div>
      {data.blocking && (
        <LoadError what={data.blocking.what} message={data.blocking.message} retry={data.blocking.retry} />
      )}
      {/* The cards are the roster: with no copy of it there is nothing to list, and an
          empty page would read as "no drivers". */}
      {data.rosterBlocking && (
        <LoadError
          what={data.rosterBlocking.what}
          message={data.rosterBlocking.message}
          retry={data.rosterBlocking.retry}
        />
      )}
      <div className="driver-list">
        {filtered.map((driver) => (
          <div
            key={driver.id}
            className={`driver-card ${countsReady ? driver.heat : "cool"}`}
            onClick={() => countsReady && openCard(driver)}
            style={driver.active === false ? { opacity: 0.55 } : undefined}
          >
            <div className="driver-name">
              {driver.name}
              {driver.active === false && (
                <span className="meta" style={{ marginLeft: 6 }}>
                  · inactive
                </span>
              )}
            </div>
            <div className="driver-role">{driver.role}</div>
            <div className="driver-stats">
              <div className="driver-stat">
                <div className={`driver-stat-value ${countsReady && driver.monthAgainst > 0 ? "red" : ""}`}>
                  {countsReady ? driver.monthAgainst : "—"}
                </div>
                <div className="driver-stat-label">Faulted Mo</div>
              </div>
              <div className="driver-stat">
                <div className={`driver-stat-value ${countsReady && driver.ytdAgainst > 3 ? "amber" : ""}`}>
                  {countsReady ? driver.ytdAgainst : "—"}
                </div>
                <div className="driver-stat-label">YTD</div>
              </div>
              <div className="driver-stat">
                <div className="driver-stat-value">{countsReady ? driver.againstTotal : "—"}</div>
                <div className="driver-stat-label">All Time</div>
              </div>
            </div>
            <div className="driver-catstrip">
              {driver.strip.map((s) => (
                <div key={s.cat} className={`dcs ${countsReady && s.n > 0 ? "on" : ""}`}>
                  <span className="dcs-n">{countsReady ? s.n : "—"}</span>
                  <span className="dcs-l">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="driver-srcvol">
              <span className="src-badge src-traces">T {driver.srcVol.traces}</span>
              <span className="src-badge src-returns">R {driver.srcVol.returns}</span>
              <span className="src-badge src-laters">L {driver.srcVol.laters}</span>
            </div>
            <div
              style={{ display: "flex", gap: 6, marginTop: 8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="btn ghost sm" onClick={() => openEdit(driver)}>
                ✎ Edit
              </button>
              {driver.active === false ? (
                <button
                  className="btn ghost sm"
                  onClick={() => reactivateDriver(driver)}
                  disabled={savingRoster}
                >
                  Reactivate
                </button>
              ) : (
                <button
                  className="btn ghost sm"
                  onClick={() => deactivateDriver(driver)}
                  disabled={savingRoster}
                  style={{ color: "var(--accent-amber)" }}
                >
                  Deactivate
                </button>
              )}
              {!hasRecords(driver.id) && (
                <button
                  className="btn ghost sm"
                  onClick={() => removeDriver(driver)}
                  disabled={savingRoster}
                  style={{ color: "var(--accent-red)" }}
                  title="No history on record — permanently delete this entry"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {formOpen && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <div className="modal-header">
              <div className="modal-title">
                {formOpen === "add" ? "Add Driver / Loader" : "Edit Driver"}
              </div>
              <button className="close-x" onClick={closeForm}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && submitForm()}
                />
              </label>
              <label className="field" style={{ marginTop: 10 }}>
                <span>Role</span>
                <select value={formRole} onChange={(e) => setFormRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              {formError && (
                <div
                  className="note-block"
                  style={{ marginTop: 10, color: "var(--accent-red)", fontSize: 12 }}
                >
                  {formError}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "14px 20px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg-2)",
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button className="btn ghost" onClick={closeForm}>
                Cancel
              </button>
              <button className="btn" onClick={submitForm} disabled={savingRoster}>
                {savingRoster
                  ? "Saving..."
                  : formOpen === "add"
                    ? "Add"
                    : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
