"""Fetch image cutouts at one sky point from four surveys, for the brightness rule.

Each survey answers independently with up to MAX_FRAMES FITS images that cover the point,
an explicit "no_coverage", or "unavailable" when its archive fails. Nothing here decides
brightness; `brightness.measure` does, on the returned bytes.

- SPHEREx: IRSA SIA (`spherex_dr1`), then IBE cutouts of the newest L2 images
  (IMAGE/VARIANCE/FLAGS, MJy/sr), as the archive service requests them.
- WISE: IRSA IBE AllWISE Atlas W2 (4.6 um) coadd covering the point, cutout in DN.
- DSS: STScI DSS cutout service, POSS-II/UKST red plates, with a TAN WCS.
- NEOSSat: CADC CAOM2 calibrated ("cor"/"cord") FITS whose footprint contains the point.
  Raw NEOSSat frames carry no WCS and are not used.
"""
from __future__ import annotations

import asyncio
import csv
import io
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

MAX_FRAMES = 2
CUTOUT_ARCSEC = 120
MAX_BYTES = 12_000_000
SOURCE_DEADLINE_S = 45
SURVEY_LABELS = {"spherex": "SPHEREx", "wise": "WISE", "dss": "DSS", "neossat": "NEOSSat"}

IRSA = "https://irsa.ipac.caltech.edu"
DSS_URL = "https://archive.stsci.edu/cgi-bin/dss_search"
CADC_TAP = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/argus/sync"
CADC_DATA = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/data/pub/NEOSSAT/"
MJD_ZERO = datetime(1858, 11, 17, tzinfo=timezone.utc)


@dataclass
class Frame:
    label: str
    source_url: str
    fits: bytes
    observed_at_utc: str | None = None


@dataclass
class SourceResult:
    survey: str
    status: str  # "ok", "no_coverage" or "unavailable"
    frames: list[Frame] = field(default_factory=list)
    message: str | None = None


class SourceUnavailable(Exception):
    pass


def mjd_to_utc(mjd: float) -> str:
    return (MJD_ZERO + timedelta(days=float(mjd))).isoformat(timespec="seconds").replace("+00:00", "Z")


async def get_bytes(client: httpx.AsyncClient, url: str, params=None, *, fits: bool = False) -> bytes:
    try:
        async with client.stream("GET", url, params=params, timeout=30, follow_redirects=True) as response:
            response.raise_for_status()
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > MAX_BYTES:
                    raise SourceUnavailable("Response exceeded the size limit.")
    except httpx.HTTPError as error:
        raise SourceUnavailable(f"{type(error).__name__} from {httpx.URL(url).host}") from error
    if fits and not bytes(content[:6]) == b"SIMPLE":
        raise SourceUnavailable(f"{httpx.URL(url).host} did not return a FITS image.")
    return bytes(content)


async def spherex(client, ra, dec) -> SourceResult:
    from astropy.io.votable import parse
    content = await get_bytes(client, f"{IRSA}/SIA", {
        "COLLECTION": "spherex_dr1", "POS": f"CIRCLE {ra} {dec} 0.0005", "MAXREC": 200})
    table = list(parse(io.BytesIO(content)).iter_tables())[0].to_table(use_names_over_ids=True)
    rows = sorted(table, key=lambda row: float(row["t_min"]), reverse=True)[:MAX_FRAMES]
    if not rows:
        return SourceResult("spherex", "no_coverage")
    frames = []
    for row in rows:
        url = str(row["access_url"])
        if not url.startswith(f"{IRSA}/ibe/data/spherex/"):
            raise SourceUnavailable("Unexpected SPHEREx image URL.")
        query = urlencode({"center": f"{ra},{dec}", "size": f"{CUTOUT_ARCSEC / 3600}"})
        frames.append(Frame(f"SPHEREx {row['energy_bandpassname']}", url,
                            await get_bytes(client, f"{url}?{query}", fits=True), mjd_to_utc(row["t_min"])))
    return SourceResult("spherex", "ok", frames)


async def wise(client, ra, dec) -> SourceResult:
    from astropy.io import ascii
    path = "wise/allwise/p3am_cdd"
    text = (await get_bytes(client, f"{IRSA}/ibe/search/{path}", {
        "POS": f"{ra},{dec}", "where": "band=2", "columns": "coadd_id,band"})).decode("utf-8", "replace")
    table = ascii.read(text, format="ipac")
    if len(table) == 0:
        return SourceResult("wise", "no_coverage")
    coadd = str(table["coadd_id"][0])
    url = f"{IRSA}/ibe/data/{path}/{coadd[:2]}/{coadd[:4]}/{coadd}/{coadd}-w2-int-3.fits"
    query = urlencode({"center": f"{ra},{dec}", "size": f"{CUTOUT_ARCSEC}arcsec", "gzip": "false"})
    return SourceResult("wise", "ok", [Frame("AllWISE W2 (4.6 µm) coadd", url, await get_bytes(client, f"{url}?{query}", fits=True))])


async def dss(client, ra, dec) -> SourceResult:
    minutes = CUTOUT_ARCSEC / 60
    params = {"v": "poss2ukstu_red", "r": ra, "d": dec, "e": "J2000", "h": minutes, "w": minutes, "f": "fits", "c": "none"}
    data = await get_bytes(client, DSS_URL, params, fits=True)
    return SourceResult("dss", "ok", [Frame("DSS2 red", f"{DSS_URL}?{urlencode(params)}", data)])


async def neossat(client, ra, dec) -> SourceResult:
    query = f"""SELECT TOP {MAX_FRAMES} a.uri, p.time_bounds_lower
        FROM caom2.Observation AS o JOIN caom2.Plane AS p ON o.obsID = p.obsID
        JOIN caom2.Artifact AS a ON p.planeID = a.planeID
        WHERE o.collection = 'NEOSSAT' AND p.productID IN ('cord', 'cor')
        AND a.uri LIKE 'cadc:NEOSSAT/%.fits'
        AND 1 = CONTAINS(POINT('ICRS', {float(ra):.10f}, {float(dec):.10f}), p.position_bounds)
        ORDER BY p.time_bounds_lower DESC"""
    text = (await get_bytes(client, CADC_TAP, {"LANG": "ADQL", "REQUEST": "doQuery", "FORMAT": "csv", "QUERY": query})).decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return SourceResult("neossat", "no_coverage")
    frames = []
    for row in rows:
        name = row["uri"].removeprefix("cadc:NEOSSAT/")
        if "/" in name:
            raise SourceUnavailable("Unexpected NEOSSat artifact name.")
        url = CADC_DATA + name
        frames.append(Frame(f"NEOSSat {name}", url, await get_bytes(client, url, fits=True), mjd_to_utc(row["time_bounds_lower"])))
    return SourceResult("neossat", "ok", frames)


FETCHERS = {"spherex": spherex, "wise": wise, "dss": dss, "neossat": neossat}


async def fetch_all(client: httpx.AsyncClient, ra: float, dec: float) -> list[SourceResult]:
    async def one(survey, fetcher):
        try:
            return await asyncio.wait_for(fetcher(client, ra, dec), SOURCE_DEADLINE_S)
        except (SourceUnavailable, TimeoutError) as error:
            return SourceResult(survey, "unavailable", message=str(error) or "No response in time.")
        except Exception as error:  # malformed metadata never counts as coverage
            return SourceResult(survey, "unavailable", message=f"Unreadable {SURVEY_LABELS[survey]} response ({type(error).__name__}).")
    return list(await asyncio.gather(*(one(s, f) for s, f in FETCHERS.items())))
