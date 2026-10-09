import React from "react";
import { fmtYm, monthsText, exclusionText } from "../../data/coverage.js";
import { openCoverage } from "./nav.js";

// What a like-for-like comparison left out, in one line inside the card it qualifies
// (the Overview hero, the Compare card): "20 category-months left out · Which · Data
// Coverage". "Which" lists each run ("Damage · Jul 2025, Dec 2025 · no data on file
// this period"), and each opens Data Coverage where its reason lies.

// The month a run opens Data Coverage at: where its reason lies — the comparison month
// when only that side lacks what this one has.
const caveatMonth = (e) => (e.side === "comparison" ? e.cmpMonths[0] : e.months[0]);

export default function LeftOut({ exclusions }) {
  const [open, setOpen] = React.useState(false);
  if (!exclusions.length) return null;
  // Each left-out (category, month) pair is one cell of the comparison.
  const cells = exclusions.reduce((a, e) => a + e.months.length, 0);
  return (
    <div className="co-leftout" aria-label="Left out of the comparison">
      <span title={exclusions.map((e) => exclusionText(e)).join("\n")}>
        {cells.toLocaleString()} category-month{cells === 1 ? "" : "s"} left out
      </span>
      <span className="co-leftout-sep" aria-hidden="true">
        ·
      </span>
      <button type="button" className="kpi-note-n" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Which"}
      </button>
      <span className="co-leftout-sep" aria-hidden="true">
        ·
      </span>
      <button type="button" className="kpi-note-n" onClick={() => openCoverage({})}>
        Data Coverage
      </button>
      {open && (
        <ul className="co-leftout-list">
          {exclusions.map((e) => (
            <li key={`${e.cat}|${e.reason}|${e.side}`}>
              <button
                type="button"
                className="kpi-note-n"
                onClick={() => openCoverage({ ym: caveatMonth(e), cat: e.cat })}
                title={`Compared with ${monthsText(e.cmpMonths)}. Opens Data Coverage at ${fmtYm(caveatMonth(e))}.`}
              >
                {exclusionText(e)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
