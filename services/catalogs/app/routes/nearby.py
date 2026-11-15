"""GET /api/catalogs/nearby?ra&dec&radiusArcsec -> {sources}.

Bounded cone search. An empty result is a valid, successful response and is distinct from a
service error (upstream_unavailable).
"""
from __future__ import annotations

from fastapi import APIRouter, Query, Response

from app.config import get_settings
from app.deps import get_provider
from app.errors import upstream_unavailable
from app.gaia.provider import UpstreamError
from app.models import NearbyResponse
from app.presets import gaia_identity
from app.validation import validate_dec, validate_ra, validate_radius_arcsec

router = APIRouter()


@router.get("/api/catalogs/nearby", response_model=NearbyResponse)
def nearby(
    response: Response,
    ra: float = Query(...),
    dec: float = Query(...),
    radius_arcsec: float = Query(..., alias="radiusArcsec"),
    retry: bool = Query(False, description="A manual retry: probe archives that are in cooldown."),
) -> NearbyResponse:
    settings = get_settings()
    ra = validate_ra(ra)
    dec = validate_dec(dec)
    radius_arcsec = validate_radius_arcsec(radius_arcsec, settings.max_radius_arcsec)

    provider = get_provider(settings)
    try:
        # Only the live provider understands a recovery probe; fixtures take the plain call.
        sources = provider.nearby(ra, dec, radius_arcsec, settings.max_rows, **({"probe": True} if retry else {}))
    except UpstreamError as exc:
        raise upstream_unavailable(str(exc)) from exc
    response.headers["X-SPHEREx-Catalog-Mode"] = "live" if settings.live else "fixture"
    return NearbyResponse(
        sources=[row.model_copy(update={"identity": gaia_identity(row.source_id, settings)}) for row in sources],
        provenance=getattr(sources, "provenance", None),
    )
