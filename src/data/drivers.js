// Driver roster seed + fault/category vocabularies for the Davis Driver Scorecard.
// Drivers are loaded from the data-drivers Netlify function at runtime; SEED_DRIVERS
// is used only to seed an empty store (see seeding logic in App).
import { catLabel, catColor } from "./categories.js";

export const SEED_DRIVERS = [
  { name: "Aaron Mitchell", role: "driver" },
  { name: "Allen Council", role: "driver" },
  { name: "Anthony Bennett", role: "driver" },
  { name: "Ben Paintsil", role: "driver" },
  { name: "Brian Worley", role: "driver" },
  { name: "Colin Calhoun", role: "driver" },
  { name: "DJ McCrary", role: "driver" },
  { name: "Enock Akyea", role: "driver" },
  { name: "Fred Andi", role: "driver" },
  { name: "Frank Okine", role: "driver" },
  { name: "George Leonard", role: "driver" },
  { name: "Jean Delsion", role: "driver" },
  { name: "Jim Pallette", role: "driver" },
  { name: "John Thompson", role: "driver" },
  { name: "Ken Watkins", role: "driver" },
  { name: "Kobe Kawakabe", role: "driver" },
  { name: "Leroy Smith", role: "driver" },
  { name: "Mandi Malbrough", role: "driver" },
  { name: "Marcus Crumpton", role: "driver" },
  { name: "Martin Wyatt", role: "driver" },
  { name: "Michael Carter", role: "driver" },
  { name: "Michael Frye", role: "driver" },
  { name: "Michael Tharp", role: "driver" },
  { name: "Mone Watkins", role: "driver" },
  { name: "Nana Owusu", role: "driver" },
  { name: "Olamide Kazeem", role: "driver" },
  { name: "Oyieke Nelson", role: "driver" },
  { name: "Rasheed Davis", role: "driver" },
  { name: "Richard Mawuenyega", role: "driver" },
  { name: "Ronald Gates", role: "driver" },
  { name: "Samuel Osei", role: "driver" },
  { name: "Steven Adjetey", role: "driver" },
  { name: "Tariq Hammou", role: "driver" },
  { name: "Terrance Taylor", role: "driver" },
  { name: "Terry Gambrell", role: "driver" },
  { name: "Theo Afunyah", role: "driver" },
  { name: "Vincent Bonzo", role: "driver" },
  { name: "William Kidd", role: "driver" },
  { name: "Anthony Kostner", role: "driver" },
  { name: "Brett Spradley", role: "driver" },
  { name: "Brent Boyd", role: "driver" },
  { name: "Che Roberts", role: "driver" },
  { name: "Chris Head", role: "driver" },
  { name: "Darvin Cepeda", role: "driver" },
  { name: "Denis Suljic", role: "driver" },
  { name: "Garry Pitts", role: "driver" },
  { name: "Joe Gibbs", role: "driver" },
  { name: "Junior Thomas", role: "driver" },
  { name: "Marcus Young", role: "driver" },
  { name: "Montel Bishop", role: "driver" },
  { name: "Rasko Suljic", role: "driver" },
  { name: "Robert Best", role: "driver" },
  { name: "Scott Hart", role: "driver" },
  { name: "Terrance Hawk", role: "driver" },
  { name: "Tobias Johnson", role: "driver" },
  { name: "Trevarr Howard", role: "driver" },
  { name: "Victor Fernandez", role: "driver" },
  { name: "William Goodwin", role: "non-driver" },
  { name: "Eugene Sage", role: "driver" },
  { name: "Sammy Graham", role: "driver" },
  { name: "Prince Buckle", role: "driver" },
  { name: "Ricardo Burrowes", role: "driver" },
];

// NOTE: the seed used to end with a tail of ~26 single-name rows (Theo, Scott,
// Mandi, Kazeem, Frye, Teerrance, Marcus, …) that duplicated drivers already listed
// above under their full names. They were not harmless clutter — a bare first name
// on the roster actively BREAKS attribution, because matchDriver's first-name
// fallback only fires when exactly one driver shares that first name. With both
// "Scott" and "Scott Hart" present, a NuVizz name that should have resolved to
// Scott Hart matched nothing at all. Keep this list to full names only.

// Incident categories (used across the scorecard, incident tables, and trends), in
// the order the editor and the incident filters list them. Labels and colours come
// from the category registry (categories.js) — this list used to carry its own
// colours, and its Forgotten Freight orange no longer matched the charts'.
//
// Unable to Track is here so the incident log and editor can NAME it; the scorecard,
// trends and history rollups leave it out — it is a record of a failed lookup, not
// something charged to anyone (its polarity in the registry is "excluded").
export const INCIDENT_CATEGORIES = [
  "late",
  "damage",
  "missing",
  "misdelivery",
  "forgotten_freight",
  "attempts",
  "complaint",
  "compliment",
  "return",
  "trace",
  "unable_to_track",
].map((id) => ({ id, label: catLabel(id), color: catColor(id) }));

// Fault attribution codes for an incident. These colours are status (who is at fault),
// not category identity — exonerated is the status green, not Compliment's.
export const FAULT_CODES = [
  { id: "driver", label: "Driver Fault", color: "#dc3545" },
  { id: "preload", label: "Preload (Wh)", color: "#d4a017" },
  { id: "warehouse", label: "Warehouse", color: "#d4a017" },
  { id: "customer", label: "Customer", color: "#64748b" },
  { id: "vendor", label: "Vendor (Uline)", color: "#64748b" },
  { id: "exonerated", label: "Exonerated", color: "#16a34a" },
  { id: "unknown", label: "Unknown", color: "#6b7891" },
];

// Roster roles, shared by the Drivers roster editor and every "assign to
// driver" picker.
export const ROLES = [
  { id: "driver", label: "Driver" },
  { id: "loader", label: "Loader" },
  { id: "non-driver", label: "Non-Driver" },
];

// Stable, collision-free id for a driver added through the roster editor
// (seeded drivers use drv_{index}_{slug} instead; see buildSeededDrivers).
export function newDriverId() {
  return `drv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Uline source reports an incident physically came in on (distinct from the
// derived fault category). One incident can carry more than one of these.
export const ULINE_SOURCES = [
  { id: "laters", label: "Late" },
  { id: "returns", label: "Return" },
  { id: "traces", label: "Trace" },
];
export const SOURCE_LABELS = Object.fromEntries(
  ULINE_SOURCES.map((s) => [s.id, s.label]),
);

// Controlled late-reason options. On Late-source rows this REPLACES the fault
// dropdown; everywhere else the fault dropdown is unchanged.
export const LATE_REASONS = [
  { id: "attempted", label: "Attempted" },
  { id: "unable_to_locate", label: "Unable to Locate" },
  { id: "forgotten_freight", label: "Forgotten Freight" },
  { id: "closed_mondays", label: "Closed Mondays" },
  { id: "closed_fridays", label: "Closed Fridays" },
  { id: "forgot_close_out", label: "Forgot Close Out" },
  { id: "hold_per_uline", label: "Hold per Uline" },
  { id: "hold_vet_equip", label: "Hold Vet Equip" },
  { id: "holiday", label: "Holiday" },
];
export const LATE_REASON_LABELS = Object.fromEntries(
  LATE_REASONS.map((r) => [r.id, r.label]),
);

// Collapse duplicate driver names (case-insensitive), keeping the longest spelling,
// then sort alphabetically by name.
export function dedupeDrivers(list) {
  const byName = new Map();
  for (const d of list) {
    const key = d.name.trim().toLowerCase();
    if (!byName.has(key) || byName.get(key).name.length < d.name.length) {
      byName.set(key, d);
    }
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

// Build the seeded roster from SEED_DRIVERS with stable ids (drv_{index}_{slug}).
export function buildSeededDrivers() {
  return dedupeDrivers(SEED_DRIVERS).map((d, i) => ({
    id: `drv_${i}_${d.name.replace(/[^a-z0-9]/gi, "").toLowerCase()}`,
    ...d,
    active: true,
  }));
}

// Classify the responsible party for an incident from a reason + notes blob.
export function classifyFault(reason = "", notes = "") {
  const s = `${reason} ${notes}`.toUpperCase();
  if (/\bNON[- ]?DRIVER\b/.test(s)) {
    return /PRELOAD(ED)?/.test(s) ? "preload" : "warehouse";
  }
  if (/PRELOAD(ED)?/.test(s)) return "preload";
  if (
    /\bSW INTACT\b|SHRINKWRAP INTACT|PALLETS? INTACT|PALLET LOOKS? (GOOD|GREAT)/.test(
      s,
    )
  )
    return "exonerated";
  if (
    /POORLY BUILT|SKID BUILT.*POOR|BUILT VERY POORLY|NAILS IN (THE )?PALLET/.test(
      s,
    )
  )
    return "vendor";
  if (
    /CLOSED ON|CST (REQ|REQUESTED)|CUSTOMER LEFT|LEFT EARLY|TURNED AWAY|CLOSED @|CLOSED DUE TO/.test(
      s,
    )
  )
    return "customer";
  if (/\bAB HAD IT\b/.test(s)) return "warehouse";
  if (/RIDICULOUS/.test(s)) return "exonerated";
  return "unknown";
}

// Deactivating a driver retires them from the operational views: they drop out
// of driver charts, leaderboards and scorecards so those show only the people
// currently being managed. Their incidents are NOT deleted and still count in
// company totals and logs — deactivating someone must never retroactively
// change a number that has already been reported.
//
// Returns the ids to hide. A driver_id with no roster row is deliberately NOT
// hidden: unknown ids (legacy imports, since-removed drivers) would otherwise
// vanish silently, which is the failure mode this app has been bitten by.
export function hiddenDriverIds(drivers) {
  return new Set(
    (drivers || []).filter((d) => d && d.active === false).map((d) => d.id),
  );
}
