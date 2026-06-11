import React from "react";

// Shared stacked-leaderboard components (used by Scorecard + Trends).
// One row per driver: rank · name · stacked bar (solid = period, faded = rest
// of total) · "period / total" numbers.

export function LeaderRow({ rank, row, color, max, onSelect }) {
  const total = row.ytd || 0;
  const per = Math.min(row.month || 0, total);
  const rest = total - per;
  const pct = (n) => (max > 0 ? (n / max) * 100 : 0);
  return (
    <div className="lb-row" onClick={() => onSelect && onSelect(row.driverId)}>
      <span className="lb-rank">{rank}</span>
      <span className="lb-name" title={row.name}>{row.name}</span>
      <span className="lb-track">
        <span className="lb-seg lb-seg-mo" style={{ width: `${pct(per)}%`, background: color }} />
        <span className="lb-seg lb-seg-ytd" style={{ width: `${pct(rest)}%`, background: color }} />
      </span>
      <span className="lb-nums">
        <b style={{ color }}>{row.month || 0}</b>
        <i>/</i>
        {total}
      </span>
    </div>
  );
}

export function CategoryLeaderboard({
  title,
  color,
  data,
  onSelect,
  periodLabel = "MO",
  totalLabel = "YTD",
  topN = 8,
}) {
  const [showAll, setShowAll] = React.useState(false);
  const rows = showAll ? data : data.slice(0, topN);
  const max = Math.max(1, ...data.map((r) => r.ytd || 0));
  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div className="chart-card-title">
          <span className="cc-dot" style={{ background: color }} />
          {title}
        </div>
        <div className="cc-count">
          <span className="cc-key"><i style={{ background: color }} /> {periodLabel}</span>
          <span className="cc-key"><i className="cc-key-ytd" style={{ background: color }} /> {totalLabel}</span>
          · {data.length}
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
            />
          ))
        )}
      </div>
      {data.length > topN && (
        <button className="cc-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? `Show top ${topN}` : `Show all ${data.length} →`}
        </button>
      )}
    </div>
  );
}
