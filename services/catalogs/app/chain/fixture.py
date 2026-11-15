"""Deterministic, offline catalog steps for the check chain (default mode).

Rows come from `chain_scenarios.json` in the fixtures directory. Like the Gaia fixture
provider, a query selects the scenario whose anchor is nearest; rows are then matched by
their real coordinates, so a click far from every anchor finds nothing. All names and
measurements are synthetic and must never be presented as real catalog entries.

A query within 0.5° of the unavailable sentinel (RA 359.999, Dec 89.999) makes every
fixture step fail, to exercise the "incomplete" verdict.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.chain.core import CatalogRow, ChainQuery, angular_sep_arcsec
from app.gaia.provider import UpstreamError

_UNAVAILABLE = (359.999, 89.999)
SCENARIO_FILE = "chain_scenarios.json"


@lru_cache(maxsize=2)
def _scenarios(path: str) -> tuple[dict, ...]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return tuple(payload["scenarios"])


class FixtureStep:
    def __init__(self, live_twin, fixtures_dir: Path) -> None:
        # Reuse the live step's identity so fixture and live responses label steps alike.
        for attr in ("id", "label", "catalog", "reference_url", "requires_observation_epoch", "caveat"):
            setattr(self, attr, getattr(live_twin, attr))
        self._path = str(Path(fixtures_dir) / SCENARIO_FILE)

    def fetch(self, query: ChainQuery) -> list[CatalogRow]:
        if angular_sep_arcsec(query.ra, query.dec, *_UNAVAILABLE) < 1800.0:
            raise UpstreamError(f"{self.label} is unavailable (simulated).")
        scenarios = _scenarios(self._path)
        nearest = min(scenarios, key=lambda s: angular_sep_arcsec(query.ra, query.dec, s["ra"], s["dec"]))
        return [
            CatalogRow(
                name=row["name"], ra=row["ra"], dec=row["dec"],
                ref_epoch=row.get("refEpoch"),
                pm_ra_cos_dec_mas_yr=row.get("pmRaCosDecMasYr"),
                pm_dec_mas_yr=row.get("pmDecMasYr"),
                detail=row.get("detail"),
            )
            for row in nearest["catalogs"].get(self.id, [])
        ]
