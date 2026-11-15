"""Shared pieces of the check chain: query, catalog rows, motion-aware matching, verdict.

Every catalog step turns its upstream rows into `CatalogRow`s and calls `match_rows`, so
separation, proper-motion propagation and ordering are computed one way for all catalogs.

A position is matched at the query epoch when the row has proper motion and the query has
an epoch: the catalog position is propagated (labelled `positionPredicted`). Otherwise the
catalog position is used as published. Fast movers without catalog proper motion can be
missed; steps say so in their message rather than implying the sky is empty.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

from app.astrometry.propagate import propagate
from app.models import ChainMatch, ChainStep, ChainVerdict, EpochKind

MAX_MATCHES_PER_STEP = 5


@dataclass(frozen=True)
class ChainQuery:
    ra: float
    dec: float
    radius_arcsec: float
    # Extra search radius for catalogs with proper motion, so a source that has moved
    # since the catalog epoch is still fetched before propagation.
    motion_pad_arcsec: float
    epoch_utc: str | None
    epoch_year: float | None
    epoch_kind: EpochKind | None

    @property
    def search_radius_arcsec(self) -> float:
        return self.radius_arcsec + (self.motion_pad_arcsec if self.epoch_year else 0.0)


@dataclass(frozen=True)
class CatalogRow:
    name: str
    ra: float
    dec: float
    ref_epoch: float | None = None
    pm_ra_cos_dec_mas_yr: float | None = None
    pm_dec_mas_yr: float | None = None
    detail: str | None = None
    url: str | None = None


class StepNotConfigured(Exception):
    """The step needs local configuration (e.g. a catalog snapshot) that is absent."""


class ChainCatalog(Protocol):
    """One catalog in the chain. Implementations only fetch rows; the runner matches them.

    `fetch` returns rows around the query (within `query.search_radius_arcsec` when the
    catalog has proper motion, else `query.radius_arcsec`), or raises UpstreamError when
    the service fails, or StepNotConfigured when local configuration is missing.
    """

    id: str
    label: str
    catalog: str
    reference_url: str | None
    # True when the step is only meaningful at an actual observation time (moving objects).
    requires_observation_epoch: bool
    # A standing caveat appended to the step message (e.g. epoch without proper motion).
    caveat: str | None

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        ...


def angular_sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    # Haversine: stable for the small separations this service deals with.
    a = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600.0


def match_rows(rows: list[CatalogRow], query: ChainQuery) -> list[ChainMatch]:
    matches: list[ChainMatch] = []
    for row in rows:
        ra, dec, predicted = row.ra, row.dec, False
        has_motion = row.pm_ra_cos_dec_mas_yr is not None or row.pm_dec_mas_yr is not None
        if query.epoch_year is not None and row.ref_epoch is not None and has_motion:
            moved = propagate(
                row.ra, row.dec, row.ref_epoch, query.epoch_year,
                row.pm_ra_cos_dec_mas_yr, row.pm_dec_mas_yr,
            )
            ra, dec, predicted = moved.ra, moved.dec, True
        sep = angular_sep_arcsec(query.ra, query.dec, ra, dec)
        if sep <= query.radius_arcsec:
            matches.append(ChainMatch(
                name=row.name, ra=ra, dec=dec, separation_arcsec=round(sep, 3),
                position_predicted=predicted, detail=row.detail, url=row.url,
            ))
    matches.sort(key=lambda m: m.separation_arcsec)
    return matches


def match_message(count: int, radius: float, note: str | None) -> str:
    base = (
        f"{count} source{'s' if count != 1 else ''} within {radius:g}″."
        if count
        else f"No source within {radius:g}″."
    )
    return f"{base} {note}" if note else base


def verdict_for(steps: list[ChainStep]) -> tuple[ChainVerdict, str]:
    matched = [s.label for s in steps if s.status == "match"]
    if matched:
        return "catalogued", (
            "Already catalogued: " + ", ".join(matched)
            + (" lists" if len(matched) == 1 else " list")
            + " a source at this position. Not a new object."
        )
    unchecked = [s.label for s in steps if s.status != "no_match"]
    if unchecked:
        return "incomplete", (
            "No match so far, but not every catalog was checked ("
            + ", ".join(unchecked)
            + "). This is not evidence that the source is uncatalogued."
        )
    return "uncatalogued_candidate", (
        "No catalog in the chain explains this position. That makes it an uncatalogued "
        "candidate worth a closer look, not a confirmed discovery: rule out image artifacts, "
        "check other epochs, and look for it in the literature."
    )
