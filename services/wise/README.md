# WISE time-lapse service

Builds dated WISE/NEOWISE frames for the viewer's **WISE view**. For a sky position it
finds every W1 or W2 single exposure (Level 1b) that covers the field, groups them into
visits, and combines each visit into one frame on a shared grid with one stretch. The
result uses the SPHEREx archive's comparison shape, so the viewer plays it with the same
controls.

This is deferred scope in `spherex-project-brief.md` ("WISE historical imagery"), built at
the user's request on the `implement-wise` branch. It adds a route beside the shared
contract; it does not change `/api/comparisons` or its OpenAPI schema. The coordinator
has not yet adopted it into the brief or the handoff contract.

## Run

The service reuses the archive's Python environment (same dependencies). From the
repository root:

```sh
services/archive/.venv/bin/python -m pytest services/wise/tests -q
services/archive/.venv/bin/python -m services.wise serve            # port 8020
services/archive/.venv/bin/python -m services.wise compare --ra 133.79512916666664 --dec -7.245147222222222 --fov 6 --band 2 --summary
services/archive/.venv/bin/python -m services.wise replay <comparison id>
```

`npm run dev` starts it with the rest of the stack, and `npm run dev:wise` starts it
alone. Vite proxies `/api/wise` to port 8020; set `WISE_API_TARGET` to change that.
Runtime data goes to `services/wise/.local-data` (ignored by Git); set `WISE_STORAGE_DIR`
or `--storage` to move it.

## Routes

| Route | Result |
|---|---|
| `GET /api/wise/comparisons?ra&dec&fovArcmin&band` | `{status, comparison, diagnostics}` in the archive's shape. `fovArcmin` is 1–12, `band` is 1 (W1) or 2 (W2, default). |
| `GET /api/wise/comparisons/{id}` | The saved manifest, exactly as written. Never rebuilt. |
| `GET /api/wise/comparisons/progress/{progressId}` | `{stage, done, total, fraction, elapsedSeconds}` for a running build started with that `progressId` query parameter (8–64 letters, digits or hyphens). 404 once it ends. Display only; it never changes the result. |
| `GET /api/wise/comparisons/{id}/assets/{name}` | A rendered PNG, a combined-frame FITS, or a retained source cutout. |

Statuses are the archive's: `ready` (two or more visits), `single_epoch`, `no_coverage`,
`no_comparable_pair` (exposures exist but no visit passed the coverage or alignment
checks) and `upstream_unavailable`. A failed query is never reported as absence.
Errors use `{code, message}`. IDs belong to this service's own evidence store; a SPHEREx
comparison ID does not resolve here, and the reverse. The viewer marks WISE links with
`view=wise`.

## How a frame is made

Every setting below is in `WiseConfig` (`models.py`) and is saved in each manifest.

1. **Discovery.** IRSA's image search is queried for four single-exposure sets: All-Sky
   4-band, 3-band cryo, post-cryo 2-band and NEOWISE-R. Only frames that cover the whole
   requested field are returned. Frames with `qual_frame` 0 are dropped.
2. **Visits.** Exposures are ordered by time. A new visit starts after a 10-day gap, when
   a visit would exceed 15 days, or when the mission phase changes. WISE returns to most
   of the sky every six months, so a field usually has about 23 visits from 2010 to 2024.
3. **Sampling.** Six visits are used (`maxEpochs`), evenly spaced and always including
   the first and last, so the frames span the full baseline. A few frames are enough to
   see motion, and each visit costs several downloads. Within a visit, up to 5 exposures
   are used, evenly spaced in time. The manifest records how many visits were found and
   how many were used; the rest are not downloaded.
4. **Preparation.** Each cutout has the median of its finite pixels subtracted, then is
   resampled (bilinear) onto a north-up TAN grid at 2.75 arcsec per pixel.
5. **Combination.** A frame is the per-pixel median of its exposures. A pixel is valid
   when at least two exposures cover it. A visit needs two usable exposures and 80% valid
   pixels.
6. **Time.** The displayed time is the midpoint of the first and last exposure used. The
   frame also records that interval and every contributing exposure with its own
   mid-exposure time (IRSA `mjd_obs`).
7. **Alignment.** Registration is WCS reprojection only. Each frame is checked against the
   earliest one using background sources, with the central target excluded. A measured
   failure removes that frame and is recorded; nothing is shifted to fit.
8. **Stretch.** One asinh stretch for all frames, from the 3rd and 99.7th percentiles of
   all valid pixels. Units are DN.

## Evidence

A manifest holds the field, grid, stretch, resolved settings, every source exposure with
its URL, observation time and SHA-256, the implementation fingerprint, and the search
record. The comparison ID is the SHA-256 of that record, so the same inputs and settings
give the same ID and a changed input gives a new one. The manifest, PNGs, combined FITS
frames and all source cutouts are written before a `ready` response is returned, using
the archive's `LocalStore` (immutable blobs, conflict detection, integrity check on
load). A 6 arcmin comparison stores about 20 MB.

## Limits to keep in mind

- This is a quick look. It does not measure motion or variability, and a visible change
  is an observation to check, not a result.
- Subtracting each exposure's median removes real differences in background between
  visits and any uniform extended emission. No zero-point scaling is applied, so
  brightness is not photometric.
- No bad-pixel mask or uncertainty image is used. The median removes isolated artefacts,
  but diffraction spikes, latent images, scattered moonlight and saturated cores remain.
- Changes within one visit (up to 15 days) are averaged away, and anything that happens
  between the six chosen visits is not shown.
- W1 and W2 are broad filters. A WISE frame is not comparable with a SPHEREx spectral
  channel, and the two are never mixed in one comparison.
- IRSA's image search takes 30–80 s when it is healthy and dominates a first build: a
  6 arcmin field then needs 30 cutouts (about 5 MB), a 12 arcmin field about 18 MB. A
  hanging search is tried twice, then reported as `upstream_unavailable`. A build stops
  at a 360 s deadline and publishes nothing. Search results and finished cutouts are cached
  on disk (the survey's image sets are final), so a retry resumes from them. IRSA
  sometimes answers 503 when requests arrive quickly; those downloads are retried one
  at a time.

## Checks run

On November 14, 2026, on macOS with the archive environment:

- `pytest services/wise/tests services/archive/tests -q`: 92 passed. The WISE tests use
  synthetic exposures only.
- Live builds against IRSA for WISE 0855 (W2, 6 arcmin), under the earlier setting of 24
  visits: 233 exposures found, 23 visits, 115 cutouts retrieved, `ready` with 23 frames
  from 2010-05-04 to 2024-04-16. A cold build took 131 s.
- The same field with the current six-visit setting, using the cached search result and
  30 fresh cutout downloads: `ready` with 6 frames from 2010-05-04 to 2024-04-16 in about
  35 s, with progress reported through the browser. No claim is made about what the
  frames show.
- Later the same evening IRSA's image search and TAP both answered 502 or hung. A build
  of a new field then returned `upstream_unavailable`, as intended. A fully cold build
  under the six-visit setting has therefore not been timed.

Not yet done: the other four challenge targets, a retained real fixture under
`fixtures/`, an OpenAPI file for this route, and any deployed check.

## Acknowledgement

This service uses data products from the Wide-field Infrared Survey Explorer, a joint
project of the University of California, Los Angeles, and the Jet Propulsion
Laboratory/California Institute of Technology, and from NEOWISE, a project of the Jet
Propulsion Laboratory/California Institute of Technology. Both are funded by the
National Aeronautics and Space Administration. Images are served by the NASA/IPAC
Infrared Science Archive.
