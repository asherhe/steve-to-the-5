# Handoff: point marking, catalog check and leaderboard points (point-check-v3)

Branch `fix-saved-example`, HEAD `3e5b726` (origin/main "neossat viewer", fast-forwarded).
Nothing is committed. Other agents edit `web/src/viewer/Viewer.tsx`, `SkyMap.tsx`, findings
community files, `services/findings/models.py` (Pin summary fields) and migration
`20261115160000_findings_viewport_summary.sql` concurrently. Untracked `services/catalogs/app/chain/`,
`check_chain.py`, `web/src/inspector/CheckChain*` belong to another contributor (their
`CheckChain.test.tsx` fails on its own).

## Done and verified earlier

- Double-click on the map marks a point (amber box-with-X replaces Aladin's reticle at centre,
  stays on the sky); single click still opens the Gaia inspector after 280 ms
  (`SkyMap.tsx` `bindPointer`). Map menu: "Check map center against catalogs".
- "Check this point" pane (`web/src/viewer/PointCheck.tsx`, logic in `catalogCheckSummary.ts`,
  tests `catalogCheckSummary.test.mjs`) runs `GET /api/catalogs/review` anonymously.
  `observedAtUtc` is optional there (SkyBoT skipped when absent).
- Gaia rows: "Show on map" (propagated to frame time / mosaic guide date) via the inspector's
  `catalogMark` / `comparisonMark`.
- Header Gaia and Review candidate buttons removed; tutorial and viewer README updated.
- v2 comparison-based scoring (`services/findings/review.py`, `point-check-v2`) exists but is
  superseded by v3 below. `CandidateReviewPane` / `ReviewReport` still use v2.

## User's current requirements (v3)

1. Submitting must not require loading SPHEREx (or any) frames.
2. Server fetches SPHEREx, WISE, DSS and NEOSSat itself. 20 points if the point is bright in
   any 2 of the 4 (user chose this). Known object (listed by ANY catalog) = 10 points and can be
   submitted directly with no brightness step. Otherwise 0, still postable.
3. Any catalog's listed source can be shown on the map (not only Gaia).
4. No two users may submit the same star: blocked if same catalog identity or an existing
   leaderboard entry within 15″ (user chose this).

## v3 backend: done, tests pass

- `services/findings/cutouts.py` (new): async fetchers. DSS (STScI dss_search, TAN WCS) and
  NEOSSat (CADC calibrated `cor`/`cord` FITS with TAN WCS; raw frames have no WCS) were probed
  live and work. SPHEREx (IRSA SIA `spherex_dr1` + IBE cutout) and WISE (IBE AllWISE W2 coadd
  cutout) are written to the formats the archive/WISE services use but were NOT verified live
  (IRSA returned 502 at the time).
- `services/findings/brightness.py`: any survey; peak within 1.5 px vs annulus median, noise
  1.4826×MAD (SPHEREx also sqrt(VARIANCE), flags mask from FLAGS header); ring ≥ 8–25″.
  Bright = ≥ 5σ. Checked on real data: stars 54–100σ, blank sky ~0σ.
- `services/findings/point_review.py` (new): `prepare_point_review`, `known_identity`
  (catalog priority Gaia > SIMBAD > CatWISE > VizieR > UltracoolSheet > SkyBoT, nearest row),
  object key = sha256(catalog:name). Undated points: SkyBoT "skipped" does not block 20.
- `models.py`: `PointReviewInput {ra, dec, radiusArcsec=30, frame?}`, `FrameRef`,
  `SourceMeasurement`, `CatalogIdentity`, `ExistingEntry`, `PointReviewResponse`;
  `comparisonId` optional on `FindingInput`/`Finding`/`LeaderboardEntry`, `fovArcmin` optional.
- `api.py`: `POST /api/findings/points/review` (signed in) returns score, identity,
  brightness, `duplicate`; `POST /api/findings` with a v3 `reviewId` and no comparison goes to
  RPC `spherex_submit_point_finding` (409 `already_on_leaderboard` on duplicates).
- `main.py`: `load_cutouts` (shared httpx client); catalog loader omits `observedAtUtc` if None.
- Migration `supabase/migrations/20261115150000_findings_point_check_scores.sql` (rewritten for
  v3, NOT applied to the hosted DB): optional comparison, score 0–50, `object_key` columns,
  unique visible entry per object, `spherex_point_entry_near`, locked
  `spherex_submit_point_finding`, leaderboard ranks only `point-check-v3`.
- Tests: `services/findings/tests/test_point_reviews.py` (new), `test_review_database_flow.py`
  (rewritten for points, real SQL dedupe), `pglite_bridge.cjs`, `check_migration.cjs`
  (dedupe assertions). `services/findings/fixtures/openapi.json` and
  `web/src/findings/findings.generated.ts` regenerated.
- Last results: findings tests 40 passed; `node services/findings/tests/check_migration.cjs`
  passed. PGlite is installed in `services/findings/.venv` (gitignored) per the findings README.

## v3 frontend: NOT started (next steps)

1. Run `npx tsc -p web/src/viewer/tsconfig.json --noEmit` first: regenerated findings types
   (optional `comparisonId`) may break consumers.
2. `web/src/findings/api.ts`: add `pointReview(req)` → `POST /api/findings/points/review`;
   allow `createFinding` without `comparisonId`/marks.
3. New submit component (replaces the CandidateReviewPane route from the check pane): sign-in,
   call `pointReview({ra, dec, radiusArcsec, frame?})` (send `frame` only when marked on a dated
   frame), show score/reasons/identity/brightness table/duplicate, title+note →
   `createFinding({ra, dec, title, note, reviewId})`, handle 409 `already_on_leaderboard`.
4. `PointCheck.tsx` / `Viewer.tsx`: remove the v2 pieces (`checkSurveys`, `loadSurveyAt`,
   `brightnessEvidenceFor`, `checkSubmitHint`, `reviewMarkedPoint`, survey list); update
   `expectedPoints` text (2 of SPHEREx/WISE/DSS/NEOSSat, fetched by the server); allow submit
   for reference-map points too.
5. Show-on-map for every catalog: generalize `GaiaList` to rows of all checks (SIMBAD `ra/dec`,
   CatWISE `ra/dec`, VizieR `RAJ2000/DEJ2000`, UltracoolSheet `ra_j2000_formula`, SkyBoT
   sexagesimal `RA/DEC`, Gaia propagated); add a generic Aladin catalog layer prop to `SkyMap`
   (e.g. `sourceMarks: {ra, dec, label}[]`).
6. Leaderboard/threads with `comparisonId: null`: `LeaderboardPanel` "Evidence & discussion",
   Viewer `showEntryEvidence`/`openFinding`, `FindingThread` must focus the map on ra/dec instead
   of loading a comparison.
7. Demo mock `web/src/findings/mock.ts`: `pointReview` with the live catalog check (no
   brightness), duplicate rule in localStorage.
8. Update `web/src/findings/tests/masterplan.test.tsx`, `services/findings/README.md` (its
   "Point scoring" section still describes v2), viewer README, tutorial step 4, leaderboard text.
9. Verify: IRSA SPHEREx/WISE fetchers live; browser end-to-end (viewer preview config
   `viewer-wise`, port 5184).

## Commands

```sh
services/catalogs/.venv/bin/python -m pytest services/findings/tests -q
node services/findings/tests/check_migration.cjs
services/catalogs/.venv/bin/python -m pytest services/catalogs/tests -q --ignore=services/catalogs/tests/test_check_chain.py
node --test web/src/viewer/*.test.mjs
npm --prefix web test
npx tsc -p web/src/viewer/tsconfig.json --noEmit
npm run generate:findings-types   # after re-exporting services/findings/fixtures/openapi.json
```
