"""Dependency wiring: select the Gaia provider based on settings.

Routes depend on `get_provider`; tests can override it on the FastAPI app.
"""
from __future__ import annotations

from functools import lru_cache

from app.config import Settings, get_settings
from app.gaia.fixture_provider import FixtureGaiaProvider
from app.gaia.provider import GaiaProvider
from app.reliability import Failover, parse_endpoints


@lru_cache(maxsize=4)
def get_failover(
    request_timeout_s: float,
    total_timeout_s: float,
    cooldown_s: float,
    connect_timeout_s: float = 3.0,
    max_concurrent: int = 4,
) -> Failover:
    """One failover state per timing configuration, shared by the Gaia and SIMBAD clients.

    Cooldowns and capacity are tracked per endpoint URL, so sharing the instance does not
    couple the two services; it only keeps one deadline and cooldown discipline.
    """
    return Failover(request_timeout_s, total_timeout_s, cooldown_s, connect_timeout_s, max_concurrent)


def failover_for(settings: Settings) -> Failover:
    return get_failover(
        settings.upstream_request_timeout_s, settings.upstream_total_timeout_s, settings.upstream_cooldown_s,
        settings.upstream_connect_timeout_s, settings.upstream_max_concurrent,
    )


@lru_cache(maxsize=4)
def _build_provider(live: bool, fixtures_dir: str, max_rows: int, gaia_tap_urls: str, failover: Failover | None = None) -> GaiaProvider:
    if live:
        from app.gaia.tap import DEFAULT_GAIA_ENDPOINTS, TapGaiaProvider

        return TapGaiaProvider(
            endpoints=parse_endpoints(gaia_tap_urls, DEFAULT_GAIA_ENDPOINTS),
            failover=failover,
            max_rows=max_rows,
        )
    return FixtureGaiaProvider(fixtures_dir)


def get_provider(settings: Settings | None = None) -> GaiaProvider:
    s = settings or get_settings()
    return _build_provider(s.live, str(s.fixtures_dir), s.max_rows, s.gaia_tap_urls, failover_for(s) if s.live else None)
