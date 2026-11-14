"""GET /api/catalogs/nearby?ra&dec&radiusArcsec -> {sources}.

Bounded cone search. An empty result is a valid, successful response and is distinct from a
service error (upstream_unavailable).
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.config import get_settings
from app.deps import get_provider
from app.errors import upstream_unavailable
from app.gaia.provider import UpstreamError
from app.models import NearbyResponse
from app.validation import validate_dec, validate_ra, validate_radius_arcsec

router = APIRouter()


@router.get("/api/catalogs/nearby", response_model=NearbyResponse)
def nearby(
    ra: float = Query(...),
    dec: float = Query(...),
    radius_arcsec: float = Query(..., alias="radiusArcsec"),
) -> NearbyResponse:
    settings = get_settings()
    ra = validate_ra(ra)
    dec = validate_dec(dec)
    radius_arcsec = validate_radius_arcsec(radius_arcsec, settings.max_radius_arcsec)

    provider = get_provider(settings)
    try:
        sources = provider.nearby(ra, dec, radius_arcsec, settings.max_rows)
    except UpstreamError as exc:
        raise upstream_unavailable(str(exc)) from exc
    return NearbyResponse(sources=sources)
