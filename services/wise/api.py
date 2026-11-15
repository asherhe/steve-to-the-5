import os
from pathlib import Path
import re
import threading
import time

from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from services.archive.api import install_error_handlers
from services.archive.models import ArchiveError, ComparisonResponse, ErrorBody
from services.archive.storage import LocalStore

from .client import WiseClient
from .models import WiseConfig, WiseFieldRequest
from .pipeline import WisePipeline


def create_router(pipeline):
    router = APIRouter(prefix="/api/wise/comparisons", tags=["wise"], responses={
        code: {"model": ErrorBody} for code in (404, 409, 422, 429, 500, 503)})
    # One active build per process, as for the SPHEREx archive.
    building = threading.Lock()
    # Progress of running builds, keyed by an ID the client chose. Display only.
    progress, progress_lock = {}, threading.Lock()

    @router.get("/progress/{progress_id}")
    def build_progress(progress_id: str):
        with progress_lock:
            state = progress.get(progress_id)
            if state is None:
                raise ArchiveError("NOT_FOUND", "No running build has this progress ID", 404)
            return JSONResponse({**state["latest"], "elapsedSeconds": round(time.monotonic() - state["started"], 1)})

    @router.delete("/progress/{progress_id}")
    def cancel_build(progress_id: str):
        """Stop a running build. Finished downloads stay cached, so a retry resumes from them."""
        with progress_lock:
            state = progress.get(progress_id)
            if state is None:
                raise ArchiveError("NOT_FOUND", "No running build has this progress ID", 404)
            state["cancel"].set()
        return JSONResponse({"cancelled": True})

    @router.get("", response_model=ComparisonResponse)
    def compare(ra: float, dec: float, fovArcmin: float = 6, band: int = 2, progressId: str | None = None):
        try:
            field = WiseFieldRequest(ra=ra, dec=dec, fovArcmin=fovArcmin, band=band)
        except ValidationError as exc:
            raise ArchiveError("INVALID_REQUEST", "Finite RA/Dec, a field of 1–12 arcminutes "
                               "and band 1 or 2 are required", 422) from exc
        if progressId is not None and not re.fullmatch(r"[A-Za-z0-9-]{8,64}", progressId):
            raise ArchiveError("INVALID_REQUEST", "progressId must be 8–64 letters, digits or hyphens", 422)
        if not building.acquire(blocking=False):
            raise ArchiveError("BUILD_BUSY", "Another WISE time-lapse build is running; retry shortly. "
                               "Saved comparisons remain available by ID.", 429)

        cancel = threading.Event()

        def report(state):
            with progress_lock:
                if progressId in progress:
                    progress[progressId]["latest"] = state
        try:
            if progressId is not None:
                with progress_lock:
                    progress[progressId] = {"started": time.monotonic(), "cancel": cancel, "latest": {
                        "stage": "discovery", "done": 0, "total": 1, "fraction": 0.0}}
            response = pipeline.build(field, report if progressId is not None else None, cancel)
        finally:
            with progress_lock:
                progress.pop(progressId, None)
            building.release()
        return JSONResponse(response.model_dump(mode="json", by_alias=True))

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


def create_app(pipeline=None):
    app = FastAPI(title="WISE/NEOWISE time-lapse comparisons", version="0.1.0")
    if pipeline is None:
        root = Path(os.environ.get("WISE_STORAGE_DIR", Path(__file__).parent / ".local-data"))
        config = WiseConfig()
        pipeline = WisePipeline(WiseClient(config, root / "cache"), LocalStore(root / "evidence"), config)
    app.include_router(create_router(pipeline))
    install_error_handlers(app)
    return app
