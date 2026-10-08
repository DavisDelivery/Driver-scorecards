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
  A like-for-like total adds each category over its own compared months, so its drawer is
  a blend spec with `cells` (`cellsDrill`), never the plain months × categories block.
  "What changed" is `src/data/narrative.js`: deterministic sentences over the compared
  cells, every count carrying its drawer (`test/narrative.test.mjs` holds each to
  `resolveDrill`); it names no inactive driver, and no driver at all without the roster.
  Compare's builders (`compareByCategory`, `yearLines`, `quarterMix`) hand each mark its
  drawer, so the screen only opens it. The years chart is like-for-like too: a point not
  captured whole, or captured differently from the selected year's month, is drawn
  hollow off its line and named — never joined to the points it can't be compared with.
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
- Charts go through the kit in `src/views/kit/` (`ChartCard` with its ⋯ menu holding the
  table view and CSV, `StackedColumns` and `EmphasisBars` for columns, `BarList` for every
  horizontal list, `StatTile`/`TileStrip`, `PeriodBar`, `Icon`). Text stays ink; colour is
  on the marks. What a chart draws is decided in `kit/shape.js`, which is pure and tested
  (`test/kit-shape.test.mjs`, `test/kit-layout.test.mjs`).
- The open tab and each tab's filters live in the URL hash (`src/data/hashState.js`),
  under per-tab keys (`sc.p`, `att.p`, `tr.y` …) — never a bare shared key.

## Chart design rules

Chad's verdict on the old charts was "looks like a child designed it" — dates run
together, hairline bars in empty plots, stray numbers on random bars. These keep it from
coming back; the spec they came from is the v0.24.1 visual spec.

- **Every layout decision is a pure function in `kit/shape.js`, from the measured width**
  (`useSize`), never a phone flag: `timeTicks` (which dates an axis names), `barGeometry`
  (62% of the slot, 2–36px; up to 72px for 7 slots or fewer), `labelPlan`, `niceTicks`/`yAxisWidth`, `chartForm`,
  `chooseGrain`, `tileRows`, `gridRows`, `businessDays`, `peakSummary`, `columnCaps`, `capLabelY`, `targetTick`, `sparkWidth`, `shadedReasons`, `yearLinesPlan`, `sparkPlan`,
  `avgLine`. Test a new rule there.
- **Axes.** No two tick labels closer than the widest label + 16px; never rotated, never
  under 11px, never `MM/DD`. A day axis ticks its Mondays (`Sep 14`), a window of 7 days
  or fewer every day (`Mon 5`), months stride from January, and a year line appears only when the axis crosses
  a year. Empty weekends leave a day axis (display only — tables, CSV and totals keep
  every day). The count axis tops out at the first nice step over the max, with up to five
  steps when fewer would leave a fifth of the plot empty (101 is 0–125, not 0–150).
- **Numbers on columns: all or none** (`labelPlan`) — never "latest + max". With labels the
  y axis and grid go and the tallest column reaches the top (its number's room is kept in
  pixels, not counts); without them the subtitle names the peak (`peakSummary`, told the
  plan by `onLabelPlan`), never both. Last year on a column chart is a 2px tick across
  each column at last year's value, a little wider than it — a bullet chart's target
  (`marks`, `targetTick`) — so the column stays centred on its month; never a line
  through the bars. Only a counted column gets one (`columnCaps`): a month still to come
  or shaded draws no lone tick, and its last-year value stays in the hover and the
  table; a month last year has nothing for gets no tick and the note names it. A
  column's number is 6px over its own cap and is lifted only past a tick that would
  cross it (`capLabelY`). A line on the same axis (an average) means no numbers on the
  columns.
- **A pointer never focuses a chart.** With `accessibilityLayer` on, a focus (a tap's
  emulated mousedown included) moves the readout to the first slot, so every such chart's
  wrapper prevents a pointer's mousedown (`test/chart-pointer-focus.test.mjs`); keyboard
  focus still works. `test/browser/touch-readout.mjs` taps a column on a 390px touch
  phone against a running dev server and checks the readout names it.
- **The hover says what the table says.** A chart that draws a slot differently from what
  it counted (a shaded history-only month, an average drawn only over long runs) draws
  from a key of its own and names the counted key as the series' `tip`; it never nulls
  the counted value. A picked driver's column is the driver's own count; its hover and
  chip name the fleet's beside it.
- **Lines.** A line is two points or more; a lone comparable point is a small dot. The
  years chart (Compare) is a Month × Year table when the selected year has no three
  comparable months running (`yearLinesPlan`); the Company History sparkline draws runs of
  three or more months and isn't drawn under six (`sparkPlan`). The 3-month average on
  Every month on file is drawn only over runs of three months, and not at all when that
  leaves under six months or none of the latest six (`avgLine`) — then the hover and the
  table carry it. One footnote, linking to Data Coverage, replaces per-row caveat walls.
- **A visual change never redefines a number.** Trends and Reports stack all six charted
  categories, Attempts (logged) included, and their totals and month/year changes are the
  raw ones they always were; a period still in progress keeps its change, uncoloured and
  marked "to date", and so does a year captured differently from the one before
  (`yearCompared`, through `likeForLike`), marked "not compared". A month with no data,
  or a category the history serving it never tracked, reads "—" as it always has; a live
  month's counted 0 stays 0 in the table, the CSV and the hover even where coverage says
  the category wasn't captured yet (Attempts in Apr–May 2026) — the hover and the note say
  "not captured", the number doesn't change. Turning those 0s into "—" would be a change to
  what the tables report, shipped and announced on its own, on every screen at once.
  Counting failures apart from attempts, or comparing years
  like-for-like, is Company History's job — moving either onto these screens is a change
  to what a total means, shipped and announced on its own.
- **Form.** Fewer than 7 time slots, rankings, weekdays and breakdowns are a `BarList`
  (top 8, Not set / Unassigned gray and last). A manual-entry period under 10 entries is a
  sentence over the log with its charts a click away ("Show the charts"); every tile
  stays, as it always has. An empty one keeps its total tile alone (a picked driver's
  "0 of 37" with it) — never a row of "0 · — · 0 · — · 0" — over one empty state with
  "Widen the period", and the log under it says nothing more (no search box or second
  empty line). Reviews does the same with no reviews in the period. The manual-entry
  analytics grid fills every row (`gridRows`, from its measured width): the trend as rows
  sits beside By workday and the breakdown as three thirds when a third is wide enough,
  otherwise the breakdown spans its own row — never a card beside an empty hole.
- **Slot states.** No count (not captured, no feed) is a shaded slot with no text — as
  a row (fewer than 7 slots), no bar and "—" in ink 2, one row high, with why in its hover
  and one note line under the list ("May 2026: not captured …"); a
  counted zero a 2px stub; a bucket in progress is faded with "to date" in its hover. A
  month only imported history holds is an outlined bar (never filled) of its history count
  on an entry tab's trend (`outline`), named so in its hover and not clickable (it has no
  entries to list); the tab's own total stays what it lists, and its subtitle says how many
  more history holds. The note under a chart names each state it draws once, with its
  swatch and, for months, which ones ("Shaded: no data on file (Dec 2025), not captured
  (May 2026)" — `shadedReasons`); its items wrap whole and a line never ends in "·". A drawn bar
  must equal what clicking it lists, and the table view / CSV keep exactly the values they
  had — how a slot is drawn is display only.
- **Cards, tables and tiles.** One card look (title, one-line subtitle, one ⋯ menu, note
  under the plot); no header bands, coloured stripes or CHART | TABLE | CSV clusters. Row
  actions (edit, delete, deactivate) sit behind a row's ⋯ (`CardMenu fixed`), never a red
  button on every row; dates read `Sep 14, 2026`; on a phone a wide table is a stack of
  cards (`.cards-on-phone` + `data-label`) and a long list shows 20 at a time. Every date
  on screen goes through `fmtDate` / `fmtDateRange` in `period.js` ("Oct 8", the year when
  it isn't this year); the log's search, CSVs and printouts keep their own formats. A
  table's counted zero is "0" in ink 2 and a category not tracked is "—", never "·". Tiles: label,
  value, sub; a word value (a name, a weekday) is set smaller on one line; ties say
  "2 drivers tied"; a tile left alone on a strip's last row spans it with the same
  label / value / sub stack as the rest. A change on a tile's sub-line leads with ▲/▼ in
  the polarity colour. The drill drawer uses the same tiles, card titles and `BarList`. A leaderboard
  with nothing in the period or the year is one line under the grid, not a card. Hover readouts name the whole date (`fmtHead`: `Tue, Sep 29, 2026`).
- **Type.** Inter everywhere, sentence case, nothing under 11px. JetBrains Mono is for
  identifiers only (PRO, shipment, stop). No emoji — `kit/Icon.jsx`.
- **Colour.** The muted category palette in `categories.js` (validated; re-run the
  validator before changing it); a picked driver is the category colour, everyone else
  `DEEMPH`; chrome greys are the tokens in `chartTheme.js` / `:root`.

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
