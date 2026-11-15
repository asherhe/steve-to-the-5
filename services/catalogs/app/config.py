"""Runtime configuration for the catalog service.

All values are environment-overridable so no machine-specific path is baked in.
Defaults keep the service offline and deterministic.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """Service settings, resolved from the environment once at startup."""

    # When False (default) all data comes from bundled fixtures: deterministic and offline.
    live: bool
    # Directory holding the catalog fixtures. Repository-relative by default.
    fixtures_dir: Path
    # Bounds enforced on every request.
    max_radius_arcsec: float
    max_rows: int
    # Allow external name resolution (SIMBAD / Gaia) beyond bundled presets. Live only.
    external_resolve: bool
    # Upstream archives in priority order, as "NAME=url,NAME=url". Empty uses the defaults.
    gaia_tap_urls: str = ""
    simbad_tap_urls: str = ""
    # Timing shared by the Gaia and SIMBAD clients (seconds). A non-final archive attempt
    # gets `request`; the last archive being tried gets whatever is left of `total`.
    upstream_connect_timeout_s: float = 3.0
    upstream_request_timeout_s: float = 6.0
    upstream_total_timeout_s: float = 20.0
    upstream_cooldown_s: float = 180.0
    # Concurrent requests allowed per archive. There is no queue: a full archive is skipped.
    upstream_max_concurrent: int = 4

    @classmethod
    def from_env(cls) -> "Settings":
        base = Path(__file__).resolve().parent.parent  # services/catalogs
        fixtures = Path(
            os.environ.get("CATALOGS_FIXTURES_DIR", str(base / "fixtures" / "catalogs"))
        )
        return cls(
            live=_env_bool("CATALOGS_LIVE", False),
            fixtures_dir=fixtures,
            max_radius_arcsec=_env_float("CATALOGS_MAX_RADIUS_ARCSEC", 300.0),
            max_rows=_env_int("CATALOGS_MAX_ROWS", 200),
            external_resolve=_env_bool("CATALOGS_EXTERNAL_RESOLVE", False),
            gaia_tap_urls=os.environ.get("CATALOGS_GAIA_TAP_URLS", ""),
            simbad_tap_urls=os.environ.get("CATALOGS_SIMBAD_TAP_URLS", ""),
            upstream_connect_timeout_s=_env_float("CATALOGS_UPSTREAM_CONNECT_TIMEOUT_S", 3.0),
            upstream_request_timeout_s=_env_float("CATALOGS_UPSTREAM_REQUEST_TIMEOUT_S", 6.0),
            upstream_total_timeout_s=_env_float("CATALOGS_UPSTREAM_TOTAL_TIMEOUT_S", 20.0),
            upstream_cooldown_s=_env_float("CATALOGS_UPSTREAM_COOLDOWN_S", 180.0),
            upstream_max_concurrent=max(1, _env_int("CATALOGS_UPSTREAM_MAX_CONCURRENT", 4)),
        )


def get_settings() -> Settings:
    return Settings.from_env()
