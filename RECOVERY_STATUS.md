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
| 1 | Recover NuVizz proxy functions (`track`, `doc`) | ⚠️ **NOT recoverable** — proprietary upstream API, not in client bundle/artifact/API. Shipped as documented placeholders. |
| 1 | `recovered-build` branch + `prod-artifact-recovery` tag from deploy zip | ⏭️ skipped — the "download deploy" zip is published-files only (no functions); no editable artifact to immortalize beyond what's recovered here |
| 1 | Connect repo to Netlify for continuous deploy | ⏳ **blocked on NuVizz** (see below) — would otherwise replace the working photo proxies with placeholders |
| 3 | Fix 1 — no horizontal page scroll (768/1024/1440) | ✅ done & verified on draft |
| 3 | Fix 2 — widen Fault column | ✅ done & verified (150px) |
| 3 | Fix 3 — inline row-expand drawer (lazy photos, notes, custom fault) | ✅ done & verified on draft |

## ⚠️ NuVizz functions — deployment caveat (READ BEFORE CONNECTING GIT DEPLOY)

The live site has 10 functions. The 4 **data** functions are fully recovered and
verified storage-compatible. The **photo** path (`/track` + `/doc`) proxies a
**proprietary external NuVizz API** authenticated with the site env vars
`NUVIZZ_USER` / `NUVIZZ_PASS` / `NUVIZZ_COMPANY`. That upstream API shape exists
only inside the original (lost) function source — it is **not** in the client
bundle, the deploy artifact, or any Netlify API, so it could not be recovered.

`netlify/functions/track.js` and `doc.js` are therefore **documented placeholders**
that make the client degrade gracefully to "No photos available". They do NOT
perform real NuVizz lookups.

Consequence: connecting continuous Git deploy (or any CLI deploy from this repo)
will **replace the currently-working `track`/`doc` with these placeholders**,
disabling "Pull Missing Photos" / NuVizz enrichment. Before switching the deploy
source, restore the real NuVizz integration in `track.js`/`doc.js` (re-implement
against the NuVizz API using the existing env-var credentials, or supply the
original source if it turns up). The other ~6 `nuvizz-*` functions on the live
site are orphaned (the current client only calls `/track` and `/doc`).

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
