import os
from contextlib import asynccontextmanager
from urllib.parse import quote

import httpx
from fastapi import FastAPI

from .api import create_router
from .supabase import ApiError, Supabase


def create_app() -> FastAPI:
    required = ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVER_KEY", "SPHEREX_COMPARISON_BASE_URL")
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        raise RuntimeError("Missing server configuration: " + ", ".join(missing))
    comparison_base = os.environ["SPHEREX_COMPARISON_BASE_URL"].rstrip("/")
    wise_base = os.environ.get("WISE_COMPARISON_BASE_URL", "http://127.0.0.1:8020").rstrip("/")
    catalog_base = os.environ.get("SPHEREX_CATALOG_BASE_URL", "http://127.0.0.1:8010").rstrip("/")
    client = httpx.AsyncClient(timeout=10.0, follow_redirects=False)
    supabase = Supabase(
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
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.") from error

    async def load_saved_comparison(identifier):
        return await load_comparison(identifier, comparison_base, "/api/comparisons")

    async def load_wise_comparison(identifier):
        return await load_comparison(identifier, wise_base, "/api/wise/comparisons")

    async def load_catalog_review(ra, dec, radius, observed):
        try:
            response = await client.get(f"{catalog_base}/api/catalogs/review", params={
                "ra": ra, "dec": dec, "radiusArcsec": radius, "observedAtUtc": observed}, timeout=40)
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(503, "catalogs_unavailable", "Catalog review could not complete. Try again shortly.") from error

    app = FastAPI(lifespan=lifespan)
    app.include_router(create_router(supabase, load_saved_comparison,
        load_wise_comparison=load_wise_comparison, load_catalog_review=load_catalog_review))

    return app
