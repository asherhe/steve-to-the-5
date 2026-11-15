"""Server-side test of whether a marked point is bright in a saved dated frame.

Measured on each frame's retained FITS, in that file's own WCS (never on display PNGs):

- peak: the highest valid pixel within PEAK_RADIUS_PX of the point (allows for the point
  being placed a pixel off the source);
- background and noise: median and 1.4826 x MAD of valid pixels in an annulus between
  ANNULUS_PX[0] and ANNULUS_PX[1] around the point, widened to at least ANNULUS_MIN_ARCSEC;
- for SPHEREx, the noise is at least the pixel's own uncertainty, sqrt(VARIANCE);
- the point is "bright" when (peak - background) / noise >= BRIGHT_SNR.

SPHEREx cutouts carry IMAGE (MJy/sr), VARIANCE and FLAGS; pixels with flags outside the
frame's informational mask, non-finite values or non-positive variance are excluded. The
WISE service retains a combined median image (DN) without a variance or mask, so its noise
comes from the annulus alone. This is a local contrast test on one image, not a photometric
detection, a flux measurement or evidence of variability.
"""
from __future__ import annotations

import io
import math
from typing import Literal

import numpy as np

BRIGHT_SNR = 5.0
PEAK_RADIUS_PX = 1.5
ANNULUS_PX = (4.0, 10.0)
# The ring is also at least this wide on the sky, so fine-pixel surveys (DSS, WISE, NEOSSat)
# measure background outside a star's own wings rather than inside them.
ANNULUS_MIN_ARCSEC = (8.0, 25.0)
MIN_ANNULUS_PIXELS = 30

Status = Literal["measured", "outside", "unmeasurable"]


def informational_mask_from(flags_header) -> int:
    """SPHEREx flags that describe the scene, not a defect (as the archive service uses them)."""
    mask = 0
    for key in flags_header:
        if key.startswith("MSKN") and flags_header[key] in ("SOURCE", "FULLSAMPLE"):
            mask |= 1 << int(key[4:])
    return mask


def measure(fits_bytes: bytes, survey: str, ra: float, dec: float, informational_mask: int | None = None) -> dict:
    """Returns {status, snr, bright, peak, background, noise, unit} for one frame.

    SPHEREx files use their IMAGE/VARIANCE/FLAGS extensions; every other survey uses the
    first image HDU with a celestial WCS (DSS, WISE and NEOSSat cutouts are single images).
    """
    import warnings
    from astropy.io import fits
    from astropy.wcs import WCS, FITSFixedWarning

    with fits.open(io.BytesIO(fits_bytes), memmap=False) as hdus, warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        if survey == "spherex":
            if informational_mask is None:
                informational_mask = informational_mask_from(hdus["FLAGS"].header)
            image_hdu = hdus["IMAGE"]
            image = np.asarray(image_hdu.data, dtype=float)
            variance = np.asarray(hdus["VARIANCE"].data, dtype=float)
            flags = np.asarray(hdus["FLAGS"].data, dtype=np.int64)
            valid = np.isfinite(image) & np.isfinite(variance) & (variance > 0) & ((flags & ~np.int64(informational_mask)) == 0)
        else:
            image_hdu = next((h for h in hdus if getattr(h, "data", None) is not None
                              and getattr(h.data, "ndim", 0) == 2 and WCS(h.header).has_celestial), None)
            if image_hdu is None:
                return {"status": "unmeasurable", "snr": None, "bright": False, "peak": None,
                        "background": None, "noise": None, "unit": None}
            image = np.asarray(image_hdu.data, dtype=float)
            variance = None
            valid = np.isfinite(image)
        header = image_hdu.header
        unit = header.get("BUNIT")
        wcs = WCS(header).celestial

    result = {"status": "unmeasurable", "snr": None, "bright": False, "peak": None,
              "background": None, "noise": None, "unit": unit}
    if image.ndim != 2:
        return result
    x, y = (float(v) for v in wcs.world_to_pixel_values(ra, dec))
    height, width = image.shape
    if not (math.isfinite(x) and math.isfinite(y)) or not (-0.5 <= x < width - 0.5 and -0.5 <= y < height - 0.5):
        return {**result, "status": "outside"}

    from astropy.wcs.utils import proj_plane_pixel_scales
    scale_arcsec = float(np.mean(proj_plane_pixel_scales(wcs))) * 3600
    inner = max(ANNULUS_PX[0], ANNULUS_MIN_ARCSEC[0] / scale_arcsec)
    outer = max(ANNULUS_PX[1], ANNULUS_MIN_ARCSEC[1] / scale_arcsec)
    rows, cols = np.indices(image.shape)
    distance = np.hypot(cols - x, rows - y)
    core = valid & (distance <= PEAK_RADIUS_PX)
    ring = valid & (distance >= inner) & (distance <= outer)
    if not core.any() or ring.sum() < MIN_ANNULUS_PIXELS:
        return result
    values = image[ring]
    background = float(np.median(values))
    noise = 1.4826 * float(np.median(np.abs(values - background)))
    peak_index = np.unravel_index(np.argmax(np.where(core, image, -np.inf)), image.shape)
    peak = float(image[peak_index])
    if variance is not None:
        noise = max(noise, math.sqrt(float(variance[peak_index])))
    if not (math.isfinite(noise) and noise > 0):
        return result
    snr = (peak - background) / noise
    return {"status": "measured", "snr": round(snr, 2), "bright": snr >= BRIGHT_SNR,
            "peak": peak, "background": background, "noise": noise, "unit": unit}
