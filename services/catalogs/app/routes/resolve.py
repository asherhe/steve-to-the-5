"""Exact identity resolution; bundled targets are independent of upstream services.

Order: bundled targets and their component-ambiguity checks first, then (only when live
and external resolution are both enabled) SIMBAD, Strasbourg before the Harvard mirror.
The three ways a name can fail are kept distinct: lookup switched off (`resolver_disabled`),
SIMBAD not responding (`upstream_unavailable`), and no such name (`not_found`, or
`not_found_in_mirror` when only the dated mirror could be asked).
"""
from __future__ import annotations
import time  # noqa: F401  (tests patch time.monotonic through this module)
from datetime import datetime, timezone
from urllib.parse import quote
from fastapi import APIRouter, Query
from app import simbad
from app.config import get_settings
from app.deps import failover_for
from app.errors import ApiError, not_found, upstream_unavailable
from app.models import ErrorBody, ResolveResult
from app.presets import naming_version, normalize_name, partial_preset_names, resolve_preset
from app.reliability import AllEndpointsDown, BoundedCache, parse_endpoints

router = APIRouter()

HIT_TTL_S = 86_400.0
MISS_TTL_S = 300.0
# A miss from the mirror alone is not authoritative: keep it only briefly.
MIRROR_MISS_TTL_S = 60.0
NOT_FOUND_MESSAGE = "No object with that name in SIMBAD. Try a full catalog designation or coordinates."
MIRROR_MISS_MESSAGE = (
    "No match in the available SIMBAD mirror. The main SIMBAD server is not responding and the "
    "mirror is a dated copy, so the object may still exist. Try a catalog designation or coordinates."
)

# Name-resolution namespace of the shared cache: a ResolveResult, or a (code, message) miss.
_cache: BoundedCache[ResolveResult | tuple[str, str]] = BoundedCache(256)


def _endpoints(settings):
    return parse_endpoints(settings.simbad_tap_urls, simbad.DEFAULT_SIMBAD_ENDPOINTS)


@router.get("/api/resolve", response_model=ResolveResult, responses={code: {"model": ErrorBody} for code in (400, 404, 409, 503)})
def resolve(
    name: str = Query(..., min_length=1, max_length=256),
    retry: bool = Query(False, description="A manual retry: probe SIMBAD servers that are in cooldown."),
) -> ResolveResult:
    settings = get_settings()
    preset = resolve_preset(name, settings)
    if preset is not None:
        return ResolveResult.model_validate(preset)
    partials = partial_preset_names(name, settings)
    if partials:
        raise ApiError("incomplete_name", "Choose a matching target: " + ", ".join(partials) + ". Or enter a full name or catalog identifier.", 400)
    if not (settings.live and settings.external_resolve):
        raise ApiError("resolver_disabled", "Name lookup beyond the five bundled targets is switched off on this server. Choose a suggestion or enter coordinates.", 503)
    key = (naming_version(str(settings.fixtures_dir)), str(settings.fixtures_dir), settings.live, settings.external_resolve, normalize_name(name))
    cached = _cache.get(key)
    if isinstance(cached, ResolveResult):
        return cached.model_copy(deep=True)
    if cached is not None:
        code, message = cached
        # A mirror-only miss stops applying as soon as the main server may be reachable again.
        primary = _endpoints(settings)[0]
        if code != "not_found_in_mirror" or (failover_for(settings).cooling(primary) and not retry):
            raise ApiError(code, message, 404)
    try:
        result = _resolve_external(name.strip(), probe=True) if retry else _resolve_external(name.strip())
    except ApiError as exc:
        if exc.code == "not_found":
            _cache.put(key, (exc.code, NOT_FOUND_MESSAGE), MISS_TTL_S)
            raise not_found(NOT_FOUND_MESSAGE) from exc
        if exc.code == "not_found_in_mirror":
            _cache.put(key, (exc.code, exc.message), MIRROR_MISS_TTL_S)
        raise
    _cache.put(key, result, HIT_TTL_S)
    return result.model_copy(deep=True)


def _resolve_external(name: str, probe: bool = False, fetch=None) -> ResolveResult:
    settings = get_settings()
    endpoints = _endpoints(settings)
    try:
        endpoint, found = simbad.lookup(name, endpoints, failover_for(settings), probe=probe, fetch=fetch)
    except AllEndpointsDown as exc:
        if exc.busy:
            raise upstream_unavailable("SIMBAD lookups are busy with other requests. Try again in a moment.") from exc
        raise upstream_unavailable(
            "SIMBAD is not responding, so this name could not be looked up. "
            "The five bundled targets and coordinate search still work."
        ) from exc
    except simbad.SimbadAmbiguous as exc:
        raise ApiError("ambiguous_name", "Several identities matched. Enter a full catalog or component designation.", 409) from exc
    except simbad.SimbadInvalid as exc:
        raise upstream_unavailable("SIMBAD returned unusable data for this name. Use a bundled target or coordinates.") from exc
    if found is None:
        if endpoint != endpoints[0]:
            raise ApiError("not_found_in_mirror", MIRROR_MISS_MESSAGE, 404)
        raise not_found(NOT_FOUND_MESSAGE)
    name_alias = simbad.common_name(found.identifiers, name)
    display = name_alias or (found.main_id[5:].strip() if found.main_id.startswith("NAME ") else found.main_id)
    return ResolveResult.model_validate({
        "name": display, "ra": found.ra, "dec": found.dec,
        "identity": {"objectId": "simbad:" + found.main_id, "commonName": name_alias,
            "canonicalDesignation": found.main_id, "displayName": display,
            "aliases": found.identifiers, "component": "SIMBAD resolved object",
            "relatedDesignations": [], "catalogIds": [{"catalog": "SIMBAD", "dataRelease": None, "id": found.main_id}],
            "provenance": [{"source": "SIMBAD", "url": simbad.SIMBAD_OBJECT_URL + quote(found.main_id, safe=""),
                "retrievedAtUtc": datetime.now(timezone.utc).isoformat(), "kind": "live_lookup", "servedBy": endpoint.name}]},
        "positionProvenance": {"source": f"SIMBAD identifier lookup via {endpoint.name}; epoch not supplied", "refEpochJulianYear": None, "role": "catalog_reference_position"}})
