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

    async def load_saved_comparison(comparison_id: str):
        encoded_id = quote(comparison_id, safe="")
        if encoded_id in (".", "..") or "/" in comparison_id or "\\" in comparison_id:
            return None
        try:
            response = await client.get(f"{comparison_base}/api/comparisons/{encoded_id}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.") from error

    app = FastAPI(lifespan=lifespan)
    app.include_router(create_router(supabase, load_saved_comparison))
    return app
