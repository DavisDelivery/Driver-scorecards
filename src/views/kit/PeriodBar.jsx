import React from "react";
import { useHashState, writeHash } from "../../data/hashState.js";

// The one filter row: period presets, a custom range, and — on the Scorecard — the
// month picker and the fault scope, all above the charts they scope and never inside a
// chart card. Day grain (the manual-entry tabs) uses period.js PERIODS and a date range;
// month grain (the Scorecard) uses MONTH_PRESETS and a month range.
//
//   value     { p, from, to }            from usePeriodState
//   onChange  (patch) => void            a partial { p } / { from } / { to }
//   anchor    { value, options, onChange, label }   month grain: the month select
//   fault     { value, onChange, disabled, title }  "all" | "driver"
//   day       { value, min, max, onChange, label }  the Scorecard's Attempts day: a
//             day of the anchor month, so it sits beside the month picker it belongs
//             to rather than inside the card it scopes
//   max       latest pickable date for a custom range (YYYY-MM-DD or YYYY-MM)
export default function PeriodBar({
  grain = "day",
  presets,
  value,
  onChange,
  anchor = null,
  fault = null,
  day = null,
  max,
  className = "",
}) {
  const customId = grain === "month" ? "custom" : "range";
  const inputType = grain === "month" ? "month" : "date";
  return (
    <div className={`period-bar ${className}`.trim()}>
      {anchor && (
        <select
          className="period-anchor"
          value={anchor.value}
          onChange={(e) => anchor.onChange(e.target.value)}
          aria-label={anchor.label || "Month"}
        >
          {anchor.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <div className="month-picker" role="group" aria-label="Period">
        {presets.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`month-btn ${value.p === v ? "active" : ""}`}
            aria-pressed={value.p === v}
            onClick={() => onChange({ p: v })}
          >
            {label}
          </button>
        ))}
      </div>
      {value.p === customId && (
        <div className="custom-range">
          <input
            type={inputType}
            value={value.from}
            max={max}
            onChange={(e) => onChange({ from: e.target.value })}
            aria-label="From"
          />
          <span className="meta">to</span>
          <input
            type={inputType}
            value={value.to}
            max={max}
            onChange={(e) => onChange({ to: e.target.value })}
            aria-label="To"
          />
        </div>
      )}
      {day && (
        <label className="period-day" title={day.title}>
          <span className="period-day-lbl">{day.label || "Day"}</span>
          <input
            type="date"
            value={day.value || ""}
            min={day.min}
            max={day.max}
            onChange={(e) => day.onChange(e.target.value)}
          />
        </label>
      )}
      {fault && (
        <div className="month-picker" role="group" aria-label="Fault scope">
          <button
            type="button"
            className={`month-btn ${fault.value === "all" ? "active" : ""}`}
            aria-pressed={fault.value === "all"}
            onClick={() => fault.onChange("all")}
          >
            All Incidents
          </button>
          <button
            type="button"
            className={`month-btn ${fault.value === "driver" ? "active" : ""}`}
            aria-pressed={fault.value === "driver"}
            onClick={() => fault.onChange("driver")}
            disabled={fault.disabled}
            title={fault.title}
          >
            Driver Fault Only
          </button>
        </div>
      )}
    </div>
  );
}

// A tab's period selection, kept in the URL hash under that tab's own namespace
// (`${ns}.p`, `${ns}.from`, `${ns}.to`) so it survives a tab switch and travels with a
// link. A preset the tab doesn't offer (a hand-edited or stale link) reads as the
// default rather than as nothing.
export function usePeriodState(ns, presets, fallback) {
  const [rawP] = useHashState(`${ns}.p`, fallback);
  const [from] = useHashState(`${ns}.from`, "");
  const [to] = useHashState(`${ns}.to`, "");
  const p = presets.some(([v]) => v === rawP) ? rawP : fallback;
  const value = React.useMemo(() => ({ p, from, to }), [p, from, to]);
  const onChange = React.useCallback(
    (patch) => {
      const out = {};
      if ("p" in patch) out[`${ns}.p`] = patch.p === fallback ? null : patch.p;
      if ("from" in patch) out[`${ns}.from`] = patch.from || null;
      if ("to" in patch) out[`${ns}.to`] = patch.to || null;
      writeHash(out);
    },
    [ns, fallback],
  );
  return [value, onChange];
}
