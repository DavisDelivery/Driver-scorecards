// Guards the one definition of an attempt (src/data/attemptRecords.js).
//
// The builder was lifted out of the Attempts tab, where it was written inline. The
// first job of these tests is to prove the move changed no number: `legacyRecords`
// below is the tab's v0.19.1 code, copied verbatim, and every record the new builder
// returns must match it field for field — the one intended difference being the
// same-day, same-PRO guard on hand-logged rows, which is tested on its own.
//
// Set DDS_PARITY_FIXTURE to a JSON file of { feedDays: {date: feed response},
// incidents, drivers } to run the same parity check against a production pull.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupAttemptLegs } from "../src/data/attemptLegs.js";
import { matchDriver } from "../src/data/driverMatch.js";
import {
  buildAttemptRecords,
  feedRecord,
  overrideIndex,
  normPro,
  normState,
  customerKey,
  attemptOutcome,
  driverKey,
  feedAttribution,
  feedOrderIndex,
  feedOrderFor,
  ATTRIBUTED_BY_TEXT,
} from "../src/data/attemptRecords.js";

// ---- the v0.19.1 Attempts tab, verbatim (ManualEntry.jsx feedRecords + analyticsRecords)
function legacyRecords({ periodRows, incidents, drivers, category = "attempts" }) {
  const logIncidents = incidents
    .filter((i) => i.category === category)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const overrides = new Map();
  for (const i of logIncidents) {
    if (!i.attempt_stop_nbr) continue;
    overrides.set(
      `${i.attempt_stop_nbr}|${(i.delivered_date || "").slice(0, 10)}`,
      i,
    );
  }
  const feedRecords = groupAttemptLegs(periodRows).map((a) => {
    const ov = [a, ...a.legRows]
      .map((l) => overrides.get(`${l.stopNbr}|${a.date}`))
      .find(Boolean);
    const matched = ov ? null : matchDriver(a.originalDriverName || "", drivers);
    return {
      id: `feed:${a.date}:${a.stopNbr}`,
      pro_number: a.shipmentNbr || a.stopNbr,
      category,
      driver_id: ov?.driver_id || matched?.id || null,
      driver_name: ov?.driver_name || matched?.name || a.originalDriverName || "",
      driver_raw: a.originalDriverName || "",
      customer: a.businessName || "",
      to_city: a.city || "",
      to_state: a.state || "",
      delivered_date: a.date,
      created_at: a.detectedAt || a.date,
      notes: a.note || "",
      from_feed: true,
      attempt: a,
    };
  });
  return [...feedRecords, ...logIncidents.filter((i) => !i.attempt_stop_nbr)];
}
// The v0.19.1 by-driver key, and its per-driver tally.
const legacyKey = (i, drivers) =>
  i.driver_id ||
  `name:${i.driver_name || drivers.find((d) => d.id === i.driver_id)?.name || i.driver_raw || "Unassigned"}`;
const tally = (rows, keyFn) => {
  const m = {};
  for (const r of rows) m[keyFn(r)] = (m[keyFn(r)] || 0) + 1;
  return m;
};

// Every field the old record had must come through unchanged; `attempt` is now `order`.
function assertSameRecords(newRecs, oldRecs) {
  assert.equal(newRecs.length, oldRecs.length, "record count");
  oldRecs.forEach((o, n) => {
    const r = newRecs[n];
    for (const k of Object.keys(o)) {
      if (k === "attempt") assert.deepEqual(r.order, o.attempt, `record ${n} order`);
      else assert.deepEqual(r[k], o[k], `record ${n} (${o.id}) field ${k}`);
    }
  });
}

// Feed days in the shape fetchAttemptsRange returns: rows stamped with their day.
const daysOf = (byDate) =>
  new Map(
    Object.entries(byDate).map(([date, rows]) => [
      date,
      { status: "ok", rows: rows.map((r) => ({ ...r, date, planMissing: false })) },
    ]),
  );
const flatRows = (days) => [...days.values()].flatMap((d) => d.rows);

const row = (stopNbr, over = {}) => ({
  stopNbr,
  shipmentNbr: `ATT${stopNbr.replace(/-\d+$/, "")}`,
  originalDriverName: null,
  businessName: "ACME SUPPLY",
  city: "NORCROSS",
  state: "GA",
  zip: "30071",
  currentStatus: "UNPLANNED",
  currentlyUnplanned: true,
  detectedAt: "2026-09-12T03:00:41.833Z",
  ...over,
});

const DRIVERS = [
  { id: "drv_tyrese", name: "Tyrese Griffin", active: true },
  { id: "drv_leroy", name: "Leroy Smith", active: true },
  { id: "drv_ben", name: "Ben Paintsil", active: true },
  { id: "drv_darvin", name: "Darvin Cepeda", active: true },
  // Deactivated: hidden from pickers and charts, but never from a record.
  { id: "drv_joe", name: "Joe Gibbs", active: false },
];

const FEED = daysOf({
  "2026-09-11": [
    // Original named, its -1 duplicate unnamed: one attempt, Tyrese's.
    row("007174773-1"),
    row("007174773", { originalDriverName: "Tyrese  Griffin", attributedFrom: "plan", currentStatus: "DELIVERED", currentlyUnplanned: false }),
    // Original unnamed, the duplicate named: the duplicate never decides.
    row("007172024"),
    row("007172024-1", { originalDriverName: "Garry Pitts" }),
    // A duplicate listed without its original stands alone, with its own driver.
    row("007169922-1", { originalDriverName: "Leroy Smith", attributedFrom: "timeline" }),
    // No shipment number: can't be grouped, passes through alone.
    row("007170000", { shipmentNbr: null, originalDriverName: "Joe Gibbs" }),
  ],
  "2026-09-12": [
    // A feed name with no roster row keeps its raw name.
    row("007180001", { originalDriverName: "Someone  New", state: "GEORGIA" }),
    // A saved reassignment on the primary stop wins over the feed's driver.
    row("007180002", { originalDriverName: "Ben  Paintsil", attributedFrom: "plan" }),
    // A reassignment saved on the -1 leg (before legs were grouped) still applies.
    row("007180003"),
    row("007180003-1", { currentStatus: "SCHEDULED", currentlyUnplanned: false }),
  ],
  "2026-09-15": [
    // A reassignment saved for another day must not touch this one.
    row("007180004", { originalDriverName: "Leroy Smith" }),
  ],
});

const ov = (id, stop, date, driverId, driverName, created) => ({
  id,
  category: "attempts",
  attempt_stop_nbr: stop,
  delivered_date: date,
  driver_id: driverId,
  driver_name: driverName,
  pro_number: stop,
  created_at: created,
});
const hand = (id, pro, date, driverId, driverName, created) => ({
  id,
  category: "attempts",
  pro_number: pro,
  delivered_date: date,
  driver_id: driverId,
  driver_name: driverName,
  customer: "HAND LOGGED CO",
  zip_code: "30092",
  manual_entry: true,
  created_at: created,
});

const INCIDENTS = [
  ov("o1", "007180002", "2026-09-12", "drv_darvin", "Darvin Cepeda", "2026-09-13T10:00:00Z"),
  ov("o2", "007180003-1", "2026-09-12", "drv_ben", "Ben Paintsil", "2026-09-13T11:00:00Z"),
  ov("o3", "007180004", "2026-09-14", "drv_darvin", "Darvin Cepeda", "2026-09-15T09:00:00Z"),
  // Same PRO as a feed order, but a different day: a later attempt, kept.
  hand("h1", "007174773", "2026-09-29", "drv_tyrese", "Tyrese Griffin", "2026-09-29T19:55:00Z"),
  // Before the feed started: hand-logged attempts are all there is.
  hand("h2", "007126190", "2026-06-01", "drv_leroy", "Leroy Smith", "2026-06-01T15:00:00Z"),
  // A deactivated driver's hand-logged attempt still counts.
  hand("h3", "007199999", "2026-09-20", "drv_joe", "Joe Gibbs", "2026-09-20T12:00:00Z"),
  // Not an attempt at all.
  { id: "ff1", category: "forgotten_freight", pro_number: "007180001", delivered_date: "2026-09-12", driver_id: "drv_ben", created_at: "2026-09-12T12:00:00Z" },
];

test("parity: the builder reproduces the v0.19.1 Attempts tab record for record", () => {
  const built = buildAttemptRecords({ feedDays: FEED, incidents: INCIDENTS, drivers: DRIVERS });
  const old = legacyRecords({ periodRows: flatRows(FEED), incidents: INCIDENTS, drivers: DRIVERS });
  assert.equal(built.duplicates.length, 0, "no same-day duplicates in this fixture");
  assertSameRecords(built.records, old);

  // And so every count the tab derives: the per-driver tally is the same, with the
  // nameless bucket's internal key now "unassigned".
  const oldTally = tally(old, (i) => legacyKey(i, DRIVERS));
  oldTally.unassigned = oldTally["name:Unassigned"];
  delete oldTally["name:Unassigned"];
  assert.deepEqual(tally(built.records, driverKey), oldTally);
});

test("-1/-2 duplicates fold into their original and are never charged to the original's driver", () => {
  const { records, folded, copies } = buildAttemptRecords({
    feedDays: FEED,
    incidents: [],
    drivers: DRIVERS,
  });
  const byStop = Object.fromEntries(records.map((r) => [r.order.stopNbr, r]));
  // 11 rows, 3 of them folded into another stop's order.
  assert.equal(flatRows(FEED).length, 11);
  assert.equal(records.length, 8);
  assert.equal(folded, 3);
  assert.equal(copies, 4);
  // Credited to the named original.
  assert.equal(byStop["007174773"].driver_id, "drv_tyrese");
  assert.equal(byStop["007174773"].order.legs, 2);
  // The named duplicate does not speak for the unnamed original.
  assert.equal(byStop["007172024"].driver_name, "");
  assert.equal(byStop["007172024"].key, "unassigned");
  assert.equal(byStop["007172024"].attributedBy, null);
  // A duplicate on its own carries only its own driver.
  assert.equal(byStop["007169922-1"].driver_id, "drv_leroy");
});

test("a saved reassignment wins, from either leg, on its own day only — and is never counted itself", () => {
  const { records } = buildAttemptRecords({ feedDays: FEED, incidents: INCIDENTS, drivers: DRIVERS });
  const byStop = Object.fromEntries(records.filter((r) => r.from_feed).map((r) => [r.order.stopNbr, r]));
  assert.equal(byStop["007180002"].driver_id, "drv_darvin");
  assert.equal(byStop["007180002"].driver_raw, "Ben  Paintsil");
  assert.equal(byStop["007180002"].overridden, true);
  assert.equal(byStop["007180002"].attributedBy, "override");
  assert.equal(byStop["007180003"].driver_id, "drv_ben", "saved on the -1 leg");
  assert.equal(byStop["007180004"].driver_id, "drv_leroy", "o3 is for 09/14, not 09/15");
  assert.equal(byStop["007180004"].overridden, false);
  // o1–o3 are attributions, not attempts.
  assert.equal(records.filter((r) => r.attempt_stop_nbr).length, 0);
  assert.deepEqual(
    records.filter((r) => !r.from_feed).map((r) => r.id),
    ["h1", "h3", "h2"],
    "hand-logged rows follow the feed, newest entered first",
  );
});

test("roster matching: double spaces collapse onto the roster name; an unknown name stays visible", () => {
  const { records } = buildAttemptRecords({ feedDays: FEED, incidents: [], drivers: DRIVERS });
  const r = records.find((x) => x.order?.stopNbr === "007180001");
  assert.equal(r.driver_id, null);
  assert.equal(r.driver_name, "Someone  New");
  assert.equal(r.key, "name:Someone  New");
  // A deactivated driver is still the driver on the record; hiding is for displays.
  const joe = records.find((x) => x.order?.stopNbr === "007170000");
  assert.equal(joe.driver_id, "drv_joe");
});

test("the same-PRO guard drops a hand-logged attempt the feed already has on the same day", () => {
  // Logged by hand on 09/12 for PRO 007180001, which the feed lists on 09/12 as
  // ATT007180001: one failure, which would otherwise count twice.
  const dup = hand("h9", "007180001", "2026-09-12", "drv_ben", "Ben Paintsil", "2026-09-12T20:00:00Z");
  const incidents = [...INCIDENTS, dup];
  const built = buildAttemptRecords({ feedDays: FEED, incidents, drivers: DRIVERS });
  assert.deepEqual(built.duplicates.map((r) => r.id), ["h9"]);
  assert.equal(built.records.some((r) => r.id === "h9"), false);

  // The only difference from v0.19.1 is that row: everything else is unchanged.
  const old = legacyRecords({ periodRows: flatRows(FEED), incidents, drivers: DRIVERS });
  assert.equal(old.length, built.records.length + 1);
  assertSameRecords(built.records, old.filter((r) => r.id !== "h9"));

  // It matches whatever form the PRO was typed in.
  for (const pro of ["7180001", "ATT007180001", " 007180001 "]) {
    const b = buildAttemptRecords({
      feedDays: FEED,
      incidents: [{ ...dup, pro_number: pro }],
      drivers: DRIVERS,
    });
    assert.equal(b.duplicates.length, 1, pro);
  }
  // A duplicate's own stop number matches its original's order too.
  const viaCopy = buildAttemptRecords({
    feedDays: FEED,
    incidents: [hand("h8", "007174773", "2026-09-11", "drv_tyrese", "Tyrese Griffin", "2026-09-11T20:00:00Z")],
    drivers: DRIVERS,
  });
  assert.equal(viaCopy.duplicates.length, 1);
});

test("the day log finds the same duplicate the period drops, from that day's orders alone", () => {
  // The log tags a hand-logged row and leaves it out of the day's count; it must pick
  // exactly the rows the period build drops, or the two disagree by one.
  const dup = hand("h9", "007180001", "2026-09-12", "drv_ben", "Ben Paintsil", "2026-09-12T20:00:00Z");
  const later = hand("h7", "007180001", "2026-09-13", "drv_ben", "Ben Paintsil", "2026-09-13T20:00:00Z");
  const built = buildAttemptRecords({ feedDays: FEED, incidents: [dup, later], drivers: DRIVERS });
  const dayOrders = groupAttemptLegs(FEED.get("2026-09-12").rows);
  const index = feedOrderIndex(dayOrders);
  assert.equal(feedOrderFor(dup, index)?.stopNbr, "007180001");
  assert.equal(feedOrderFor(later, index), null, "a later day is a later attempt");
  assert.deepEqual(built.duplicates.map((r) => r.id), ["h9"]);
  assert.equal(feedOrderFor({ pro_number: "" }, index), null);
});

test("the guard keeps a hand-logged attempt on a day the feed has no data for", () => {
  // 09/12 failed to load: no rows, so nothing to be a duplicate of.
  const feedDays = new Map(FEED);
  feedDays.set("2026-09-12", { status: "failed", rows: [] });
  const dup = hand("h9", "007180001", "2026-09-12", "drv_ben", "Ben Paintsil", "2026-09-12T20:00:00Z");
  const b = buildAttemptRecords({ feedDays, incidents: [dup], drivers: DRIVERS });
  assert.equal(b.duplicates.length, 0);
  assert.equal(b.records.filter((r) => r.id === "h9").length, 1);
});

test("hand-logged attempts are dated by incidentDateStr", () => {
  const { records } = buildAttemptRecords({
    feedDays: new Map(),
    incidents: [{ id: "x", category: "attempts", pro_number: "1", ingested_at: "2026-07-02T14:00:00Z", driver_id: "d" }],
  });
  assert.equal(records[0].date, "2026-07-02");
  assert.equal(records[0].attributedBy, "hand");
  assert.equal(records[0].pro, "000000001");
});

test("attribution: absent attributedFrom reads 'unknown', never one of the real sources", () => {
  assert.equal(feedAttribution({ attributedFrom: "plan" }), "plan");
  assert.equal(feedAttribution({ attributedFrom: "holder" }), "holder");
  assert.equal(feedAttribution({ attributedFrom: "timeline" }), "timeline");
  assert.equal(feedAttribution({}), "unknown");
  assert.equal(feedAttribution({ attributedFrom: null }), "unknown");
  assert.equal(feedAttribution({ attributedFrom: "something-new" }), "unknown");
  for (const k of ["plan", "holder", "timeline", "unknown", "override", "hand"]) {
    assert.ok(ATTRIBUTED_BY_TEXT[k], k);
  }
  const { records } = buildAttemptRecords({ feedDays: FEED, incidents: [], drivers: DRIVERS });
  const by = Object.fromEntries(records.map((r) => [r.order.stopNbr, r.attributedBy]));
  assert.equal(by["007174773"], "plan");
  assert.equal(by["007169922-1"], "timeline");
  assert.equal(by["007180001"], "unknown");
});

test("normPro: the ATT marker, a -1/-2 suffix and missing zero-padding all come off", () => {
  assert.equal(normPro("ATT007138914"), "007138914");
  assert.equal(normPro("007138914-1"), "007138914");
  assert.equal(normPro("7138914"), "007138914");
  assert.equal(normPro(" att007138914 "), "007138914");
  assert.equal(normPro("ab12345x"), "AB12345X");
  assert.equal(normPro(null), "");
});

test("customerKey: one customer however the feed spelled the state", () => {
  assert.equal(normState("GEORGIA"), "GA");
  assert.equal(normState(" ga "), "GA");
  assert.equal(normState("South  Carolina"), "SC");
  // With a zip, name + zip5 decide; the state can't split them.
  assert.equal(
    customerKey({ businessName: "Otr Solutions", zip: "30076-1234", state: "GEORGIA" }),
    customerKey({ businessName: "OTR SOLUTIONS", zip: "30076", state: null }),
  );
  // Without one, city and a normalised state stand in.
  assert.equal(
    customerKey({ businessName: "OTR SOLUTIONS", city: "Roswell", state: "GEORGIA" }),
    customerKey({ businessName: "OTR  SOLUTIONS", city: "ROSWELL", state: "GA" }),
  );
  // An incident's own field names work too.
  assert.equal(
    customerKey({ customer: "OTR SOLUTIONS", zip_code: "30076" }),
    customerKey({ businessName: "OTR SOLUTIONS", zip: "30076" }),
  );
  assert.equal(customerKey({ businessName: "" }), null);
});

test("attemptOutcome: the duplicate carrying the redelivery decides", () => {
  const [split] = groupAttemptLegs([
    { date: "d", stopNbr: "1", shipmentNbr: "ATT1", currentStatus: "DELIVERED" },
    { date: "d", stopNbr: "1-1", shipmentNbr: "ATT1", currentStatus: "UNPLANNED", currentlyUnplanned: true },
  ]);
  assert.equal(attemptOutcome(split), "unplanned");
  assert.equal(attemptOutcome({ stopNbr: "2", currentStatus: "DELIVERED" }), "delivered");
  assert.equal(attemptOutcome({ stopNbr: "2", currentStatus: "SCHEDULED" }), "rescheduled");
  assert.equal(attemptOutcome({ stopNbr: "2", currentStatus: "UNPLANNED" }), "unplanned");
  assert.equal(attemptOutcome({ stopNbr: "2", currentStatus: "EXCEPTION" }), "other");
  assert.equal(attemptOutcome(null), null);
});

test("driverKey: id, else name, else unassigned — an id with no roster row is its own key", () => {
  assert.equal(driverKey({ driver_id: "drv_gone", driver_name: "" }), "drv_gone");
  assert.equal(driverKey({ driver_name: "A B" }), "name:A B");
  assert.equal(driverKey({ driver_raw: "C D" }), "name:C D");
  assert.equal(driverKey({}), "unassigned");
});

test("feedRecord on a single day matches the period build (the log's driver filter uses it)", () => {
  const overrides = overrideIndex(INCIDENTS);
  const [order] = groupAttemptLegs(FEED.get("2026-09-12").rows.filter((r) => r.stopNbr.startsWith("007180003")));
  const one = feedRecord(order, { overrides, drivers: DRIVERS });
  const all = buildAttemptRecords({ feedDays: FEED, incidents: INCIDENTS, drivers: DRIVERS });
  assert.equal(one.key, all.records.find((r) => r.id === one.id).key);
  assert.equal(one.key, "drv_ben");
});

test(
  "parity on a production pull (DDS_PARITY_FIXTURE)",
  { skip: !process.env.DDS_PARITY_FIXTURE && "set DDS_PARITY_FIXTURE to run" },
  () => {
    const fx = JSON.parse(readFileSync(process.env.DDS_PARITY_FIXTURE, "utf8"));
    const feedDays = new Map(
      Object.keys(fx.feedDays)
        .sort()
        .map((date) => {
          const j = fx.feedDays[date];
          const planMissing = !!j.manifest?.planMissing;
          return [date, { status: "ok", rows: (j.attempts || []).map((a) => ({ ...a, date, planMissing })) }];
        }),
    );
    const built = buildAttemptRecords({ feedDays, incidents: fx.incidents, drivers: fx.drivers });
    const old = legacyRecords({ periodRows: flatRows(feedDays), incidents: fx.incidents, drivers: fx.drivers });
    const dropped = new Set(built.duplicates.map((r) => r.id));
    assertSameRecords(built.records, old.filter((r) => !dropped.has(r.id)));
    console.log(
      `production parity: ${built.records.length} records (${built.records.filter((r) => r.from_feed).length} feed, ` +
        `${built.records.filter((r) => !r.from_feed).length} hand-logged), ${built.folded} folded, ` +
        `${built.duplicates.length} dropped by the same-PRO guard`,
    );
  },
);
