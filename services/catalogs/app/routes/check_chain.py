"""GET /api/catalogs/check-chain?ra&dec&radiusArcsec[&epochUtc&epochKind] -> CheckChainResponse.

Checks one user-confirmed sky point against the catalog chain (see app/chain/runner.py).
`epochUtc` is the time the point was observed: with epochKind=observation (a dated SPHEREx
frame) it enables proper-motion propagation and the known-asteroid step; with
epochKind=approximate (the undated all-sky mosaic) it only propagates catalog positions.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query, Response

from app.astrometry.propagate import iso_to_decimal_year
from app.chain.core import ChainQuery
from app.chain.runner import build_catalogs, http_client, run_chain
from app.config import get_settings
from app.deps import get_provider
from app.errors import invalid_request
from app.models import CheckChainResponse, ErrorBody
from app.validation import validate_dec, validate_ra, validate_radius_arcsec

router = APIRouter()


@router.get(
    "/api/catalogs/check-chain",
    response_model=CheckChainResponse,
    responses={400: {"model": ErrorBody}},
)
def check_chain(
    response: Response,
    ra: float = Query(...),
    dec: float = Query(...),
    radius_arcsec: float = Query(10.0, alias="radiusArcsec"),
    epoch_utc: str | None = Query(None, alias="epochUtc", max_length=64),
    epoch_kind: Literal["observation", "approximate"] | None = Query(None, alias="epochKind"),
) -> CheckChainResponse:
    settings = get_settings()
    ra = validate_ra(ra)
    dec = validate_dec(dec)
    radius_arcsec = validate_radius_arcsec(radius_arcsec, settings.chain_max_radius_arcsec)
    epoch_year = None
    if epoch_utc is not None:
        try:
            epoch_year = iso_to_decimal_year(epoch_utc)
        except ValueError as exc:
            raise invalid_request("epochUtc must be a UTC ISO-8601 timestamp.") from exc
        if not 1990.0 <= epoch_year <= 2100.0:
            raise invalid_request("epochUtc must fall between 1990 and 2100.")
        epoch_kind = epoch_kind or "observation"
    elif epoch_kind is not None:
        raise invalid_request("epochKind requires epochUtc.")

    query = ChainQuery(
        ra=ra, dec=dec, radius_arcsec=radius_arcsec,
        motion_pad_arcsec=settings.chain_motion_pad_arcsec,
        epoch_utc=epoch_utc, epoch_year=epoch_year, epoch_kind=epoch_kind,
    )
    client = http_client(settings.chain_timeout_s) if settings.live else None
    catalogs = build_catalogs(settings, get_provider(settings), client)
    response.headers["X-SPHEREx-Catalog-Mode"] = "live" if settings.live else "fixture"
    return run_chain(query, catalogs, settings.chain_timeout_s, settings.live)
