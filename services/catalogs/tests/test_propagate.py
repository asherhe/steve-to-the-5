from __future__ import annotations

import math

from app.astrometry.propagate import iso_to_decimal_year, propagate

# Shared test vector also used by the frontend propagate.test.ts.
# A source at (10, 20) deg, epoch 2016.0, pmRaCosDec = 3600 mas/yr, pmDec = -3600 mas/yr,
# propagated 10 years to 2026.0.
#   dRa  = (3600 / cos(20deg)) * 10 / 3.6e6 deg = (3600/0.93969) * 10 / 3.6e6
#   dDec = -3600 * 10 / 3.6e6 = -0.01 deg
VEC = {
    "ra": 10.0,
    "dec": 20.0,
    "refEpoch": 2016.0,
    "toEpoch": 2026.0,
    "pmRaCosDec": 3600.0,
    "pmDec": -3600.0,
}


def test_known_vector():
    p = propagate(
        VEC["ra"],
        VEC["dec"],
        VEC["refEpoch"],
        VEC["toEpoch"],
        VEC["pmRaCosDec"],
        VEC["pmDec"],
    )
    expected_dra = (3600.0 / math.cos(math.radians(20.0))) * 10.0 / 3.6e6
    assert abs(p.ra - (10.0 + expected_dra)) < 1e-9
    assert abs(p.dec - 19.99) < 1e-9
    assert p.predicted is True
    assert p.from_epoch == 2016.0 and p.to_epoch == 2026.0


def test_zero_proper_motion_is_identity():
    p = propagate(42.0, -13.0, 2016.0, 2025.5, None, None)
    assert p.ra == 42.0
    assert p.dec == -13.0


def test_direction_sign():
    # Positive pmDec moves north.
    p = propagate(0.0, 0.0, 2016.0, 2017.0, 0.0, 3.6e6)
    assert p.dec > 0.0


def test_iso_to_decimal_year():
    assert abs(iso_to_decimal_year("2016-01-01T00:00:00Z") - 2016.0) < 1e-6
    mid = iso_to_decimal_year("2025-07-02T12:00:00Z")
    assert 2025.4 < mid < 2025.6
