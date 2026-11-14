from collections.abc import Awaitable, Callable
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .models import CreatedFinding, Finding, FindingInput, Reply, ReplyInput, Viewport
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

        return handle


def create_router(supabase: Supabase, load_saved_comparison: ComparisonLoader) -> APIRouter:
    router = APIRouter(prefix="/api/findings", tags=["findings"], route_class=FindingsRoute)

    async def signed_in(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if credentials is None:
            raise ApiError(401, "unauthorized", "Sign in to post or reply.")
        return await supabase.user(credentials.credentials)

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

    @router.get("/{finding_id}", response_model=Finding)
    async def get_finding(finding_id: UUID):
        finding = await supabase.rpc("spherex_finding_thread", {"p_id": str(finding_id)})
        if finding is None:
            raise ApiError(404, "finding_not_found", "Finding not found.")
        return finding

    @router.post("", status_code=201, response_model=CreatedFinding)
    async def create_finding(finding: FindingInput, author=Depends(signed_in)):
        comparison = await load_saved_comparison(finding.comparisonId)
        if not comparison or comparison.get("id") != finding.comparisonId or not comparison.get("frames"):
            raise ApiError(422, "invalid_comparison", "Choose a saved comparison before posting.")
        frame_ids = {frame["id"] for frame in comparison["frames"]}
        if any(mark.frameId not in frame_ids for mark in finding.marks):
            raise ApiError(422, "invalid_frame", "Each mark must belong to the saved comparison.")

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
            },
        )
        return {"id": finding_id}

    @router.post("/{finding_id}/replies", status_code=201, response_model=Reply)
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
