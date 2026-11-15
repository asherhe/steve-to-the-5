import os
from contextlib import asynccontextmanager
from urllib.parse import quote

import httpx
from fastapi import FastAPI

from . import cutouts
from .api import create_local_demo_router, create_router
from .supabase import ApiError, Supabase


def saved_comparison(body):
    """The SPHEREx and WISE services return a saved comparison as {status, comparison,
    diagnostics}; evidence checks need the comparison itself."""
    if isinstance(body, dict) and "id" not in body and isinstance(body.get("comparison"), dict):
        return body["comparison"]
    return body


def local_demo() -> bool:
    """FINDINGS_LOCAL_DEMO=1 runs point scoring only: no Supabase, no sign-in, nothing stored."""
    return os.environ.get("FINDINGS_LOCAL_DEMO", "").strip() == "1"


def create_app() -> FastAPI:
    demo = local_demo()
    required = () if demo else ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVER_KEY", "SPHEREX_COMPARISON_BASE_URL")
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        raise RuntimeError("Missing server configuration: " + ", ".join(missing))
    comparison_base = os.environ.get("SPHEREX_COMPARISON_BASE_URL", "http://127.0.0.1:8000").strip().rstrip("/")
    wise_base = os.environ.get("WISE_COMPARISON_BASE_URL", "http://127.0.0.1:8020").rstrip("/")
    catalog_base = os.environ.get("SPHEREX_CATALOG_BASE_URL", "http://127.0.0.1:8010").rstrip("/")
    client = httpx.AsyncClient(timeout=10.0, follow_redirects=False)
    supabase = None if demo else Supabase(
        client,
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_PUBLISHABLE_KEY"],
        os.environ["SUPABASE_SERVER_KEY"],
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with client:
            yield

    async def load_comparison(comparison_id: str, base: str, path: str):
        encoded_id = quote(comparison_id, safe="")
        if encoded_id in (".", "..") or "/" in comparison_id or "\\" in comparison_id:
            return None
        try:
            response = await client.get(f"{base}{path}/{encoded_id}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return saved_comparison(response.json())
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.") from error

    async def load_saved_comparison(identifier):
        return await load_comparison(identifier, comparison_base, "/api/comparisons")

    async def load_wise_comparison(identifier):
        return await load_comparison(identifier, wise_base, "/api/wise/comparisons")

    async def load_catalog_review(ra, dec, radius, observed):
        try:
            params = {"ra": ra, "dec": dec, "radiusArcsec": radius}
            if observed is not None:  # undated points: the catalog service skips SkyBoT
                params["observedAtUtc"] = observed
            response = await client.get(f"{catalog_base}/api/catalogs/review", params=params, timeout=40)
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(503, "catalogs_unavailable", "Catalog review could not complete. Try again shortly.") from error

    max_asset_bytes = 20_000_000

    async def load_asset(survey, comparison_id, name):
        """A saved frame's FITS bytes from the survey's evidence store, size-bounded."""
        base, path = (wise_base, "/api/wise/comparisons") if survey == "wise" else (comparison_base, "/api/comparisons")
        if "/" in comparison_id or "/" in name or not name.endswith(".fits"):
            raise ApiError(422, "invalid_evidence", "Invalid saved evidence asset.")
        url = f"{base}{path}/{quote(comparison_id, safe='')}/assets/{quote(name, safe='')}"
        try:
            async with client.stream("GET", url, timeout=30) as response:
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > max_asset_bytes:
                        raise ApiError(503, "evidence_too_large", "A saved frame is too large to measure.")
                return bytes(content)
        except httpx.HTTPError as error:
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.") from error

    async def load_cutouts(ra, dec):
        # Same client; cutout requests set their own timeouts and follow archive redirects.
        return await cutouts.fetch_all(client, ra, dec)

    app = FastAPI(lifespan=lifespan)
    if demo:
        app.include_router(create_local_demo_router(load_saved_comparison, load_wise_comparison=load_wise_comparison,
            load_catalog_review=load_catalog_review, load_cutouts=load_cutouts))
        return app
    app.include_router(create_router(supabase, load_saved_comparison,
        load_wise_comparison=load_wise_comparison, load_catalog_review=load_catalog_review, load_asset=load_asset,
        load_cutouts=load_cutouts))

    return app
