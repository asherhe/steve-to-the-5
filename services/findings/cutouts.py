"""Fetch image cutouts at one sky point from four surveys, for the brightness rule.

Each survey answers independently with up to MAX_FRAMES FITS images (48 for SPHEREx),
an explicit "no_coverage", or "unavailable" when its archive fails. Nothing here decides
brightness; `brightness.measure` does, on the returned bytes.

- SPHEREx: IRSA SIA (DR1/QR3), then a bounded detector-balanced sample of L2 images
  (IMAGE/VARIANCE/FLAGS, MJy/sr), as the archive service requests them.
- WISE: IRSA IBE AllWISE Atlas W2 (4.6 um) coadd covering the point, cutout in DN.
- DSS: STScI DSS cutout service, POSS-II/UKST red plates, with a TAN WCS.
- NEOSSat: CADC CAOM2 calibrated ("cor"/"cord") FITS whose footprint contains the point.
  Raw NEOSSat frames carry no WCS and are not used.
"""
from __future__ import annotations

import asyncio
import csv
import gzip
import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

MAX_FRAMES = 2
MAX_SPECTRAL_FRAMES = 48
MAX_SPECTRAL_BYTES = 64_000_000
CUTOUT_ARCSEC = 120
SPHEREX_CUTOUT_ARCSEC = 180  # full 49.6-arcsec background ring plus native-pixel rounding margin
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
    observed_until_utc: str | None = None
    observation_id: str | None = None
    release: str | None = None


@dataclass
class SourceResult:
    survey: str
    status: str  # "ok", "no_coverage" or "unavailable"
    frames: list[Frame] = field(default_factory=list)
    message: str | None = None
    discovery: dict = field(default_factory=dict)


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
        status = f" {error.response.status_code}" if isinstance(error, httpx.HTTPStatusError) else ""
        raise SourceUnavailable(f"{type(error).__name__}{status} from {httpx.URL(url).host}") from error
    if fits and content[:2] == b"\x1f\x8b":
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(content)) as compressed:
                content = compressed.read(MAX_BYTES + 1)
        except (OSError, EOFError) as error:
            raise SourceUnavailable("Unreadable compressed FITS image.") from error
        if len(content) > MAX_BYTES:
            raise SourceUnavailable("Expanded FITS exceeded the size limit.")
    if fits and not bytes(content[:6]) == b"SIMPLE":
        raise SourceUnavailable(f"{httpx.URL(url).host} did not return a FITS image.")
    return bytes(content)


async def spherex(client, ra, dec) -> SourceResult:
    from astropy.io.votable import parse
    from astropy.table import vstack
    async def discover(release):
        params = {"COLLECTION": f"spherex_{release}", "POS": f"CIRCLE {ra} {dec} 0.0005", "MAXREC": 2000}
        content = await get_bytes(client, f"{IRSA}/SIA", params)
        document = parse(io.BytesIO(content))
        statuses = {str(info.value).upper() for resource in document.resources for info in resource.infos if info.name == "QUERY_STATUS"}
        if "ERROR" in statuses:
            raise SourceUnavailable("SPHEREx discovery was rejected by the archive.")
        tables = list(document.iter_tables())
        if not tables:
            raise SourceUnavailable("SPHEREx returned no discovery table.")
        return tables[0].to_table(use_names_over_ids=True), "OVERFLOW" in statuses, {"params": params, "responseSha256": hashlib.sha256(content).hexdigest()}
    discoveries = await asyncio.gather(*(discover(release) for release in ("dr1", "qr3")), return_exceptions=True)
    available = [d for d in discoveries if not isinstance(d, Exception)]
    if not available:
        details = "; ".join(f"{release}: {type(error).__name__}" + (f" ({error})" if isinstance(error, SourceUnavailable) else "")
                            for release, error in zip(("dr1", "qr3"), discoveries))
        raise SourceUnavailable(f"SPHEREx discovery unavailable. {details}")
    limited = any(d[1] for d in available) or len(available) < 2
    table = vstack([d[0] for d in available])
    record = {"queries": [d[2] for d in available], "incomplete": limited, "maxFrames": MAX_SPECTRAL_FRAMES,
              "maxTotalBytes": MAX_SPECTRAL_BYTES, "cutoutArcsec": SPHEREX_CUTOUT_ARCSEC,
              "selection": "newest within each detector; round-robin detectors; unique source URLs"}
    # Round-robin across detectors, newest first within each. Do not mistake the
    # detector-wide em_min/em_max for the wavelength at the requested position.
    groups = {}
    seen = set()
    for row in sorted(table, key=lambda row: (-float(row["t_min"]), str(row["access_url"]))):
        url = str(row["access_url"])
        if url in seen:
            continue
        seen.add(url)
        groups.setdefault(str(row["energy_bandpassname"]), []).append(row)
    rows = []
    while any(groups.values()) and len(rows) < MAX_SPECTRAL_FRAMES:
        for name in sorted(groups):
            if groups[name] and len(rows) < MAX_SPECTRAL_FRAMES:
                rows.append(groups[name].pop(0))
    if not rows:
        if limited:
            raise SourceUnavailable("SPHEREx returned an empty, incomplete discovery result.")
        return SourceResult("spherex", "no_coverage")
    frames = []
    failures = []
    remaining = MAX_SPECTRAL_BYTES
    slots = asyncio.Semaphore(4)
    async def fetch(row):
        nonlocal remaining
        url = str(row["access_url"])
        if not url.startswith(f"{IRSA}/ibe/data/spherex/"):
            raise SourceUnavailable("Unexpected SPHEREx image URL.")
        query = urlencode({"center": f"{ra},{dec}", "size": f"{SPHEREX_CUTOUT_ARCSEC / 3600}"})
        async with slots:
            if remaining <= 0:
                raise SourceUnavailable("SPHEREx total cutout byte budget reached.")
            content = await get_bytes(client, f"{url}?{query}", fits=True)
            remaining -= len(content)
            if remaining < 0:
                raise SourceUnavailable("SPHEREx total cutout byte budget reached.")
            return Frame(f"SPHEREx {row['energy_bandpassname']}", url, content, mjd_to_utc(row["t_min"]),
                         mjd_to_utc(row["t_max"]) if "t_max" in table.colnames else None,
                         str(row["obs_id"]) if "obs_id" in table.colnames else None,
                         "dr1" if "/dr1/" in url else "qr3")
    for value in await asyncio.gather(*(fetch(row) for row in rows), return_exceptions=True):
        if isinstance(value, Exception):
            failures.append(type(value).__name__)
        else:
            frames.append(value)
    return SourceResult("spherex", "ok" if frames else "unavailable", frames, message=(
        f"Measured {len(frames)} of {len(rows)} selected images from {len(table)} discovery rows"
        f"{' (discovery incomplete/capped)' if limited else ''}; {len(failures)} downloads failed. This is not an exhaustive image search."),
        discovery={**record, "selectedUrls": [str(r["access_url"]) for r in rows], "downloadFailures": len(failures)})


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
        AND (a.uri LIKE 'cadc:NEOSSAT/%.fits' OR a.uri LIKE 'cadc:NEOSSAT/%.fits.gz')
        AND 1 = CONTAINS(POINT('ICRS', {float(ra):.10f}, {float(dec):.10f}), p.position_bounds)
        ORDER BY p.time_bounds_lower DESC"""
    text = (await get_bytes(client, CADC_TAP, {"LANG": "ADQL", "REQUEST": "doQuery", "FORMAT": "csv", "QUERY": query})).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), strict=True)
    if not {"uri", "time_bounds_lower"}.issubset(reader.fieldnames or []):
        raise SourceUnavailable("Unexpected NEOSSat metadata columns.")
    rows = list(reader)
    if len(rows) > MAX_FRAMES:
        raise SourceUnavailable("NEOSSat row limit exceeded.")
    if not rows:
        return SourceResult("neossat", "no_coverage")
    frames = []
    for row in rows:
        uri = row.get("uri") or ""
        name = uri.removeprefix("cadc:NEOSSAT/")
        if not re.fullmatch(r"cadc:NEOSSAT/[A-Za-z0-9][A-Za-z0-9_.-]*\.fits(?:\.gz)?", uri):
            raise SourceUnavailable("Unexpected NEOSSat artifact name.")
        url = CADC_DATA + name
        frames.append(Frame(f"NEOSSat {name}", url, await get_bytes(client, url, fits=True), mjd_to_utc(row["time_bounds_lower"])))
    return SourceResult("neossat", "ok", frames)


FETCHERS = {"spherex": spherex, "wise": wise, "dss": dss, "neossat": neossat}


async def fetch_all(client: httpx.AsyncClient, ra: float, dec: float) -> list[SourceResult]:
    async def one(survey, fetcher):
        try:
            return await asyncio.wait_for(fetcher(client, ra, dec), 120 if survey == "spherex" else SOURCE_DEADLINE_S)
        except (SourceUnavailable, TimeoutError) as error:
            return SourceResult(survey, "unavailable", message=str(error) or "No response in time.")
        except Exception as error:  # malformed metadata never counts as coverage
            return SourceResult(survey, "unavailable", message=f"Unreadable {SURVEY_LABELS[survey]} response ({type(error).__name__}).")
    return list(await asyncio.gather(*(one(s, f) for s, f in FETCHERS.items())))
