"""Exact identity resolution; bundled targets are independent of upstream services."""
from __future__ import annotations
import math
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from urllib.parse import quote
from fastapi import APIRouter, Query
from app.config import get_settings
from app.errors import ApiError, not_found, upstream_unavailable
from app.models import ErrorBody, ResolveResult
from app.presets import normalize_name, partial_preset_names, resolve_preset

router = APIRouter()
_cache: OrderedDict[tuple, tuple[float, ResolveResult | None]] = OrderedDict()
_lock = threading.Lock()


@router.get("/api/resolve", response_model=ResolveResult, responses={code: {"model": ErrorBody} for code in (400, 404, 409, 503)})
def resolve(name: str = Query(..., min_length=1, max_length=256)) -> ResolveResult:
    settings = get_settings()
    preset = resolve_preset(name, settings)
    if preset is not None:
        return ResolveResult.model_validate(preset)
    partials = partial_preset_names(name, settings)
    if partials:
        raise ApiError("incomplete_name", "Choose a matching target: " + ", ".join(partials) + ". Or enter a full name or catalog identifier.", 400)
    if not (settings.live and settings.external_resolve):
        raise ApiError("resolver_disabled", "Not in the five bundled targets. External name lookup is disabled; choose a suggestion or enter coordinates.", 503)
    from app.presets import naming_version
    key = (naming_version(str(settings.fixtures_dir)), str(settings.fixtures_dir), settings.live, settings.external_resolve, normalize_name(name))
    now = time.monotonic()
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] > now:
            _cache.move_to_end(key)
            if cached[1] is None:
                raise not_found("No identifier found by SIMBAD. Try a full catalog designation or coordinates.")
            return cached[1].model_copy(deep=True)
    try:
        result = _resolve_external(name.strip())
    except ApiError as exc:
        if exc.code != "not_found":
            raise
        result = None
    with _lock:
        _cache[key] = (now + (86400 if result else 300), result)
        _cache.move_to_end(key)
        while len(_cache) > 256:
            _cache.popitem(last=False)
    if result is None:
        raise not_found("No identifier found by SIMBAD. Try a full catalog designation or coordinates.")
    return result.model_copy(deep=True)


def _resolver_session():
    # Live-only import: the offline service must not require astroquery/requests.
    from requests import Session

    class ResolverSession(Session):
        def request(self, method, url, **kwargs):
            # Also bounds TAP capability and identifier requests.
            kwargs["timeout"] = 8
            return super().request(method, url, **kwargs)

    return ResolverSession()


def _resolve_external(name: str) -> ResolveResult:
    client = None
    try:
        from astroquery.simbad import Simbad
        client = Simbad()
        client._session.close()
        client._session = _resolver_session()
        table = client.query_object(name, wildcard=False)
        if table is None or len(table) == 0:
            raise not_found("No identifier found by SIMBAD.")
        if len(table) != 1:
            raise ApiError("ambiguous_name", "Several identities matched. Enter a full catalog or component designation.", 409)
        row = table[0]
        # astroquery >=0.4.8 returns lowercase column names and degree-valued angles.
        ra, dec = float(row["ra"]), float(row["dec"])
        canonical = str(row["main_id"]).strip()
        if not canonical or not math.isfinite(ra) or not math.isfinite(dec) or not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise ValueError("Invalid SIMBAD position or identifier")
        identities = client.query_objectids(canonical)
        aliases = [] if identities is None else [str(value).strip() for value in identities["id"]]
        url = "https://simbad.u-strasbg.fr/simbad/sim-id?Ident=" + quote(canonical, safe="")
        return ResolveResult.model_validate({
            "name": canonical, "ra": ra, "dec": dec,
            "identity": {"objectId": "simbad:" + canonical, "commonName": None,
                "canonicalDesignation": canonical, "displayName": canonical,
                "aliases": aliases, "component": "SIMBAD resolved object",
                "relatedDesignations": [], "catalogIds": [{"catalog": "SIMBAD", "dataRelease": None, "id": canonical}],
                "provenance": [{"source": "SIMBAD", "url": url, "retrievedAtUtc": datetime.now(timezone.utc).isoformat(), "kind": "live_lookup"}]},
            "positionProvenance": {"source": "SIMBAD identifier lookup; epoch not supplied", "refEpochJulianYear": None, "role": "catalog_reference_position"}})
    except ApiError:
        raise
    except Exception as exc:
        raise upstream_unavailable("SIMBAD name lookup is unavailable or returned invalid data. Use a bundled target or coordinates.") from exc
    finally:
        if client is not None:
            client._session.close()
