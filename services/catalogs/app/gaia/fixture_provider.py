"""Deterministic, offline Gaia provider backed by bundled fixtures.

This is the default provider. It lets the whole slice run and be verified without any
network access, cleanly separating synthetic fixtures from live checks.

Fixtures (fixtures/catalogs):
- nearby_known.json      one clean match near the query point
- nearby_ambiguous.json  several close sources
- nearby_unmatched.json  empty sources (valid, not an error)
- detail_*.json          source detail keyed by sourceId
- unavailable.json       marker: any query triggers a simulated upstream failure

Selection for `nearby` is by nearest-preset region so a given coordinate deterministically
maps to one of the known/ambiguous/unmatched fixtures. A sentinel RA (see _UNAVAILABLE_RA)
simulates an upstream failure for tests of that path.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from app.gaia.provider import SourceNotFound, UpstreamError
from app.models import GaiaDetail, NearbySource

# Query near this RA/Dec to deterministically simulate an upstream failure in tests.
_UNAVAILABLE_RA = 359.999
_UNAVAILABLE_DEC = 89.999

# Region centers (deg) that select a scenario fixture for `nearby`.
_SCENARIOS = [
    ("nearby_known.json", 269.4521, 4.6933),       # near Barnard's Star
    ("nearby_ambiguous.json", 133.7951, -7.2451),  # near WISE 0855 supplied position
    ("nearby_unmatched.json", 83.8221, 9.9357),    # a sparse field
]


def _strip_meta(obj):
    """Drop documentation-only keys (prefixed with "_") so fixtures validate strictly."""
    if isinstance(obj, dict):
        return {k: _strip_meta(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [_strip_meta(v) for v in obj]
    return obj


def _angular_sep_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    cos_sep = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(r1 - r2)
    cos_sep = max(-1.0, min(1.0, cos_sep))
    return math.degrees(math.acos(cos_sep))


class FixtureGaiaProvider:
    def __init__(self, fixtures_dir: Path) -> None:
        self._dir = Path(fixtures_dir)

    def _read(self, name: str) -> dict:
        return _strip_meta(json.loads((self._dir / name).read_text(encoding="utf-8")))

    def _closest_scenario(self, ra: float, dec: float) -> str:
        best_name, best_sep = _SCENARIOS[0][0], float("inf")
        for name, cra, cdec in _SCENARIOS:
            sep = _angular_sep_deg(ra, dec, cra, cdec)
            if sep < best_sep:
                best_name, best_sep = name, sep
        return best_name

    def nearby(
        self, ra: float, dec: float, radius_arcsec: float, max_rows: int
    ) -> list[NearbySource]:
        if _angular_sep_deg(ra, dec, _UNAVAILABLE_RA, _UNAVAILABLE_DEC) < 0.5:
            raise UpstreamError("Gaia catalog service is unavailable (simulated).")

        payload = self._read(self._closest_scenario(ra, dec))
        rows = [NearbySource.model_validate(row) for row in payload["sources"]]
        # Enforce the radius and row bound even on fixtures, for honest behaviour.
        rows = [r for r in rows if r.separation_arcsec <= radius_arcsec]
        rows.sort(key=lambda r: r.separation_arcsec)
        return rows[:max_rows]

    def detail(self, source_id: str) -> GaiaDetail:
        for name in ("detail_known.json", "detail_partial.json"):
            payload = self._read(name)
            if str(payload.get("sourceId")) == str(source_id):
                return GaiaDetail.model_validate(payload)
        raise SourceNotFound(f"No Gaia source with id {source_id!r} in fixtures.")
