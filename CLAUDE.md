# Davis Driver Scorecard — working notes

## Workflow

- **Merge automatically.** Push the branch, open the PR, and merge it (squash) without
  waiting for approval. Don't stop to ask. Still hold off if a build fails, a check is
  red, or the change turns out to be riskier than described — say so instead of merging.
- Report what shipped in plain terms afterwards, including anything skipped or uncertain.
- **Every merge bumps the version.** No change reaches `main` without `APP_VERSION` in
  `src/App.jsx` going up in the same PR, and `version` in `package.json` set to match —
  the number is printed in the sidebar, so it is how anyone tells which build a browser
  is actually running. Patch for a fix or a wording/doc change, minor for a new screen,
  control or report. Bump it as part of the change, not as a follow-up commit.

## Data layer (Firestore, `src/data/firebase.js`)

The app is backed by Firestore in the shared `davismarginiq` project. Every collection is
`dds_`-prefixed so it can't collide with another Davis app.

**Firestore caps a document at 1 MB, and this app has been bitten by it three times.**
Anything that can grow without bound must be split across documents, never accumulated
into one:

- `dds_incident_photos/{incidentId}__{idx}` — one document per photo. Photos are base64
  data URIs of 100–300 KB; several in one document silently exceeded the cap and were
  discarded while the UI reported success.
- `dds_report_pdfs/{reportId}__{idx}` — PDFs chunked at 700 KB and rejoined on read. A
  real photo report is ~6 MB.
- `dds_history/{YYYY-MM}` — history sharded per calendar month. It previously lived in a
  single document that was already at 35% of the cap.
- `dds_report_contrib/{reportId}` — per-report rollup snapshots, one document each, which
  keep `rollupReportToHistory` idempotent.

Readers still fall back to the older single-document shapes, so pre-split data keeps working.

**Never swallow a write failure.** The original bug this project started from was a save
that fell back to one browser's localStorage and reported success, losing a week of
entries. Surface failures to the user; if a caller can't handle a throw (e.g. startup
seeding), catch it there deliberately and say why in a comment.

## Reporting rules

- Deactivating a driver hides them from driver-level views (charts, leaderboards,
  scorecards, pickers) but **must not change any total**. Filter at the display layer, not
  in the aggregation that totals are derived from.
- A `driver_id` with no roster row is never hidden — unknown must not mean invisible.
- **Count by month through `src/data/blend.js`.** It is the one live/history blend, decided
  per cell — one category in one month: a cell whose category has a live incident that
  counts that month (`countsTowardCharts`, COUNTED8) is served from live incidents, every
  other cell from `dds_history`, never both. Whether a cell is live is decided for the
  company (anyone's row, fault filter off), never per driver, so a month can be part live,
  part history (Jan 2026: forgotten freight live, the rest from history). The Scorecard,
  Trends, Reports, the roster cards and the entry tabs' history-only months all count from
  it; don't write another copy, and never decide live or history for a whole month.
  Under Driver-fault scope a cell history serves is "not tracked" and counts nothing —
  history has no fault field — and every screen and drawer says so rather than showing 0.
  History is read once, in `src/data/AnalyticsProvider.jsx` — screens get it, the blend
  and the people index from `useAnalytics()`, and anything that writes history from this
  browser must leave it re-read (`refreshHistory`; firebase.js also announces every
  history write).
- **A drill-down shows the same number as the thing you clicked.** Every clickable number
  opens the one drawer (`src/views/kit/DrillDrawer.jsx`) with the spec of what it counted
  and the number it showed; `src/data/drill.js` resolves the spec from the same blend
  (via `scorecardDetail.js`) and the drawer flags any difference. Never recount for a
  drill-down — the driver popup once disagreed with its own row because it was never
  given the history. `test/drill-reconcile.test.mjs` checks each screen's marks, and the
  drivers opened from inside a drawer (`driverFromDrawer` carries only the count on the
  row clicked, never the chart's totals, and opens the driver on that drawer's months and
  categories). The clicked number is only checked against the data it was counted from
  (`drillStamp`); a link opened after the data moved says so plainly instead of raising
  the alarm.
- **A failed read is never zero.** Incidents, the roster, reports and history are read with
  the checked loaders in firebase.js (`{ data, error }`); a screen whose numbers depend on
  a failed read shows the failure (`kit/LoadState.jsx`), not an empty chart. With the
  offline cache on, Firestore answers an unreachable server from this browser's cache
  instead of throwing — the loaders treat that as a failure too (`readResult` in
  `loadState.js`), showing a cached copy only as an old one. Anything that splits by role
  or hides inactive drivers waits for the roster (`RosterGate`). Startup only seeds the
  roster when the roster read succeeded and came back empty.
- **Whose fault it was comes from `src/data/faultGroups.js`**: driver, not the driver's
  (exonerated, preload, warehouse, customer, vendor), not reviewed, or typed in — and a
  late row with a late reason but no fault is reviewed, in a group of its own (All
  Incidents gives late rows a reason dropdown, not a fault one). The Scorecard and the
  weekly PDF cover both count by it; don't list fault codes anywhere else.
- The Scorecard's tiles count the same cells as its leaderboards (`scorecardKpis.js`):
  failures are `FAILURES` only, attempts and compliments have tiles of their own, and the
  period and year to date count back from the month picker. Its dispatch-feed count is
  read from the shared feed cache only — landing on the Scorecard never loads a period
  from the feed.
- **What a month covers is decided in `src/data/coverage.js`.** Every (month, category)
  cell is live, history, partial, conflict, no data or not tracked, from the capture
  windows Chad confirmed on 10/07 (`CAPTURE_WINDOWS`: 2023's spreadsheet held lost/missing
  only; the entry tabs began June 2026, so earlier months of theirs are not captured, not
  zero; the Uline categories follow the reports' spans by day). A cell that holds a count
  is never a gap, so the cells always add up to the blend. Hand-logged entries never roll up,
  so a month of report rollups whose report rows match history is whole, not a conflict
  (Data Coverage still lists the difference and why). Compare months only through
  `likeForLike` — whole cells captured the same way on both sides — and name what it drops.
  Company History (`src/views/CompanyHistory.jsx`, `company/`) counts through
  `companyMetrics.js`: its headline is the full covered total and drills to exactly that;
  the delta says how much of it was compared. Its Data Coverage page never writes — a stale
  or missing report rollup is fixed with Re-sync in Report Detail. The rollup's counting
  is `src/data/rollup.js`, which firebase.js imports, so the page and the rollup agree.
- File an incident under a month with `incidentYm()` / `incidentDateStr()` from
  `src/data/incidentDate.js`. Hand-copied date precedences drifted apart before.
- The manual-entry tabs (Forgotten Freight, Unable to Track, Mis-Deliveries, Compliments,
  Attempts) draw from `src/data/manualAnalytics.js`, attempts from
  `attemptRecords.js`. A picked driver (`<ns>.driver` in the hash) re-scopes the tiles,
  charts, table and log against the rest of the fleet — never a total. Rank leaves out
  Unassigned and feed names the roster doesn't match. An attempts drill-down counts the
  records the Attempts tab publishes (`publishAttempts` in AnalyticsProvider), so its
  total is the tile's; the tab stamps the drawer with the data on screen when clicked
  (`at`), since its period can still be loading. The picker, rank, by-driver chart and
  driver card wait for the roster (`RosterGate`), and a feed that can't be reached shows
  "—", never 0.

## Categories, charts and screen state

- `src/data/categories.js` is the only place a category gets its label, polarity
  (failure / attempt / credit / excluded) or colour — screens and both PDFs read it.
  Never spell a category hex anywhere else, CSS included; `test/categories.test.mjs` fails
  if you do. A hex that is also a status or neutral token (the fault red, the slates) is
  allowed only in the files that test names, with the reason.
  The stack order is validated with the dataviz palette validator; re-run it before
  changing a hue or the order.
- Charts go through the kit in `src/views/kit/` (`ChartCard` with its table view and CSV,
  `StackedColumns`, `EmphasisBars`, `PeriodBar`). Text stays ink; colour is on the marks.
  What a chart draws is decided in `kit/shape.js`, which is pure and tested.
- The open tab and each tab's filters live in the URL hash (`src/data/hashState.js`),
  under per-tab keys (`sc.p`, `att.p`, `tr.y` …) — never a bare shared key.

## Reports

- `src/reports/pdfGenerator.js` — the weekly accountability report across all drivers.
  Owns the shared print primitives (brand and ink palette, `drawBadge`, `loadImage`,
  `fitDims`). Category colours come from `categories.js`, not from here.
- `src/reports/driverReport.js` — single-driver handout for the selected period, printed
  from the manual-entry tabs: exactly the rows on screen (the order table on Attempts, the
  log elsewhere). Imports its styling from `pdfGenerator.js` so the two can't drift apart.

## Dates

Entries are dated in the business timezone (America/New_York) via `todayET` / `nowET` in
`src/data/period.js`. Format ISO date strings by parsing the string, not through
`new Date()`, so a day can never shift by timezone.
