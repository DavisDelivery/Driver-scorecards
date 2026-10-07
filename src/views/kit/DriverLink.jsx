import React from "react";
import { useAnalytics } from "../../data/AnalyticsProvider.jsx";
import { driverDrill } from "../../data/drill.js";
import { COUNTED8 } from "../../data/categories.js";
import { nameOf } from "../../data/people.js";
import { openDrill } from "./drillNav.js";

// A driver's name that opens their record. Until Driver 360 exists that is the driver's
// drawer: their counts from the same blend as the number it sits beside, over the same
// period, so the drawer agrees with the row it was opened from.
//
//   id     the driver_id; none (unattributed) renders plain text, never a dead link
//   base   { categoryIds, scopes, scope, fault } — what the drawer counts (default: every
//          counted category, all time)
//   then   { category, x } — open narrowed to this category, x the number clicked
//   drill  a ready-made drawer state instead (a drawer opening one of its own drivers)
export default function DriverLink({ id, name, base = null, then = null, drill = null, className = "", children }) {
  const a = useAnalytics();
  const label = children || name || nameOf(a.people, id);
  if (!id) return <span className={className}>{label}</span>;
  const open = (e) => {
    e.stopPropagation();
    const b = base || {
      categoryIds: COUNTED8,
      scopes: [{ label: "All time", months: a.blend(null).months }],
    };
    openDrill(drill || driverDrill(id, b, then));
  };
  return (
    <button type="button" className={`dd-driver-link ${className}`.trim()} onClick={open} title={`Open ${nameOf(a.people, id)}`}>
      {label}
    </button>
  );
}
