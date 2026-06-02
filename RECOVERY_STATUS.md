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
