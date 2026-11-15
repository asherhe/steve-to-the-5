# Frame-time catalog review and outage tolerance

Prepared against main commit `5eccba5883f799e7c995d238787ef45f4b01a748`.

## Behavior

A mark on a loaded WISE/SPHEREx frame already captures its observation timestamp and
pauses playback. Gaia, SIMBAD and CatWISE now search an expanded native-epoch cone,
then filter proper-motion predictions at that timestamp. Published columns remain intact;
map markers and nearest identities use the explicit frame-time prediction. CatWISE uses
motion-fit coordinates at MJD 57170, not its stationary-fit coordinates. SkyBoT continues
using the selected frame timestamp with geocentric predictions.

The quick-look motion allowance is 15 arcsec/year, limited to 150 years from the reference
epoch and 2,000 retrieved rows. A reached row cap remains partial even after all rows move
outside the requested cone. Unknown motion components, UltracoolSheet and VizieR AllWISE
retain published coordinates; parallax, perspective effects and motion faster than the
search allowance remain limitations. A combined frame still uses its recorded representative
time. These are catalog review aids, not a motion tracker or complete cross-identification.

No returned matches and up to two unavailable catalogs permit the uncatalogued-candidate
path, including the existing two-bright-survey rule for 20 participation points. Returned
rows in any catalog still take the 10-point known-object path. Three outages, unexpected
skips, and empty partial results remain incomplete (0 points). The undated SkyBoT skip
remains exempt. Missing services stay named in summaries and persisted review reasons.
Server, anonymous summary, and local demo follow the same policy. Historical reviews and
immutable image evidence remain unchanged; no migration or hosted deployment is performed.

## Brightness status

The existing findings service fetches SPHEREx, WISE, DSS and calibrated NEOSSat cutouts and
measures local contrast at the marked sky coordinate. Any two distinct bright surveys can
earn 20 points; two frames from one survey cannot. This path has synthetic FITS/WCS tests.
It does not follow a moving object between the observation dates of different surveys.
Live archive reliability is not established by this patch, and the browser-local demo does
not calculate brightness or award 20-point scores.

## Verification

The patch was first prepared and tested in a permitted temporary copy after automatic
approval review failed. After explicit user approval it was applied to the original
checkout, which passed the following checks:

- TypeScript check and production Vite build: passed.
- Viewer Node tests: 69 passed.
- Catalog/findings Python tests, including localhost transport and local database tests:
  213 passed, 36 subtests. Only pre-existing broken CheckChain collection was excluded.
- Frontend tests excluding the pre-existing unfinished CheckChain suite: 89 passed.
- The full frontend suite's earlier run had 94 passed and one existing CheckChain failure
  (`checkChain` missing). Full Python collection is likewise blocked by its missing
  `ChainMatch` model. Those unrelated files remain unchanged.
- No browser, live archive, hosted database, or deployed-origin verification was completed.

Tests cover entering/leaving the cone, RA wrap and polar crossing, absent proper motion,
CatWISE motion units, expanded Gaia retrieval, truncated empty motion searches, 0/1/2/3
outages, returned matches overriding outages, identity selection at predicted coordinates,
and non-Gaia markers using only predictions for the requested date.

Reproduce from repository root with the project-local Python environment:

```sh
services/catalogs/.venv/bin/python -m pytest services/catalogs/tests services/findings/tests --ignore=services/catalogs/tests/test_check_chain.py
node --experimental-strip-types --test web/src/viewer/*.test.mjs
npm run build
npm --prefix web test -- --no-cache --exclude src/inspector/__tests__/CheckChain.test.tsx
```

## Astrometry references

- [IRSA CatWISE column definitions](https://irsa.ipac.caltech.edu/data/WISE/CatWISE/gator_docs/catwise_colDescriptions.html): motion-fit reference date, coordinate columns and motion units.
- [SIMBAD query guide](https://simbad.u-strasbg.fr/Pages/guide/sim-fsam.htx): reference frame and epoch.
