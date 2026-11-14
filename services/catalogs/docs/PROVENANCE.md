# Catalog data provenance

## Source catalog

Astrometry and photometry come from **Gaia DR3** (`gaiadr3.gaia_source`), queried via the ESA
Gaia TAP service in live mode. Gaia DR3 astrometry is referenced to epoch **2016.0**.

Column mapping (Gaia TAP → response field):

| Gaia column | Response field | Unit |
|---|---|---|
| `source_id` | `sourceId` (string) | — |
| `ra`, `dec` | `ra`, `dec` | degrees |
| `ref_epoch` | `refEpoch` | Julian year |
| `pmra` | `pmRaCosDecMasYr` | mas/yr (Gaia `pmra` already includes cos δ) |
| `pmdec` | `pmDecMasYr` | mas/yr |
| `parallax` | `parallaxMas` | mas |
| `phot_g_mean_mag` | `gMag` | mag |
| `ra_error`, `dec_error` | `raErrorMas`, `decErrorMas` | mas |
| `pmra_error`, `pmdec_error` | `pmRaCosDecErrorMasYr`, `pmDecErrorMasYr` | mas/yr |
| `parallax_error` | `parallaxErrorMas` | mas |
| `radial_velocity`, `radial_velocity_error` | `radialVelocityKmS`, `radialVelocityErrorKmS` | km/s |
| `phot_bp_mean_mag`, `phot_rp_mean_mag` | `bpMag`, `rpMag` | mag |

Non-finite or masked cells are returned as `null`.

## Epoch propagation (predicted positions)

To overlay a catalog source on a dated SPHEREx frame, the observed position is propagated
from the Gaia reference epoch (2016.0) to the frame's observation epoch using proper motion:

```
dt_yr      = frameEpochYear - refEpoch
raPredDeg  = ra  + (pmRaCosDecMasYr / cos(dec)) * dt_yr / 3.6e6
decPredDeg = dec + (pmDecMasYr)                 * dt_yr / 3.6e6
```

The result is a **prediction**, always labelled as such, and never replaces the observed
position. Limitation: parallax and radial-velocity (perspective) terms are omitted for this
MVP marker. Over a few years the omission is small relative to the SPHEREx pixel scale for
most targets but is not zero; nearby high-proper-motion or high-parallax stars are the
sensitive cases. The same formula is implemented in the backend
(`app/astrometry/propagate.py`) and the frontend (`web/src/inspector/propagate.ts`) and is
checked against a shared test vector.

## Distinct kinds of data

- **Catalog measurements** (Gaia DR3): observed positions, motions, photometry with units.
- **Predicted positions**: propagated catalog positions, labelled predicted.
- These are kept distinct from **image observations** (SPHEREx frames), which this slice does
  not produce.

## Data kinds by provenance

- **Synthetic fixtures** (`fixtures/catalogs/*`): hand-written, offline, for deterministic
  development and tests. Approximate real objects but are not a dated live query.
- **Live query** (`CATALOGS_LIVE=1`): a real Gaia TAP response at request time. Not verified
  in this repository; verify separately at integration.
- **Saved real example**: none retained in this slice yet; if added, it will be dated and
  labelled.

## Attribution

Gaia data: work has made use of data from the European Space Agency (ESA) mission *Gaia*
(https://www.cosmos.esa.int/gaia), processed by the *Gaia* Data Processing and Analysis
Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Cite the Gaia DR3
data release when publishing results. SPHEREx image-release attribution (DR1/QR3) is handled
by the archive slice (task 1), not here.
