import os
from pathlib import Path
import threading

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from .client import IRSAClient
from .models import ArchiveError, ComparisonResponse, ErrorBody, FieldRequest, ProcessingConfig
from .pipeline import Pipeline
from .storage import LocalStore


def create_router(pipeline):
    router = APIRouter(prefix="/api/comparisons", tags=["archive"], responses={
        code: {"model": ErrorBody} for code in (404, 409, 422, 429, 500, 503)})
    # One active build per PROCESS. This is not a distributed limit: run a single
    # worker, or put a shared limiter in front of several.
    building = threading.Lock()

    @router.get("", response_model=ComparisonResponse)
    def compare(ra: float, dec: float, fovArcmin: float = 6):
        try:
            field = FieldRequest(ra=ra, dec=dec, fovArcmin=fovArcmin)
        except ValidationError as exc:
            raise ArchiveError("INVALID_REQUEST", "Finite RA/Dec and a field of 1–30 arcminutes are required", 422) from exc
        recorded = pipeline.store.matching_recorded_field(field) if hasattr(pipeline.store, "matching_recorded_field") else None
        if recorded is not None:
            return JSONResponse(recorded, headers={"X-SPHEREx-Evidence": "saved-real-example"})
        # Reject at once instead of queueing: excess requests never wait for the lock.
        if not building.acquire(blocking=False):
            raise ArchiveError("BUILD_BUSY", "Another comparison build is running; retry shortly. "
                               "Saved comparisons remain available by ID.", 429)
        try:
            response = pipeline.build(field)
        finally:
            building.release()
        return JSONResponse(response.model_dump(mode="json", by_alias=True))

    @router.get("/{comparison_id}", response_model=ComparisonResponse)
    def replay(comparison_id: str):
        # Stored bytes, integrity-checked; never rebuilt and never queued behind a build.
        return JSONResponse(pipeline.store.load_raw(comparison_id))

    @router.get("/{comparison_id}/assets/{name}")
    def asset(comparison_id: str, name: str):
        content, sha = pipeline.store.asset(comparison_id, name)
        media_type = "image/png" if name.endswith(".png") else "application/fits"
        return Response(content, media_type=media_type, headers={
            "ETag": f'"{sha}"', "Cache-Control": "public, max-age=31536000, immutable"})

    return router


def install_error_handlers(app):
    @app.exception_handler(ArchiveError)
    def archive_error(request: Request, exc: ArchiveError):
        headers = {"Retry-After": "30"} if exc.http_status == 429 else None
        return JSONResponse(status_code=exc.http_status, headers=headers,
                            content={"code": exc.code, "message": exc.message})

    @app.exception_handler(RequestValidationError)
    def request_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422,
                            content={"code": "INVALID_REQUEST", "message": "Invalid comparison parameters"})


def create_app(pipeline=None):
    app = FastAPI(title="SPHEREx archive comparisons", version="0.2.0")
    if pipeline is None:
        root = Path(os.environ.get("SPHEREX_STORAGE_DIR", Path(__file__).parent / ".local-data"))
        config = ProcessingConfig()
        fixtures = Path(__file__).resolve().parents[2] / "fixtures" / "archive"
        examples = [fixtures / name / "evidence" for name in ("real", "real-wise0855", "real-epsindib", "real-rdraconis")]
        pipeline = Pipeline(IRSAClient(config, root / "cache", search_attempts=6, cutout_attempts=5), LocalStore(root / "evidence", examples), config)
    app.include_router(create_router(pipeline))
    install_error_handlers(app)
    return app
