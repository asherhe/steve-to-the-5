# SPHEREx archive backend

This standalone slice implements coordinate discovery, dated monochrome preparation,
immutable local evidence storage, replay and asset delivery. It owns no frontend,
Gaia service, auth, discussion system, or hosted deployment.

## Run from the repository root

Python 3.11 or later is required. The checked environment used Python 3.13 on macOS
arm64. `requirements.in` lists direct dependencies; `requirements.lock` records the
complete tested environment. The coordinator can integrate these into root dependency
management without changing this module's public interfaces.

```sh
python3 -m venv services/archive/.venv
services/archive/.venv/bin/python -m pip install -r services/archive/requirements.lock
services/archive/.venv/bin/python -m pytest services/archive/tests -q
services/archive/.venv/bin/python -m services.archive serve
```

OpenAPI is available at `/openapi.json`, interactive docs at `/docs`. An export for the
coordinator is in `fixtures/archive/openapi.json`. The default CLI storage directory is
`services/archive/.local-data`. Set `SPHEREX_STORAGE_DIR` when using the app factory;
use `--storage` with the CLI. The path must be persistent in a deployed service.

### Live comparison and five-target log

```sh
services/archive/.venv/bin/python -m services.archive compare --ra 133.7951291667 --dec -7.2451472222 --fov 6
services/archive/.venv/bin/python -m services.archive coverage --output services/archive/.local-data/coverage-log.json
services/archive/.venv/bin/python -m services.archive coverage --only "WISE 0855" --output services/archive/.local-data/one.json
```

Global options go before the command: `--deadline` (overall build seconds, default
180), `--attempts`, `--timeout`, `--max-frames`, `--max-candidates`, `--storage`.

Requests use SIA2 directly over HTTPX for explicit byte limits, timeout, retry and
VOTable-error handling. DR1 and QR3 Wide Survey collections are queried. Deep Survey
collections are not included in this version. No account is required for this path.
Downloads are restricted to HTTPS IRSA SPHEREx paths.

### Offline synthetic fixture

```sh
services/archive/.venv/bin/python -m services.archive --synthetic compare --ra 10 --dec 20 --fov 6
services/archive/.venv/bin/python -m services.archive --synthetic serve
```

The synthetic field is centred at RA=10°, Dec=20°. These images are manufactured
stars and a moving central point, with linear spectral WCS. They are not NASA data.
Response examples for all five domain statuses are in `fixtures/archive/responses`.

### Retained real examples

Two real examples are kept. They are different kinds of evidence.

| Directory | What it is | Field |
|---|---|---|
| `fixtures/archive/real-wise0855/` | Comparison built by a live archive query with the current policy (`evidenceKind: real_archive`), copied with its original cutouts | WISE 0855 challenge position, 6 arcmin |
| `fixtures/archive/real/` | Earlier hand-curated tutorial pair (manifest schema 1, `saved_real_example`) | IRSA tutorial field, 1 arcmin |

Serve a saved example by its original ID (no archive access):

```sh
services/archive/.venv/bin/python -m services.archive --storage fixtures/archive/real-wise0855 --recorded fixtures/archive/real-wise0855/sources.json serve
services/archive/.venv/bin/python -m services.archive --storage fixtures/archive/real --recorded fixtures/archive/real/sources.json serve
```

The ID is `originalComparisonId` in each `sources.json` (for the tutorial example, the
`id` in `response.json`). `GET /api/comparisons/{id}` returns the stored response
unchanged.

Reprocess the retained WISE 0855 cutouts offline:

```sh
services/archive/.venv/bin/python -m services.archive --recorded fixtures/archive/real-wise0855/sources.json compare --ra 133.79512916666664 --dec -7.245147222222222 --fov 6
```

Reprocessing is labelled `saved_real_example`, sees only the retained frames, and gets
a different ID from the live build. The regression test requires identical PNG bytes in
the recorded environment; that is not a promise of bitwise equality across dependency
versions or architectures.

The tutorial cutouts were requested with the old 10% margin. Under the current
geometric-coverage rule they are rejected (`insufficient_geometric_coverage`), so
reprocessing them returns `no_comparable_pair`. The thresholds were not relaxed to make
them pass. Their saved comparison still replays exactly by ID.

To retain another live result: `python -m services.archive retain <id> --output
fixtures/archive/real-<name> --target "<name>"` copies the manifest, PNGs and original
cutouts from the local store.

## API and integration contract

- `GET /api/comparisons?ra=...&dec=...&fovArcmin=...`: anonymous build, domain response
  `{status, comparison, diagnostics}`. RA/Dec are finite ICRS degrees; RA is [0,360),
  Dec [-90,90], and square field width is 1–30 arcminutes (default 6).
- `GET /api/comparisons/{id}`: the saved response exactly as stored. Never queries
  IRSA and never waits for a running build.
- `GET /api/comparisons/{id}/assets/{name}`: immutable PNG or original FITS bytes with
  ETag. Image URLs are same-origin relative paths; source URLs identify original
  archive products.

Domain statuses (HTTP 200) and what each one is allowed to claim:

| status | Returned when |
|---|---|
| `ready` | Two or more frames passed every check. May come from an incomplete search; see `diagnostics.complete` and `incompleteStages`. |
| `single_epoch` | A complete search found exactly one usable frame. |
| `no_comparable_pair` | A complete search found no acceptable pair. |
| `no_coverage` | Every release query succeeded and returned no exposures. |
| `upstream_unavailable` | The archive prevented an answer: discovery failed, every cutout failed, or downloads failed and no pair was found among the rest (`INCOMPLETE_RETRIEVAL`). |

HTTP errors use `{code, message}` and are not domain statuses:

| HTTP | code | Meaning |
|---|---|---|
| 422 | `INVALID_REQUEST` | Bad coordinates or field |
| 404 | `NOT_FOUND` | Unknown ID or asset |
| 429 | `BUILD_BUSY` | The single build slot is taken. Rejected at once with `Retry-After: 30`; nothing is queued. |
| 503 | `PROCESSING_LIMIT` | Local budget exhausted: build deadline, cutout budget without a pair, too many candidates, or SIA overflow. Nothing is published and nothing is claimed about the sky. |
| 500 | `EVIDENCE_CORRUPT` | Saved evidence failed integrity checks |
| 409 | `EVIDENCE_CONFLICT` | Different content offered under an existing ID |

An incomplete search never yields `no_comparable_pair`, `single_epoch` or
`no_coverage`. It yields `ready` (with the gaps listed), `upstream_unavailable`, or
HTTP 503, depending on whether the archive or the local budget was the cause.

The handoff fields are preserved. Additive fields include observation IDs, detector,
time bounds, bandwidths, source hashes, per-frame and common coverage, resolved
settings, limitations and provenance. `comparison.config` is an open object holding the
settings as saved; names differ between manifest schema 1 and 2. Contract proposals for
the coordinator are in `INTEGRATION.md`.

`grid.fitsHeader` is a conventional FITS celestial WCS; PNGs are north-up with top-row
origin. To map a zero-based PNG pixel into that WCS, use `(x, height-1-y)`. `fovArcmin`
is the requested width; rounding up pixel counts makes the actual grid slightly wider.

`qualityFlags` is a summary of input/output pixel counts and the allowed informational
flag mask, not a flag image. Native flag values are in the retained FITS asset.

The coordinator can include `create_router(pipeline)` in the shared app and call
`install_error_handlers(app)`. `create_app()` supplies a standalone factory for
`uvicorn services.archive.api:create_app --factory`. The local store implements
`EvidenceStore`; a cloud adapter must preserve atomic publication, conflict detection,
integrity checks and `load_raw`. No Supabase schema or root application file was changed.

## Processing policy and limits

Resolved settings are serialized in each manifest. These are provisional quick-look
engineering choices, not detection-significance criteria.

**Grid and cutout extent**

- 6.2 arcsec/pixel, north-up/east-left ICRS TAN grid; one exposure per frame.
- The cutout request is made before any detector WCS is available, so its size is the
  conservative bound: a detector-aligned square circumscribing the circle through the
  farthest corner of the actual rounded output grid, plus 20 arcsec padding per side
  for bilinear support, centre rounding and distortion. That covers every rotation
  (requests: 1 arcmin field → 2.13 arcmin, 6 → 9.29, 30 → 43.19).
- After download the detector WCS is used to measure what was really covered. If the
  detector edge truncates the cutout, the missing area stays missing.

**Coverage, three separate settings.** All use the full output grid as denominator
(`coverage.outputPixels`).

| Setting | Default | Meaning |
|---|---|---|
| `minGeometricCoverage` | 0.98 | Output pixels whose bilinear support lies inside the cutout array |
| `minValidCoverage` | 0.80 | Output pixels whose whole support also passes the quality mask |
| `minCommonValidCoverage` | 0.75 | Pixels valid in both frames of a pair |

Each frame also reports validity within 5 output pixels of the requested position
(`targetRegionValidFraction`); the comparison reports the same for all frames together.
This is reported, not thresholded. Thresholds are not relaxed automatically.

**Masking and background**

- Only documented SOURCE and FULLSAMPLE informational flags are allowed. All other set
  bits, nonfinite values and nonpositive variance are excluded.
- Bilinear reprojection requires all supporting pixels to be valid; flags are never
  interpolated and bad pixels are never filled. Invalid or uncovered pixels are
  transparent. One bad detector pixel therefore removes up to four output pixels.
- The supplied ZODI model is subtracted. No frame-wise median subtraction, histogram
  matching, per-frame normalization or PSF homogenization.

**Wavelength.** The response is evaluated from the spectral WCS at every output pixel.
Over the common valid region, wavelength differences must not exceed 0.25 of the
narrower local bandwidth. Frames must share a detector. This is visualization, not
calibrated spectroscopy.

**Search and selection**

- Up to 1000 discovered candidates. Cutouts are requested in batches of 24, round-robin
  by detector and alternating earliest/latest dates, at most 120 per build, 3 at a time.
- The search stops at the first batch that yields an acceptable pair, then adds frames
  from the sample that are compatible with every chosen frame, up to 12. Pairs are
  ranked by longest baseline, then common coverage, wavelength agreement and IDs. This
  is not a globally optimal or exhaustive search, and the wavelength is whichever one
  the best-ranked pair happens to have.
- A failed download no longer discards the batch. Successful cutouts are used; each
  failure is recorded with observation, detector, category and attempt count.

**Alignment check.** Frames are registered by WCS reprojection only. A check compares
centroids of background sources between two frames, excluding a 5-pixel radius around
the requested position so target motion is never used or removed. It needs at least
three mutual matches within 2 pixels; median residual above 0.5 pixel is a measured
failure. Fewer references leave the frame labelled
`wcs_only_not_empirically_verified`, which is different from a failure.

- A failure belongs to a pair. That pair is skipped and the next-ranked pair is tried;
  neither frame is excluded from other pairings, because the check cannot say which
  frame is wrong.
- A frame is added to a chosen set only if it has no failed check against any member.
- If no acceptable pair remains, later batches are fetched while the budget allows.
- No shift or other correction is ever applied to the images.

**Bounded work**

- One comparison build per process. A second build request gets HTTP 429 immediately.
  Replay and asset requests are unaffected.
- Overall build deadline 180 s, checked between stages, batches, downloads and retries.
  Network timeouts and backoff waits are capped by the time left. A build that passes
  the deadline publishes nothing and returns HTTP 503. One image preparation or the
  final publish is not interrupted, so the response can arrive slightly late.
- Transient failures (timeouts, transport errors, HTTP 502/503/504) are retried up to 3
  attempts with exponential backoff (0.5 s base, 8 s cap) and jitter. Other statuses
  are not retried. Each response is capped at 20 MB.

**Time.** Observation timestamps come from SIA UTC MJD bounds, keeping start and end
and displaying the midpoint. FITS creation and processing dates are not used.

**Identity.** The comparison ID is a SHA-256 over the field, resolved settings, grid,
stretch, source content hashes, implementation fingerprint and the search record. Any
changed threshold or code gives a new ID. Because the search record is part of the
saved evidence, the same frames found on a run with different download failures also
get a different ID.

## Storage and operational limits

Immutable content-addressed blobs hold original cutouts and rendered PNGs. A checksummed
manifest is published atomically last, after fsync. Existing IDs cannot be overwritten
with conflicting records. Replay checks manifest and blob integrity, returns the stored
response unchanged, and never repairs corruption by fetching a new archive version.
Evidence written under manifest schema 1 replays under the current code.

Temporary cutout caches are separate from retained evidence. There is no automatic
evidence deletion or cloud retention policy. Back up manifests and blobs together. An
ephemeral hosting filesystem is not durable storage.

Deployment assumptions:

- **Single worker.** The build slot is a lock inside one process. It is not a
  distributed limit; N workers allow N concurrent builds. `serve` runs one worker.
- A proxy timeout above the 180 s deadline, persistent disk, and same-origin routing
  (broad CORS is not enabled).
- Each cutout is about 4 MB regardless of field size. A cold build that needs all five
  batches downloads roughly 480 MB.

## Verified and unverified

RESULTS_PLACEHOLDER

## Sources and attribution

- https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/
- https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/
- https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/
- https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/
- https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html

DR1 spectral-image DOI: 10.26131/IRSA678. The full SPHEREx acknowledgement is preserved
in comparison provenance. Use the appropriate QR3 citation for QR3 observations.
