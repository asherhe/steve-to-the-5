"""Bounded, on-demand CADC NEOSSat preview discovery; no comparison processing."""
from __future__ import annotations

import asyncio
import csv
import io
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.errors import upstream_unavailable
from app.validation import validate_dec, validate_ra

router = APIRouter()
TAP_URL = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/argus/sync"
IMAGE_BASE = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/data/pub/NEOSSAT/"
MAX_IMAGES = 12
MAX_ROWS = 60
MAX_BYTES = 256_000
MJD_ZERO = datetime(1858, 11, 17, tzinfo=timezone.utc)


class NeossatPosition(BaseModel):
    ra: float
    dec: float


class NeossatImage(BaseModel):
    observation_id: str = Field(alias="observationId")
    product: str
    observed_at_utc: str = Field(alias="observedAtUtc")
    image_url: str = Field(alias="imageUrl")


class NeossatResponse(BaseModel):
    position: NeossatPosition
    images: list[NeossatImage]
    truncated: bool
    retrieved_at_utc: str = Field(alias="retrievedAtUtc")
    source: Literal["CADC NEOSSat"] = "CADC NEOSSat"


def preview_query(ra: float, dec: float) -> str:
    # Numeric coordinates have already been validated; spatial bounds, not target names
    # or proximity to pointing centres, determine whether the selected point is covered.
    return f"""SELECT TOP {MAX_ROWS + 1}
        o.observationID, p.productID, p.time_bounds_lower, a.uri
        FROM caom2.Observation AS o
        JOIN caom2.Plane AS p ON o.obsID = p.obsID
        JOIN caom2.Artifact AS a ON p.planeID = a.planeID
        WHERE o.collection = 'NEOSSAT' AND p.dataProductType = 'image'
        AND a.productType = 'preview'
        AND 1 = CONTAINS(POINT('ICRS', {ra:.12f}, {dec:.12f}), p.position_bounds)
        ORDER BY p.time_bounds_lower DESC, o.observationID DESC, p.productID ASC"""


def parse_previews(text: str) -> tuple[list[NeossatImage], bool]:
    reader = csv.DictReader(io.StringIO(text), strict=True)
    required = {"observationID", "productID", "time_bounds_lower", "uri"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("Unexpected CADC columns")
    rows = list(reader)
    if len(rows) > MAX_ROWS + 1:
        raise ValueError("CADC row limit exceeded")
    images: dict[str, NeossatImage] = {}
    ranks = {"raw": 0, "clean": 1, "cor": 2, "cord": 3}
    for row in rows[:MAX_ROWS]:
        observation_id, product = row["observationID"], row["productID"]
        uri = row["uri"] or ""
        if (not observation_id or not product or None in row
                or not re.fullmatch(r"cadc:NEOSSAT/[A-Za-z0-9][A-Za-z0-9_.-]*\.png", uri)):
            raise ValueError("Invalid CADC preview record")
        if not isinstance(row["time_bounds_lower"], str):
            raise ValueError("Missing observation time")
        mjd = float(row["time_bounds_lower"])
        if not math.isfinite(mjd):
            raise ValueError("Invalid observation time")
        observed = MJD_ZERO + timedelta(days=mjd)
        image = NeossatImage(
            observationId=observation_id, product=product,
            observedAtUtc=observed.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            imageUrl=IMAGE_BASE + uri.removeprefix("cadc:NEOSSAT/"),
        )
        previous = images.get(observation_id)
        if previous is None or ranks.get(product, -1) > ranks.get(previous.product, -1):
            images[observation_id] = image
    ordered = sorted(images.values(), key=lambda image: (image.observed_at_utc, image.observation_id), reverse=True)
    return ordered[:MAX_IMAGES], len(rows) > MAX_ROWS or len(ordered) > MAX_IMAGES


async def fetch_previews(ra: float, dec: float) -> tuple[list[NeossatImage], bool]:
    params = {"LANG": "ADQL", "REQUEST": "doQuery", "FORMAT": "csv", "QUERY": preview_query(ra, dec)}
    async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), follow_redirects=False) as client:
        async with client.stream("GET", TAP_URL, params=params) as response:
            response.raise_for_status()
            if not response.headers.get("content-type", "").lower().startswith("text/csv"):
                raise ValueError("Unexpected CADC content type")
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > MAX_BYTES:
                    raise ValueError("CADC response limit exceeded")
    return parse_previews(content.decode("utf-8-sig"))


@router.get("/api/catalogs/neossat", response_model=NeossatResponse,
            responses={400: {"description": "Invalid coordinates"},
                       503: {"description": "Archive unavailable or live access disabled"}})
async def neossat(response: Response, ra: float = Query(...), dec: float = Query(...)) -> NeossatResponse:
    ra, dec = validate_ra(ra), validate_dec(dec)
    response.headers["Cache-Control"] = "no-store"
    if not get_settings().live:
        raise upstream_unavailable("NEOSSat archive access is disabled in offline mode.")
    try:
        images, truncated = await asyncio.wait_for(fetch_previews(ra, dec), timeout=22)
    except (httpx.HTTPError, ValueError, OverflowError, TimeoutError, csv.Error) as exc:
        raise upstream_unavailable("The NEOSSat archive could not be reached or returned an invalid response. Try Refresh again.") from exc
    return NeossatResponse(
        position=NeossatPosition(ra=ra, dec=dec), images=images, truncated=truncated,
        retrievedAtUtc=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
