import React from "react";
import { leaderBar, displayName, textWidth } from "./kit/shape.js";

// Shared category leaderboards (Scorecard + Trends): one row per driver — rank, name,
// the period's bar on a pale track with the year to date as a thin gray line directly
// under it, and the two counts at the end.
//
// A Scorecard period can reach back over Jan 1 (12M in September, or a custom range),
// so it isn't always inside the year to date. Then the numbers read "period · YTD n" —
// two counts side by side, not a part of a whole — and only the period's bar is drawn
// (kit/shape.js leaderBar).
//
// Rows are real buttons: they were clickable divs with nothing but a hover tint to say
// so. The bars carry the category colour; every number stays in ink.

export function LeaderRow({ rank, row, color, max, onSelect, periodLabel, totalLabel, nested = true }) {
  const total = row.ytd || 0;
  const { solid: per, whole } = leaderBar(row, { nested });
  const pct = (n) => (max > 0 && n > 0 ? `max(2px, ${(n / max) * 100}%)` : "0");
  const clickable = !!onSelect;
  const Tag = clickable ? "button" : "div";
  const name = displayName(row.name);
  return (
    <Tag
      type={clickable ? "button" : undefined}
      className={`lb-row ${clickable ? "lb-row-btn" : ""}`.trim()}
      onClick={clickable ? () => onSelect(row.driverId) : undefined}
      title={`${row.name} — ${row.month || 0} ${periodLabel || ""} · ${total} ${totalLabel || ""}${clickable ? ". Click for detail." : ""}`}
    >
      <span className="lb-rank">{rank}</span>
      <span className="lb-name">{name}</span>
      <span className="lb-bars" aria-hidden="true">
        <span className="lb-track">
          <span className="lb-bar" style={{ width: pct(per), background: color }} />
        </span>
        {/* The year to date, scaled to the same maximum: only when the period is part of
            it, so the line is never a length no number on the row states. */}
        {nested && <span className="lb-ytd" style={{ width: pct(whole) }} />}
      </span>
      <span className="lb-nums">
        <b className={row.month ? "" : "lb-zero"}>{row.month || 0}</b>
        {nested ? " / " : ` · ${totalLabel} `}
        {total}
      </span>
    </Tag>
  );
}

export function CategoryLeaderboard({
  title,
  color,
  data,
  onSelect,
  onOpen,
  periodLabel = "This month",
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
  // The numbers' column is as wide as its widest "12 · YTD 40" (or "3 / 12"), so it
  // never runs past the card's edge.
  const widest = rows.reduce((w, r) => {
    const text = nested ? `${r.month || 0} / ${r.ytd || 0}` : `${r.month || 0} · ${totalLabel} ${r.ytd || 0}`;
    return Math.max(w, textWidth(text, 12.5));
  }, 0);
  const numsW = Math.max(44, Math.ceil(widest + 6));
  return (
    <div className="chart-card lb-card">
      <div className="lb-head">
        <div className="lb-head-row">
          <span className="lb-swatch" style={{ background: color }} aria-hidden="true" />
          {onOpen ? (
            <button
              type="button"
              className="lb-title"
              onClick={onOpen}
              title={`Open every ${title.toLowerCase()} incident behind this chart`}
            >
              {title}
            </button>
          ) : (
            <div className="lb-title">{title}</div>
          )}
          {onOpen && (
            <button type="button" className="lb-details" onClick={onOpen}>
              Details
            </button>
          )}
        </div>
        <div
          className="lb-key"
          title={nested ? `Bar: ${periodLabel}. Gray line under it: ${totalLabel}.` : `${totalLabel}: a count beside the period, not part of its bar`}
        >
          {periodLabel} <b>{periodTotal}</b> · {totalLabel} <b>{ytdTotal}</b>
        </div>
      </div>
      {note && <div className="lb-note">{note}</div>}
      <div className="lb-body" style={{ "--bl-value": `${numsW}px` }}>
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
        <button type="button" className="lb-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? `Show top ${topN}` : `Show all ${data.length} drivers`}
        </button>
      )}
    </div>
  );
}
