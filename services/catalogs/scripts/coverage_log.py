"""Produce the catalog-slice coverage log for the five challenge targets.

Scope: this log records what the CATALOG service can honestly demonstrate for each target,
namely name resolution to a position and a bounded Gaia DR3 cone search (offline fixtures by
default, live when CATALOGS_LIVE=1). It is NOT the archive imaging coverage log, which task 1
owns. Run from the service directory:

    python scripts/coverage_log.py            # offline (fixtures)
    CATALOGS_LIVE=1 python scripts/coverage_log.py   # live Gaia TAP

Writes docs/coverage-log.json and prints a short table.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.deps import get_provider  # noqa: E402
from app.gaia.provider import UpstreamError  # noqa: E402
from app.presets import resolve_preset  # noqa: E402

TARGETS = [
    "Barnard's Star",
    "Epsilon Indi B",
    "WISE 0855-0714",
    "RW Aurigae",
    "R Draconis",
]


def main() -> int:
    settings = get_settings()
    provider = get_provider(settings)
    mode = "live-gaia-tap" if settings.live else "offline-fixtures"
    rows = []
    for name in TARGETS:
        preset = resolve_preset(name, settings)
        if preset is None:
            rows.append({"target": name, "resolved": False, "outcome": "resolve_failed"})
            continue
        ra, dec = preset["ra"], preset["dec"]
        try:
            sources = provider.nearby(ra, dec, 30.0, settings.max_rows)
            if len(sources) == 0:
                outcome = "no_source_in_radius"
            elif len(sources) == 1:
                outcome = "single_match"
            else:
                outcome = f"ambiguous_{len(sources)}_sources"
            rows.append(
                {
                    "target": name,
                    "resolved": True,
                    "ra": ra,
                    "dec": dec,
                    "nearbyCount": len(sources),
                    "outcome": outcome,
                }
            )
        except UpstreamError as exc:
            rows.append(
                {
                    "target": name,
                    "resolved": True,
                    "ra": ra,
                    "dec": dec,
                    "outcome": "upstream_unavailable",
                    "detail": str(exc),
                }
            )

    log = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "note": (
            "Catalog-slice coverage only (name resolution + Gaia DR3 cone search). "
            "Not the SPHEREx imaging coverage log (task 1). Offline rows use synthetic "
            "fixtures and are labelled accordingly by the mode field."
        ),
        "targets": rows,
    }
    out = _SERVICE_ROOT / "docs" / "coverage-log.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(log, indent=2) + "\n", encoding="utf-8")

    print(f"mode: {mode}")
    for r in rows:
        print(f"  {r['target']:<20} {r.get('outcome', 'n/a')}")
    print(f"written: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
