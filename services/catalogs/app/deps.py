"""Dependency wiring: select the Gaia provider based on settings.

Routes depend on `get_provider`; tests can override it on the FastAPI app.
"""
from __future__ import annotations

from functools import lru_cache

from app.config import Settings, get_settings
from app.gaia.fixture_provider import FixtureGaiaProvider
from app.gaia.provider import GaiaProvider


@lru_cache(maxsize=4)
def _build_provider(live: bool, fixtures_dir: str, timeout_s: float, max_rows: int) -> GaiaProvider:
    if live:
        from app.gaia.tap import TapGaiaProvider

        return TapGaiaProvider(timeout_s=timeout_s, max_rows=max_rows)
    return FixtureGaiaProvider(fixtures_dir)


def get_provider(settings: Settings | None = None) -> GaiaProvider:
    s = settings or get_settings()
    return _build_provider(s.live, str(s.fixtures_dir), s.tap_timeout_s, s.max_rows)
