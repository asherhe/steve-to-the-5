"""Provisional, fixed-position spectral screening. Never a composition determination.

The windows are deliberately explicit policy, not a fitted atmosphere or a calibrated
classifier. A species earns once only when BOTH of its predeclared absorption regions
pass. No display pixels, catalog photometry, or different surveys are combined.
"""
from __future__ import annotations

import hashlib
import io
import math
import re
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
from astropy import units as u
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales

from .brightness import informational_mask_from
from .models import SpectralSample, SpectralReview, SpectralBandTest, SpectralFeature

CONFIG = {
    "apertureRadiusArcsec": 12.4, "backgroundAnnulusArcsec": [24.8, 49.6],
    "minBackgroundPixels": 30, "minBackgroundCoverage": 0.8,
    "maxWavelengthSpreadBandwidth": 0.25, "sourceSnr": 5.0,
    "featureSigma": 5.0, "minDepthFraction": 0.2, "systematicFraction": 0.1,
    "maxTimeSpanDays": 7.0, "independentSeparationBandwidth": 1.0,
    "background": "ZODI subtraction then local annulus median",
    "uncertainty": "pixel variance + annulus scatter + median background error; 10% floor in band tests",
    "flags": "Only documented SOURCE and FULLSAMPLE bits allowed; whole aperture must be valid",
    "units": "MJy/sr", "resampling": "none; native WCS fixed angular aperture",
    "apertureCorrection": "none; surface brightness screening, not total source flux",
    "speciesPoints": 5, "sourcePoints": 10,
}
# (feature region, blue continuum, red continuum); all units micrometres.
# Broad windows are screening choices. References establish line/band locations,
# not validation of this app's windows, thresholds or false-positive rate.
TEMPLATES = (
    ("water", "water (H₂O)", "https://www.ipac.caltech.edu/publication/1999ApJ...522L..65B", (
        ("1.4 µm water band", (1.35, 1.48), (1.26, 1.32), (1.50, 1.59)),
        ("1.9 µm water band", (1.80, 2.02), (1.68, 1.75), (2.08, 2.16)))),
    ("methane", "methane (CH₄)", "https://stsci-opo.org/STScI-01GW821M4YH9F2VXCTD2T52H8W.pdf", (
        ("2.2 µm methane band", (2.18, 2.30), (2.06, 2.14), (2.34, 2.40)),
        ("3.3 µm methane band", (3.20, 3.40), (3.05, 3.15), (3.50, 3.65)))),
    ("hydrogen", "hydrogen (H I)", "https://doi.org/10.1088/0004-6256/140/5/1214", (
        ("Paschen beta absorption", (1.263, 1.301), (1.20, 1.24), (1.32, 1.36)),
        ("Brackett gamma absorption", (2.136, 2.196), (2.03, 2.09), (2.25, 2.31)))),
)
LIMITATIONS = [
    "Tentative absorption-pattern matches are prompts for follow-up, not chemical identifications, abundances, temperatures or discoveries.",
    "This provisional screen has no calibrated false-positive rate. Blends, dust, continuum curvature, motion, variability and PSF changes can mimic absorption.",
    "Fixed-aperture surface brightness has no PSF fit, aperture correction or deblending. Different wavelengths may be observed on different dates; each band test is limited to seven days.",
    "WCS-WAVE is a quick-look wavelength approximation. Confirm candidates with calibrated spectrophotometry and spectral modelling; hydrogen lines can be unresolved at SPHEREx resolution.",
    "Only the declared water, methane and hydrogen absorption patterns are screened. Missing or unsupported patterns do not mean a substance is absent; emission is not tested.",
    "Bounded DR1/QR3 image sampling is not a complete spectrum or an exhaustive archive search.",
]


def implementation_hash():
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def measure(frame, ra, dec):
    result = SpectralSample(sourceSha256=hashlib.sha256(frame.fits).hexdigest(), sourceUrl=frame.source_url,
                            observedAtUtc=frame.observed_at_utc, observedUntilUtc=frame.observed_until_utc,
                            observationId=frame.observation_id, release=frame.release, status="rejected")
    try:
        with fits.open(io.BytesIO(frame.fits), memmap=False) as hdus, warnings.catch_warnings():
            warnings.simplefilter("ignore")
            header = hdus["IMAGE"].header
            result.observationId = str(header.get("OBSID", result.observationId or "")) or None
            result.detector = int(header["DETECTOR"])
            result.processingVersion = str(hdus[0].header["VERSION"])
            if result.detector not in range(1, 7) or not result.observedAtUtc or not result.observedUntilUtc:
                raise ValueError("Missing detector or original observation interval")
            if datetime.fromisoformat(result.observedUntilUtc) < datetime.fromisoformat(result.observedAtUtc):
                raise ValueError("Invalid observation interval")
            factor = u.Unit(header["BUNIT"]).to(u.MJy / u.sr)
            image = np.asarray(hdus["IMAGE"].data, dtype=float) * factor
            variance = np.asarray(hdus["VARIANCE"].data, dtype=float) * factor**2
            zodi = np.asarray(hdus["ZODI"].data, dtype=float) * u.Unit(hdus["ZODI"].header.get("BUNIT", header["BUNIT"])).to(u.MJy / u.sr)
            flags = np.asarray(hdus["FLAGS"].data, dtype=np.int64)
            if image.ndim != 2 or image.size > 2040**2 or any(a.shape != image.shape for a in (variance, zodi, flags)):
                raise ValueError("Invalid image dimensions")
            image = image - zodi
            good = np.isfinite(image) & np.isfinite(variance) & (variance > 0) & ((flags & ~np.int64(informational_mask_from(hdus["FLAGS"].header))) == 0)
            wcs = WCS(header).celestial
            x, y = map(float, wcs.world_to_pixel_values(ra, dec))
            scale = float(np.max(proj_plane_pixel_scales(wcs))) * 3600
            if not all(math.isfinite(v) for v in (x, y, scale)) or scale <= 0:
                raise ValueError("Invalid position or pixel scale")
            # Require complete geometric coverage through the background outer edge.
            pad = CONFIG["backgroundAnnulusArcsec"][1] / scale + 1
            if min(x, y, image.shape[1] - 1 - x, image.shape[0] - 1 - y) < pad:
                raise ValueError("Incomplete aperture/background coverage")
            yy, xx = np.indices(image.shape)
            sky = wcs.pixel_to_world(xx, yy)
            from astropy.coordinates import SkyCoord
            distance = sky.separation(SkyCoord(ra, dec, unit="deg")).arcsec
            core = distance <= CONFIG["apertureRadiusArcsec"]
            ring = (distance >= CONFIG["backgroundAnnulusArcsec"][0]) & (distance <= CONFIG["backgroundAnnulusArcsec"][1])
            if core.sum() < 4 or not good[core].all() or (good & ring).sum() < CONFIG["minBackgroundPixels"] or good[ring].mean() < CONFIG["minBackgroundCoverage"]:
                raise ValueError("Flags or missing pixels in aperture/background")
            spectral_header = header.copy()
            for key in list(spectral_header):
                if key in ("A_ORDER", "B_ORDER", "AP_ORDER", "BP_ORDER") or re.fullmatch(r"(?:A|B|AP|BP)_\d+_\d+", key):
                    del spectral_header[key]
            spectral_wcs = WCS(spectral_header, fobj=hdus, key="W")
            spectral_wcs.sip = None
            wave, band = spectral_wcs.pixel_to_world(xx[core], yy[core])
            wave, band = wave.to_value(u.um), band.to_value(u.um)
            if not np.isfinite(wave).all() or not np.isfinite(band).all() or np.min(band) <= 0 or np.ptp(wave) > CONFIG["maxWavelengthSpreadBandwidth"] * np.min(band):
                raise ValueError("Incompatible wavelength response across aperture")
            background = image[ring & good]
            median = float(np.median(background))
            scatter = 1.4826 * float(np.median(np.abs(background - median)))
            n = int(core.sum())
            signal = float(np.mean(image[core]) - median)
            noise = math.sqrt(max(float(np.sum(variance[core])) / n**2, scatter**2 / n)
                              + math.pi / 2 * max(scatter**2, float(np.median(variance[ring & good]))) / len(background))
            if not all(math.isfinite(v) for v in (signal, noise)) or noise <= 0:
                raise ValueError("Invalid brightness uncertainty")
            result.status = "measured"
            result.wavelengthUm, result.bandwidthUm = float(np.mean(wave)), float(np.mean(band))
            result.brightnessMjySr, result.uncertaintyMjySr, result.snr = signal, noise, signal / noise
    except Exception as error:
        result.reason = str(error) if isinstance(error, ValueError) else f"Unusable spectral FITS ({type(error).__name__})"
    return result


def independent(samples):
    selected = []
    for sample in sorted(samples, key=lambda s: (s.wavelengthUm, s.sourceSha256)):
        if all(abs(sample.wavelengthUm - other.wavelengthUm) >= max(sample.bandwidthUm, other.bandwidthUm) * CONFIG["independentSeparationBandwidth"] for other in selected):
            selected.append(sample)
    return selected


def time_value(sample, end=False):
    return datetime.fromisoformat(sample.observedUntilUtc if end else sample.observedAtUtc).timestamp()


def test_band(samples, definition):
    name, region, blue, red = definition
    result = SpectralBandTest(name=name, status="insufficient", message="Need a feature sample and independent continuum samples on both sides, on one detector within seven days.", sampleHashes=[], startUm=region[0], endUm=region[1])
    # Use whole approximate passbands, not just centres, to avoid assigning one
    # broadband measurement to multiple regions or treating a blended edge as a line.
    def within(s, bounds):
        return bounds[0] <= s.wavelengthUm - s.bandwidthUm / 2 and s.wavelengthUm + s.bandwidthUm / 2 <= bounds[1]
    candidates = sorted((s for s in samples if within(s, region)), key=lambda s: (time_value(s), s.sourceSha256), reverse=True)
    tested = []
    for center in candidates:
        near = [s for s in samples if s.detector == center.detector and s.release == center.release and s.processingVersion == center.processingVersion
                and abs(time_value(s) - time_value(center)) <= CONFIG["maxTimeSpanDays"] * 86400]
        left = sorted((s for s in near if within(s, blue)), key=lambda s: (abs(time_value(s) - time_value(center)), s.sourceSha256))
        right = sorted((s for s in near if within(s, red)), key=lambda s: (abs(time_value(s) - time_value(center)), s.sourceSha256))
        if not left or not right:
            continue
        trio = [left[0], center, right[0]]
        if max(time_value(s, True) for s in trio) - min(time_value(s) for s in trio) > CONFIG["maxTimeSpanDays"] * 86400:
            continue
        a, b = left[0], right[0]
        if a.snr < CONFIG["sourceSnr"] or b.snr < CONFIG["sourceSnr"]:
            continue
        t = (center.wavelengthUm - a.wavelengthUm) / (b.wavelengthUm - a.wavelengthUm)
        continuum = (1 - t) * a.brightnessMjySr + t * b.brightnessMjySr
        def variance(s):
            return s.uncertaintyMjySr**2 + (CONFIG["systematicFraction"] * abs(s.brightnessMjySr))**2
        noise = math.sqrt(variance(center) + (1 - t)**2 * variance(a) + t**2 * variance(b))
        depth = (continuum - center.brightnessMjySr) / continuum
        significance = (continuum - center.brightnessMjySr) / noise
        tested.append((depth, significance, trio))
    if not tested:
        return result
    # Do not choose the most flattering epoch. All usable samples in this window
    # must pass; an inconsistent observation prevents a pattern bonus.
    depth, significance, _ = min(tested, key=lambda item: item[1])
    result.depthFraction, result.significance = depth, significance
    result.sampleHashes = sorted({s.sourceSha256 for _, _, trio in tested for s in trio})
    supported = all(d >= CONFIG["minDepthFraction"] and sig >= CONFIG["featureSigma"] for d, sig, _ in tested)
    result.status = "supported" if supported else "not_supported"
    result.message = "Absorption window passes the provisional screen." if supported else "Usable measurements do not consistently pass the absorption screen."
    return result


def analyze(source, ra, dec):
    if source is None or source.status != "ok":
        return SpectralReview(status="no_coverage" if source and source.status == "no_coverage" else "unavailable",
                              message=source.message or "SPHEREx cutouts unavailable." if source else "SPHEREx cutouts unavailable.", config=CONFIG, limitations=LIMITATIONS)
    samples = [measure(frame, ra, dec) for frame in source.frames]
    usable = [s for s in samples if s.status == "measured"]
    detected = any(s.snr >= CONFIG["sourceSnr"] for s in usable)
    features = []
    for key, label, url, definitions in TEMPLATES:
        bands = [test_band(usable, d) for d in definitions]
        status = "supported" if all(b.status == "supported" for b in bands) else "not_supported" if any(b.status == "not_supported" for b in bands) else "insufficient"
        features.append(SpectralFeature(key=key, label=label, sourceUrl=url, status=status, points=5 if detected and status == "supported" else 0, bands=bands))
    return SpectralReview(status="measured" if detected else "insufficient", message=source.message or "Bounded SPHEREx spectral image sample measured at the selected position.",
                          config={**CONFIG, "templates": TEMPLATES, "selection": source.discovery, "implementationSha256": implementation_hash(),
                                  "runtime": {"numpy": np.__version__, "astropy": __import__("astropy").__version__}}, sourceDetected=detected,
                          independentChannels=len(independent(usable)), samples=samples, features=features, limitations=LIMITATIONS)
