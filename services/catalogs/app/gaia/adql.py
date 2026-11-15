"""ADQL query builders for Gaia DR3 (live path).

Numeric parameters are validated and formatted by this module (no string interpolation of
untrusted free text): callers pass already-validated finite floats and an integer source id.
A bounded TOP is always applied.
"""
from __future__ import annotations

GAIA_SOURCE_TABLE = "gaiadr3.gaia_source"

# Columns requested for a cone search (lean: just what /nearby returns + ordering).
_NEARBY_COLUMNS = (
    "source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, phot_g_mean_mag"
)

# Full column set for a single-source detail lookup.
_DETAIL_COLUMNS = (
    "source_id, ra, dec, ref_epoch, pmra, pmdec, parallax, phot_g_mean_mag, "
    "ra_error, dec_error, pmra_error, pmdec_error, parallax_error, "
    "radial_velocity, radial_velocity_error, phot_bp_mean_mag, phot_rp_mean_mag"
)


# Columns a response must carry before it is trusted, including an empty one.
NEARBY_COLUMN_NAMES = tuple(name.strip() for name in _NEARBY_COLUMNS.split(",")) + ("sep_deg",)
DETAIL_COLUMN_NAMES = tuple(name.strip() for name in _DETAIL_COLUMNS.split(","))


def nearby_query(ra: float, dec: float, radius_deg: float, top: int) -> str:
    return (
        f"SELECT TOP {int(top)} {_NEARBY_COLUMNS}, "
        f"DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', {ra!r}, {dec!r})) AS sep_deg "
        f"FROM {GAIA_SOURCE_TABLE} "
        f"WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), "
        f"CIRCLE('ICRS', {ra!r}, {dec!r}, {radius_deg!r})) "
        f"ORDER BY sep_deg ASC"
    )


def detail_query(source_id: int) -> str:
    return (
        f"SELECT TOP 1 {_DETAIL_COLUMNS} "
        f"FROM {GAIA_SOURCE_TABLE} "
        f"WHERE source_id = {int(source_id)}"
    )
