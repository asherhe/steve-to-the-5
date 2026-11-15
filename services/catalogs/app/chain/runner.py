"""Build the catalog sequence and run it for one selected point.

Order (cheapest and most decisive first): Gaia DR3 → SIMBAD → CatWISE2020 →
UltracoolSheet → SkyBoT → VizieR (2MASS, AllWISE). Steps run concurrently, each under the
configured deadline; results are reported in chain order. A step that times out or fails is
"unavailable", and the verdict is then "incomplete" rather than a fabricated negative.
"""
from __future__ import annotations

import datetime as _dt
import time
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

import httpx

from app.chain.core import (
    MAX_MATCHES_PER_STEP,
    ChainCatalog,
    ChainQuery,
    StepNotConfigured,
    match_message,
    match_rows,
    verdict_for,
)
from app.chain.fixture import FixtureStep
from app.chain.live import (
    USER_AGENT,
    CatWiseStep,
    GaiaStep,
    SimbadStep,
    SkybotStep,
    UltracoolStep,
    VizierInfraredStep,
)
from app.config import Settings
from app.gaia.provider import GaiaProvider, UpstreamError
from app.models import ChainStep, CheckChainResponse

_POOL = ThreadPoolExecutor(max_workers=12, thread_name_prefix="check-chain")


def build_catalogs(settings: Settings, gaia: GaiaProvider, client: httpx.Client | None) -> list[ChainCatalog]:
    live_steps = [
        SimbadStep(client, settings.max_rows),
        CatWiseStep(client, settings.max_rows),
        UltracoolStep(settings.ultracool_csv),
        SkybotStep(client),
        VizierInfraredStep(client, settings.max_rows),
    ]
    rest = live_steps if settings.live else [FixtureStep(s, settings.fixtures_dir) for s in live_steps]
    # Gaia goes through the service's provider in both modes (fixture provider offline).
    return [GaiaStep(gaia, settings.max_rows), *rest]


def _run_step(catalog: ChainCatalog, query: ChainQuery) -> ChainStep:
    base = dict(id=catalog.id, label=catalog.label, catalog=catalog.catalog,
                reference_url=catalog.reference_url)
    if catalog.requires_observation_epoch and query.epoch_kind != "observation":
        return ChainStep(**base, status="skipped", match_count=0, matches=[],
                         message="Needs the observation time of a dated SPHEREx frame; the "
                                 "all-sky mosaic combines many dates.")
    try:
        rows = catalog.fetch(query)
    except StepNotConfigured as exc:
        return ChainStep(**base, status="not_configured", match_count=0, matches=[], message=str(exc))
    except UpstreamError as exc:
        return ChainStep(**base, status="unavailable", match_count=0, matches=[],
                         message=f"Could not be checked: {exc}")
    matches = match_rows(rows, query)
    return ChainStep(
        **base, status="match" if matches else "no_match", match_count=len(matches),
        matches=matches[:MAX_MATCHES_PER_STEP],
        message=match_message(len(matches), query.radius_arcsec, catalog.caveat),
    )


def run_chain(query: ChainQuery, catalogs: list[ChainCatalog], timeout_s: float, live: bool) -> CheckChainResponse:
    deadline = time.monotonic() + timeout_s
    futures = [(_POOL.submit(_run_step, c, query), c) for c in catalogs]
    steps: list[ChainStep] = []
    for future, catalog in futures:
        try:
            steps.append(future.result(timeout=max(0.0, deadline - time.monotonic())))
        except FutureTimeout:
            steps.append(ChainStep(
                id=catalog.id, label=catalog.label, catalog=catalog.catalog,
                reference_url=catalog.reference_url, status="unavailable", match_count=0,
                matches=[], message=f"Could not be checked: no response within {timeout_s:g} s.",
            ))
    verdict, message = verdict_for(steps)
    return CheckChainResponse(
        ra=query.ra, dec=query.dec, radius_arcsec=query.radius_arcsec,
        epoch_utc=query.epoch_utc, epoch_kind=query.epoch_kind,
        mode="live" if live else "fixture",
        checked_at_utc=_dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        verdict=verdict, verdict_message=message, steps=steps,
    )


@lru_cache(maxsize=2)
def http_client(timeout_s: float) -> httpx.Client:
    return httpx.Client(timeout=timeout_s, follow_redirects=True,
                        headers={"User-Agent": USER_AGENT})
