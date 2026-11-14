"""Bundled target presets for name resolution.

Independent of any external name lookup (contract requirement). Covers the five challenge
targets plus common aliases. Coordinates are ICRS decimal degrees. WISE 0855's position is
the one supplied by the challenge brief (08h55m10.831s, -07d14m42.53s).
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.config import Settings


def _normalize_key(name: str) -> str:
    return " ".join(name.strip().lower().split())


@lru_cache(maxsize=4)
def _load(fixtures_dir_str: str) -> dict[str, dict]:
    path = Path(fixtures_dir_str) / "presets.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    index: dict[str, dict] = {}
    for entry in data["presets"]:
        canonical = {"name": entry["name"], "ra": entry["ra"], "dec": entry["dec"]}
        for alias in [entry["name"], *entry.get("aliases", [])]:
            index[_normalize_key(alias)] = canonical
    return index


def resolve_preset(name: str, settings: Settings) -> dict | None:
    """Return {name, ra, dec} for a known preset/alias, else None."""
    index = _load(str(settings.fixtures_dir))
    return index.get(_normalize_key(name))
