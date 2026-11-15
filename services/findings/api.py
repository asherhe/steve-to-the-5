from collections.abc import Awaitable, Callable
from typing import Annotated, Literal
import asyncio
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .models import CreatedFinding, ErrorResponse, ExistingEntry, Finding, FindingInput, Reply, ReplyInput, Viewport, ReviewInput, ReviewResponse, LeaderboardResult, PublicAuthConfig, PointReviewInput, PointReviewResponse
from .point_review import DUPLICATE_RADIUS_ARCSEC, SCORE_VERSION as POINT_SCORE_VERSION, prepare_point_review
from .review import prepare_review
from .wise_variability import validate_blink
from .supabase import ApiError, Supabase

ComparisonLoader = Callable[[str], Awaitable[dict | None]]
bearer = HTTPBearer(auto_error=False)


class FindingsRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                issue = error.errors()[0]
                field = ".".join(str(part) for part in issue["loc"][1:]) or "request"
                return JSONResponse(
                    {"code": "invalid_request", "message": f"{field}: {issue['msg']}"},
                    status_code=422,
                )
            except ApiError as error:
                return JSONResponse(
                    {"code": error.code, "message": error.message}, status_code=error.status
                )
            except ResponseValidationError:
                return JSONResponse(
                    {"code": "findings_unavailable", "message": "Findings are temporarily unavailable."},
                    status_code=503,
                )

        return handle


def create_router(supabase: Supabase | None, load_saved_comparison: ComparisonLoader, *, load_wise_comparison=None, load_catalog_review=None,
                  load_asset=None, load_cutouts=None, spectral_store=None, local_demo=False) -> APIRouter:
    router = APIRouter(
        prefix="/api/findings", tags=["findings"], route_class=FindingsRoute,
        responses={422: {"model": ErrorResponse, "description": "Invalid request"}, 503: {"model": ErrorResponse}},
    )

    async def signed_in(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if credentials is None:
            raise ApiError(401, "unauthorized", "Sign in to post or reply.")
        return await supabase.user(credentials.credentials)

    async def evidence(identifier, survey):
        loader = load_wise_comparison if survey == "wise" else load_saved_comparison
        if loader is None:
            raise ApiError(503, "comparison_unavailable", "This survey's saved evidence service is not configured.")
        comparison = await loader(identifier)
        if comparison is None:
            raise ApiError(422, "invalid_comparison", "Choose a saved comparison before posting.")
        if not isinstance(comparison, dict) or comparison.get("id") != identifier:
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.")
        return comparison

    review_slots = asyncio.Semaphore(2)

    @router.get("/spectral/{evidence_id}")
    async def spectral_manifest(evidence_id: str):
        if spectral_store is None:
            raise ApiError(503, "evidence_unavailable", "Spectral evidence storage is not configured.")
        payload = await asyncio.to_thread(spectral_store.read, evidence_id, ".json")
        return Response(payload, media_type="application/json", headers={"ETag": f'"{evidence_id}"', "Cache-Control": "public, max-age=31536000, immutable"})

    @router.get("/spectral/{evidence_id}/assets/{sha}.fits")
    async def spectral_asset(evidence_id: str, sha: str):
        if spectral_store is None:
            raise ApiError(503, "evidence_unavailable", "Spectral evidence storage is not configured.")
        payload = await asyncio.to_thread(spectral_store.asset, evidence_id, sha)
        return Response(payload, media_type="application/fits", headers={"ETag": f'"{sha}"', "Cache-Control": "public, max-age=31536000, immutable"})

    async def measure_point(data):
        if load_catalog_review is None or load_cutouts is None:
            raise ApiError(503, "catalogs_unavailable", "Point review is not configured.")
        if review_slots.locked():
            raise ApiError(429, "review_busy", "Other reviews are running. Try again shortly.")
        async with review_slots:
            if not data.wiseComparisonId:
                raise ApiError(422, "wise_blink_required", "Get a WISE blink at this point before calculating its score.")
            wise_comparison = await evidence(data.wiseComparisonId, "wise")
            validate_blink(wise_comparison, data)
            return await prepare_point_review(data, load_catalog_review, load_cutouts, evidence, spectral_store, wise_comparison, load_asset)

    if local_demo:
        @router.post("/points/review", status_code=201, response_model=PointReviewResponse)
        async def demo_point_review(data: PointReviewInput):
            response, _, _ = await measure_point(data)
            response.limitations.insert(0, "LOCAL DEMO: real survey measurements; posts and rankings are saved only in this browser.")
            return response

        # The demo factory has measurements and immutable evidence only: no auth,
        # database writes, public leaderboard or discussion routes.
        return router

    @router.get("/auth/config", response_model=PublicAuthConfig)
    async def auth_config():
        return {"url": supabase.url, "publishableKey": supabase.publishable_key}

    @router.get("/leaderboard", response_model=LeaderboardResult)
    async def leaderboard(board: Literal["daily", "allTime"] = "daily"):
        rows = await supabase.rpc("spherex_review_leaderboard", {"p_board": board})
        return {"board": board, "placeholder": False, "entries": rows}

    @router.post("/reviews", status_code=201, response_model=ReviewResponse,
                 responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}})
    async def review(data: ReviewInput, author=Depends(signed_in)):
        if load_catalog_review is None:
            raise ApiError(503, "catalogs_unavailable", "Catalog review is not configured.")
        if review_slots.locked():
            raise ApiError(429, "review_busy", "Other reviews are running. Try again shortly.")
        async with review_slots:
            comparison = await evidence(data.comparisonId, data.survey)
            response, candidate_key = await prepare_review(data, comparison, load_catalog_review, evidence, load_asset)
            await supabase.request("POST", "spherex_candidate_reviews", json={
                "id": str(response.id), "author_id": author.id,
                "comparison_id": data.comparisonId, "survey": data.survey,
                "ra": data.ra, "dec": data.dec, "candidate_key": candidate_key,
                "fov_arcmin": comparison["field"]["fovArcmin"],
                "score": response.score, "report": response.model_dump(mode="json"),
            })
            return response

    async def existing_entry(ra, dec, key):
        """The leaderboard entry already holding this object or a point within the duplicate radius."""
        found = await supabase.rpc("spherex_point_entry_near", {
            "p_ra": ra, "p_dec": dec, "p_radius_arcsec": DUPLICATE_RADIUS_ARCSEC, "p_object_key": key})
        return ExistingEntry.model_validate(found) if found else None

    def duplicate_error(entry: ExistingEntry) -> ApiError:
        what = "This object" if entry.sameObject else f"A point {entry.separationArcsec:.1f}″ away"
        return ApiError(409, "already_on_leaderboard",
                        f"{what} is already on the leaderboard: “{entry.title}” by {entry.displayName}. Open it to join the discussion.")

    @router.post("/points/review", status_code=201, response_model=PointReviewResponse,
                 responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}})
    async def point_review(data: PointReviewInput, author=Depends(signed_in)):
        """Scores a marked point; the server runs the catalog chain and fetches survey cutouts."""
        response, candidate_key, key = await measure_point(data)
        response.duplicate = await existing_entry(data.ra, data.dec, key)
        await supabase.request("POST", "spherex_candidate_reviews", json={
            "id": str(response.id), "author_id": author.id,
            "comparison_id": data.frame.comparisonId if data.frame else None,
            "survey": data.frame.survey if data.frame else "spherex",
            "ra": data.ra, "dec": data.dec, "candidate_key": candidate_key, "object_key": key,
            "fov_arcmin": None, "score": response.score, "report": response.model_dump(mode="json"),
        })
        return response

    @router.get("", response_model=Viewport)
    async def viewport(
        ra: Annotated[float, Query(ge=0, lt=360)],
        dec: Annotated[float, Query(ge=-90, le=90)],
        radius_deg: Annotated[float, Query(alias="radiusDeg", gt=0, le=180)],
        zoom: Annotated[int, Query(ge=0, le=30)],
    ):
        items = await supabase.rpc(
            "spherex_findings_viewport",
            {"p_ra": ra, "p_dec": dec, "p_radius": radius_deg, "p_zoom": zoom},
        )
        return {"items": items}

    @router.get("/{finding_id}", response_model=Finding, responses={404: {"model": ErrorResponse}})
    async def get_finding(finding_id: UUID):
        finding = await supabase.rpc("spherex_finding_thread", {"p_id": str(finding_id)})
        if finding is None:
            raise ApiError(404, "finding_not_found", "Finding not found.")
        return finding

    @router.post("", status_code=201, response_model=CreatedFinding, responses={401: {"model": ErrorResponse}})
    async def create_finding(finding: FindingInput, author=Depends(signed_in)):
        if finding.reviewId:
            point = await supabase.request("GET", "spherex_candidate_reviews", params={
                "id": f"eq.{finding.reviewId}", "author_id": f"eq.{author.id}", "select": "*", "limit": 1})
            if point and point[0]["report"].get("scoreVersion") in ("point-check-v3", POINT_SCORE_VERSION):
                return await create_point_finding(finding, point[0], author)
        if finding.comparisonId is None:
            raise ApiError(422, "invalid_comparison", "Choose a saved comparison or a completed point review before posting.")
        comparison = await evidence(finding.comparisonId, finding.survey)
        frames = comparison.get("frames")
        if not isinstance(frames, list) or not frames or any(
            not isinstance(frame, dict) or not isinstance(frame.get("id"), str) or not frame["id"]
            for frame in frames
        ):
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.")
        frame_ids = {frame["id"] for frame in frames}
        if len(frame_ids) != len(frames):
            raise ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.")
        if any(mark.frameId not in frame_ids for mark in finding.marks):
            raise ApiError(422, "invalid_frame", "Each mark must belong to the saved comparison.")

        candidate_key = None
        if finding.reviewId:
            reviews = await supabase.request("GET", "spherex_candidate_reviews", params={
                "id": f"eq.{finding.reviewId}", "author_id": f"eq.{author.id}", "select": "*", "limit": 1})
            if not reviews:
                raise ApiError(422, "invalid_review", "Choose your own completed candidate review.")
            reviewed = reviews[0]
            if (reviewed["comparison_id"], reviewed["survey"], reviewed["ra"], reviewed["dec"]) != (
                    finding.comparisonId, finding.survey, finding.ra, finding.dec):
                raise ApiError(422, "invalid_review", "The review belongs to a different image or position. Run it again.")
            report = reviewed["report"]
            if not any(mark.frameId == report["frameId"] and mark.ra == finding.ra and mark.dec == finding.dec for mark in finding.marks):
                raise ApiError(422, "invalid_review", "Keep the reviewed position marked on its original frame.")
            candidate_key = reviewed["candidate_key"]

        finding_id = uuid4()
        await supabase.request(
            "POST",
            "spherex_findings",
            json={
                "id": str(finding_id),
                "comparison_id": finding.comparisonId,
                "ra": finding.ra,
                "dec": finding.dec,
                "title": finding.title,
                "note": finding.note,
                "marks": [mark.model_dump() for mark in finding.marks],
                "author_id": author.id,
                "author_display_name": author.display_name,
                "survey": finding.survey,
                "review_id": str(finding.reviewId) if finding.reviewId else None,
                "candidate_key": candidate_key,
            },
        )
        return {"id": finding_id}

    async def create_point_finding(finding: FindingInput, reviewed: dict, author):
        """A leaderboard entry for a point review. One entry per object, checked atomically."""
        if finding.comparisonId is not None or finding.marks:
            raise ApiError(422, "invalid_review", "A point submission has no saved comparison or frame marks.")
        if (reviewed["ra"], reviewed["dec"]) != (finding.ra, finding.dec):
            raise ApiError(422, "invalid_review", "The review belongs to a different position. Check the point again.")
        finding_id = uuid4()
        result = await supabase.rpc("spherex_submit_point_finding", {
            "p_id": str(finding_id), "p_ra": finding.ra, "p_dec": finding.dec,
            "p_title": finding.title, "p_note": finding.note,
            "p_author_id": author.id, "p_author_display_name": author.display_name,
            "p_review_id": str(finding.reviewId), "p_object_key": reviewed.get("object_key"),
            "p_survey": reviewed.get("survey") or "spherex", "p_radius_arcsec": DUPLICATE_RADIUS_ARCSEC,
        })
        if isinstance(result, dict) and result.get("duplicate"):
            raise duplicate_error(ExistingEntry.model_validate(result["duplicate"]))
        return {"id": finding_id}

    @router.post(
        "/{finding_id}/replies", status_code=201, response_model=Reply,
        responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
    )
    async def create_reply(finding_id: UUID, reply: ReplyInput, author=Depends(signed_in)):
        created = await supabase.rpc(
            "spherex_finding_reply",
            {
                "p_finding_id": str(finding_id),
                "p_author_id": author.id,
                "p_author_display_name": author.display_name,
                "p_text": reply.text,
            },
        )
        if created is None:
            raise ApiError(404, "finding_not_found", "Finding not found.")
        return created

    return router
