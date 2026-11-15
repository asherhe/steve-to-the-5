"""Bounded catalog context for cold-object review; never an identity or novelty verdict."""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import math
import threading
import time
import xml.etree.ElementTree as ET
from typing import Literal
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from astropy.coordinates import SkyCoord
from astropy import units as u
from astropy.time import Time
from fastapi import APIRouter, Query, Request
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
REVIEW_CACHE_TTL_S = 3600
MOTION_ROWS = 2000
# Bounded quick-look search, not a completeness claim for arbitrary stellar motion.
MOTION_ARCSEC_PER_YEAR = 15.0


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


# Gaia DR3 is already cached by its provider. Each other catalog has its own cone cache.
_check_caches = {name: BoundedCache[CatalogCheck](128) for name in CATALOGS[1:]}


class CatalogReview(BaseModel):
    mode: Literal["live", "offline"]
    ra: float
    dec: float
    radiusArcsec: float
    # Null when the point has no observation time (e.g. a mark on the undated all-sky mosaic).
    observedAtUtc: str | None = None
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


def table_result(content, media_type, required=(), max_rows=MAX_ROWS):
    infos = [node for node in ET.fromstring(content).iter() if node.tag.rsplit("}", 1)[-1] == "INFO"]
    if any(node.get("name", "").lower() == "error" or node.get("value", "").upper() == "ERROR" for node in infos):
        raise EndpointDown("Catalog returned an error document")
    overflow = any(node.get("value", "").upper() == "OVERFLOW" for node in infos)
    table = parse_votable(content, required, media_type)
    columns = [{"name": name, "unit": str(table[name].unit) if table[name].unit else None,
                "description": table[name].description} for name in table.colnames]
    rows = [{name: cell(row[name]) for name in table.colnames} for row in table[:max_rows]]
    return columns, rows, overflow or len(table) >= max_rows


def cone(ra, dec, radius, ra_column="ra", dec_column="dec"):
    return f"1=CONTAINS(POINT('ICRS',{ra_column},{dec_column}),CIRCLE('ICRS',{ra},{dec},{radius / 3600}))"


def motion_radius(radius, observed, epoch):
    if not observed:
        return radius
    years = abs(float(Time(observed).jyear) - epoch)
    if years > 150:
        raise EndpointDown("Observation outside the bounded proper-motion search interval")
    return radius + MOTION_ARCSEC_PER_YEAR * years


def at_observation(rows, ra, dec, radius, observed, epoch, ra_key="ra", dec_key="dec",
                   pmra_key="pmra", pmdec_key="pmdec", motion_scale=1):
    """Keep native columns; filter on predicted positions only when both motions are known.

    Tangent-vector space motion at infinite distance (no parallax or radial velocity).
    The spherical offset handles RA wrap and polar crossings without dividing by cos(dec).
    Missing astrometry stays at its published position, explicitly labelled as such.
    """
    point = SkyCoord(ra, dec, unit="deg")
    selected = []
    for row in rows:
        def number(key):
            try:
                value = float(row.get(key))
                return value if math.isfinite(value) else None
            except (TypeError, ValueError):
                return None
        x, y = number(ra_key), number(dec_key)
        if x is None or y is None or not 0 <= x < 360 or abs(y) > 90:
            raise EndpointDown("Invalid catalog coordinates")
        position = SkyCoord(x, y, unit="deg")
        item = {**row, "positionBasis": "published catalog position"}
        pmra, pmdec = number(pmra_key), number(pmdec_key)
        ref = number("refEpoch") if "refEpoch" in row else epoch
        if observed and ref is not None and pmra is not None and pmdec is not None:
            years = float(Time(observed).jyear) - ref
            east, north = pmra * motion_scale * years, pmdec * motion_scale * years
            radians = math.hypot(east, north) * math.pi / (180 * 3_600_000)
            position = position.directional_offset_by(math.atan2(east, north) * u.rad, math.atan(radians) * u.rad)
            item.update(predictedRa=float(position.ra.deg), predictedDec=float(position.dec.deg),
                        positionAtUtc=observed, positionBasis="proper-motion prediction")
        distance = float(point.separation(position).arcsec)
        if distance <= radius:
            item["separationArcsec"] = distance
            selected.append(item)
    return sorted(selected, key=lambda row: row["separationArcsec"])


def unavailable_reason(exc: BaseException) -> str:
    """One plain sentence on why a catalog could not be checked, most actionable cause first."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    text = f"{type(exc).__name__} {exc}".lower()
    if status == 429 or "429" in text or "too many requests" in text:
        return "the archive is limiting how many requests it accepts. Try again in a minute."
    if getattr(exc, "busy", False) or "busy" in text:
        return "this server is busy with other checks. Try again in a moment."
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)) or "timed out" in text or "timeout" in text \
            or "no complete response" in text:
        return "the archive did not respond in time."
    if (isinstance(status, int) and status >= 500) or "http 5" in text:
        return "the archive returned a server error."
    if "rejected" in text:
        return "the archive rejected the query."
    if "connect" in text or "unreachable" in text:
        return "the archive could not be reached."
    return "the search did not complete."


def tap_check(name, scope, endpoints, query, required, settings, *, motion=None):
    policy = failover_for(settings)

    def fetch(endpoint, deadline):
        response = tap_sync(endpoint.url, query, deadline, "votable", policy.connect_timeout_s)
        columns, rows, limited = table_result(response.content, response.media_type, required, MOTION_ROWS if motion else MAX_ROWS)
        return columns, rows, limited, hashlib.sha256(response.content).hexdigest()

    endpoint, (columns, rows, limited, digest) = policy.run(endpoints, fetch)
    notes = ["Rows are nearby catalog entries, not confirmed counterparts."]
    if motion:
        rows = at_observation(rows, **motion)
        notes += ["Positions with both proper-motion components are predicted for the selected frame time; published columns are retained.",
                  "The search allows 15 arcsec/year of motion. Missing motions retain published positions; faster motion, parallax and perspective effects can cause missed associations."]
    else:
        notes.append("Positions are published catalog coordinates, not propagated to the selected frame time.")
    limited = limited or len(rows) > MAX_ROWS
    return CatalogCheck(catalog=name, status="partial" if limited else "candidates" if rows else "no_candidates",
        scope=scope, sourceUrl=endpoint.url + "/sync?" + urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "votable", "QUERY": query}),
        servedBy=endpoint.name, retrievedAtUtc=now(), responseSha256=digest, columns=columns, rows=rows[:MAX_ROWS],
        limitations=notes +
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


def skybot_undated():
    # Solar System positions only mean something at an actual observation time. A point
    # without one (the all-sky mosaic combines many dates) is not checked, never guessed.
    return CatalogCheck(catalog="SkyBoT", status="skipped",
        scope="Needs the observation time of a dated frame", sourceUrl="",
        limitations=["No observation time was given, so known Solar System objects were not checked. "
                     "Mark the point on a dated frame to include them."])


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
        limit = MOTION_ROWS if observed else MAX_ROWS + 1
        result = get_provider(settings).nearby(ra, dec, motion_radius(radius, observed, 2016.0), limit)
        provenance = getattr(result, "provenance", None)
        rows = at_observation([row.model_dump(by_alias=True) for row in result], ra, dec, radius, observed, 2016.0,
                              pmra_key="pmRaCosDecMasYr", pmdec_key="pmDecMasYr")
        return CatalogCheck(catalog="Gaia DR3", status="partial" if len(result) >= limit or len(rows) > MAX_ROWS else "candidates" if rows else "no_candidates",
            scope="Gaia DR3, reference epoch 2016.0; positions in degrees, motions mas/yr, parallax mas, G magnitude",
            sourceUrl=provenance.source_table_url if provenance else "https://www.cosmos.esa.int/web/gaia/dr3",
            servedBy=provenance.served_by if provenance else None,
            retrievedAtUtc=provenance.retrieved_at_utc if provenance else now(), rows=rows[:MAX_ROWS],
            limitations=["Uses the existing Gaia failover and cache. Inspect a source for its full astrometry and frame-time prediction.",
                          "Dated searches include a 15 arcsec/year motion margin, then filter proper-motion predictions at the frame time. Missing motions retain published coordinates; parallax and perspective effects are not modeled.",
                          *(["Result limit reached; the motion search is incomplete."] if len(result) >= limit or len(rows) > MAX_ROWS else [])])

    tasks = [gaia,
        lambda: tap_check("SIMBAD", "SIMBAD basic object records in the selected cone",
            parse_endpoints(settings.simbad_tap_urls, DEFAULT_SIMBAD_ENDPOINTS),
            f"SELECT TOP {MOTION_ROWS + 1 if observed else 51} * FROM basic WHERE {cone(ra, dec, motion_radius(radius, observed, 2000.0))}",
            ("main_id", "ra", "dec"), settings,
            motion=dict(ra=ra, dec=dec, radius=radius, observed=observed, epoch=2000.0) if observed else None),
        lambda: tap_check("CatWISE2020", "CatWISE2020 catalog; consult epoch and quality columns",
            (Endpoint("IRSA", "https://irsa.ipac.caltech.edu/TAP"),),
            f"SELECT TOP {MOTION_ROWS + 1 if observed else 51} * FROM catwise_2020 WHERE {cone(ra, dec, motion_radius(radius, observed, float(Time(57170, format='mjd').jyear)), 'ra_pm', 'dec_pm') if observed else cone(ra, dec, radius)}",
            ("ra_pm", "dec_pm", "pmra", "pmdec") if observed else ("ra", "dec"), settings,
            motion=dict(ra=ra, dec=dec, radius=radius, observed=observed, epoch=float(Time(57170, format='mjd').jyear),
                        ra_key="ra_pm", dec_key="dec_pm", motion_scale=1000) if observed else None),
        lambda: ultracool(ra, dec, radius),
        (lambda: skybot(ra, dec, radius, observed)) if observed else skybot_undated,
        lambda: tap_check("VizieR", "VizieR II/328/allwise only (AllWISE); other VizieR catalogs are not searched",
            (Endpoint("CDS VizieR", "https://tapvizier.cds.unistra.fr/TAPVizieR/tap"),),
            f'SELECT TOP 51 * FROM "II/328/allwise" WHERE {cone(ra, dec, radius, "RAJ2000", "DEJ2000")}',
            ("RAJ2000", "DEJ2000"), settings),
    ]

    def attempt(item):
        name, task = item
        cache = _check_caches.get(name)
        key = (
            ra, dec, radius,
            observed if name in {"SIMBAD", "CatWISE2020", "SkyBoT"} else None,
            settings.simbad_tap_urls if name == "SIMBAD" else None,
        )
        if cache is not None and (cached := cache.get(key)) is not None:
            return cached.model_copy(deep=True)
        try:
            result = task()
        except Exception as exc:
            # Never turn a failed/malformed query into a successful zero-row result.
            reason = unavailable_reason(exc)
            return CatalogCheck(catalog=name, status="unavailable", scope=f"Not checked: {reason}", sourceUrl="",
                limitations=[f"The catalog could not be checked: {reason} No absence was established.",
                             f"Detail: {str(exc)[:300] or type(exc).__name__}"])
        if cache is not None and result.status in {"candidates", "no_candidates", "partial"}:
            cache.put(key, result.model_copy(deep=True), REVIEW_CACHE_TTL_S)
        return result

    with ThreadPoolExecutor(max_workers=6) as pool:
        checks = list(pool.map(attempt, zip(CATALOGS, tasks)))
    return CatalogReview(mode="live", ra=ra, dec=dec, radiusArcsec=radius,
        observedAtUtc=observed, checks=checks, limitations=limitations)


class ReviewSlots:
    """Admission for live reviews.

    `max_active` reviews may have a client waiting on them. A review whose client has gone
    (the viewer marked another point, changed the radius or closed the panel) stops counting
    at once, so a new check never waits behind, or is refused because of, an abandoned one.
    Abandoned reviews keep their worker threads until their bounded queries end;
    `max_running` caps all running reviews, abandoned ones included, so rapid re-marking
    cannot pile up load on the catalogs."""

    def __init__(self, max_active=2, max_running=6):
        self.max_active, self.max_running = max_active, max_running
        self.lock = threading.Lock()
        self.active = self.running = 0

    def try_take(self):
        """A ticket for a new review, or None when there is no room."""
        with self.lock:
            if self.active >= self.max_active or self.running >= self.max_running:
                return None
            self.active += 1
            self.running += 1
            return {"active": True}

    def abandon(self, ticket):
        """The client went away; the review's threads may still be running."""
        with self.lock:
            if ticket["active"]:
                ticket["active"] = False
                self.active -= 1

    def finish(self, ticket):
        with self.lock:
            self.running -= 1
            if ticket["active"]:
                ticket["active"] = False
                self.active -= 1


_review_slots = ReviewSlots()
# A new check usually arrives just as the viewer drops the one it replaces; give the
# server time to notice that disconnect before calling the service busy.
REVIEW_SLOT_WAIT_S = 5.0
DISCONNECT_POLL_S = 0.25


@router.get("/review", response_model=CatalogReview)
async def review(request: Request, ra: float = Query(ge=0, lt=360), dec: float = Query(ge=-90, le=90),
                 radiusArcsec: float = Query(default=120, ge=5, le=300),
                 observedAtUtc: datetime | None = Query(default=None)):
    from app.errors import ApiError
    if observedAtUtc is not None and observedAtUtc.tzinfo is None:
        raise ApiError("invalid_request", "Observation time must include a timezone.", 400)
    waited_until = time.monotonic() + REVIEW_SLOT_WAIT_S
    while (ticket := _review_slots.try_take()) is None:
        if time.monotonic() >= waited_until or await request.is_disconnected():
            raise ApiError("review_busy", "Other catalog reviews are running. Try again shortly.", 429)
        await asyncio.sleep(DISCONNECT_POLL_S)
    observed = observedAtUtc.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if observedAtUtc else None

    def work():
        try:
            return run_review(ra, dec, radiusArcsec, observed)
        finally:
            _review_slots.finish(ticket)

    task = asyncio.ensure_future(asyncio.to_thread(work))
    # An abandoned review's result (or error) is discarded when it eventually finishes.
    task.add_done_callback(lambda done: done.cancelled() or done.exception())
    while True:
        finished, _ = await asyncio.wait({task}, timeout=DISCONNECT_POLL_S)
        if finished:
            return task.result()
        if await request.is_disconnected():
            _review_slots.abandon(ticket)
            raise ApiError("review_abandoned", "The client stopped waiting for this review.", 409)
