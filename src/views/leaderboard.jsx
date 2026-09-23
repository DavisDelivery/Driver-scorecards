import React from "react";

// Shared stacked-leaderboard components (used by Scorecard + Trends).
// One row per driver: rank · name · stacked bar (solid = period, faded = rest
// of total) · "period / total" numbers.
//
// Rows are real buttons: they were clickable divs with nothing but a hover tint to
// say so, which is why clicking a name read as a feature that didn't exist.

export function LeaderRow({ rank, row, color, max, onSelect, periodLabel, totalLabel }) {
  const total = row.ytd || 0;
  const per = Math.min(row.month || 0, total);
  const rest = total - per;
  const pct = (n) => (max > 0 ? (n / max) * 100 : 0);
  const clickable = !!onSelect;
  const Tag = clickable ? "button" : "div";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      className={`lb-row ${clickable ? "lb-row-btn" : ""}`}
      onClick={clickable ? () => onSelect(row.driverId) : undefined}
      title={
        clickable
          ? `${row.name} — ${row.month || 0} ${periodLabel || ""} · ${total} ${totalLabel || ""}. Click for detail.`
          : undefined
      }
    >
      <span className="lb-rank">{rank}</span>
      <span className="lb-name">{row.name}</span>
      <span className="lb-track">
        <span className="lb-seg lb-seg-mo" style={{ width: `${pct(per)}%`, background: color }} />
        <span className="lb-seg lb-seg-ytd" style={{ width: `${pct(rest)}%`, background: color }} />
      </span>
      <span className="lb-nums">
        <b style={{ color: row.month ? color : undefined }} className={row.month ? "" : "lb-zero"}>
          {row.month || 0}
        </b>
        <i>/</i>
        <span className="lb-total">{total}</span>
      </span>
      {clickable && <span className="lb-chev" aria-hidden="true">›</span>}
    </Tag>
  );
}

export function CategoryLeaderboard({
  title,
  color,
  data,
  onSelect,
  onOpen,
  periodLabel = "MO",
  totalLabel = "YTD",
  topN = 8,
  totals = null,
}) {
  const [showAll, setShowAll] = React.useState(false);
  const rows = showAll ? data : data.slice(0, topN);
  const max = Math.max(1, ...data.map((r) => r.ytd || 0));
  // `totals` lets the caller supply the real category totals. The rows it passes may
  // leave out deactivated drivers, and CLAUDE.md is explicit that retiring a driver
  // must never change a total — so summing the visible rows is only the fallback.
  const periodTotal = totals ? totals.period : data.reduce((a, r) => a + (r.month || 0), 0);
  const ytdTotal = totals ? totals.ytd : data.reduce((a, r) => a + (r.ytd || 0), 0);
  return (
    <div className="chart-card">
      <div className="chart-card-header">
        {onOpen ? (
          <button
            type="button"
            className="chart-card-title cc-open"
            onClick={onOpen}
            title={`Open every ${title.toLowerCase()} incident behind this chart`}
          >
            <span className="cc-dot" style={{ background: color }} />
            {title}
          </button>
        ) : (
          <div className="chart-card-title">
            <span className="cc-dot" style={{ background: color }} />
            {title}
          </div>
        )}
        <div className="cc-count">
          <span className="cc-key">
            <i style={{ background: color }} /> {periodLabel} <b style={{ color }}>{periodTotal}</b>
          </span>
          <span className="cc-key">
            <i className="cc-key-ytd" style={{ background: color }} /> {totalLabel} <b>{ytdTotal}</b>
          </span>
          {onOpen && (
            <button type="button" className="cc-details" onClick={onOpen}>
              Details →
            </button>
          )}
        </div>
      </div>
      <div className="lb-body">
        {data.length === 0 ? (
          <div className="empty-state">No incidents</div>
        ) : (
          rows.map((row, i) => (
            <LeaderRow
              key={row.driverId || row.name}
              rank={i + 1}
              row={row}
              color={color}
              max={max}
              onSelect={onSelect}
              periodLabel={periodLabel}
              totalLabel={totalLabel}
            />
          ))
        )}
      </div>
      {data.length > topN && (
        <button className="cc-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? `Show top ${topN}` : `Show all ${data.length} drivers →`}
        </button>
      )}
    </div>
  );
}
