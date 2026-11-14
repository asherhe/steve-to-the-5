"""Provider protocol for Gaia DR3 data.

The route layer depends on this protocol, never on a specific backend. Two implementations
exist: a deterministic fixture provider (default, offline) and a live TAP provider
(opt-in). A service failure raises UpstreamError; an empty cone search returns an empty list
and is a distinct, successful outcome.
"""
from __future__ import annotations

from typing import Protocol

from app.models import GaiaDetail, NearbySource


class UpstreamError(Exception):
    """Raised when the catalog backend itself fails (network, timeout, server error).

    Distinct from an empty result: an empty cone search is not an error.
    """


class SourceNotFound(Exception):
    """Raised when a requested source ID does not exist in the catalog."""


class GaiaProvider(Protocol):
    def nearby(
        self, ra: float, dec: float, radius_arcsec: float, max_rows: int
    ) -> list[NearbySource]:
        ...

    def detail(self, source_id: str) -> GaiaDetail:
        ...
