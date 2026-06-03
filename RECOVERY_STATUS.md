# Davis Driver Scorecard — Recovery Status

This repository is the new version-control home for the Davis Driver Scorecard
app (previously deployed to Netlify with **no source control** — every deploy
was a direct artifact upload, and the editable source was lost).

Recovery is being performed from two surviving sources:
1. The live **minified** client bundle at
   `https://davis-driver-scorecard.netlify.app/assets/index-<hash>.js`
   (behavioral spec for the React client — reconstructed into clean `.jsx`).
2. The Netlify **deploy artifact** (pulled via the Netlify API once a token is
   provided) — contains the readable `netlify/functions/*` source and serves as
   the immutable production-artifact record.

## Deploy target (do NOT change / do NOT create a new site)
- Netlify site name: `davis-driver-scorecard`
- Netlify site ID:   `ce0bfa10-79d2-4f01-a177-018f1957f257`
- Team slug:         `chad-gdxevza`
- Live URL:          https://davis-driver-scorecard.netlify.app
- Build command: `vite build` · Publish dir: `dist` · Functions dir: `netlify/functions`

## Status

| Phase | Item | State |
|-------|------|-------|
| 1 | GitHub repo (this repo) under version control | ✅ done |
| 1 | Reconstruct React client (`src/*`) from minified bundle | ✅ done — `vite build` clean, all 10 views render, output matches prod artifact |
| 1 | Recover the 4 data functions (`data-incidents/drivers/reports/history`) | ✅ done — reconstructed to the **exact** Netlify Blobs schema; verified byte-identical to prod on a draft deploy |
| 1 | Recover NuVizz proxy functions (`track`, `doc`) | ✅ **recovered & verified** — see below |
| 1 | `recovered-build` branch + `prod-artifact-recovery` tag from deploy zip | ⏭️ skipped — the "download deploy" zip is published-files only (no functions); no editable artifact to immortalize beyond what's recovered here |
| 1 | Connect repo to Netlify for continuous deploy | ⏳ ready — all functions verified; pending owner go-ahead + GitHub App authorization |
| 3 | Fix 1 — no horizontal page scroll (768/1024/1440) | ✅ done & verified on draft |
| 3 | Fix 2 — widen Fault column | ✅ done & verified (150px) |
| 3 | Fix 3 — inline row-expand drawer (lazy photos, notes, custom fault) | ✅ done & verified on draft |
| 5 | Report naming — date-range default + editable; starts_at/ends_at stored | ✅ done (build clean; logic unit-checked) |
| 6 | Reports & analytics redesign — full-width nav, Weekly/Monthly/Yearly + charts | ✅ done (build clean; reconciliation unit-checked) |

> NOTE on brief phase numbering: this table uses the **master-brief** numbering
> (Phase 4 = the three Report-Detail UI fixes, listed here under "3" from the
> earlier draft). Brief Phases 5 (report naming) and 6 (analytics redesign) are
> the latest additions.

### Phase 5 — Report naming
Default name is derived from the **true min/max incident date** ("Week of Jun 1–5",
"Week of Apr 28 – May 2"). `starts_at`/`ends_at` are stored separately so analytics
group by real dates, not the editable label. The name is seeded only while blank
(re-drop/re-enrich won't clobber edits) and is inline-editable in both Ingest and
ReportDetail.

### Phase 6 — Reports & analytics redesign
Split-pane removed. The Reports list is full-width with a **Weekly | Monthly | Yearly**
granularity switcher + year/month period controls; clicking a report opens its own
full-width detail screen with a back button (state-based navigation — no react-router
added, to avoid destabilising the tab-based SPA). A recharts chart band sits atop each
view (weekly stacked-by-category + driver-fault line; monthly 12-month stacked + prior-
year ghost line; yearly category totals). Loading **skeletons**, empty states, sticky
headers, right-aligned mono numerics, sparklines + vs-prior deltas, and j/k/Enter + "/"
keyboard nav are in.

**Reconciliation:** monthly/yearly rollups use a shared `data/analytics.js` that mirrors
the Dashboard blend exactly — live incidents where any exist for a month, else the
history rollup — and counts live incidents with the same `driver_id` + tracked-category
filter the server `/rollup-report` uses. So Reports' monthly/yearly numbers reconcile
with the Trends tab and the Dashboard.

## NuVizz functions — RECOVERED & verified

The photo path (`/track` + `/doc`) talks to NuVizz DeliverIt v7, authenticated
with site env vars `NUVIZZ_USER` / `NUVIZZ_PASS` / `NUVIZZ_COMPANY` (ULINE).
Recovered from the gold-copy functions + the `davis-nuvizz` reference, with one
key correction confirmed by live testing:

- **Auth changed.** NuVizz deprecated the auth-token/Bearer flow (the minted JWT
  is now rejected with "invalid signature"). The working scheme is **direct HTTP
  Basic on every call** (the live `track` reports `sourceVia: "direct-basic"`).
- **`track`** → `GET {host}/stop/info/{pro}/{companyCode}` (Basic) → `{ stop, exe, load }`
  with `exe.{from,to}.podDoc[]` (documentGuid/Name/Path/extension), exceptions, driver.
- **`doc`** → `GET {host}/deliverit/openapi/documentapi/doc/getdocument/{companyCode}`
  `?documentGuid=<guid>&objectType=02&extension=<ext>` (Basic) → `{ documentData: <base64> }`,
  re-served as a data URI. Tries ULINE then DAVIS; portal→contact-support failover;
  sibling `tracking.davisdelivery.com/.netlify/functions/doc` as a last-resort chain.

Verified end-to-end on a draft: `track` returns the real stop for PRO 007103079
(driver Vincent Bonzo, 1 podDoc) and `doc?guid=` returns the real ~109 KB JPEG
(`via: direct`). The other ~6 `nuvizz-*` functions on the live site are orphaned
(the current client only calls `/track` and `/doc`).

## Verified on draft deploys (production untouched)
- Reconstructed data functions returned **byte-identical** responses to production
  (33 incidents light, 88 drivers, 1 report, 771 history records, photos endpoint).
- Recovered client renders real data: sidebar counts 1/33/88, dashboard KPIs,
  15 recharts charts, "historical rollup" badge.
- Phase 3: no horizontal page scroll at 768/1024/1440; fault dropdown legible;
  row drawer lazy-loads the real POD photo, notes/fault edits persist, custom-fault works.

## Verified facts from the live site
- Light theme only. Accent `#1e5b92`, JetBrains Mono for mono accents. `APP_VERSION = 0.5.0`.
- Tabs: Scorecard, Reports, New Report, All Incidents, Trends, Drivers, History Import.
- Split-photo storage is intact: `GET /.netlify/functions/data-incidents` returns
  ~37 KB of light records (`has_photos`, `photo_count`, no photo bytes).
- `GET /.netlify/functions/data-history` returns ~163 KB of rollup records.
- Data-client endpoints (from bundle):
  `data-incidents` (+`/batch`, +`/photos?id=`), `data-drivers`, `data-reports`,
  `data-history` (+`/batch`, +`/rollup-report`, +`/all`), `track?pro=`, `doc?guid=`.

> Scratch artifacts (downloaded minified bundle, beautified copies) live in
> `_recovery/` and are git-ignored — they are build output, not source.
