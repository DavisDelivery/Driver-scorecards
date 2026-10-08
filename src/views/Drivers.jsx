import { catLabel, catColor } from "../data/categories.js";
import React from "react";
import { updateRoster, saveIncidentsBatch } from "../data/firebase.js";
import { ROLES, newDriverId } from "../data/drivers.js";
import { useAnalytics } from "../data/AnalyticsProvider.jsx";
import { tally, tallyTotal } from "../data/blend.js";
import { monthsOfYear } from "../data/scorecardDetail.js";
import { currentYmET } from "../data/period.js";
import { LoadError } from "./kit/LoadState.jsx";
import { openDrill } from "./kit/drillNav.js";
import CardMenu from "./kit/CardMenu.jsx";
import Icon from "./kit/Icon.jsx";

// Categories that count against a driver (negative events). Compliments are
// tracked but never counted "against" a driver.
const NEG_CATS = ["damage","late","missing","misdelivery","forgotten_freight","attempts","complaint"];
// Spelled out in full, as everywhere else (categories.js).
const CAT_LABEL = Object.fromEntries(NEG_CATS.map((c) => [c, catLabel(c)]));
// The Mix bar's categories, in the registry's stack order (categories.js).
const STRIP = ["damage", "forgotten_freight", "misdelivery", "late", "missing"];

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
  // The table's sort: a column and a direction; the default puts this month's most first.
  const [sort, setSort] = React.useState({ col: "month", dir: "desc" });
  // Roster editor: "add" | the driver object being edited | null.
  const [formOpen, setFormOpen] = React.useState(null);
  const [formName, setFormName] = React.useState("");
  const [formRole, setFormRole] = React.useState("driver");
  const [formError, setFormError] = React.useState("");
  const [savingRoster, setSavingRoster] = React.useState(false);

  // The cards count from the shared blend (blend.js), the same rule as the Scorecard,
  // so a card and the drawer it opens can't disagree. Each card used to run its own
  // per-driver version of the rule: a month counted live for a driver as soon as they
  // had ANY live row in it — a compliment, a no-fault row — and that driver's history
  // for the month vanished.
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
    const dir = sort.dir === "asc" ? 1 : -1;
    const byName = (a, b) => a.name.localeCompare(b.name);
    const cmp = {
      name: (a, b) => byName(a, b) * dir,
      role: (a, b) => String(a.role || "").localeCompare(String(b.role || "")) * dir || byName(a, b),
      status: (a, b) => ((a.active === false ? 1 : 0) - (b.active === false ? 1 : 0)) * dir || byName(a, b),
      month: (a, b) => (a.monthAgainst - b.monthAgainst) * dir || (a.againstTotal - b.againstTotal) * dir || byName(a, b),
      ytd: (a, b) => (a.ytdAgainst - b.ytdAgainst) * dir || byName(a, b),
      all: (a, b) => (a.againstTotal - b.againstTotal) * dir || byName(a, b),
    }[sort.col];
    return list.sort(cmp);
  }, [enriched, search, roleFilter, showInactive, sort]);
  // The Mix bars share one scale: the largest all-time strip on the page.
  const mixMax = React.useMemo(() => Math.max(1, ...filtered.map((d) => d.strip.reduce((a, x) => a + x.n, 0))), [filtered]);

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
      <div className="page-title">Driver roster</div>
      <h1 className="page-heading">
        Drivers <span className="meta"><span className="meta-sep">· </span>{filtered.length} / {drivers.length}</span>
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
        <label className="toolbar-check">
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
            <Icon name="alert-triangle" />
            Remove {stubRows.length} single-name row{stubRows.length === 1 ? "" : "s"}
          </button>
        )}
        <button className="btn" onClick={openAdd}>
          <Icon name="plus" />
          Add driver or loader
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
      {/* The roster as one sortable table: who, their role and status, the three counts
          the drawer checks (this month, the year to date, all time), and a small Mix bar
          of what the all-time count is made of. A row opens that driver's drawer; Edit
          and Deactivate sit behind its ⋯. */}
      <div className="card">
        <div className="card-body tight">
          <div className="table-wrap">
            <table className="data analytics-table drv-table">
              <thead>
                <tr>
                  <SortTh col="name" sort={sort} setSort={setSort}>Name</SortTh>
                  <SortTh col="role" sort={sort} setSort={setSort} className="drv-wide">Role</SortTh>
                  <SortTh col="status" sort={sort} setSort={setSort} className="drv-wide">Status</SortTh>
                  <SortTh col="month" sort={sort} setSort={setSort} num>This month</SortTh>
                  <SortTh col="ytd" sort={sort} setSort={setSort} num>YTD</SortTh>
                  <SortTh col="all" sort={sort} setSort={setSort} num>All time</SortTh>
                  <th className="drv-wide">Mix, all time</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((driver) => {
                  const inactive = driver.active === false;
                  const mixTotal = driver.strip.reduce((a, x) => a + x.n, 0);
                  const mixTitle = countsReady
                    ? [
                        ...driver.strip.map((x) => `${x.label} ${x.n}`),
                        `Uline volumes: ${driver.srcVol.traces} traces, ${driver.srcVol.returns} returns, ${driver.srcVol.laters} lates`,
                      ].join("\n")
                    : "Counts loading";
                  const role = (driver.role || "driver").replace(/^./, (c) => c.toUpperCase());
                  // What the all-time count is made of: one bar, in the registry's colours, its
                  // counts and the Uline report volumes in its hover — every row one line tall.
                  const mixBar =
                    countsReady && mixTotal > 0 ? (
                      <span className="drv-mix-bar" style={{ width: `${Math.max(4, (mixTotal / mixMax) * 100)}%` }}>
                        {driver.strip
                          .filter((x) => x.n > 0)
                          .map((x) => (
                            <i key={x.cat} style={{ flexGrow: x.n, background: catColor(x.cat) }} />
                          ))}
                      </span>
                    ) : null;
                  return (
                    <tr
                      key={driver.id}
                      className={`clickable ${inactive ? "drv-inactive" : ""}`.trim()}
                      onClick={() => countsReady && openCard(driver)}
                      title={countsReady ? `Open ${driver.name}'s failures` : undefined}
                    >
                      <td className="drv-name">
                        <span className="drv-name-text">{driver.name}</span>
                        <span className="drv-sub">
                          {role}
                          {inactive ? " · inactive" : ""}
                        </span>
                        {/* On a phone the Mix column is hidden: its bar sits here. */}
                        {mixBar && (
                          <span className="drv-mix drv-sub-mix" title={mixTitle} aria-hidden="true">
                            {mixBar}
                          </span>
                        )}
                      </td>
                      <td className="drv-wide">{role}</td>
                      <td className="drv-wide drv-status">{inactive ? "Inactive" : "Active"}</td>
                      <td className="num">{countsReady ? driver.monthAgainst : "—"}</td>
                      <td className="num">{countsReady ? driver.ytdAgainst : "—"}</td>
                      <td className="num">{countsReady ? driver.againstTotal : "—"}</td>
                      <td className="drv-wide">
                        <span className="drv-mix" title={mixTitle} aria-label={mixTitle.replace(/\n/g, ", ")}>
                          {mixBar}
                        </span>
                      </td>
                      <td className="row-menu-cell" onClick={(e) => e.stopPropagation()}>
                        <CardMenu
                          label={`Actions for ${driver.name}`}
                          className="row-menu"
                          fixed
                          items={[
                            { id: "edit", label: "Edit", icon: "pencil", onSelect: () => openEdit(driver) },
                            inactive
                              ? { id: "reactivate", label: "Reactivate", icon: "rotate-ccw", disabled: savingRoster, onSelect: () => reactivateDriver(driver) }
                              : { id: "deactivate", label: "Deactivate", icon: "user-x", disabled: savingRoster, onSelect: () => deactivateDriver(driver) },
                            ...(!hasRecords(driver.id)
                              ? [
                                  {
                                    id: "remove",
                                    label: "Remove for good",
                                    icon: "trash-2",
                                    danger: true,
                                    disabled: savingRoster,
                                    title: "No history on record — permanently delete this entry",
                                    onSelect: () => removeDriver(driver),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <div className="empty-state">No one on the roster matches.</div>}
        </div>
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

// A sortable column head: click to sort by it, again to flip the direction.
function SortTh({ col, sort, setSort, num = false, className = "", children }) {
  const on = sort.col === col;
  return (
    <th
      className={`sortable ${num ? "num" : ""} ${className}`.trim()}
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: num ? "desc" : "asc" }))}
    >
      {children}
      {on ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}
