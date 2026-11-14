"""GET /api/resolve?name -> {name, ra, dec}.

Bundled presets resolve first and independently of any external service. External name
lookup (SIMBAD / Gaia identifier) is an optional fallback used only when live + external
resolution are enabled. Unknown names return a not_found error.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.config import get_settings
from app.errors import invalid_request, not_found, upstream_unavailable
from app.models import ResolveResult
from app.presets import resolve_preset

router = APIRouter()


@router.get("/api/resolve", response_model=ResolveResult)
def resolve(name: str = Query(..., min_length=1)) -> ResolveResult:
    settings = get_settings()
    cleaned = name.strip()
    if not cleaned:
        raise invalid_request("name must be a non-empty string.")

    preset = resolve_preset(cleaned, settings)
    if preset is not None:
        return ResolveResult(name=preset["name"], ra=preset["ra"], dec=preset["dec"])

    if settings.live and settings.external_resolve:
        return _resolve_external(cleaned)

    raise not_found(
        f"Unknown target name {cleaned!r}. Known presets cover the challenge targets; "
        "external name lookup is disabled."
    )


def _resolve_external(name: str) -> ResolveResult:
    try:
        from astroquery.simbad import Simbad
    except Exception as exc:  # pragma: no cover - import guard
        raise upstream_unavailable("External name resolution is unavailable.") from exc
    try:
        table = Simbad.query_object(name)
    except Exception as exc:
        raise upstream_unavailable(f"Name resolution service failed: {exc}") from exc
    if table is None or len(table) == 0:
        raise not_found(f"Name {name!r} not found by external resolver.")
    row = table[0]
    # astroquery SIMBAD returns sexagesimal RA/Dec; convert via astropy.
    from astropy.coordinates import SkyCoord
    import astropy.units as u

    coord = SkyCoord(row["RA"], row["DEC"], unit=(u.hourangle, u.deg), frame="icrs")
    return ResolveResult(name=name, ra=float(coord.ra.deg), dec=float(coord.dec.deg))
