// Who a driver id is: name, role, roster status and the span of their record, plus the
// peer sets and fleet statistics the benchmark views compare a driver against.
//
// Two reporting rules live here so no view has to remember them:
//   - an id with no roster row is never hidden. It is named from the data (the incident
//     or history row that carries it) and counts as active, so it shows everywhere.
//   - a deactivated driver is hidden from pickers and peer sets only. Totals are never
//     filtered through this file.
import { incidentYm } from "./incidentDate.js";
import { historyYm } from "./blend.js";
import { matchDriver } from "./driverMatch.js";

// Map(id -> { id, name, role, active, onRoster, rawNames, firstOnFile, lastOnFile })
//
// rawNames are the NuVizz load-driver names on rows charged to this id that resolve back
// to the same person (matchDriver). driver_raw is the load's driver, not an alias: on
// about one row in eight a manual entry is charged to someone else, and listing those
// names would put other people under this driver.
export function personIndex({ drivers = [], incidents = [], history = [] } = {}) {
  const out = new Map();
  const ensure = (id, name) => {
    let p = out.get(id);
    if (!p) {
      p = {
        id,
        name: name || "",
        role: "driver",
        active: true,
        onRoster: false,
        rawNames: new Set(),
        firstOnFile: "",
        lastOnFile: "",
      };
      out.set(id, p);
    }
    if (!p.name && name) p.name = name;
    return p;
  };
  const span = (p, ym) => {
    if (!ym) return;
    if (!p.firstOnFile || ym < p.firstOnFile) p.firstOnFile = ym;
    if (!p.lastOnFile || ym > p.lastOnFile) p.lastOnFile = ym;
  };

  for (const d of drivers || []) {
    if (!d || !d.id) continue;
    const p = ensure(d.id, d.name);
    p.name = d.name || p.name;
    p.role = d.role || "driver";
    p.active = d.active !== false;
    p.onRoster = true;
  }
  const checked = new Set(); // "id|raw" pairs already put through matchDriver
  for (const inc of incidents || []) {
    if (!inc || !inc.driver_id) continue;
    const p = ensure(inc.driver_id, inc.driver_name || inc.driver_raw);
    span(p, incidentYm(inc));
    const raw = String(inc.driver_raw || "").trim();
    const key = `${inc.driver_id}|${raw}`;
    if (!raw || checked.has(key)) continue;
    checked.add(key);
    if (matchDriver(raw, drivers || [])?.id === inc.driver_id) p.rawNames.add(raw);
  }
  for (const rec of history || []) {
    if (!rec || !rec.driver_id) continue;
    span(ensure(rec.driver_id, rec.driver_name), historyYm(rec));
  }
  for (const p of out.values()) if (!p.name) p.name = p.id;
  return out;
}

// The name to show for an id: the roster's, else the data's, else the id itself.
export function nameOf(index, id) {
  if (!id) return "Unattributed";
  return index?.get(id)?.name || id;
}

// The ids a benchmark compares against: active roster rows in the role group, plus every
// id seen in scope that has no roster row (unknown is never invisible). Role groups are
// the Scorecard's: "loader" is loaders; "driver" is everyone else (drivers and
// non-drivers). Inactive drivers are left out — they are not being managed.
export function peerSet(drivers = [], seenIds = [], group = "driver") {
  const inGroup = (role) => (group === "loader" ? role === "loader" : role !== "loader");
  const onRoster = new Set();
  const out = [];
  for (const d of drivers || []) {
    if (!d || !d.id) continue;
    onRoster.add(d.id);
    if (d.active !== false && inGroup(d.role || "driver")) out.push(d.id);
  }
  for (const id of seenIds || []) {
    if (id && !onRoster.has(id) && group !== "loader" && !out.includes(id)) out.push(id);
  }
  return out;
}

// Nearest-rank statistics over every value given, zeros included — a peer with no
// incidents is a 0 in the set, not a missing value. Empty input gives nulls.
export function fleetStats(values = []) {
  const v = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { median: null, p90: null, mean: null };
  const rank = (p) => v[Math.max(1, Math.ceil((p / 100) * v.length)) - 1];
  return { median: rank(50), p90: rank(90), mean: v.reduce((a, x) => a + x, 0) / v.length };
}

// Where v stands among values, highest first: rank = 1 + how many are strictly higher.
// `tied` says someone else holds the same value, so the rank is shared.
export function rankOf(values = [], v) {
  let higher = 0;
  let same = 0;
  for (const x of values) {
    if (x > v) higher++;
    else if (x === v) same++;
  }
  return { rank: higher + 1, tied: same > 1, of: values.length };
}
