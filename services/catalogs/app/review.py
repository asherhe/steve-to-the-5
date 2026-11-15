"""Bounded catalog context for cold-object review; never an identity or novelty verdict."""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import math
import threading
import xml.etree.ElementTree as ET
from typing import Literal
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from astropy.coordinates import SkyCoord
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.config import get_settings
from app.deps import failover_for, get_provider
from app.gaia.tap import parse_votable
from app.reliability import BoundedCache, Endpoint, EndpointDown, parse_endpoints
from app.simbad import DEFAULT_SIMBAD_ENDPOINTS
from app.tap_http import tap_sync

router = APIRouter(prefix="/api/catalogs", tags=["catalog review"])
CATALOGS = ("Gaia DR3", "SIMBAD", "CatWISE2020", "UltracoolSheet", "SkyBoT", "VizieR")
ULTRACOOL_URL = "https://zenodo.org/records/15802304/files/UltracoolSheet%20-%20Main.csv?download=1"
_sheet_cache = BoundedCache(1)
MAX_ROWS = 50
_review_slots = threading.BoundedSemaphore(2)


class CatalogCheck(BaseModel):
    catalog: str
    status: Literal["candidates", "no_candidates", "partial", "unavailable", "skipped"]
    scope: str
    sourceUrl: str
    servedBy: str | None = None
    retrievedAtUtc: str | None = None
    responseSha256: str | None = None
    columns: list[dict[str, str | None]] = Field(default_factory=list)
    rows: list[dict] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class CatalogReview(BaseModel):
    mode: Literal["live", "offline"]
    ra: float
    dec: float
    radiusArcsec: float
    observedAtUtc: str
    checks: list[CatalogCheck]
    limitations: list[str]


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def cell(value):
    if value is None or getattr(value, "mask", False):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, float) and not math.isfinite(value):
        return None
    # IDs must survive JavaScript's 53-bit integer limit exactly.
    if isinstance(value, int) and abs(value) > 2**53 - 1:
        return str(value)
    return value if isinstance(value, (str, int, float, bool)) else str(value)


def table_result(content, media_type, required=()):
    infos = [node for node in ET.fromstring(content).iter() if node.tag.rsplit("}", 1)[-1] == "INFO"]
    if any(node.get("name", "").lower() == "error" or node.get("value", "").upper() == "ERROR" for node in infos):
        raise EndpointDown("Catalog returned an error document")
    overflow = any(node.get("value", "").upper() == "OVERFLOW" for node in infos)
    table = parse_votable(content, required, media_type)
    columns = [{"name": name, "unit": str(table[name].unit) if table[name].unit else None,
                "description": table[name].description} for name in table.colnames]
    rows = [{name: cell(row[name]) for name in table.colnames} for row in table[:MAX_ROWS]]
    return columns, rows, overflow or len(table) >= MAX_ROWS


def cone(ra, dec, radius, ra_column="ra", dec_column="dec"):
    return f"1=CONTAINS(POINT('ICRS',{ra_column},{dec_column}),CIRCLE('ICRS',{ra},{dec},{radius / 3600}))"


def tap_check(name, scope, endpoints, query, required, settings):
    policy = failover_for(settings)

    def fetch(endpoint, deadline):
        response = tap_sync(endpoint.url, query, deadline, "votable", policy.connect_timeout_s)
        columns, rows, limited = table_result(response.content, response.media_type, required)
        return columns, rows, limited, hashlib.sha256(response.content).hexdigest()

    endpoint, (columns, rows, limited, digest) = policy.run(endpoints, fetch)
    return CatalogCheck(catalog=name, status="partial" if limited else "candidates" if rows else "no_candidates",
        scope=scope, sourceUrl=endpoint.url + "/sync?" + urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "votable", "QUERY": query}),
        servedBy=endpoint.name, retrievedAtUtc=now(), responseSha256=digest, columns=columns, rows=rows,
        limitations=["Rows are nearby catalog entries, not confirmed counterparts. Positions are not propagated."] +
        (["Result limit reached; the search is incomplete."] if limited else []))


async def bounded_get(url, params=None):
    # Both wall-clock time and decoded body size are bounded, including slow streams.
    async with asyncio.timeout(25):
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            async with client.stream("GET", url, params=params) as response:
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 8_000_000:
                        raise EndpointDown("Response exceeded the review size limit")
                return bytes(content), response.headers.get("content-type", "")


def ultracool(ra, dec, radius):
    cached = _sheet_cache.get("2.1.0")
    if cached is None:
        content, _ = asyncio.run(bounded_get(ULTRACOOL_URL))
        rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
        required = {"name", "ra_j2000_formula", "dec_j2000_formula"}
        if not rows or not required.issubset(rows[0]):
            raise EndpointDown("Unexpected UltracoolSheet columns")
        cached = (rows, now(), hashlib.sha256(content).hexdigest())
        _sheet_cache.put("2.1.0", cached, 86400)
    rows, retrieved, digest = cached
    nearby = []
    point = SkyCoord(ra, dec, unit="deg")
    for row in rows:
        try:
            position = SkyCoord(float(row["ra_j2000_formula"]), float(row["dec_j2000_formula"]), unit="deg")
            distance = point.separation(position).arcsec
        except (ValueError, TypeError):
            continue
        if math.isfinite(distance) and distance <= radius:
            nearby.append({**row, "separationArcsec": distance})
    nearby.sort(key=lambda row: row["separationArcsec"])
    return CatalogCheck(catalog="UltracoolSheet", status="partial" if len(nearby) > MAX_ROWS else "candidates" if nearby else "no_candidates",
        scope="UltracoolSheet 2.1.0 Main table, positions propagated to J2000 by the compilation",
        sourceUrl=ULTRACOOL_URL, servedBy="Zenodo release 15802304", retrievedAtUtc=retrieved,
        responseSha256=digest, rows=nearby[:MAX_ROWS],
        limitations=["Pinned July 2025 release; newer discoveries may be absent.",
                      "J2000 positions are not moved to the selected observation date. High proper motion can move objects outside this cone.",
                      "Column definitions and original-paper reference codes: https://zenodo.org/records/15802304"])


def skybot(ra, dec, radius, observed):
    url = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php"
    params = {"RA": ra, "DEC": dec, "SR": radius / 3600, "TIME": observed,
              "MAXREC": MAX_ROWS + 1, "VERB": 3, "RESPONSEFORMAT": "votable", "-loc": "500"}
    content, media = asyncio.run(bounded_get(url, params))
    columns, rows, limited = skybot_table(content, media)
    return CatalogCheck(catalog="SkyBoT", status="partial" if limited else "candidates" if rows else "no_candidates",
        scope="Known Solar System objects at the selected frame time; geocentric predictions",
        sourceUrl=url + "?" + urlencode(params), servedBy="IMCCE/LTE", retrievedAtUtc=now(),
        responseSha256=hashlib.sha256(content).hexdigest(), columns=columns, rows=rows,
        limitations=["Geocentric predictions differ from a spacecraft viewpoint, especially for nearby objects.",
                      "A combined frame spans time; this query uses its displayed time only."] +
                      (["Row limit reached; incomplete search."] if limited else []))


def skybot_table(content, media):
    # SkyBoT's SCS endpoint uses QUERY_STATUS=ERROR for its explicit empty-cone
    # message. Recognize only that response; other ERROR documents stay failures.
    root = ET.fromstring(content)
    infos = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "INFO"]
    errors = [node for node in infos if node.get("value", "").upper() == "ERROR" or node.get("name", "").lower() == "error"]
    if (root.tag.rsplit("}", 1)[-1] == "VOTABLE" and errors and
        all(node.get("name") == "QUERY_STATUS" and (node.text or "").strip().startswith(
            "No solar system object was found in the requested FOV:") for node in errors)):
        return [], [], False
    return table_result(content, media)


def run_review(ra, dec, radius, observed, settings=None):
    settings = settings or get_settings()
    limitations = [
        "These are cone-search review aids, not automated cross-identifications or a complete novelty search.",
        "Unmatched does not mean new. Different epochs, sensitivity, crowding, motion and incomplete catalogs can explain a miss.",
        "DSS and Gaia detections are not required for a cold-object candidate. WISE catalog presence is not an image detection.",
    ]
    if not settings.live:
        checks = [CatalogCheck(catalog=name, status="skipped", scope="Live review disabled", sourceUrl="",
                  limitations=["Offline mode; no live catalog check was performed."]) for name in CATALOGS]
        return CatalogReview(mode="offline", ra=ra, dec=dec, radiusArcsec=radius, observedAtUtc=observed, checks=checks, limitations=limitations)

    def gaia():
        result = get_provider(settings).nearby(ra, dec, radius, MAX_ROWS + 1)
        provenance = getattr(result, "provenance", None)
        rows = [row.model_dump(by_alias=True) for row in result[:MAX_ROWS]]
        return CatalogCheck(catalog="Gaia DR3", status="partial" if len(result) > MAX_ROWS else "candidates" if rows else "no_candidates",
            scope="Gaia DR3, reference epoch 2016.0; positions in degrees, motions mas/yr, parallax mas, G magnitude",
            sourceUrl=provenance.source_table_url if provenance else "https://www.cosmos.esa.int/web/gaia/dr3",
            servedBy=provenance.served_by if provenance else None,
            retrievedAtUtc=provenance.retrieved_at_utc if provenance else now(), rows=rows,
            limitations=["Uses the existing Gaia failover and cache. Inspect a source for its full astrometry and frame-time prediction.",
                          "The cone is centered on the selected image point; high proper motion can cause missed associations."])

    tasks = [gaia,
        lambda: tap_check("SIMBAD", "SIMBAD basic object records in the selected cone",
            parse_endpoints(settings.simbad_tap_urls, DEFAULT_SIMBAD_ENDPOINTS),
            f"SELECT TOP 51 * FROM basic WHERE {cone(ra, dec, radius)}", ("main_id", "ra", "dec"), settings),
        lambda: tap_check("CatWISE2020", "CatWISE2020 catalog; consult epoch and quality columns",
            (Endpoint("IRSA", "https://irsa.ipac.caltech.edu/TAP"),),
            f"SELECT TOP 51 * FROM catwise_2020 WHERE {cone(ra, dec, radius)}", ("ra", "dec"), settings),
        lambda: ultracool(ra, dec, radius), lambda: skybot(ra, dec, radius, observed),
        lambda: tap_check("VizieR", "VizieR II/328/allwise only (AllWISE); other VizieR catalogs are not searched",
            (Endpoint("CDS VizieR", "https://tapvizier.cds.unistra.fr/TAPVizieR/tap"),),
            f'SELECT TOP 51 * FROM "II/328/allwise" WHERE {cone(ra, dec, radius, "RAJ2000", "DEJ2000")}',
            ("RAJ2000", "DEJ2000"), settings),
    ]

    def attempt(item):
        name, task = item
        try:
            return task()
        except Exception:
            # Never turn a failed/malformed query into a successful zero-row result.
            return CatalogCheck(catalog=name, status="unavailable", scope="Search did not complete", sourceUrl="",
                limitations=["The catalog could not be checked. Retry later; no absence or points are inferred."])

    with ThreadPoolExecutor(max_workers=6) as pool:
        checks = list(pool.map(attempt, zip(CATALOGS, tasks)))
    return CatalogReview(mode="live", ra=ra, dec=dec, radiusArcsec=radius,
        observedAtUtc=observed, checks=checks, limitations=limitations)


@router.get("/review", response_model=CatalogReview)
def review(ra: float = Query(ge=0, lt=360), dec: float = Query(ge=-90, le=90),
           radiusArcsec: float = Query(default=120, ge=5, le=300),
           observedAtUtc: datetime = Query()):
    if observedAtUtc.tzinfo is None:
        from app.errors import ApiError
        raise ApiError("invalid_request", "Observation time must include a timezone.", 400)
    if not _review_slots.acquire(blocking=False):
        from app.errors import ApiError
        raise ApiError("review_busy", "Other catalog reviews are running. Try again shortly.", 429)
    try:
        return run_review(ra, dec, radiusArcsec, observedAtUtc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"))
    finally:
        _review_slots.release()
