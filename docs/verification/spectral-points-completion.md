# Spectral points verification — 2026-11-15

Branch: `feat/spherex-spectral-points`. Implemented v4 scoring, a required saved
WISE blink, known-object bonuses, tentative two-region water/methane/hydrogen
patterns, WISE variability, typed reports, immutable spectral storage and an
additive database migration. Rules and limitations: [spectral points](../spectral-points.md).

Executed locally:

- `npm.cmd run build`: production typecheck/build passed (existing large Aladin bundle warning).
- `services/catalogs/.venv/Scripts/python.exe -m pytest services/findings/tests -q -p no:cacheprovider`: 61 passed, 36 subtests passed. After increasing the SPHEREx cutout margin, the affected source suite was rerun: 9 passed, 6 subtests passed.
- `npm.cmd --prefix web test -- --exclude src/inspector/__tests__/CheckChain.test.tsx`: 100 passed. The unrelated CheckChain test remains excluded as documented by the prior handoff; no claim is made about that unfinished slice.
- `node --experimental-strip-types --test --test-reporter=dot web/src/viewer/*.test.mjs`: all 67 passed.
- `node services/findings/tests/check_migration.cjs`: isolated PGlite migrations/grants/ownership/duplicate/replay checks passed. The Python API/database integration also exercised v4 submission, missing-WISE rejection, public read, second-account replies and duplicate blocking.
- `node scripts/verify-spectral-browser.mjs` against an isolated `VITE_LIVE_FINDINGS=1` dev server: passed WISE prerequisite, load, sign-in restoration, score/evidence rendering and desktop/mobile layouts. APIs, auth and map images were synthetic. Screenshots were visually inspected; local artifacts are in `.local-test-temp/spectral-browser`.
- `git diff --check`: passed.

Live checks were separate: `scripts/verify-spectral-live.py` queried the exact
five coordinates in `fixtures/catalogs/resolved-targets.json`, using 12 images
per target rather than the application's 48-image cap. The final results are
in [the live log](spectral-points-live.json). Barnard's Star and Epsilon Indi B
returned cutouts; strict quality/brightness/wavelength-coverage gates did not
support any species bonus. The remaining three targets encountered HTTP 502
archive failures in the final run. Earlier probes returned usable wavelength
samples at WISE 0855 and elsewhere, but they do not establish complete spectra
or scientific classification accuracy. No live positive chemical/variability
result is claimed.

The live probe exposed insufficient background-ring margin in 120-arcsecond
cutouts. SPHEREx now requests 180 arcseconds, retaining the same aperture,
background and quality requirements. The corrected live run removed those
geometric-margin rejections for the returned cutouts.

Six original real Epsilon Indi B cutouts and their manifest were retained
locally in `services/findings/.local-data/spectral` (ignored runtime evidence,
not committed fixtures). The following replay used no archive requests and
passed source integrity, numeric tolerance and feature-status checks:

```powershell
services/catalogs/.venv/Scripts/python.exe scripts/reproduce-point-spectrum.py 7921bd43a862e54c049a1c9d0a32ac0d1629b6bea2a486edca31eb70639e428c
```

Synthetic positive examples test the rule implementation, not the astrophysical
validity of the chemical hypotheses or a false-positive rate. A scientifically
validated chemical classifier remains separate work.

No hosted Supabase migration, live auth/write test, deployed-origin verification
or deployment was performed. The new SQL migration and durable evidence
storage must be configured when releasing the service. The default local demo
still does not invent spectral or variability measurements.

## Main integration verification

Integrated `origin/main` at `0b44f29`, preserving catalog caching, frame-time
predictions and the policy tolerating at most two unavailable catalogs. Added
a regression covering the interaction between that outage limit and both
spectral and WISE bonuses; regenerated the representative v4 fixture.

- Production typecheck/build passed.
- Findings backend: 64 passed, 42 subtests passed.
- Frontend: 100 passed, with the same pre-existing CheckChain exclusion above.
- Viewer: 72 passed, including the incoming catalog-cache tests.
- Catalog suite: the documented unfinished `test_check_chain.py` could not
  collect because `ChainMatch` is absent. With it excluded, all checks completed;
  two temporary-directory permission errors and one transport timing failure
  passed when those three checks were rerun outside the sandbox.
- `git diff --check` passed. No additional live archive or hosted checks were run.
