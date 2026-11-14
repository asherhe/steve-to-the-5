"""Input validation and sexagesimal coordinate normalization.

Rules (from the contract): finite coordinates, dec in [-90, 90], ra in [0, 360),
positive bounded search sizes. Sexagesimal RA/Dec strings are normalized to decimal degrees.
"""
from __future__ import annotations

import math
import re

from app.errors import invalid_request


def validate_ra(ra: float) -> float:
    if not math.isfinite(ra):
        raise invalid_request("ra must be a finite number.")
    if not (0.0 <= ra < 360.0):
        raise invalid_request("ra must be in [0, 360) decimal degrees.")
    return ra


def validate_dec(dec: float) -> float:
    if not math.isfinite(dec):
        raise invalid_request("dec must be a finite number.")
    if not (-90.0 <= dec <= 90.0):
        raise invalid_request("dec must be in [-90, 90] decimal degrees.")
    return dec


def validate_radius_arcsec(radius: float, max_radius_arcsec: float) -> float:
    if not math.isfinite(radius):
        raise invalid_request("radiusArcsec must be a finite number.")
    if radius <= 0.0:
        raise invalid_request("radiusArcsec must be positive.")
    if radius > max_radius_arcsec:
        raise invalid_request(
            f"radiusArcsec must be <= {max_radius_arcsec:g} (search size bound)."
        )
    return radius


def validate_source_id(source_id: str) -> str:
    sid = (source_id or "").strip()
    if not sid:
        raise invalid_request("sourceId must be a non-empty string.")
    return sid


_HMS_RE = re.compile(
    r"^\s*(\d{1,2})[h:\s]+(\d{1,2})[m:\s]+([\d.]+)s?\s*$", re.IGNORECASE
)
_DMS_RE = re.compile(
    r"^\s*([+-]?)(\d{1,3})[d:\s]+(\d{1,2})[m':\s]+([\d.]+)[\"s]?\s*$", re.IGNORECASE
)


def _parse_hms_to_deg(text: str) -> float | None:
    m = _HMS_RE.match(text)
    if not m:
        return None
    h, mm, ss = int(m.group(1)), int(m.group(2)), float(m.group(3))
    if not (0 <= h < 24 and 0 <= mm < 60 and 0 <= ss < 60):
        return None
    return (h + mm / 60.0 + ss / 3600.0) * 15.0


def _parse_dms_to_deg(text: str) -> float | None:
    m = _DMS_RE.match(text)
    if not m:
        return None
    sign = -1.0 if m.group(1) == "-" else 1.0
    d, mm, ss = int(m.group(2)), int(m.group(3)), float(m.group(4))
    if not (0 <= d <= 90 and 0 <= mm < 60 and 0 <= ss < 60):
        return None
    return sign * (d + mm / 60.0 + ss / 3600.0)


def normalize_ra_input(value: str | float) -> float:
    """Accept decimal degrees or sexagesimal HMS and return finite RA degrees in [0, 360)."""
    if isinstance(value, (int, float)):
        return validate_ra(float(value))
    text = str(value).strip()
    try:
        return validate_ra(float(text))
    except (ValueError, TypeError):
        pass
    deg = _parse_hms_to_deg(text)
    if deg is None:
        raise invalid_request(f"Could not parse RA value: {value!r}.")
    return validate_ra(deg % 360.0)


def normalize_dec_input(value: str | float) -> float:
    """Accept decimal degrees or sexagesimal DMS and return finite Dec degrees in [-90, 90]."""
    if isinstance(value, (int, float)):
        return validate_dec(float(value))
    text = str(value).strip()
    try:
        return validate_dec(float(text))
    except (ValueError, TypeError):
        pass
    deg = _parse_dms_to_deg(text)
    if deg is None:
        raise invalid_request(f"Could not parse Dec value: {value!r}.")
    return validate_dec(deg)
