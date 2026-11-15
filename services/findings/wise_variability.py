"""Bounded first/last-visit aperture screen on original WISE blink exposures.

Uses MAGZP, never combined native-DN display brightness. This is a follow-up
candidate flag, not a calibrated variability detection or a light-curve model.
"""
import asyncio
import hashlib
import io
import math
from datetime import datetime
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
from astropy.wcs.utils import proj_plane_pixel_scales

from .models import WiseVariability, WiseEpoch
from .review import REAL_EVIDENCE, evidence_position, valid_frames
from .supabase import ApiError

CONFIG = {"version": "wise-aperture-v1", "apertureRadiusArcsec": 8.25,
          "annulusArcsec": [22, 38.5], "minExposuresPerVisit": 2, "maxExposuresPerVisit": 12,
          "minVisitSeparationDays": 10, "sourceSnr": 5, "minFractionalChange": 0.2,
          "minChangeSigma": 5, "systematicFraction": 0.1, "maxWithinVisitScatterFraction": 0.2,
          "maxCentroidOffsetArcsec": 2.75, "pair": "first and last dated visits",
          "fluxUnit": "fraction of Vega zero-magnitude flux (no aperture correction)",
          "calibration": "sum(background-subtracted native DN) * 10**(-0.4 * MAGZP)",
          "uncertainty": "annulus MAD and background error, MAGZPUNC, visit scatter, 10% systematic floor"}
LIMITATIONS = ["Possible brightness change is a provisional aperture screen, not confirmed intrinsic variability.",
               "No pixel uncertainty/mask products or PSF/deblending fit are available in this blink. Artifacts, blends, motion and changing PSFs can mimic variability.",
               "Requires aligned visits, two exposures per visit, consistent centroids and calibrated zero points. Bright/saturation-risk sources and noisy visits receive no variability bonus.",
               "Only first/last visits are compared; this is not a complete light curve. See retained original WISE exposures and their observation intervals."]


def validate_blink(comparison, point):
    if comparison.get("provenance", {}).get("evidenceKind") not in REAL_EVIDENCE or not str(comparison.get("provenance", {}).get("survey", "")).startswith("WISE"):
        raise ApiError(422, "invalid_wise_blink", "Load a real WISE blink before scoring.")
    evidence_position(comparison, point)
    frames = sorted(valid_frames(comparison), key=lambda f: f.get("observedAtUtc", ""))
    try:
        times = [datetime.fromisoformat(f["observedAtUtc"]) for f in frames]
        if len(frames) < 2 or times[-1] <= times[0]:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise ApiError(422, "invalid_wise_blink", "The WISE blink needs two distinct dated visits.")
    return [frames[0], frames[-1]]


def measure_exposure(raw, ra, dec, band):
    with fits.open(io.BytesIO(raw), memmap=False) as hdus:
        hdu = next(h for h in hdus if getattr(h, "data", None) is not None and getattr(h.data, "ndim", 0) == 2)
        header = hdu.header
        if str(header.get("BUNIT", "")).upper() != "DN" or int(header["BAND"]) != band:
            raise ValueError("Unknown WISE units or incompatible band")
        zp, zperr = float(header["MAGZP"]), float(header["MAGZPUNC"])
        if not (math.isfinite(zp) and 0 < zp < 40 and math.isfinite(zperr) and 0 <= zperr <= 0.1):
            raise ValueError("Missing/invalid zero point or uncertainty")
        data = np.asarray(hdu.data, dtype=float)
        wcs = WCS(header).celestial
        x, y = map(float, wcs.world_to_pixel_values(ra, dec))
        scale = float(np.max(proj_plane_pixel_scales(wcs))) * 3600
        if not all(math.isfinite(v) for v in (x, y, scale)) or scale <= 0:
            raise ValueError("Invalid WISE WCS")
        pad = CONFIG["annulusArcsec"][1] / scale + 1
        if min(x, y, data.shape[1] - x - 1, data.shape[0] - y - 1) < pad:
            raise ValueError("Point/background outside WISE exposure")
        yy, xx = np.indices(data.shape)
        distance = wcs.pixel_to_world(xx, yy).separation(SkyCoord(ra, dec, unit="deg")).arcsec
        core = distance <= CONFIG["apertureRadiusArcsec"]
        ring = (distance >= CONFIG["annulusArcsec"][0]) & (distance <= CONFIG["annulusArcsec"][1])
        if not np.isfinite(data[core | ring]).all() or ring.sum() < 30 or core.sum() < 4:
            raise ValueError("Invalid WISE pixels")
        bg = float(np.median(data[ring]))
        rms = 1.4826 * float(np.median(np.abs(data[ring] - bg)))
        flux = float(np.sum(data[core] - bg))
        noise = rms * math.sqrt(core.sum() + math.pi / 2 * core.sum()**2 / ring.sum())
        if rms <= 0 or flux <= 0 or flux / noise < CONFIG["sourceSnr"]:
            raise ValueError("WISE source too faint for variability screen")
        # Conservative one-magnitude buffer beyond nominal W1=8/W2=7 saturation onset.
        magnitude = zp - 2.5 * math.log10(flux)
        if magnitude < (9 if band == 1 else 8):
            raise ValueError("Source may be affected by WISE saturation")
        weights = np.where(core, np.maximum(data - bg, 0), 0)
        cx, cy = float((weights * xx).sum() / weights.sum()), float((weights * yy).sum() / weights.sum())
        if wcs.pixel_to_world(cx, cy).separation(SkyCoord(ra, dec, unit="deg")).arcsec > CONFIG["maxCentroidOffsetArcsec"]:
            raise ValueError("WISE centroid moved away from the selected point")
        factor = 10**(-0.4 * zp)
        return flux * factor, math.hypot(noise * factor, flux * factor * math.log(10) * 0.4 * zperr), zp, zperr


async def analyze(comparison, point, asset_loader):
    frames = validate_blink(comparison, point)
    result = WiseVariability(comparisonId=comparison["id"], status="insufficient", message="WISE measurements do not meet the variability requirements.",
                             config={**CONFIG, "implementationSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, limitations=LIMITATIONS)
    if asset_loader is None:
        result.status, result.message = "unavailable", "Retained WISE exposures are unavailable."
        return result
    try:
        inputs = comparison["provenance"]["inputs"]
        band = {"W1": 1, "W2": 2}[comparison["config"]["band"]]
        if frames[0].get("alignment") not in ("reference_frame", "verified") or frames[1].get("alignment") != "verified":
            raise ValueError("WISE image alignment is not empirically verified for both visits.")
        for frame in frames:
            group = next(g for g in inputs if g["frameSourceSha256"] == frame["sourceSha256"])
            originals = group["exposures"]
            if not CONFIG["minExposuresPerVisit"] <= len(originals) <= CONFIG["maxExposuresPerVisit"]:
                raise ValueError("At least two retained exposures are required in each WISE visit.")
            measurements, seen = [], set()
            for original in originals:
                sha, exposure = original["sourceSha256"], original["exposure"]
                if sha in seen or exposure["band"] != band or (exposure.get("qualFrame") or 0) < 5:
                    raise ValueError("Duplicate, mixed-band or low-quality WISE exposures")
                seen.add(sha)
                raw = await asset_loader("wise", comparison["id"], f"{sha}.fits")
                if hashlib.sha256(raw).hexdigest() != sha:
                    raise ValueError("WISE exposure failed its content hash check")
                flux, noise, zp, zperr = await asyncio.to_thread(measure_exposure, raw, point.ra, point.dec, band)
                measurements.append({"relativeFlux": flux, "uncertainty": noise, "magzp": zp, "magzpUncertainty": zperr,
                                     "sourceSha256": sha, "sourceUrl": exposure["sourceUrl"], "observedAtUtc": original["observedAtUtc"],
                                     "assetUrl": f"/api/wise/comparisons/{comparison['id']}/assets/{sha}.fits"})
            fluxes = [m["relativeFlux"] for m in measurements]
            mean = float(np.mean(fluxes))
            scatter = float(np.std(fluxes, ddof=1))
            if scatter / mean > CONFIG["maxWithinVisitScatterFraction"]:
                raise ValueError("WISE exposures disagree within a visit; no variability points.")
            uncertainty = math.sqrt(sum(m["uncertainty"]**2 for m in measurements) / len(measurements)**2
                                    + scatter**2 / len(measurements) + (CONFIG["systematicFraction"] * mean)**2)
            times = sorted(m["observedAtUtc"] for m in measurements)
            result.epochs.append(WiseEpoch(frameId=frame["id"], observedStartUtc=times[0], observedEndUtc=times[-1],
                                           relativeFlux=mean, uncertainty=uncertainty, exposures=measurements))
        first, last = result.epochs
        if (datetime.fromisoformat(last.observedStartUtc) - datetime.fromisoformat(first.observedEndUtc)).total_seconds() < CONFIG["minVisitSeparationDays"] * 86400:
            raise ValueError("WISE visits are not separated by at least ten days.")
        delta = abs(last.relativeFlux - first.relativeFlux)
        result.fractionalChange = delta / ((last.relativeFlux + first.relativeFlux) / 2)
        result.significance = delta / math.hypot(first.uncertainty, last.uncertainty)
        candidate = result.fractionalChange >= CONFIG["minFractionalChange"] and result.significance >= CONFIG["minChangeSigma"]
        result.status = "candidate" if candidate else "stable"
        result.message = "Possible variable brightness: first/last WISE visits pass the provisional change screen." if candidate else "No qualifying brightness change between the first and last WISE visits."
    except ApiError:
        result.status, result.message = "unavailable", "A retained WISE exposure could not be loaded."
    except (ValueError, KeyError, TypeError, StopIteration) as error:
        result.message = str(error) if isinstance(error, ValueError) else "WISE calibration or provenance is incomplete."
    return result
