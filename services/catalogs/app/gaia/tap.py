"""Live Gaia DR3 provider via the ESA Gaia TAP service (astroquery).

Opt-in (CATALOGS_LIVE=1). Imports astroquery lazily so the default offline install does not
require it. Network/timeout/server failures raise UpstreamError; a cone search that returns
zero rows is a valid empty result, not an error.

Unit mapping to the response contract:
- ra, dec            : degrees
- ref_epoch          : Julian year (Gaia DR3 = 2016.0)
- pmra               : mas/yr, already includes cos(dec) in Gaia -> pmRaCosDecMasYr
- pmdec              : mas/yr -> pmDecMasYr
- parallax           : mas -> parallaxMas
- phot_g_mean_mag    : mag -> gMag
- *_error            : same units as the measured quantity
- radial_velocity    : km/s
"""
from __future__ import annotations

import math

from app.gaia.adql import detail_query, nearby_query
from app.gaia.provider import SourceNotFound, UpstreamError
from app.models import GaiaDetail, NearbySource, SourceProvenance

_GAIA_SOURCE_URL = "https://gea.esac.esa.int/archive/"
_DATA_RELEASE = "Gaia DR3"
_CATALOG = "gaiadr3.gaia_source"


def _f(value) -> float | None:
    """Coerce a possibly-masked/NaN table cell to a finite float or None."""
    try:
        if value is None:
            return None
        v = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


class TapGaiaProvider:
    def __init__(self, timeout_s: float = 20.0, max_rows: int = 200) -> None:
        self._timeout_s = timeout_s
        self._max_rows = max_rows

    def _gaia(self):
        try:
            from astroquery.gaia import Gaia
        except Exception as exc:  # pragma: no cover - import guard
            raise UpstreamError(
                "astroquery is not installed; live Gaia access is unavailable."
            ) from exc
        Gaia.ROW_LIMIT = self._max_rows
        return Gaia

    def _run(self, adql: str):
        Gaia = self._gaia()
        try:
            job = Gaia.launch_job(adql)
            return job.get_results()
        except Exception as exc:
            raise UpstreamError(f"Gaia TAP query failed: {exc}") from exc

    def nearby(
        self, ra: float, dec: float, radius_arcsec: float, max_rows: int
    ) -> list[NearbySource]:
        radius_deg = radius_arcsec / 3600.0
        table = self._run(nearby_query(ra, dec, radius_deg, max_rows))
        sources: list[NearbySource] = []
        for row in table:
            sep_deg = _f(row["sep_deg"]) or 0.0
            sources.append(
                NearbySource(
                    source_id=str(row["source_id"]),
                    ra=float(row["ra"]),
                    dec=float(row["dec"]),
                    ref_epoch=float(row["ref_epoch"]),
                    pm_ra_cos_dec_mas_yr=_f(row["pmra"]),
                    pm_dec_mas_yr=_f(row["pmdec"]),
                    parallax_mas=_f(row["parallax"]),
                    g_mag=_f(row["phot_g_mean_mag"]),
                    separation_arcsec=sep_deg * 3600.0,
                )
            )
        return sources

    def detail(self, source_id: str) -> GaiaDetail:
        try:
            sid_int = int(source_id)
        except ValueError as exc:
            raise SourceNotFound(f"Not a Gaia source id: {source_id!r}.") from exc
        table = self._run(detail_query(sid_int))
        if len(table) == 0:
            raise SourceNotFound(f"No Gaia source with id {source_id!r}.")
        row = table[0]
        return GaiaDetail(
            source_id=str(row["source_id"]),
            ra=float(row["ra"]),
            dec=float(row["dec"]),
            ref_epoch=float(row["ref_epoch"]),
            pm_ra_cos_dec_mas_yr=_f(row["pmra"]),
            pm_dec_mas_yr=_f(row["pmdec"]),
            parallax_mas=_f(row["parallax"]),
            g_mag=_f(row["phot_g_mean_mag"]),
            ra_error_mas=_f(row["ra_error"]),
            dec_error_mas=_f(row["dec_error"]),
            pm_ra_cos_dec_error_mas_yr=_f(row["pmra_error"]),
            pm_dec_error_mas_yr=_f(row["pmdec_error"]),
            parallax_error_mas=_f(row["parallax_error"]),
            radial_velocity_km_s=_f(row["radial_velocity"]),
            radial_velocity_error_km_s=_f(row["radial_velocity_error"]),
            bp_mag=_f(row["phot_bp_mean_mag"]),
            rp_mag=_f(row["phot_rp_mean_mag"]),
            provenance=SourceProvenance(
                catalog=_CATALOG,
                data_release=_DATA_RELEASE,
                source_table_url=_GAIA_SOURCE_URL,
                source_detail_url=f"{_GAIA_SOURCE_URL}?source_id={sid_int}",
            ),
        )
