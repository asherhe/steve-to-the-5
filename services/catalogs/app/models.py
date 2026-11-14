"""Response models for the catalog service.

Serialized JSON is camelCase (contract). Angular units are degrees, proper motion is
mas/yr, parallax is mas, photometry is mag, radial velocity is km/s, separations are arcsec,
all carried in field names. Nullable measurements serialize as null.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class ResolveResult(CamelModel):
    name: str
    ra: float
    dec: float


class NearbySource(CamelModel):
    source_id: str
    ra: float
    dec: float
    ref_epoch: float
    pm_ra_cos_dec_mas_yr: float | None = None
    pm_dec_mas_yr: float | None = None
    parallax_mas: float | None = None
    g_mag: float | None = None
    separation_arcsec: float


class NearbyResponse(CamelModel):
    sources: list[NearbySource]


class SourceProvenance(CamelModel):
    catalog: str
    data_release: str
    source_table_url: str | None = None
    source_detail_url: str | None = None


class GaiaDetail(CamelModel):
    source_id: str
    ra: float
    dec: float
    ref_epoch: float
    pm_ra_cos_dec_mas_yr: float | None = None
    pm_dec_mas_yr: float | None = None
    parallax_mas: float | None = None
    g_mag: float | None = None
    # Uncertainties (optional).
    ra_error_mas: float | None = None
    dec_error_mas: float | None = None
    pm_ra_cos_dec_error_mas_yr: float | None = None
    pm_dec_error_mas_yr: float | None = None
    parallax_error_mas: float | None = None
    # Radial velocity (optional).
    radial_velocity_km_s: float | None = None
    radial_velocity_error_km_s: float | None = None
    # BP / RP photometry (optional).
    bp_mag: float | None = None
    rp_mag: float | None = None
    # Provenance.
    provenance: SourceProvenance


class ErrorBody(CamelModel):
    code: str
    message: str
