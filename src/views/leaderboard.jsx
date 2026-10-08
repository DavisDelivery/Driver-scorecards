import React from "react";
import { leaderBar } from "./kit/shape.js";

// Shared stacked-leaderboard components (used by Scorecard + Trends).
// One row per driver: rank · name · stacked bar (solid = period, faded = rest
// of total) · "period / total" numbers.
//
// A Scorecard period can reach back over Jan 1 (12M in September, or a custom range),
// so it isn't always inside the year to date. Then the numbers read "period · YTD n" —
// two counts side by side, not a part of a whole — and the bar is the period alone
// (kit/shape.js leaderBar).
//
// Rows are real buttons: they were clickable divs with nothing but a hover tint to
// say so, which is why clicking a name read as a feature that didn't exist.
//
// The bars and swatches carry the category colour; every number stays in ink. A
// figure in Late's or Attempts' colour was barely readable on white.

export function LeaderRow({ rank, row, color, max, onSelect, periodLabel, totalLabel, nested = true }) {
  const total = row.ytd || 0;
  const { solid: per, faded: rest } = leaderBar(row, { nested });
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
      <span className={`lb-nums ${nested ? "" : "wide"}`.trim()}>
        <b className={row.month ? "" : "lb-zero"}>
          {row.month || 0}
        </b>
        {nested ? <i>/</i> : <i className="lb-sep">· {totalLabel}</i>}
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
  nested = true,
  note = null,
  emptyText = "No incidents",
}) {
  const [showAll, setShowAll] = React.useState(false);
  const rows = showAll ? data : data.slice(0, topN);
  const max = Math.max(1, ...data.map((r) => leaderBar(r, { nested }).whole));
  // `totals` lets the caller supply the real category totals. The rows it passes may
  // leave out deactivated drivers, and CLAUDE.md is explicit that retiring a driver
  // must never change a total — so summing the visible rows is only the fallback.
  const periodTotal = totals ? totals.period : data.reduce((a, r) => a + (r.month || 0), 0);
  const ytdTotal = totals ? totals.ytd : data.reduce((a, r) => a + (r.ytd || 0), 0);
  return (
    <div className="chart-card lb-card">
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
            <i style={{ background: color }} /> {periodLabel} <b>{periodTotal}</b>
          </span>
          {/* The faded swatch keys the faded part of the bars, so it is shown only when
              there is one: a period that isn't inside the year to date is drawn alone,
              and its YTD is a count beside it. */}
          <span
            className="cc-key"
            title={nested ? undefined : `${totalLabel}: a count beside the period, not part of its bar`}
          >
            {nested && <i className="cc-key-ytd" style={{ background: color }} />} {totalLabel} <b>{ytdTotal}</b>
          </span>
          {onOpen && (
            <button type="button" className="cc-details" onClick={onOpen}>
              Details →
            </button>
          )}
        </div>
      </div>
      {note && <div className="lb-note">{note}</div>}
      <div className="lb-body">
        {data.length === 0 ? (
          <div className="empty-state">{emptyText}</div>
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
              nested={nested}
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
