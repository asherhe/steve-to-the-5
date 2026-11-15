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


class NameProvenance(CamelModel):
    source: str
    url: str
    retrieved_at_utc: str
    kind: str
    # The server that answered a live lookup (for example a SIMBAD mirror), when known.
    served_by: str | None = None


class CatalogReference(CamelModel):
    catalog: str
    data_release: str | None = None
    id: str


class ObjectIdentity(CamelModel):
    object_id: str
    common_name: str | None
    canonical_designation: str
    display_name: str
    aliases: list[str]
    component: str
    related_designations: list[str]
    catalog_ids: list[CatalogReference]
    provenance: list[NameProvenance]


class PositionProvenance(CamelModel):
    source: str
    ref_epoch_julian_year: float | None
    role: str


class ResolveResult(CamelModel):
    name: str
    ra: float
    dec: float
    identity: ObjectIdentity | None = None
    position_provenance: PositionProvenance | None = None


class NearbySource(CamelModel):
    identity: ObjectIdentity | None = None
    source_id: str
    ra: float
    dec: float
    ref_epoch: float
    pm_ra_cos_dec_mas_yr: float | None = None
    pm_dec_mas_yr: float | None = None
    parallax_mas: float | None = None
    g_mag: float | None = None
    separation_arcsec: float


class SourceProvenance(CamelModel):
    """Where a catalog result came from.

    `catalog` and `data_release` identify the dataset (Gaia DR3) and never change with the
    server. `served_by` names the archive that actually answered (for example ESA or the
    AIP mirror); `retrieved_at_utc` is when that archive was queried, which stays the
    original time when the result is later served from the in-memory cache.
    """

    catalog: str
    data_release: str
    source_table_url: str | None = None
    source_detail_url: str | None = None
    served_by: str | None = None
    retrieved_at_utc: str | None = None
    from_cache: bool | None = None


class NearbyResponse(CamelModel):
    sources: list[NearbySource]
    provenance: SourceProvenance | None = None


class GaiaDetail(CamelModel):
    identity: ObjectIdentity | None = None
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
