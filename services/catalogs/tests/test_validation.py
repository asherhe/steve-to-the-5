from __future__ import annotations

import math

import pytest

from app.errors import ApiError
from app.validation import (
    normalize_dec_input,
    normalize_ra_input,
    validate_dec,
    validate_ra,
    validate_radius_arcsec,
)


def test_ra_boundaries():
    assert validate_ra(0.0) == 0.0
    assert validate_ra(359.999) == 359.999
    with pytest.raises(ApiError):
        validate_ra(360.0)
    with pytest.raises(ApiError):
        validate_ra(-0.1)
    with pytest.raises(ApiError):
        validate_ra(math.nan)
    with pytest.raises(ApiError):
        validate_ra(math.inf)


def test_dec_boundaries():
    assert validate_dec(-90.0) == -90.0
    assert validate_dec(90.0) == 90.0
    with pytest.raises(ApiError):
        validate_dec(90.1)
    with pytest.raises(ApiError):
        validate_dec(math.nan)


def test_radius_bounds():
    assert validate_radius_arcsec(10.0, 300.0) == 10.0
    with pytest.raises(ApiError):
        validate_radius_arcsec(0.0, 300.0)
    with pytest.raises(ApiError):
        validate_radius_arcsec(-5.0, 300.0)
    with pytest.raises(ApiError):
        validate_radius_arcsec(301.0, 300.0)


def test_sexagesimal_ra():
    # WISE 0855 RA 08h55m10.831s = 133.795... deg
    deg = normalize_ra_input("08h55m10.831s")
    assert abs(deg - 133.7951) < 1e-3
    assert normalize_ra_input("269.45207") == 269.45207
    assert abs(normalize_ra_input("17:57:48.5") - 269.45) < 0.1


def test_sexagesimal_dec():
    deg = normalize_dec_input("-07d14m42.53s")
    assert abs(deg - (-7.24515)) < 1e-3
    assert normalize_dec_input("4.66829") == 4.66829
    assert abs(normalize_dec_input("+04:40:05.8") - 4.6683) < 0.01


def test_bad_sexagesimal_rejected():
    with pytest.raises(ApiError):
        normalize_ra_input("not a coordinate")
    with pytest.raises(ApiError):
        normalize_dec_input("99d99m99s")
