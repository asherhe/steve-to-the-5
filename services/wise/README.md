# WISE blink and time-lapse service

The viewer uses real W1/W2 single-exposure images from WISE/NEOWISE, combined by
visit on a shared sky grid and display stretch. This work is authorized by the
archive-blink task; WISE and SPHEREx images are never mixed in one comparison.

## Run and demonstrate

From the repository root, `npm run dev` starts the viewer and both image services.
Restart it after Python changes. In the viewer choose **WISE → Time → Open saved
real example → Blink A ↔ B**. The retained W2 example of the WISE 0855 field has
visits in May 2010 and April 2024. It needs no archive access and is explicitly
labelled saved. SPHEREx has its own saved real example using the same controls.
DSS is a reference map and has no blink controls.

The standalone service is `npm run dev:wise` (port 8020). Runtime data goes to
`services/wise/.local-data`, or `WISE_STORAGE_DIR` with the app factory, or `--storage`
with the CLI. Both startup paths include the retained real example store.

```powershell
services/archive/.venv/Scripts/python.exe -m services.wise serve
services/archive/.venv/Scripts/python.exe -m pytest services/wise/tests -q
services/archive/.venv/Scripts/python.exe -m scripts.reproduce_wise_example
```

On Unix use `.venv/bin/python` in place of `.venv/Scripts/python.exe`.

## Fast discovery without a database query

`IndexedWiseClient` first downloads the 590 KB [unWISE tile index](https://unwise.me/data/allwise/unwise-coadds/fulldepth/tiles.fits)
and the nearest tile's per-band `-frames.fits` table in the
[neo11 release](https://unwise.me/data/neo11/unwise-coadds/fulldepth/).
These are static metadata files, not images or synthesized observation dates.
The table supplies original WISE scan/frame identities, dataset paths, observation
MJDs and quality values. Selection requires `included > 0`, `use > 0`, acceptable
`qual_frame`, and an exposure centre within 0.25 degrees of the requested position.
It is a conservative subset, not an exhaustive coverage search.

Only recognized WISE dataset paths are used to construct direct IRSA L1b cutout
URLs. No unWISE coadd pixels enter playback. The downloaded FITS header's band,
scan, frame number and MJD are checked against metadata when present. WCS coverage
and background-source alignment checks still decide which frames can be shown.
Both metadata FITS files and every contributing original cutout are retained and
hashed in the immutable evidence store. If the index is unavailable or has no
supported candidates, the service falls back to the four-phase IBE search.

This bypass fixed the observed WISE discovery outage: all five challenge targets
returned real W2 pairs, and a separate W1 check succeeded. See
[measurements and verification](../../docs/verification/blink-latency.md).

## API and processing

| Route | Behavior |
| --- | --- |
| `GET /api/wise/comparisons?ra&dec&fovArcmin&band` | Default `mode=blink`: two separated eligible visits, up to three exposures each. Field width 1–12 arcmin; band 1 or 2, default 2. |
| Same route with `mode=timeline` | Up to six visits, five exposures per visit. Explicit longer build; reuses source downloads. |
| Same route with `refresh=true` | Bypasses saved-result and retained-example lookup. Valid static metadata and source downloads remain reusable. |
| `GET /api/wise/comparisons/{id}` | Integrity-checked immutable replay; never rebuilds. |
| `GET /api/wise/comparisons/{id}/assets/{name}` | Immutable PNG or FITS asset. |
| `GET /api/wise/comparisons/progress/{progressId}` | Display-only build progress. |
| `DELETE /api/wise/comparisons/progress/{progressId}` | Cooperative cancellation; an in-flight network read may finish first. |

`progressId` is 8–64 letters, digits or hyphens. One build is admitted per process;
other builds receive 429, while replay remains available. `X-Comparison-Source`
is `archive`, `saved-cache` or `saved-example` and is outside evidence identity.
Schemas and synthetic examples live in `fixtures/wise/openapi.json` and
`fixtures/wise/responses/`. The original real demo is in `fixtures/wise/real-wise0855/`.

Visits split on a 10-day gap, a span over 15 days, or a mission-phase change. Visits
must contain at least two exposures by default. The first and last eligible visits
are included. Each exposure has its finite-pixel median subtracted and is
reprojected onto a north-up TAN grid at 2.75 arcsec/pixel. Each visit uses the
per-pixel median, requires two supporting exposures per valid pixel and 80% valid
coverage. All displayed frames share one asinh stretch in native DN. The displayed
time is the midpoint of the first and last contributing exposure times; the full
interval and each contributing exposure remain in the manifest.

Exact requests are indexed persistently after successful builds, separated by
band, field, profile, settings and implementation fingerprint. Only ready results
are cached. A failed refresh does not erase prior evidence. Old IDs retain their
original bytes after policy changes. The CLI retains its configured timeline mode.

## Scientific limits and attribution

This is a quick-look visualization, not a motion or variability measurement.
Median background subtraction removes uniform extended emission. No zero-point
scaling, uncertainty image or bad-pixel bitmask is applied. Three-exposure visits
can be noisy; artefacts and saturation remain. Changes within a visit are combined,
and unselected visits are not shown. Alignment is WCS reprojection only; insufficient
stationary background sources are labelled `wcs_only_not_empirically_verified`.
A ready pair is not a confirmed object identification or discovery.

The metadata index credits [unWISE](https://unwise.me/): Lang (2014) and Meisner,
Lang & Schlegel (2017a,b). Images use data products from the Wide-field Infrared
Survey Explorer, a joint project of UCLA and JPL/Caltech, and NEOWISE, a project of
JPL/Caltech, funded by NASA. Images are served by the NASA/IPAC Infrared Science
Archive. Full acknowledgement and source URLs are retained with each comparison.
