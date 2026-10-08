import React from "react";
import { fmtYm, monthsText, exclusionText } from "../../data/coverage.js";
import { openCoverage } from "./nav.js";

// What a like-for-like comparison left out: one chip per category, reason and side, with
// its months ("Damage · Jul 2025, Dec 2025 · no data on file this period"). A chip opens
// Data Coverage where its reason lies. Overview and Compare show the same row.

// The month a chip opens Data Coverage at: where its reason lies — the comparison month
// when only that side lacks what this one has.
const caveatMonth = (e) => (e.side === "comparison" ? e.cmpMonths[0] : e.months[0]);

export default function LeftOut({ exclusions, phone }) {
  const [all, setAll] = React.useState(false);
  const shown = phone ? 2 : 4;
  if (!exclusions.length) return null;
  return (
    <div className="co-caveats" aria-label="Left out of the comparison">
      <span className="co-caveats-h">Left out of the comparison</span>
      {(all ? exclusions : exclusions.slice(0, shown)).map((e) => (
        <button
          key={`${e.cat}|${e.reason}|${e.side}`}
          type="button"
          className="dr-chip co-caveat"
          onClick={() => openCoverage({ ym: caveatMonth(e), cat: e.cat })}
          title={`${exclusionText(e)} — compared with ${monthsText(e.cmpMonths)}. Opens Data Coverage at ${fmtYm(caveatMonth(e))}.`}
        >
          {exclusionText(e)}
        </button>
      ))}
      {exclusions.length > shown && (
        <button type="button" className="kpi-note-n" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `+${exclusions.length - shown} more`}
        </button>
      )}
    </div>
  );
}
