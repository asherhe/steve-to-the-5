"""SIMBAD name lookup over TAP, with a mirror fallback.

Strasbourg (CDS) is authoritative and tried first; the Harvard (CfA) mirror is a dated
snapshot, so a recent identifier can be missing there. The server that answered is always
returned so callers can record it and word a miss correctly.

SIMBAD's `ident.id` comparison is normalised by the server (case and spacing), so a typed
name such as "vega" or "m31" matches without a wildcard. Only exact identifier matches are
used: nothing here associates an object by position.
"""
from __future__ import annotations

import csv
import io
import math
from typing import Callable, Sequence

from app.reliability import Endpoint, EndpointDown, Failover
from app.tap_http import TapResponse, tap_sync

DEFAULT_SIMBAD_ENDPOINTS = (
    Endpoint("SIMBAD (CDS Strasbourg)", "https://simbad.cds.unistra.fr/simbad/sim-tap"),
    Endpoint("SIMBAD mirror (CfA Harvard)", "https://simbad.harvard.edu/simbad/sim-tap"),
)
# Human-facing object page. Always the current CDS address, whichever server answered.
SIMBAD_OBJECT_URL = "https://simbad.cds.unistra.fr/simbad/sim-id?Ident="

# A fetch returns the transport response, or bare bytes from a test double.
Fetch = Callable[[str, str, float], "TapResponse | bytes"]
_COLUMNS = ["oid", "main_id", "ra", "dec", "id"]


class SimbadObject:
    """One resolved object: SIMBAD's main identifier, ICRS position and every identifier."""

    def __init__(self, main_id: str, ra: float, dec: float, identifiers: list[str]) -> None:
        self.main_id = main_id
        self.ra = ra
        self.dec = dec
        self.identifiers = identifiers


class SimbadAmbiguous(Exception):
    """The identifier matched more than one object."""


class SimbadInvalid(Exception):
    """SIMBAD answered with a row that cannot be used (for example no position)."""


def _clean(identifier: str) -> str:
    return " ".join(identifier.split())


def identifier_query(name: str) -> str:
    """ADQL for every identifier of the object matching `name` exactly. Quotes are doubled."""
    literal = name.replace("'", "''")
    return (
        "SELECT b.oid, b.main_id, b.ra, b.dec, i2.id "
        "FROM ident AS i JOIN basic AS b ON b.oid = i.oidref "
        "JOIN ident AS i2 ON i2.oidref = b.oid "
        f"WHERE i.id = '{literal}'"
    )


def parse_rows(content: bytes, media_type: str | None = None) -> SimbadObject | None:
    """Parse a SIMBAD CSV table. None means a well-formed table with no rows.

    The table is validated before it is trusted: a missing or wrong header, an empty body, a
    non-CSV media type or a row with the wrong number of fields is an unusable response
    (`EndpointDown`), never "no such object". Only a correct header followed by zero rows
    is a real miss.
    """
    if media_type is not None and "csv" not in media_type:
        raise EndpointDown(f"returned {media_type or 'no media type'} instead of CSV")
    try:
        table = list(csv.reader(io.StringIO(content.decode("utf-8"))))
    except (UnicodeDecodeError, csv.Error) as exc:
        raise EndpointDown("returned an unreadable table") from exc
    if not table or [column.strip() for column in table[0]] != _COLUMNS:
        raise EndpointDown("returned an empty or unexpected table")
    if any(len(row) != len(_COLUMNS) or not row[0].strip() or not row[1].strip() for row in table[1:]):
        raise EndpointDown("returned a truncated table")
    rows = [dict(zip(_COLUMNS, row)) for row in table[1:]]
    if not rows:
        return None
    if len({row["oid"] for row in rows}) > 1:
        raise SimbadAmbiguous()
    first = rows[0]
    try:
        ra, dec = float(first["ra"]), float(first["dec"])
    except (TypeError, ValueError) as exc:
        raise SimbadInvalid("no position") from exc
    main_id = _clean(first["main_id"])
    if not main_id or not math.isfinite(ra) or not math.isfinite(dec) or not 0 <= ra < 360 or not -90 <= dec <= 90:
        raise SimbadInvalid("invalid position or identifier")
    identifiers = sorted({_clean(row["id"]) for row in rows if row["id"].strip()}, key=str.casefold)
    return SimbadObject(main_id, ra, dec, identifiers)


def lookup(
    name: str,
    endpoints: Sequence[Endpoint],
    failover: Failover,
    *,
    probe: bool = False,
    fetch: Fetch | None = None,
) -> tuple[Endpoint, SimbadObject | None]:
    """Return (answering server, object or None). Raises AllEndpointsDown when none answer."""
    run = fetch or (lambda url, adql, deadline: tap_sync(url, adql, deadline, "csv", failover.connect_timeout_s))
    adql = identifier_query(name)

    def call(endpoint: Endpoint, deadline_s: float) -> SimbadObject | None:
        response = run(endpoint.url, adql, deadline_s)
        if isinstance(response, TapResponse):
            return parse_rows(response.content, response.media_type)
        return parse_rows(response)

    return failover.run(endpoints, call, probe=probe)


def common_name(identifiers: Sequence[str], query: str) -> str | None:
    """Pick the display name from SIMBAD's recognised "NAME ..." identifiers.

    Deterministic: the one the user typed if present, otherwise the shortest, with a
    case-insensitive alphabetical tie-break. Returns None when SIMBAD lists no name; a
    name is never invented from a catalogue designation.
    """
    names = [identifier[5:].strip() for identifier in identifiers if identifier.startswith("NAME ")]
    names = [name for name in names if name]
    if not names:
        return None
    typed = _clean(query).casefold()
    for name in names:
        if name.casefold() == typed:
            return name
    return min(names, key=lambda name: (len(name), name.casefold(), name))
