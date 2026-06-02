// Driver roster seed + fault/category vocabularies for the Davis Driver Scorecard.
// Drivers are loaded from the data-drivers Netlify function at runtime; SEED_DRIVERS
// is used only to seed an empty store (see seeding logic in App).

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
  { name: "Theo", role: "driver" },
  { name: "Scott", role: "driver" },
  { name: "Mandi", role: "driver" },
  { name: "Darvin", role: "driver" },
  { name: "Bonzo", role: "driver" },
  { name: "Kazeem", role: "driver" },
  { name: "Watkins", role: "non-driver" },
  { name: "Frank", role: "non-driver" },
  { name: "Leroy", role: "driver" },
  { name: "Kostner", role: "non-driver" },
  { name: "Terrance", role: "driver" },
  { name: "Teerrance", role: "driver" },
  { name: "Brett", role: "non-driver" },
  { name: "Richard", role: "non-driver" },
  { name: "Marcus Crumpton", role: "driver" },
  { name: "Denis", role: "driver" },
  { name: "AB", role: "driver" },
  { name: "Victor", role: "non-driver" },
  { name: "Fred", role: "non-driver" },
  { name: "Enock", role: "non-driver" },
  { name: "Frye", role: "non-driver" },
  { name: "Samuel", role: "driver" },
  { name: "Nelson", role: "driver" },
  { name: "Montel", role: "driver" },
  { name: "Stephen", role: "driver" },
  { name: "Chris", role: "non-driver" },
  { name: "Marcus", role: "driver" },
];

// Incident categories (used across the scorecard, incident tables, and trends).
export const INCIDENT_CATEGORIES = [
  { id: "late", label: "Late", color: "#facc15" },
  { id: "damage", label: "Damage", color: "#dc3545" },
  { id: "missing", label: "Lost/Missing", color: "#a855f7" },
  { id: "misdelivery", label: "Misdelivery", color: "#f472b6" },
  { id: "forgotten_freight", label: "Forgotten Freight", color: "#f97316" },
  { id: "attempts", label: "Attempts", color: "#14b8a6" },
  { id: "complaint", label: "Complaint", color: "#ef4444" },
  { id: "compliment", label: "Compliment", color: "#22c55e" },
  { id: "return", label: "Return", color: "#3b82f6" },
  { id: "trace", label: "Trace", color: "#64748b" },
];

// Fault attribution codes for an incident.
export const FAULT_CODES = [
  { id: "driver", label: "Driver Fault", color: "#dc3545" },
  { id: "preload", label: "Preload (Wh)", color: "#d4a017" },
  { id: "warehouse", label: "Warehouse", color: "#d4a017" },
  { id: "customer", label: "Customer", color: "#64748b" },
  { id: "vendor", label: "Vendor (Uline)", color: "#64748b" },
  { id: "exonerated", label: "Exonerated", color: "#22c55e" },
  { id: "unknown", label: "Unknown", color: "#6b7891" },
];

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
