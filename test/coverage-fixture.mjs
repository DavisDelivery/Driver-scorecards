// A small store shaped like production's coverage, for the coverage and Company History
// tests. Not a test file.
//
//   2023      lost/missing only (the 2023 spreadsheet); 2023-11 has no history document
//   2024      damage, forgotten freight, misdelivery — no lost/missing; 2024-09 holds no
//             misdelivery record (a suspicious zero: the months before ran 5–8)
//   2025      the four; 2025-07 and 2025-12 have no document
//   2026-01   history FF 5, and 3 forgotten freight back-dated into it in August: the
//             Jan 2026 conflict shape
//   2026-04   the April report, no span of its own, rows dated 04-07..04-13; one
//             forgotten freight back-dated into April from June (before FF logging)
//   2026-05+  reports spanning 05-05..09-22 without a break
//   2026-07   a report rolled up with late 4, whose rows now count 2: a stale rollup;
//             history holds that rollup
//   2026-08   misdelivery: one report row (rolled up) and two manual entries
//   2026-06   no misdelivery at all: a captured month with none is a real zero
//   unattributed late rows, some marked no-fault, carrying a load-driver name
export const TODAY = "2026-10-08";

export const drivers = [
  { id: "d1", name: "Ann Able", role: "driver", active: true },
  { id: "d2", name: "Bo Baker", role: "driver", active: true },
  { id: "d3", name: "Cy Cole", role: "driver", active: false },
];

const months = (from, to) => {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push([y, m]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};
const rec = (y, m, category, count, driver_id = "d1", source = "backfill") => ({
  year: y,
  month: m,
  driver_id,
  driver_name: drivers.find((d) => d.id === driver_id)?.name || "",
  category,
  count,
  source,
});

export const history = [];
for (const [y, m] of months("2023-01", "2023-12")) if (m !== 11) history.push(rec(y, m, "missing", 2, "d2"));
const MIS2024 = [5, 6, 7, 5, 6, 8, 7, 6];
for (const [y, m] of months("2024-01", "2024-12")) {
  history.push(rec(y, m, "damage", 2), rec(y, m, "forgotten_freight", 3, "d2"));
  if (m <= 8) history.push(rec(y, m, "misdelivery", MIS2024[m - 1]));
  else if (m >= 10) history.push(rec(y, m, "misdelivery", 4));
}
for (const [y, m] of months("2025-01", "2026-03")) {
  if (y === 2025 && (m === 7 || m === 12)) continue;
  history.push(
    rec(y, m, "damage", 2),
    rec(y, m, "forgotten_freight", y === 2026 && m === 1 ? 5 : 3, "d2"),
    rec(y, m, "misdelivery", 4),
    rec(y, m, "missing", 1, "d3"),
  );
}
// Report rollups: July's is stale (late 4 rolled up, the rows now count 2); August's
// holds its one misdelivery row and the damage row it carries into September.
history.push(
  rec(2026, 7, "late", 3, "d1", "report"),
  rec(2026, 7, "late", 1, "d2", "report"),
  rec(2026, 8, "misdelivery", 1, "d1", "report"),
  rec(2026, 9, "damage", 1, "d2", "report"),
);

// The history month documents that exist (loadHistoryChecked monthIds).
export const monthIds = [...new Set(history.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`))];

let n = 0;
const inc = (over) => ({ id: `c${++n}`, fault: "driver", created_at: "2026-09-01T12:00:00Z", ...over });
const manual = (over) => inc({ manual_entry: true, report_id: null, ...over });

export const incidents = [
  // Jan 2026: three forgotten freight back-dated in August.
  ...[5, 9, 20].map((d) =>
    manual({ driver_id: "d2", category: "forgotten_freight", delivered_date: `2026-01-${String(d).padStart(2, "0")}`, created_at: "2026-08-13T15:00:00Z" }),
  ),
  // The April report: no span, rows 04-07..04-13.
  inc({ report_id: "r_apr", driver_id: "d1", category: "late", actual_delivery: "2026-04-07", created_at: "2026-04-17T18:00:00Z" }),
  inc({ report_id: "r_apr", driver_id: "d2", category: "damage", delivered_date: "2026-04-13", created_at: "2026-04-17T18:00:00Z" }),
  // One forgotten freight entered in June, filed under April.
  manual({ driver_id: "d1", category: "forgotten_freight", delivered_date: "2026-04-24", created_at: "2026-06-11T02:40:00Z" }),
  // May–September reports.
  inc({ report_id: "r_may", driver_id: "d1", category: "damage", delivered_date: "2026-05-12", created_at: "2026-06-02T12:00:00Z" }),
  inc({ report_id: "r_may", driver_id: "d2", category: "late", actual_delivery: "2026-06-03", created_at: "2026-06-30T12:00:00Z" }),
  inc({ report_id: "r_jul", driver_id: "d1", category: "late", actual_delivery: "2026-07-08", created_at: "2026-08-01T12:00:00Z" }),
  inc({ report_id: "r_jul", driver_id: "d2", category: "late", actual_delivery: "2026-07-09", created_at: "2026-08-01T12:00:00Z" }),
  inc({ report_id: "r_aug", driver_id: "d1", category: "misdelivery", delivered_date: "2026-08-05", created_at: "2026-08-30T12:00:00Z" }),
  inc({ report_id: "r_aug", driver_id: "d2", category: "damage", delivered_date: "2026-09-22", created_at: "2026-10-01T12:00:00Z" }),
  // August's manual misdeliveries.
  manual({ driver_id: "d2", category: "misdelivery", delivered_date: "2026-08-10", created_at: "2026-08-10T15:00:00Z" }),
  manual({ driver_id: "d3", category: "misdelivery", delivered_date: "2026-08-11", created_at: "2026-08-11T15:00:00Z" }),
  // Manual entries June on.
  manual({ driver_id: "d1", category: "forgotten_freight", delivered_date: "2026-06-15" }),
  manual({ driver_id: "d2", category: "forgotten_freight", delivered_date: "2026-09-02" }),
  manual({ driver_id: "d1", category: "attempts", fault: "", delivered_date: "2026-07-01" }),
  manual({ driver_id: "d2", category: "compliment", fault: "", delivered_date: "2026-06-20" }),
  // An id with no roster row.
  inc({ report_id: "r_jul", driver_id: "d9", driver_name: "Zed Zulu", category: "missing", return_date: "2026-07-15", created_at: "2026-08-01T12:00:00Z" }),
  // Unattributed: two late rows counted if attributed, one marked no-fault.
  inc({ report_id: "r_jul", driver_id: "", driver_raw: "JEAN  DELSOIN", category: "late", fault: "unknown", actual_delivery: "2026-07-20" }),
  inc({ report_id: "r_jul", driver_id: "", driver_raw: "JEAN DELSOIN", category: "late", fault: "unknown", actual_delivery: "2026-07-21" }),
  inc({ report_id: "r_jul", driver_id: "", driver_raw: "KOBE BOAKYE", category: "late", fault: "unknown", no_fault: true, actual_delivery: "2026-07-22" }),
  // No-fault and a return count for nothing.
  inc({ report_id: "r_jul", driver_id: "d1", category: "damage", fault: "vendor", no_fault: true, delivered_date: "2026-07-23" }),
  inc({ report_id: "r_jul", driver_id: "d1", category: "return", fault: "customer", return_date: "2026-07-24" }),
];

export const reports = [
  { id: "r_apr", week_ending: "2026-04-17", name: "4/6/2026 THRU 4/10/2026" },
  { id: "r_may", week_ending: "2026-06-05", starts_at: "2026-05-05", ends_at: "2026-06-30" },
  { id: "r_jul", week_ending: "2026-07-31", starts_at: "2026-07-01", ends_at: "2026-08-03" },
  { id: "r_aug", week_ending: "2026-09-25", starts_at: "2026-08-04", ends_at: "2026-09-22" },
  { id: "r_none", week_ending: "2026-09-25", starts_at: "2026-09-21", ends_at: "2026-09-22" },
];

// Rollup snapshots: r_jul rolled up late 4 (its two late rows now count 2) and nothing
// else; r_aug matches its rows; r_apr and r_may were never rolled up; r_none has
// nothing that counts and no snapshot.
export const contribs = [
  { report_id: "r_jul", cat: { "2026:07:d1:late": 3, "2026:07:d2:late": 1 } },
  { report_id: "r_aug", cat: { "2026:08:d1:misdelivery": 1, "2026:09:d2:damage": 1 } },
];
