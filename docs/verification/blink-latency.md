# Blink retrieval and demo verification — 2026-11-15

Branch: `fix/archive-blink-latency`. These are local checks, not deployed-origin
verification. Live checks use real archive data; synthetic tests are listed separately.

## What changed and why

SPHEREx formerly waited for 24 cutouts before checking for a pair. Earliest/latest
sampling often chose incompatible spectral footprints, spending the whole build
budget downloading unsuitable observations. The new scheduler estimates the target's
fractional detector position from SIA footprints, prioritizes similar geometry at
separated dates, and checks after six cutouts. This is only a download priority:
the existing per-pixel wavelength, flags, coverage and alignment checks still apply.
All other candidates remain eligible within the declared budget. Footprints do not
change historical frame IDs. Selection is explicitly recorded as a bounded subset.

WISE's four-phase IBE discovery queries were failing with HTTP 502 or timeouts.
Reducing image count could not fix that. The new path reads the public unWISE neo11
input-exposure index, identifies original WISE/NEOWISE L1b images, and requests their
cutouts directly. The live image paths work even while database discovery fails.
No unWISE mosaic pixels or invented dates are used. Static metadata and contributing
cutouts are retained with hashes. This path conservatively selects central, included,
usable exposures; it does not claim an exhaustive archive search. IBE remains the
fallback for unsupported/unavailable indexes.

The default WISE blink builds two separated eligible visits with up to three exposures
per visit. Visits require at least two exposures. **Load longer time-lapse** explicitly
requests up to six visits with five exposures each. These have distinct evidence IDs.
Both services persist successful exact requests and replay them without archive calls.
The viewer labels saved delivery and offers an explicit archive refresh. PNG delivery
verifies the requested blob rather than rereading every retained FITS for each image.

Quick comparison uses a central six-arcminute field when the map is wider; Advanced
retains the larger supported field sizes. DSS is reference-only: it pauses playback,
hides blink and dated overlays, cancels active builds, and navigates searches without
starting an archive comparison. Both real pipelines report progress and cancellation.

## Live local route measurements

Cold result and source caches; six-arcminute fields. Durations include discovery,
downloads, preparation and publication. They are observed timings, not guarantees.

| Challenge target | SPHEREx pair | WISE W2 pair |
| --- | ---: | ---: |
| Barnard's Star | 36.944 s | 8.685 s |
| RW Aurigae | 35.048 s | 8.254 s |
| Epsilon Indi B | 35.431 s | 6.805 s |
| WISE 0855 | 36.169 s | 7.231 s |
| R Draconis | 37.818 s | 13.139 s |

All ten returned `ready`. Every final SPHEREx pair required six requested cutouts.
WISE uses six or fewer; all final visits use at least two contributing exposures.
A separate fresh Barnard's Star W1 check returned a pair in 8.086 s.

Before footprint scheduling, RW Aurigae hit the 180 s limit and R Draconis took
164 s. Before indexed discovery, all five WISE requests failed. Logs retain those
failures rather than reporting them as no coverage:

- `blink-live-20261115.json`: earlier route with original discovery/sampling.
- `blink-geometry-live-20261115.json` and `blink-geometry-other-targets-20261115.json`:
  all five SPHEREx targets with footprint scheduling.
- `blink-indexed-wise-live-20261115.json`: static WISE discovery for all five targets.
  Its original RW Aurigae result had one exposure in the earliest indexed visit.
- `blink-indexed-rwaur-final-20261115.json`: superseding cold RW Aurigae check after
  enforcing the two-exposure minimum and skipping that sparse endpoint visit.
- `blink-local-demo-http-20261115.json`: actual local HTTP checks of saved examples,
  fresh W1 and persistent W1 replay.

These checks establish image retrieval and playback, not a detected moving object,
significant variability or discovery. The WISE 0855 pair has too few background
matches to verify alignment empirically and is labelled accordingly. No alignment
correction was applied. See each manifest's coverage, quality and selection limits.

## Reliable demo

Run `npm run dev` from the repository root (restart after Python edits). Choose
**SPHEREx** or **WISE**, open **Time**, then **Open saved real example** and
**Blink A ↔ B**. These are retained, real dated observations, not synthetic fixtures.
The WISE example spans May 2010 to April 2024. Its six source cutouts and both metadata
tables are retained under `fixtures/wise/real-wise0855/` (about 4 MB).

Actual HTTP replay took 0.323 s for the saved SPHEREx example and 0.279 s for WISE.
The newly built W1 result replayed from the persistent request cache in 0.385 s.
Network-disabled backend tests and a browser check with external imagery blocked
verify the saved examples. The surrounding reference sky may still need the network;
the retained comparison images and dates do not.

The user-facing local preview for this work runs at `http://127.0.0.1:5178`, with
updated backends on 8008 and 8028, separate from the original development processes.
For a direct WISE replay:

`/?view=wise&comparison=69b16206d33440bb0cda45fc473b46d926c7cddd0e586aea646a0059712eed9a`

Exact replay always serves the original immutable PNGs and manifests. To reprocess
the retained original exposures with current code and no network:

```powershell
services/archive/.venv/Scripts/python.exe -m scripts.reproduce_wise_example
```

That check preserves grid, contributing source hashes and observation intervals,
and permits at most one 8-bit display level difference across numerical environments.
Here both PNGs reproduced with zero differing display levels. Reprocessing records a
new implementation/evidence ID; it does not overwrite the saved example.

## Verification commands

Final results: **113 backend tests passed**, **27 viewer adapter/replay/timeline tests
passed**, production type-check/build passed, and both browser workflows passed. The
real-demo browser workflow also passed after restarting the final backend code. Offline
WISE reprocessing reproduced both PNGs exactly. Shared OpenAPI exports match the app
factories; `git diff --check` passes. Existing historical evidence files and the root
dependency lockfile retain their exact original bytes.

```powershell
services/archive/.venv/Scripts/python.exe -m pytest services/archive/tests services/wise/tests -q
npm.cmd run build
node --experimental-strip-types --test web/src/viewer/production.test.mjs web/src/viewer/wise.test.mjs web/src/viewer/evidence.test.mjs web/src/viewer/timeline.test.mjs
node web/src/viewer/blink.browser.mjs
node web/src/viewer/blink-demo.browser.mjs
```

Browser checks require Playwright and Chrome; set `PLAYWRIGHT_MODULE` to the module
URL when installed outside the root dependency tree, and `VIEWER_TEST_URL` to the
running viewer. `blink.browser.mjs` uses synthetic HTTP responses for control flows;
`blink-demo.browser.mjs` uses actual local backends and retained real evidence.
The latter verifies advancing WISE dates, separate survey replay, disabled DSS blink,
and zero archive-discovery requests. No deployed checks were run.

To repeat live verification (network required, not an offline demo):

```powershell
services/archive/.venv/Scripts/python.exe -m scripts.verify_blink_live --output .cache/blink-live-check.json --storage .cache/blink-live-check
```

Reference documentation: [IRSA SPHEREx access](https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/),
[IRSA IBE search](https://irsa.ipac.caltech.edu/ibe/ibe_search_api.html),
[unWISE data access](https://unwise.me/imgsearch/) and
[unWISE neo11 files](https://unwise.me/data/neo11/unwise-coadds/fulldepth/).
The static-table approach is this implementation's use of those published metadata
products, not a claim that unWISE provides the app's blink API.
