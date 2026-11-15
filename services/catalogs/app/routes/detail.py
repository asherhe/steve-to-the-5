"""GET /api/catalogs/gaia/{sourceId} -> full astrometry + optional fields.

Returns the same astrometry as a nearby row plus uncertainties, radial velocity, BP/RP
photometry and provenance. Optional measurements are null when unavailable. A missing source
is not_found; a backend failure is upstream_unavailable.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.deps import get_provider
from app.errors import not_found, upstream_unavailable
from app.gaia.provider import SourceNotFound, UpstreamError
from app.models import GaiaDetail
from app.presets import gaia_identity
from app.validation import validate_source_id

router = APIRouter()


@router.get("/api/catalogs/gaia/{source_id}", response_model=GaiaDetail)
def gaia_detail(source_id: str) -> GaiaDetail:
    settings = get_settings()
    sid = validate_source_id(source_id)
    provider = get_provider(settings)
    try:
        result = provider.detail(sid)
        return result.model_copy(update={"identity": gaia_identity(sid, settings)})
    except SourceNotFound as exc:
        raise not_found(str(exc)) from exc
    except UpstreamError as exc:
        raise upstream_unavailable(str(exc)) from exc
