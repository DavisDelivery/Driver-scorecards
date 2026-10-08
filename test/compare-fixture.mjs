// A store shaped like production's 2024–2026, for Company History's Compare and What
// changed tests. Not a test file.
//
//   2024–Mar 2026  the spreadsheet backfill, with production's monthly company totals for
//                  damage, forgotten freight and misdelivery (2024 held no lost/missing),
//                  and lost/missing from 2025. 2025-07 and 2025-12 have no document.
//                  Over the months both years hold (all but Jul and Dec), 2024 → 2025 is
//                  damage 93 → 80, forgotten freight 190 → 180, misdelivery 63 → 63:
//                  346 → 323.
//                  Each month's count is split over the drivers by a per-year share, so
//                  the drivers move: d1 falls, d5 is new in 2025, d3 (inactive) falls.
//   Jan 2026       3 forgotten freight back-dated in August against history's 28: a
//                  conflict.
//   Apr–Sep 2026   one Uline report spanning every day, so every app-era month is whole
//                  for the Uline categories; the entry tabs capture from June. Late rows
//                  carry late reasons (Attempted rises from 50% to 79% of Late between
//                  Jun–Jul and Aug–Sep) and forgotten freight its item; d9 has no roster
//                  row; one late row has no driver.
export const TODAY = "2026-10-08";

export const drivers = [
  { id: "d1", name: "Ann Able", role: "driver", active: true },
  { id: "d2", name: "Bo Baker", role: "driver", active: true },
  { id: "d3", name: "Cy Cole", role: "driver", active: false },
  { id: "d4", name: "Dee Dent", role: "driver", active: true },
  { id: "d5", name: "Eve Ernst", role: "driver", active: true },
];

const SERIES = {
  damage: {
    2024: [16, 6, 5, 9, 8, 7, 9, 15, 15, 10, 2, 11],
    2025: [8, 10, 6, 11, 2, 8, null, 10, 9, 13, 3, null],
    2026: [9, 6, 6],
  },
  forgotten_freight: {
    2024: [18, 12, 19, 16, 16, 22, 20, 25, 23, 22, 17, 24],
    2025: [25, 13, 15, 13, 25, 18, null, 21, 18, 16, 16, null],
    2026: [28, 15, 16],
  },
  misdelivery: {
    2024: [7, 5, 7, 7, 8, 8, 10, 11, 0, 9, 1, 4],
    2025: [7, 10, 11, 7, 3, 1, null, 7, 4, 9, 4, null],
    2026: [2, 7, 8],
  },
  missing: {
    2025: [5, 4, 8, 6, 4, 8, null, 3, 6, 8, 4, null],
    2026: [6, 9, 6],
  },
};
const SHARES = {
  2024: [["d1", 0.4], ["d2", 0.3], ["d3", 0.2], ["d4", 0.1]],
  2025: [["d1", 0.25], ["d2", 0.3], ["d3", 0.05], ["d4", 0.2], ["d5", 0.2]],
  2026: [["d1", 0.25], ["d2", 0.3], ["d3", 0.05], ["d4", 0.2], ["d5", 0.2]],
};
const NAMES = Object.fromEntries(drivers.map((d) => [d.id, d.name]));

// n split by shares: each its floor, the remainder to the first drivers in turn.
function split(n, shares) {
  const parts = shares.map(([id, w]) => [id, Math.floor(n * w)]);
  let left = n - parts.reduce((t, [, k]) => t + k, 0);
  for (let i = 0; left > 0; i = (i + 1) % parts.length, left--) parts[i][1] += 1;
  return parts.filter(([, k]) => k > 0);
}

export const history = [];
for (const [category, years] of Object.entries(SERIES)) {
  for (const [y, counts] of Object.entries(years)) {
    counts.forEach((n, i) => {
      if (n === null) return;
      for (const [driver_id, count] of split(n, SHARES[y])) {
        history.push({ year: Number(y), month: i + 1, driver_id, driver_name: NAMES[driver_id], category, count, source: "backfill" });
      }
    });
  }
}

// The history month documents that exist: every month 2024-01..2026-03 but 2025-07 and
// 2025-12 (2024-09 holds no misdelivery but is a document).
export const monthIds = [];
for (let y = 2024; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > "2026-03" || ym === "2025-07" || ym === "2025-12") continue;
    monthIds.push(ym);
  }
}

let n = 0;
const inc = (over) => ({ id: `k${++n}`, fault: "driver", created_at: "2026-09-01T12:00:00Z", report_id: "r1", ...over });
const manual = (over) => inc({ manual_entry: true, report_id: null, ...over });
const day = (ym, d) => `${ym}-${String(d).padStart(2, "0")}`;

export const incidents = [
  // Jan 2026: three forgotten freight back-dated in August.
  ...[5, 9, 20].map((d) =>
    manual({ driver_id: "d2", category: "forgotten_freight", delivered_date: day("2026-01", d), created_at: "2026-08-13T15:00:00Z" }),
  ),
];
// Late: Jun–Jul 12 rows (Attempted 6, Closed Fridays 4, Holiday 2); Aug–Sep 14 rows
// (Attempted 11, Closed Fridays 2, one with no reason).
const LATE = {
  "2026-06": ["attempted", "attempted", "attempted", "closed_fridays", "closed_fridays", "holiday"],
  "2026-07": ["attempted", "attempted", "attempted", "closed_fridays", "closed_fridays", "holiday"],
  "2026-08": ["attempted", "attempted", "attempted", "attempted", "attempted", "attempted", "closed_fridays"],
  "2026-09": ["attempted", "attempted", "attempted", "attempted", "attempted", "closed_fridays", ""],
};
const ROTA = ["d1", "d2", "d4", "d5", "d9"];
for (const [ym, reasons] of Object.entries(LATE)) {
  reasons.forEach((late_reason, i) =>
    incidents.push(
      inc({
        driver_id: ROTA[i % ROTA.length],
        ...(ROTA[i % ROTA.length] === "d9" ? { driver_name: "Zed Zulu" } : {}),
        category: "late",
        late_reason,
        fault: "unknown",
        actual_delivery: day(ym, 3 + i),
      }),
    ),
  );
}
// Forgotten freight, June on: Jun–Jul Skid 5, Box 5; Aug–Sep Skid 8, Box 2. Aug piles
// onto d5.
const FF = {
  "2026-06": [["Skid", "d1"], ["Skid", "d2"], ["Box", "d4"], ["Box", "d5"], ["Skid", "d1"]],
  "2026-07": [["Box", "d2"], ["Skid", "d4"], ["Box", "d1"], ["Skid", "d2"], ["Box", "d4"]],
  "2026-08": [["Skid", "d5"], ["Skid", "d5"], ["Skid", "d5"], ["Box", "d5"], ["Skid", "d1"]],
  "2026-09": [["Skid", "d2"], ["Skid", "d4"], ["Box", "d1"], ["Skid", "d5"], ["Skid", "d2"]],
};
for (const [ym, rows] of Object.entries(FF)) {
  rows.forEach(([forgotten_item, driver_id], i) =>
    incidents.push(manual({ driver_id, category: "forgotten_freight", forgotten_item, delivered_date: day(ym, 4 + i) })),
  );
}
// A little damage, misdelivery and lost/missing every app month, so they are captured.
for (const ym of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
  incidents.push(
    inc({ driver_id: "d2", category: "damage", delivered_date: day(ym, 14) }),
    inc({ driver_id: "d4", category: "missing", return_date: day(ym, 15) }),
  );
  if (ym >= "2026-06") incidents.push(manual({ driver_id: "d1", category: "misdelivery", misdelivery_type: "Wrong Address", delivered_date: day(ym, 16) }));
}
// No driver: in no total, a caveat.
incidents.push(inc({ driver_id: "", driver_raw: "JEAN DELSOIN", category: "late", fault: "unknown", actual_delivery: "2026-08-20" }));

export const reports = [{ id: "r1", week_ending: "2026-10-02", starts_at: "2026-04-01", ends_at: "2026-09-30" }];
