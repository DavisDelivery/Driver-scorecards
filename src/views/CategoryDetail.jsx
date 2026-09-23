import React from "react";
import { buildCategoryDetail, monthsOfYear } from "../data/scorecardDetail.js";
import { IncidentDetailRow, HistoryAggRow } from "./DriverModal.jsx";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthName = (ym) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Full detail behind one Scorecard chart: every incident it counted, who they belong
// to, and how the year has gone month by month.
//
// Everything here comes from buildCategoryDetail over the Scorecard's own blend, so
// the totals at the top are the totals on the card you clicked. Deactivated drivers
// are left out of the driver table (it's a "who am I managing" list, as on the card)
// but stay in every total and in the incident list — CLAUDE.md: retiring a driver
// must never change a number.
export default function CategoryDetail({
  category,
  roleGroup,
  scorecard,
  drivers,
  hiddenDrivers,
  onSelectDriver,
  onClose,
}) {
  const { liveByYm, history, periodMonths, ytdYear, periodLabel, categoryIds } = scorecard;

  const roleOf = React.useCallback(
    (id) => drivers.find((d) => d.id === id)?.role || "driver",
    [drivers],
  );
  const inGroup = React.useCallback(
    (id) => (roleGroup === "loader" ? roleOf(id) === "loader" : roleOf(id) !== "loader"),
    [roleGroup, roleOf],
  );

  // "period" | "ytd" | a single YYYY-MM picked off the month strip.
  const [scope, setScope] = React.useState("period");
  const [query, setQuery] = React.useState("");
  const [showHistory, setShowHistory] = React.useState(true);

  const ytdMonths = React.useMemo(() => monthsOfYear(ytdYear), [ytdYear]);
  const common = { liveByYm, history, categoryId: category.id, categoryIds, inGroup };

  const periodDetail = React.useMemo(
    () => buildCategoryDetail({ ...common, scopeMonths: periodMonths }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveByYm, history, category.id, periodMonths, inGroup],
  );
  const ytdDetail = React.useMemo(
    () => buildCategoryDetail({ ...common, scopeMonths: ytdMonths }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveByYm, history, category.id, ytdMonths, inGroup],
  );
  const scopeMonths =
    scope === "period" ? periodMonths : scope === "ytd" ? ytdMonths : [scope];
  const shown = React.useMemo(
    () =>
      scope === "period"
        ? periodDetail
        : scope === "ytd"
          ? ytdDetail
          : buildCategoryDetail({ ...common, scopeMonths }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, periodDetail, ytdDetail, liveByYm, history, category.id, inGroup],
  );

  const scopeLabel =
    scope === "period" ? periodLabel : scope === "ytd" ? `YTD ${ytdYear}` : monthName(scope);

  // Driver table: this scope's count alongside the year, inactive drivers held back
  // from the list but reported as a count so the column still adds up visibly.
  const driverRows = React.useMemo(() => {
    const rows = [];
    let hiddenCount = 0;
    for (const [id, e] of shown.byDriver) {
      if (hiddenDrivers.has(id)) {
        hiddenCount += e.count;
        continue;
      }
      const roster = drivers.find((d) => d.id === id);
      rows.push({
        id,
        name: roster?.name || e.name || id,
        count: e.count,
        ytd: ytdDetail.byDriver.get(id)?.count || 0,
      });
    }
    rows.sort((a, b) => b.count - a.count || b.ytd - a.ytd || a.name.localeCompare(b.name));
    return { rows, hiddenCount };
  }, [shown, ytdDetail, drivers, hiddenDrivers]);

  // Incident list, filtered by the search box (PRO, driver, customer, notes).
  const q = query.trim().toLowerCase();
  const matches = (...fields) => !q || fields.some((f) => String(f || "").toLowerCase().includes(q));
  const incidents = shown.incidents.filter((i) =>
    matches(i.pro_number, i.driver_name, i.driver_raw, i.customer, i.to_name, i.notes, i.reason),
  );
  const historyRows = showHistory
    ? shown.historyRows.filter((r) => matches(r.driver_name))
    : [];
  const historyTotal = shown.historyRows.reduce((a, r) => a + r.count, 0);

  const maxMonth = Math.max(1, ...ytdMonths.map((ym) => ytdDetail.byMonth.get(ym) || 0));
  const inPeriod = new Set(periodMonths);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${category.title} detail`}
      >
        <div className="modal-header">
          <div>
            <div className="modal-title cd-title">
              <span className="cc-dot" style={{ background: category.color }} />
              {category.title}
            </div>
            <div className="dm-sub">
              {roleGroup === "loader" ? "LOADERS" : "DRIVERS"} · {scopeLabel}
            </div>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <div className="dm-stats">
            <button
              type="button"
              className={`dm-stat dm-stat-btn ${scope === "period" ? "active" : ""}`}
              onClick={() => setScope("period")}
            >
              <div className="dm-stat-num" style={{ color: category.color }}>{periodDetail.total}</div>
              <div className="dm-stat-lbl">{periodLabel}</div>
            </button>
            <button
              type="button"
              className={`dm-stat dm-stat-btn ${scope === "ytd" ? "active" : ""}`}
              onClick={() => setScope("ytd")}
            >
              <div className="dm-stat-num">{ytdDetail.total}</div>
              <div className="dm-stat-lbl">YTD {ytdYear}</div>
            </button>
            <div className="dm-stat">
              <div className="dm-stat-num">{shown.byDriver.size}</div>
              <div className="dm-stat-lbl">Drivers · {scopeLabel}</div>
            </div>
            <div className="dm-stat">
              <div className="dm-stat-num">{shown.incidents.filter((i) => i.has_photos).length}</div>
              <div className="dm-stat-lbl">With photos</div>
            </div>
          </div>

          {/* The year, month by month. Click a month to see just that month. */}
          <div className="cd-strip" aria-label={`${category.title} by month, ${ytdYear}`}>
            {ytdMonths.map((ym) => {
              const n = ytdDetail.byMonth.get(ym) || 0;
              const active = scope === ym;
              return (
                <button
                  key={ym}
                  type="button"
                  className={`cd-month ${active ? "active" : ""} ${inPeriod.has(ym) ? "in-period" : ""}`}
                  onClick={() => setScope(active ? "ytd" : ym)}
                  title={`${monthName(ym)}: ${n}`}
                  disabled={n === 0}
                >
                  <span className="cd-month-n">{n || ""}</span>
                  <span className="cd-month-bar">
                    <span
                      style={{
                        height: `${(n / maxMonth) * 100}%`,
                        background: category.color,
                        opacity: active || scope === "ytd" || inPeriod.has(ym) ? 1 : 0.35,
                      }}
                    />
                  </span>
                  <span className="cd-month-lbl">{MONTH_ABBR[Number(ym.slice(5, 7)) - 1]}</span>
                </button>
              );
            })}
          </div>

          <div className="cd-grid">
            <section className="cd-drivers">
              <div className="cd-h">
                By driver · {scopeLabel}
              </div>
              {driverRows.rows.length === 0 && (
                <div className="empty-state">No drivers counted in {scopeLabel}.</div>
              )}
              {driverRows.rows.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  className="cd-driver"
                  onClick={() => onSelectDriver(r.id, category.id)}
                  title={`Open ${r.name}`}
                >
                  <span className="lb-rank">{i + 1}</span>
                  <span className="cd-driver-name">{r.name}</span>
                  <span className="cd-driver-n" style={{ color: category.color }}>{r.count}</span>
                  <span className="cd-driver-ytd">{r.ytd} ytd</span>
                </button>
              ))}
              {driverRows.hiddenCount > 0 && (
                <div className="cd-note">
                  +{driverRows.hiddenCount} from inactive drivers — counted in the totals,
                  not listed.
                </div>
              )}
            </section>

            <section className="cd-incidents">
              <div className="cd-h cd-h-row">
                <span>
                  Incidents · {scopeLabel} · {shown.total}
                </span>
                <input
                  type="search"
                  className="cd-search"
                  placeholder="PRO, driver or customer"
                  aria-label="Search incidents"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {historyTotal > 0 && (
                <label className="cd-toggle">
                  <input
                    type="checkbox"
                    checked={showHistory}
                    onChange={(e) => setShowHistory(e.target.checked)}
                  />
                  Include {historyTotal} from imported history (monthly totals only — no PRO
                  or photos)
                </label>
              )}
              {incidents.length === 0 && historyRows.length === 0 && (
                <div className="empty-state">
                  {q ? "Nothing matches that search." : `Nothing counted in ${scopeLabel}.`}
                </div>
              )}
              {incidents.map((inc, idx) => (
                <IncidentDetailRow
                  key={inc.id || idx}
                  inc={inc}
                  showDriver
                  hideCategory
                  onDriver={(id) => id && onSelectDriver(id, category.id)}
                />
              ))}
              {historyRows.map((row, idx) => (
                <HistoryAggRow
                  key={`h-${row.ym}-${row.driver_id}-${idx}`}
                  row={row}
                  showDriver
                  hideCategory
                  onDriver={(id) => onSelectDriver(id, category.id)}
                />
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
