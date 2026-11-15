import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from services.archive.api import install_error_handlers
from services.archive.builds import BuildCoordinator
from services.archive.request_cache import RequestCache
from services.archive.models import (ArchiveError, BuildCancelledResponse, BuildProgressResponse,
                                     ComparisonResponse, ErrorBody)
from services.archive.storage import LocalStore

from .indexed import IndexedWiseClient
from .models import BANDS, WiseConfig, WiseFieldRequest
from .pipeline import WisePipeline, implementation_identity


def create_router(pipeline):
    router = APIRouter(prefix="/api/wise/comparisons", tags=["wise"], responses={
        code: {"model": ErrorBody} for code in (404, 409, 422, 429, 500, 503)})
    builds = BuildCoordinator()
    # A blink is a separate immutable comparison, retaining both endpoint visits.
    blink_config = pipeline.config.model_copy(update={
        "max_epochs": 2, "exposures_per_epoch": min(3, pipeline.config.exposures_per_epoch),
        "min_exposures_per_epoch": min(2, pipeline.config.min_exposures_per_epoch)})
    blink = WisePipeline(pipeline.client, pipeline.store, blink_config, pipeline.clock)
    pipelines = {"blink": blink, "timeline": pipeline}
    caches = {mode: RequestCache(value, implementation_identity()) for mode, value in pipelines.items()}

    @router.get("/progress/{progress_id}", response_model=BuildProgressResponse)
    def build_progress(progress_id: str):
        return builds.read(progress_id)

    @router.delete("/progress/{progress_id}", response_model=BuildCancelledResponse)
    def cancel_build(progress_id: str):
        return builds.cancel(progress_id)

    @router.get("", response_model=ComparisonResponse)
    def compare(ra: float, dec: float, fovArcmin: float = 6, band: int = 2,
                progressId: str | None = None, mode: Literal["blink", "timeline"] = "blink",
                refresh: bool = False):
        try:
            field = WiseFieldRequest(ra=ra, dec=dec, fovArcmin=fovArcmin, band=band)
        except ValidationError as exc:
            raise ArchiveError("INVALID_REQUEST", "Finite RA/Dec, a field of 1–12 arcminutes "
                               "and band 1 or 2 are required", 422) from exc
        builds.validate(progressId)
        cache = caches[mode]
        cached = cache.get(field) if not refresh else None
        if cached is not None:
            return JSONResponse(cached, headers={"X-Comparison-Source": "saved-cache"})
        recorded = (pipeline.store.matching_recorded_field(
            field, {"band": BANDS[field.band]["name"], "maxEpochs": pipelines[mode].config.max_epochs})
            if not refresh else None)
        if recorded is not None:
            return JSONResponse(recorded, headers={"X-Comparison-Source": "saved-example"})
        with builds.run(progressId) as (report, cancel):
            response = pipelines[mode].build(field, report, cancel)
            cache.put(field, response)
        return JSONResponse(response.model_dump(mode="json", by_alias=True),
                            headers={"X-Comparison-Source": "archive"})

    @router.get("/{comparison_id}", response_model=ComparisonResponse)
    def replay(comparison_id: str):
        # Stored bytes, integrity-checked; never rebuilt.
        return JSONResponse(pipeline.store.load_raw(comparison_id))

    @router.get("/{comparison_id}/assets/{name}")
    def asset(comparison_id: str, name: str):
        content, sha = pipeline.store.asset(comparison_id, name)
        media_type = "image/png" if name.endswith(".png") else "application/fits"
        return Response(content, media_type=media_type, headers={
            "ETag": f'"{sha}"', "Cache-Control": "public, max-age=31536000, immutable"})

    return router


def create_store(root):
    example = Path(__file__).resolve().parents[2] / "fixtures/wise/real-wise0855/evidence"
    return LocalStore(Path(root) / "evidence", example)


def create_app(pipeline=None):
    if pipeline is None:
        root = Path(os.environ.get("WISE_STORAGE_DIR", Path(__file__).parent / ".local-data"))
        config = WiseConfig()
        pipeline = WisePipeline(IndexedWiseClient(config, root / "cache"), create_store(root), config)
    @asynccontextmanager
    async def lifespan(app):
        yield
        if hasattr(pipeline.client, "close"):
            pipeline.client.close()
    app = FastAPI(title="WISE/NEOWISE time-lapse comparisons", version="0.1.0", lifespan=lifespan)
    app.include_router(create_router(pipeline))
    install_error_handlers(app)
    return app
