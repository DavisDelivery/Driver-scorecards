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

## Reports

- `src/reports/pdfGenerator.js` — the weekly accountability report across all drivers.
  Owns the shared style primitives (palette, `drawBadge`, `loadImage`, `fitDims`).
- `src/reports/driverReport.js` — single-driver handout for the selected period, printed
  from the manual-entry tabs. Imports its styling from `pdfGenerator.js` so the two can't
  drift apart.

## Dates

Entries are dated in the business timezone (America/New_York) via `todayET` / `nowET` in
`src/data/period.js`. Format ISO date strings by parsing the string, not through
`new Date()`, so a day can never shift by timezone.
