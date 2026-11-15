"""Live Gaia DR3 provider over TAP, with archive failover and an in-memory result cache.

Opt-in (CATALOGS_LIVE=1). The same ADQL (see adql.py) is sent to an ordered list of
archives that serve the identical `gaiadr3.gaia_source` table: ESA first, then the AIP
Potsdam partner mirror. A network failure, timeout or server error moves on to the next
archive; a cone search that returns zero rows is a valid empty result, and a rejected query
is an error in its own right. Neither of those triggers a fallback.

The dataset is always Gaia DR3. Which archive answered, and when, is recorded separately in
the provenance and kept with cached results. DR3 is a frozen release, so results are cached;
the cache is in process memory only (lost on restart, and it cannot answer a field that was
never requested).

Unit mapping to the response contract:
- ra, dec            : degrees
- ref_epoch          : Julian year (Gaia DR3 = 2016.0)
- pmra               : mas/yr, already includes cos(dec) in Gaia -> pmRaCosDecMasYr
- pmdec              : mas/yr -> pmDecMasYr
- parallax           : mas -> parallaxMas
- phot_g_mean_mag    : mag -> gMag
- *_error            : same units as the measured quantity
- radial_velocity    : km/s
"""
from __future__ import annotations

import io
import math
from datetime import datetime, timezone
from typing import Callable, Sequence

from app.gaia.adql import DETAIL_COLUMN_NAMES, NEARBY_COLUMN_NAMES, detail_query, nearby_query
from app.gaia.provider import NearbyResult, SourceNotFound, UpstreamError
from app.models import GaiaDetail, NearbySource, SourceProvenance
from app.reliability import AllEndpointsDown, BoundedCache, Endpoint, EndpointDown, Failover
from app.tap_http import QueryRejected, TapResponse, tap_sync

_DATA_RELEASE = "Gaia DR3"
_CATALOG = "gaiadr3.gaia_source"
# DR3 never changes; a day bounds memory use rather than staleness.
_CACHE_TTL_S = 86_400.0

DEFAULT_GAIA_ENDPOINTS = (
    Endpoint("ESA Gaia Archive", "https://gea.esac.esa.int/tap-server/tap"),
    Endpoint("AIP Gaia mirror (Potsdam)", "https://gaia.aip.de/tap"),
)

# Human-facing pages per archive. Only ESA has a per-source page.
_ARCHIVE_PAGES = {
    "gea.esac.esa.int": ("https://gea.esac.esa.int/archive/", "https://gea.esac.esa.int/archive/?source_id={id}"),
    "gaia.aip.de": ("https://gaia.aip.de/metadata/gaiadr3/gaia_source/", "https://gaia.aip.de/metadata/gaiadr3/gaia_source/"),
}

# One cache per payload type, shared by every provider instance in the process.
nearby_cache: BoundedCache[tuple[list[NearbySource], Endpoint, str]] = BoundedCache(512)
detail_cache: BoundedCache[tuple[GaiaDetail, Endpoint, str]] = BoundedCache(512)

# A fetch returns the transport response, or bare bytes from a test double.
Fetch = Callable[[str, str, float], "TapResponse | bytes"]


def _f(value) -> float | None:
    """Coerce a possibly-masked/NaN table cell to a finite float or None."""
    try:
        if value is None:
            return None
        v = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def parse_votable(content: bytes, required_columns: Sequence[str] = (), media_type: str | None = None):
    """Return the result table after validating it.

    Raises QueryRejected for a TAP error document. Anything else that is not a VOTable
    carrying every required column raises EndpointDown, including a zero-row table with the
    wrong columns: an empty answer is only trusted when its structure is right.
    """
    from astropy.io.votable import parse  # astropy is a runtime dependency; lazy for startup

    if media_type is not None and "xml" not in media_type and "votable" not in media_type:
        raise EndpointDown(f"returned {media_type or 'no media type'} instead of a VOTable")
    try:
        votable = parse(io.BytesIO(content), verify="ignore")
        for resource in votable.resources:
            for info in resource.infos:
                if info.name == "QUERY_STATUS" and str(info.value).upper() == "ERROR":
                    raise QueryRejected(str(info.content or "query error").strip()[:200])
        table = votable.get_first_table().to_table(use_names_over_ids=True)
    except QueryRejected:
        raise
    except Exception as exc:
        raise EndpointDown("returned an unreadable table") from exc
    missing = [name for name in required_columns if name not in table.colnames]
    if missing:
        raise EndpointDown(f"returned a table without {', '.join(missing)}")
    return table


def _pages(endpoint: Endpoint, source_id: int | None) -> tuple[str, str | None]:
    for host, (table_url, detail_url) in _ARCHIVE_PAGES.items():
        if host in endpoint.url:
            return table_url, detail_url.format(id=source_id) if source_id is not None else None
    return endpoint.url, None


def _provenance(endpoint: Endpoint, retrieved_at_utc: str, from_cache: bool, source_id: int | None = None) -> SourceProvenance:
    table_url, detail_url = _pages(endpoint, source_id)
    return SourceProvenance(
        catalog=_CATALOG,
        data_release=_DATA_RELEASE,
        source_table_url=table_url,
        source_detail_url=detail_url,
        served_by=endpoint.name,
        retrieved_at_utc=retrieved_at_utc,
        from_cache=from_cache,
    )


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class TapGaiaProvider:
    def __init__(
        self,
        endpoints: Sequence[Endpoint] = DEFAULT_GAIA_ENDPOINTS,
        failover: Failover | None = None,
        max_rows: int = 200,
        fetch: Fetch | None = None,
    ) -> None:
        self._endpoints = tuple(endpoints)
        self._failover = failover or Failover(6.0, 20.0, 180.0)
        self._max_rows = max_rows
        self._fetch = fetch or (
            lambda url, adql, deadline: tap_sync(url, adql, deadline, "votable", self._failover.connect_timeout_s)
        )

    def _run(self, adql: str, required_columns: Sequence[str], probe: bool):
        """Return (endpoint, validated table) from the first archive that answers."""

        def call(endpoint: Endpoint, deadline_s: float):
            response = self._fetch(endpoint.url, adql, deadline_s)
            if isinstance(response, TapResponse):
                return parse_votable(response.content, required_columns, response.media_type)
            return parse_votable(response, required_columns)

        try:
            return self._failover.run(self._endpoints, call, probe=probe)
        except AllEndpointsDown as exc:
            if exc.busy:
                raise UpstreamError("The Gaia archives are busy with other requests. Try again in a moment.") from exc
            raise UpstreamError(f"No Gaia archive responded ({exc}).") from exc
        except QueryRejected as exc:
            raise UpstreamError(f"The Gaia archive rejected the query: {exc}") from exc

    def nearby(
        self, ra: float, dec: float, radius_arcsec: float, max_rows: int, probe: bool = False
    ) -> list[NearbySource]:
        key = (_DATA_RELEASE, ra, dec, radius_arcsec, max_rows)
        cached = nearby_cache.get(key)
        if cached is not None:
            rows, endpoint, retrieved = cached
            return NearbyResult([row.model_copy() for row in rows], _provenance(endpoint, retrieved, True))

        endpoint, table = self._run(nearby_query(ra, dec, radius_arcsec / 3600.0, max_rows), NEARBY_COLUMN_NAMES, probe)
        sources: list[NearbySource] = []
        for row in table:
            sep_deg = _f(row["sep_deg"]) or 0.0
            sources.append(
                NearbySource(
                    source_id=str(row["source_id"]),
                    ra=float(row["ra"]),
                    dec=float(row["dec"]),
                    ref_epoch=float(row["ref_epoch"]),
                    pm_ra_cos_dec_mas_yr=_f(row["pmra"]),
                    pm_dec_mas_yr=_f(row["pmdec"]),
                    parallax_mas=_f(row["parallax"]),
                    g_mag=_f(row["phot_g_mean_mag"]),
                    separation_arcsec=sep_deg * 3600.0,
                )
            )
        retrieved = _now_utc()
        # An empty list here is a real answer from an archive, so it is cached like any other.
        nearby_cache.put(key, (sources, endpoint, retrieved), _CACHE_TTL_S)
        return NearbyResult([row.model_copy() for row in sources], _provenance(endpoint, retrieved, False))

    def detail(self, source_id: str, probe: bool = False) -> GaiaDetail:
        try:
            sid_int = int(source_id)
        except ValueError as exc:
            raise SourceNotFound(f"Not a Gaia source id: {source_id!r}.") from exc
        key = (_DATA_RELEASE, sid_int)
        cached = detail_cache.get(key)
        if cached is not None:
            detail, endpoint, retrieved = cached
            return detail.model_copy(update={"provenance": _provenance(endpoint, retrieved, True, sid_int)})

        endpoint, table = self._run(detail_query(sid_int), DETAIL_COLUMN_NAMES, probe)
        if len(table) == 0:
            raise SourceNotFound(f"No Gaia source with id {source_id!r}.")
        row = table[0]
        retrieved = _now_utc()
        detail = GaiaDetail(
            source_id=str(row["source_id"]),
            ra=float(row["ra"]),
            dec=float(row["dec"]),
            ref_epoch=float(row["ref_epoch"]),
            pm_ra_cos_dec_mas_yr=_f(row["pmra"]),
            pm_dec_mas_yr=_f(row["pmdec"]),
            parallax_mas=_f(row["parallax"]),
            g_mag=_f(row["phot_g_mean_mag"]),
            ra_error_mas=_f(row["ra_error"]),
            dec_error_mas=_f(row["dec_error"]),
            pm_ra_cos_dec_error_mas_yr=_f(row["pmra_error"]),
            pm_dec_error_mas_yr=_f(row["pmdec_error"]),
            parallax_error_mas=_f(row["parallax_error"]),
            radial_velocity_km_s=_f(row["radial_velocity"]),
            radial_velocity_error_km_s=_f(row["radial_velocity_error"]),
            bp_mag=_f(row["phot_bp_mean_mag"]),
            rp_mag=_f(row["phot_rp_mean_mag"]),
            provenance=_provenance(endpoint, retrieved, False, sid_int),
        )
        detail_cache.put(key, (detail, endpoint, retrieved), _CACHE_TTL_S)
        return detail
