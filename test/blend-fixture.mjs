// A small store shaped like production, built to hit every case the blend has broken on
// before. Shared by the blend, drill-reconcile and people tests. Not a test file.
//
//   2024-02  history only, with a record that has no driver_id (Reports counts it)
//   2025-11  history only, including a compliment record
//   2025-12  live (one late) superseding history (damage 5) — the far side of Jan 1
//   2026-01  three forgotten freight back-dated into a month history already holds:
//            live 3 vs history 5 for FF, and damage 0 vs 2 — the Jan 2026 conflict shape
//   2026-02  one no-fault live row: not live, history serves it
//   2026-03  one compliment live: live, as the Scorecard has always qualified it
//   2026-04  mixed faults, an id with no roster row, an unattributed row, rows that count
//            for nothing (unable-to-track, return), history superseded
//   2026-05  vendor-fault rows only: under today's driver-fault rule history serves it
//   2026-06  complaint, attempts above history (live 2 > history 1), a timestamp date
export const drivers = [
  { id: "d1", name: "Ann Able", role: "driver", active: true },
  { id: "d2", name: "Bo Baker", role: "driver", active: true },
  { id: "d3", name: "Cy Cole", role: "loader", active: true },
  { id: "d4", name: "Di Dean", role: "driver", active: false },
  { id: "d6", name: "Ed Eve", role: "non-driver", active: true },
];

let n = 0;
const inc = (over) => ({ id: `i${++n}`, fault: "driver", ...over });

export const incidents = [
  inc({ driver_id: "d2", driver_name: "Bo Baker", category: "late", ship_date: "2025-12-30", report_id: "r2" }),
  inc({ driver_id: "d1", driver_name: "Ann Able", category: "forgotten_freight", delivered_date: "2026-01-05" }),
  inc({ driver_id: "d1", driver_name: "Ann Able", category: "forgotten_freight", delivered_date: "2026-01-09" }),
  inc({ driver_id: "d4", driver_name: "Di Dean", category: "forgotten_freight", delivered_date: "2026-01-20" }),
  inc({ driver_id: "d3", driver_name: "Cy Cole", category: "misdelivery", no_fault: true, delivered_date: "2026-02-11" }),
  inc({ driver_id: "d1", driver_name: "Ann Able", category: "compliment", fault: "", delivered_date: "2026-03-04" }),
  inc({ driver_id: "d1", driver_name: "Ann Able", category: "late", actual_delivery: "2026-04-03", report_id: "r1", sources: ["laters"] }),
  inc({ driver_id: "d2", driver_name: "Bo Baker", category: "damage", fault: "vendor", delivered_date: "2026-04-09", report_id: "r1", has_photos: true }),
  inc({ driver_id: "d5", driver_name: "", driver_raw: "ZED ZULU", category: "missing", return_date: "2026-04-30", report_id: "r1" }),
  inc({ driver_id: "", driver_raw: "NOBODY", category: "late", fault: "unknown", actual_delivery: "2026-04-12", report_id: "r1" }),
  inc({ driver_id: "d4", driver_name: "Di Dean", category: "unable_to_track", fault: "", delivered_date: "2026-04-15" }),
  inc({ driver_id: "d6", driver_name: "Ed Eve", category: "return", fault: "customer", return_date: "2026-04-02", report_id: "r1" }),
  inc({ driver_id: "d3", driver_name: "Cy Cole", category: "damage", delivered_date: "2026-04-21" }),
  inc({ driver_id: "d4", driver_name: "Di Dean", category: "late", actual_delivery: "2026-04-22", report_id: "r1" }),
  inc({ driver_id: "d2", driver_name: "Bo Baker", category: "damage", fault: "vendor", delivered_date: "2026-05-06" }),
  inc({ driver_id: "d6", driver_name: "Ed Eve", category: "missing", fault: "warehouse", delivered_date: "2026-05-07" }),
  inc({ driver_id: "d2", driver_name: "Bo Baker", category: "complaint", delivered_date: "2026-06-02" }),
  inc({ driver_id: "d3", driver_name: "Cy Cole", category: "attempts", fault: "", delivered_date: "2026-06-03" }),
  inc({ driver_id: "d1", driver_name: "Ann Able", category: "attempts", fault: "", ingested_at: "2026-06-30T23:30:00Z" }),
];

export const history = [
  { year: 2024, month: 2, driver_id: "d9", driver_name: "Old Timer", category: "misdelivery", count: 6, source: "backfill" },
  { year: 2024, month: 2, driver_id: "", category: "attempts", count: 1, source: "backfill" },
  { year: 2025, month: 11, driver_id: "d1", driver_name: "Ann Able", category: "forgotten_freight", count: 3, source: "backfill" },
  { year: 2025, month: 11, driver_id: "d2", driver_name: "Bo Baker", category: "damage", count: 2, source: "backfill" },
  { year: 2025, month: 11, driver_id: "d3", driver_name: "Cy Cole", category: "compliment", count: 4, source: "backfill" },
  { year: 2025, month: 12, driver_id: "d2", driver_name: "Bo Baker", category: "damage", count: 5, source: "backfill" },
  { year: 2026, month: 1, driver_id: "d1", driver_name: "Ann Able", category: "forgotten_freight", count: 5, source: "backfill" },
  { year: 2026, month: 1, driver_id: "d4", driver_name: "Di Dean", category: "damage", count: 2, source: "backfill" },
  { year: 2026, month: 2, driver_id: "d3", driver_name: "Cy Cole", category: "missing", count: 2, source: "backfill" },
  { year: 2026, month: 3, driver_id: "d2", driver_name: "Bo Baker", category: "damage", count: 4, source: "backfill" },
  { year: 2026, month: 4, driver_id: "d1", driver_name: "Ann Able", category: "late", count: 9, source: "report" },
  { year: 2026, month: 5, driver_id: "d2", driver_name: "Bo Baker", category: "damage", count: 3, source: "report" },
  { year: 2026, month: 6, driver_id: "d1", driver_name: "Ann Able", category: "attempts", count: 1, source: "report" },
];
