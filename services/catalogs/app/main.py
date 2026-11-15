"""FastAPI application factory for the catalog service.

Mounts the three catalog routes under /api and registers the shared {code, message} error
handlers. CORS is permissive for local standalone development; the deployed app shell uses a
same-origin entry point, so production CORS is owned by the coordinator, not this slice.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.errors import register_error_handlers
from app.routes import detail, nearby, resolve


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="SPHEREx catalog service",
        version="0.1.0",
        description=(
            "Name resolution, bounded Gaia DR3 cone search and exact source-ID detail. "
            f"Mode: {'live Gaia TAP' if settings.live else 'offline fixtures'}."
        ),
    )

    # Local development convenience only. Deployment uses a same-origin API entry point.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET"],
        allow_headers=["*"],
        expose_headers=["X-SPHEREx-Catalog-Mode"],
    )

    register_error_handlers(app)
    app.include_router(resolve.router)
    app.include_router(nearby.router)
    app.include_router(detail.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "live": settings.live}

    return app


app = create_app()
