# Spectral and WISE participation points

Implemented on `feat/spherex-spectral-points`. The user authorized tentative
spectral suggestions for known objects as well as unlisted points, then added
a mandatory WISE blink and a brightness-change bonus. This supersedes v3's
known-object brightness bypass. It is a provisional screening game, not a
calibrated chemical classifier or discovery assessment.

## Rules and contract

| Criterion | Points |
|---|---:|
| A checked catalog lists a source | 10 base |
| No applicable catalog lists a source, bright in two surveys | 20 base |
| Otherwise | 0 base |
| Usable SPHEREx fixed-position aperture signal >= 5 sigma | +10 |
| Both declared water absorption regions pass | +5 once |
| Both declared methane absorption regions pass | +5 once |
| Both declared hydrogen absorption regions pass | +5 once |
| First/last WISE visits pass the brightness-change screen | +5 once |

All +5 bonuses require the SPHEREx signal gate. Known objects qualify. An
incomplete catalog check without a listed source earns no bonuses until retried.
Following the current catalog policy, up to two unavailable catalogs are tolerated
when the other applicable checks return no matches; missing checks remain explicit
and do not establish novelty. Other incomplete or truncated checks block scoring.
Maximum score is 50 (40 for known objects). Missing measurements never establish
absence of a substance or a constant source.

The authenticated `/api/findings/points/review` now requires `wiseComparisonId`.
The server rejects missing IDs, synthetic evidence, outside-field positions and
fewer than two distinct dated WISE visits before calculating a score. The viewer
provides **Get WISE blink**, disables scoring until it is ready, and restores
the saved blink through sign-in/reload. An archive failure or single epoch does
not unlock scoring. The original optional `frame` still supplies only its
validated original time for the asteroid check.

The response adds `scoreBreakdown`, `spectral` and `wiseVariability` under
`point-check-v4`. OpenAPI and generated types are updated together. Clients
cannot supply scores/measurements. Saved v3 reports remain readable and ranked
at their original scores; they are never silently rescored. The existing
per-object/15-arcsecond database lock still blocks duplicate rewards.

## Spectral screen

`services/findings/spectral.py` maintains the thresholds and wavelength windows.
This screen has **no calibrated false-positive rate**. “Possibly contains…” means
the declared pattern passed and needs follow-up, not a chemical identification,
abundance, temperature or object classification. Other absorbers, dust, blends,
continuum curvature, PSFs, motion and variability can mimic these patterns.
No emission-line screen is implemented.

Discovery queries DR1/QR3 separately, at most 2,000 metadata rows per release,
then selects up to 48 unique URLs, round-robin across detectors, newest within
each detector. Cutouts are 180 arcseconds; bounds are four concurrent downloads,
12 MB per file, 64 MB retained total, and a 120-second survey deadline. Capped
discovery and individual failures remain explicit. The detector-wide wavelength
range is never used as the wavelength at the point.

The original IMAGE minus ZODI is measured on its native celestial WCS in a
12.4-arcsecond aperture, with local median background at 24.8–49.6 arcseconds.
All aperture pixels must be valid; only documented SOURCE/FULLSAMPLE bits are
allowed. The background needs 30 pixels and 80% valid coverage. Pixel variance,
annulus scatter and background-estimation error contribute to uncertainty.
WCS-WAVE must vary by <=0.25 bandwidth across the aperture. Values are aperture
surface brightness in MJy/sr, with no PSF fit/deblending/total-flux correction.

Each feature needs a whole approximate passband inside its window and continuum
samples on both sides. The samples share detector, release and processing version
and span <=7 days; continuum S/N must be >=5. A >=20% deficit and >=5 propagated
errors, including a 10% systematic floor, must hold in every usable tested epoch.
Both declared regions per substance must pass. These windows and thresholds are
engineering choices, **not validated published classification indices**. WCS-WAVE
is a visualization approximation; confirmation requires calibrated spectral
products and appropriate models. Narrow hydrogen lines can be unresolved.

References for feature locations and data interpretation:

- [Water/methane bands](https://www.ipac.caltech.edu/publication/1999ApJ...522L..65B).
- [Brown-dwarf spectroscopy including methane near 3.3 µm](https://stsci-opo.org/STScI-01GW821M4YH9F2VXCTD2T52H8W.pdf).
- [Hydrogen Paschen beta/Brackett gamma](https://doi.org/10.1088/0004-6256/140/5/1214).
- [SPHEREx data products and wavelength limitations](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/).
- [IRSA spectrophotometry flags and background](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html).

## WISE brightness screen

Combined blink DN frames are not photometry. The new screen measures retained,
hash-verified original exposures for the first/last visits. It requires empirical
image alignment, >=2 unique exposures per visit, quality >=5, one band, complete
apertures, valid MAGZP/MAGZPUNC, S/N >=5, centroids within 2.75 arcseconds and
within-visit scatter <=20%. Aperture estimates brighter than W1=9/W2=8 are
excluded conservatively for saturation risk.

An 8.25-arcsecond aperture and 22–38.5-arcsecond annulus yield background-subtracted
DN, scaled by `10**(-0.4 * MAGZP)` into relative Vega flux. Visit error includes
sky/background error, MAGZPUNC, exposure scatter and a 10% floor. Visits must be
separated by >=10 days and differ by >=20% of their mean flux and >=5 errors.
This remains a candidate change: pixel masks/uncertainty products, deblending and
a calibrated variability model are absent. Limitations appear in each report.
[WISE calibration reference](https://irsa.ipac.caltech.edu/data/WISE/docs/release/NEOWISE/expsup/sec3_3.html).

## Retention and activation

`SPHEREX_POINT_EVIDENCE_DIR` defaults to `services/findings/.local-data/spectral`.
Deploy it on durable storage alongside the database; no automatic cleanup is
implemented. Original SPHEREx FITS and canonical JSON receive SHA-256 IDs and
are saved atomically before granting points. Public manifest/FITS routes verify
hashes and never refetch missing/corrupt evidence. WISE IDs use the existing
immutable WISE store. Saved findings retain their original review snapshots.

Recompute retained measurements from the repository root:

```powershell
services/catalogs/.venv/Scripts/python.exe scripts/reproduce-point-spectrum.py <evidence-id> --store <evidence-directory>
```

This checks source hashes and the recorded implementation, uses saved settings,
and compares numbers at rtol=1e-7/atol=1e-10 plus feature statuses. Exact saved
JSON/FITS replay remains independent of changed defaults. SPHEREx DR1 spectral
images: DOI 10.26131/IRSA678. QR3 inputs preserve their release/source links;
WISE attribution remains in the referenced blink manifests.

Apply `20261115160000_findings_spectral_points.sql` after preceding migrations
through the normal release process. Configure the existing Supabase/auth/archive
services and build with `VITE_LIVE_FINDINGS=1`. The default local demo now uses
the same real measurement pipeline without Supabase: `npm run dev` starts its
loopback-only scoring service, or run `npm run dev:scoring` alongside a standalone
viewer. Load a real WISE blink, then select **Check and score this point**. All
bonuses are measured; missing coverage and archive failures remain explicit.
Posts and rankings stay in this browser. No hosted migration,
public write or deployment was performed for this branch.

## Verification and future criteria

`docs/verification/spectral-points-live.json` records actual bounded checks at
the five versioned target coordinates (12 images per target, not a complete
spectrum). `scripts/verify-spectral-browser.mjs` checks the real browser with
synthetic intercepted APIs, separately from live archive checks. Physics and
contract tests cover positive/flat/missing spectra, bad pixels, detector/time
incompatibility, zero-point changes, variability, immutable replay, request/score
validation and duplicate/auth boundaries.

Suggested future criteria, not awarded here: repeat detection in independent
visits; motion consistent across >=3 epochs; cross-survey positional agreement
after epoch/motion correction; unusual W1–W2 color against a defined reference
population. Each needs uncertainty/quality controls and a fixed scoring cap.
