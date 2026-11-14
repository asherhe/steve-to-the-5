"""Proper-motion propagation of a catalog position to an observation epoch.

Gaia DR3 astrometry is referenced to epoch 2016.0. To overlay a catalog source on a dated
SPHEREx frame, propagate (ra, dec) by proper motion to the frame's decimal-year epoch.

The result is a PREDICTED position and must be labelled as such by callers; it never
replaces the observed catalog position. Parallax and radial-velocity perspective terms are
omitted for this MVP marker (documented limitation): over a few years at these distances
the omission is small relative to SPHEREx pixel scale, but it is not zero.

pmRaCosDec is the proper motion in the RA direction already multiplied by cos(dec)
(Gaia convention), so the RA increment divides by cos(dec) once.
"""
from __future__ import annotations

import datetime as _dt
import math
from dataclasses import dataclass

_MAS_PER_DEG = 3_600_000.0


@dataclass(frozen=True)
class PredictedPosition:
    ra: float
    dec: float
    from_epoch: float
    to_epoch: float
    predicted: bool = True


def iso_to_decimal_year(iso_utc: str) -> float:
    """Convert a UTC ISO-8601 timestamp to a decimal year (e.g. 2025.37)."""
    text = iso_utc.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = _dt.datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    dt = dt.astimezone(_dt.timezone.utc)
    year_start = _dt.datetime(dt.year, 1, 1, tzinfo=_dt.timezone.utc)
    year_end = _dt.datetime(dt.year + 1, 1, 1, tzinfo=_dt.timezone.utc)
    frac = (dt - year_start).total_seconds() / (year_end - year_start).total_seconds()
    return dt.year + frac


def propagate(
    ra_deg: float,
    dec_deg: float,
    ref_epoch: float,
    to_epoch: float,
    pm_ra_cos_dec_mas_yr: float | None,
    pm_dec_mas_yr: float | None,
) -> PredictedPosition:
    """Propagate a position from ref_epoch to to_epoch using proper motion.

    Missing proper-motion components are treated as zero (no motion in that axis).
    """
    dt_yr = to_epoch - ref_epoch
    pm_ra = pm_ra_cos_dec_mas_yr or 0.0
    pm_dec = pm_dec_mas_yr or 0.0

    cos_dec = math.cos(math.radians(dec_deg))
    if abs(cos_dec) < 1e-12:
        # Near the pole the RA increment is undefined; keep RA fixed.
        d_ra_deg = 0.0
    else:
        d_ra_deg = (pm_ra / cos_dec) * dt_yr / _MAS_PER_DEG
    d_dec_deg = pm_dec * dt_yr / _MAS_PER_DEG

    ra = (ra_deg + d_ra_deg) % 360.0
    dec = max(-90.0, min(90.0, dec_deg + d_dec_deg))
    return PredictedPosition(
        ra=ra, dec=dec, from_epoch=ref_epoch, to_epoch=to_epoch, predicted=True
    )
