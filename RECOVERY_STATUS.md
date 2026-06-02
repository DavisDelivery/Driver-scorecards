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
| 1 | `recovered-build` branch + `prod-artifact-recovery` tag from real deploy zip | ⏳ needs Netlify token to pull artifact |
| 1 | Recover `netlify/functions/*` source | ⏳ needs Netlify token (functions are server-side, not in client bundle) |
| 1 | Reconstruct React client (`src/*`) from minified bundle | 🔧 in progress |
| 1 | `vite build` produces working dist | ⏳ pending |
| 1 | Connect repo to Netlify for continuous deploy | ⏳ likely needs dashboard (GitHub App authorization) |
| 3 | Three UI fixes (table overflow, fault column width, row-expand drawer) | ⏳ after Phase 1 verification gate |

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
