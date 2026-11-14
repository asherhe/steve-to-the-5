# Archive slice: integration notes for the coordinator

Nothing outside `services/archive/**` and `fixtures/archive/**` was changed. The items
below are proposals or facts other owners need; none has been applied to shared files.

## Proposed additions to the shared contract (additive, no field removed)

1. **HTTP errors on `GET /api/comparisons`.** Body is the agreed `{code, message}`.
   These are not domain statuses; the five statuses are unchanged.

   | HTTP | code | Meaning | Viewer suggestion |
   |---|---|---|---|
   | 429 | `BUILD_BUSY` | Another build holds the single build slot. `Retry-After: 30`. | "Busy, retry"; saved links still open |
   | 503 | `PROCESSING_LIMIT` | Local budget ran out (build deadline, cutout budget, candidate or byte limit). Nothing published. Not evidence of absence. | "Search not finished"; offer retry or a smaller field |
   | 422 | `INVALID_REQUEST` | Bad RA/Dec/field | Input error |
   | 404 | `NOT_FOUND` | Unknown comparison or asset | |
   | 500 | `EVIDENCE_CORRUPT` | Saved evidence failed its integrity check | |

2. **`upstream_unavailable` now has three diagnostic codes** in `diagnostics.code`:
   `UPSTREAM_ERROR` (discovery failed or every cutout failed), `INCOMPLETE_RETRIEVAL`
   (some downloads failed and no pair was found among the rest) and
   `INCOMPLETE_DISCOVERY` (a release query failed and the others were empty). All mean
   "the archive prevented an answer", never "no data exists".

3. **`ready` can be incomplete.** A comparison whose selected
   frames pass every check is returned even if other downloads failed or the bounded
   sample did not cover every discovered exposure. Read `diagnostics.complete`,
   `diagnostics.incompleteStages` (`discovery`, `retrieval`, `sampling`) and
   `diagnostics.selectionScope`. `single_epoch` and `no_comparable_pair` are only
   returned from a complete search.

4. **New optional fields** (null or absent on schema-1 evidence):
   - `frame.detector`, `frame.coverage` (`outputPixels`, `geometricFraction`,
     `validFraction`, `validFractionOfGeometric`, `targetRegion*`).
   - `comparison.coverage` (common valid coverage over all frames, and near the target).
   - `frame.alignment` values: `reference_frame`, `verified`,
     `wcs_only_not_empirically_verified`, `single_frame_not_applicable`.
   - `diagnostics.discovery`, `diagnostics.retrieval`, `diagnostics.alignmentFailures`,
     `diagnostics.coverageThresholds`.

5. **`comparison.config` is an open object.** It holds the resolved settings exactly as
   saved. Setting names differ between manifest schema 1 (`minimumCoverage`,
   `cutoutMarginFraction`) and schema 2 (`minGeometricCoverage`, `minValidCoverage`,
   `minCommonValidCoverage`, `cutoutPaddingArcsec`, ...). Generated types should treat it
   as a string-keyed map. `provenance.schemaVersion` tells them apart.

6. **Renamed diagnostics keys.** `notSelectedExposureIds` and `sampledObservationIds`
   (bare IDs, ambiguous because one observation ID covers six detectors) are replaced in
   new responses by `notSelectedExposures` and `sampledExposures`
   (`{observationId, detector}`). Old saved evidence keeps the old keys.

`fixtures/archive/openapi.json` is the current export; `history/openapi-v1.json` is the
previous one. Representative bodies: `fixtures/archive/responses/` and
`fixtures/archive/responses/errors/`.

## Deployment assumptions the coordinator must satisfy

- **One worker process.** The build slot is a process-local lock. With several workers
  or instances each has its own slot, so total concurrent builds equal the worker count.
  Use one worker or add a shared limiter.
- **Proxy timeout above the build deadline.** Default deadline is 180 s
  (`buildDeadlineSeconds`). It is checked between stages, batches, downloads and
  retries. A single image preparation or the final publish is not interrupted, so a
  response can arrive a little after 180 s.
- **Persistent disk** for `SPHEREX_STORAGE_DIR` (evidence and cutout cache). Each
  cutout is about 4 MB; a cold build can fetch up to 120.
- Replay and asset routes do not take the build slot and do not touch the archive.

## Viewer notes

- PNG is north-up, row 0 at the top; `grid.fitsHeader` is a FITS WCS (row 0 at the
  bottom). `fitsY = height - 1 - pngY`.
- Transparent pixels are masked or uncovered. Do not fill them. If
  `comparison.coverage.targetRegionCommonValidFraction` is below 1, some pixels near
  the requested position are missing in at least one frame.
- The service picks the wavelength (longest baseline among compatible pairs in the
  sample). There is no wavelength request parameter. A faint or very red target may be
  undetectable at the wavelength chosen; a wavelength preference would be a contract
  change for the coordinator to consider.
- `alignment: verified` means background sources agreed within 0.5 output pixel. It is a
  label; no correction is applied to any frame.

## Open gaps

See the "Verified and unverified" section of `README.md`.
