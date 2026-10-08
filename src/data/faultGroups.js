// Whose fault an entry was, in the few groups every screen and the weekly PDF count by.
//
// The Scorecard and the PDF cover each had their own "Exonerated": the Scorecard's
// took exonerated, preload, warehouse and customer, the PDF's took exonerated,
// preload, warehouse and vendor. So the same report could exonerate a customer-fault
// entry on screen and not in print, and a vendor one the other way round. One mapping
// now, imported by both.
//
//   driver        the driver's fault
//   not_driver    someone else's: exonerated, preload, warehouse, customer, vendor
//   not_reviewed  nobody has said yet: unknown, empty, missing
//   other         free text typed into the field ("ZACH"): reviewed by somebody, but
//                 not a group anyone can count as one or the other
//
// Late rows. All Incidents swaps the fault dropdown for a late-reason dropdown on a
// late row (IncidentTable.jsx isLateRow), so a late row's fault stays "unknown" however
// carefully it was reviewed: 102 of the 105 late rows that counted on 10/07 read
// unknown, 24 of them with a reason set. A late row with a reason counts as reviewed
// here, in a group of its own:
//
//   late_reason   a late row whose fault is unset but whose late reason is set
//
// It is deliberately NOT mapped onto driver or not-driver. Two of the reasons —
// "attempted" and "unable to locate", the commonest — don't say whose fault it was,
// and the reasons are marked "do not fault driver" one way or the other row by row
// (264 attempted late rows are, 13 aren't). A fault someone did set on a late row still
// wins over its reason.

export const FAULT_GROUP_ORDER = ["driver", "not_driver", "late_reason", "other", "not_reviewed"];

export const FAULT_GROUP_LABEL = {
  driver: "Driver fault",
  not_driver: "Not driver's fault",
  late_reason: "Late, reason given",
  other: "Other (typed in)",
  not_reviewed: "Not reviewed",
};

// The fault codes that clear the driver.
export const NOT_DRIVER_FAULTS = ["exonerated", "preload", "warehouse", "customer", "vendor"];

const NOT_DRIVER = new Set(NOT_DRIVER_FAULTS);

// One fault value → its group. Matched exactly, as countsTowardCharts matches
// "driver", so the Driver fault tile and the Driver-fault scope count the same rows.
// Every FAULT_CODES id lands in driver, not_driver or not_reviewed
// (test/fault-groups.test.mjs); anything else was typed in.
export function faultGroup(fault) {
  if (fault === undefined || fault === null || fault === "" || fault === "unknown") return "not_reviewed";
  if (fault === "driver") return "driver";
  if (NOT_DRIVER.has(fault)) return "not_driver";
  return "other";
}

// The rows All Incidents gives a late-reason dropdown instead of a fault one.
export const isLateRow = (inc) =>
  (Array.isArray(inc?.sources) && inc.sources.includes("laters")) || inc?.category === "late";

// One entry → its group: its fault's, or late_reason for a late row whose fault is
// unset and whose reason isn't.
export function reviewGroup(inc) {
  const g = faultGroup(inc?.fault);
  if (g === "not_reviewed" && isLateRow(inc) && inc?.late_reason) return "late_reason";
  return g;
}

// Reviewed: somebody said whose fault it was, or why it was late.
export const isReviewed = (group) => group === "driver" || group === "not_driver" || group === "late_reason";

// A list of entries split by group:
//   { total, reviewed, groups: { [group]: { n, ids } } }
// Every group is present, zeros included, so a tile can read any of them.
export function faultSplit(rows) {
  const groups = Object.fromEntries(FAULT_GROUP_ORDER.map((g) => [g, { n: 0, ids: [] }]));
  let reviewed = 0;
  for (const inc of rows || []) {
    const g = reviewGroup(inc);
    groups[g].n += 1;
    groups[g].ids.push(inc.id);
    if (isReviewed(g)) reviewed += 1;
  }
  return { total: (rows || []).length, reviewed, groups };
}
