import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { buildCoverage, ulineCoverage } from "../../data/coverage.js";

// The coverage of every (month, category) cell (coverage.js), from the all-fault blend:
// the Uline reports' days, the history documents that exist, today's month as the one
// still in progress, and the live rows (a hand-logged entry never rolls up, so it is no
// disagreement). Company History reads its numbers through it; Trends and Reports read
// what a year captured and compare years like-for-like through the same one.
//   → { cov, uline }
export default function useCoverage(today) {
  const a = useAnalytics();
  const blend = a.blend(null);
  const uline = React.useMemo(() => ulineCoverage(a.reports, a.incidents), [a.reports, a.incidents]);
  const cov = React.useMemo(
    () => buildCoverage({ blend, historyMonthIds: a.historyState.monthIds, uline, today, incidents: a.incidents }),
    [blend, a.historyState.monthIds, uline, today, a.incidents],
  );
  return { cov, uline };
}
