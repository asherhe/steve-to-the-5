"""Versioned challenge identities. Coordinates are field centers, never identity matches."""
from __future__ import annotations
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from app.config import Settings
from app.errors import ApiError
from app.models import ObjectIdentity


def normalize_name(name: str) -> str:
    value = unicodedata.normalize("NFKC", name).translate(str.maketrans({"’": "'", "‘": "'", "−": "-", "–": "-", "—": "-"}))
    value = " ".join(value.strip().lower().split())
    value = re.sub(r"^ε(?=\s|$)", "epsilon", value)
    return re.sub(r"^(gj|hip)(?=\d)", r"\1 ", value)


def validate_name(name: str) -> None:
    if not name.strip() or len(name) > 256 or any(ord(c) < 32 for c in name):
        raise ApiError("invalid_request", "Enter a name of 1–256 characters without control characters.", 400)
    # B/b and Ba/Bb can denote different objects. Never silently fold these scopes.
    key = normalize_name(name)
    if key in {"epsilon indi", "epsilon ind", "eps indi", "eps ind", "epsilon indi b", "epsilon ind b", "eps indi b", "eps ind b"}:
        if key.endswith(" b") and name.strip().endswith("B"):
            return
        raise ApiError("ambiguous_name", "Choose Epsilon Indi B (the Ba/Bb brown-dwarf pair), or enter an explicit component designation. A, Ba, Bb and planet designations are distinct.", 409)


@lru_cache(maxsize=4)
def naming_version(directory: str) -> str:
    return json.loads((Path(directory) / "presets.json").read_text(encoding="utf-8"))["version"]


@lru_cache(maxsize=4)
def load_presets(directory: str) -> list[dict]:
    entries = json.loads((Path(directory) / "presets.json").read_text(encoding="utf-8"))["presets"]
    seen = {}
    for entry in entries:
        ObjectIdentity.model_validate(entry["identity"])
        for alias in [entry["name"], entry["identity"]["displayName"], entry["identity"]["canonicalDesignation"], *entry["aliases"]]:
            key = normalize_name(alias)
            if key in seen and seen[key] != entry["identity"]["objectId"]:
                raise ValueError(f"Naming alias collision: {alias}")
            seen[key] = entry["identity"]["objectId"]
    return entries


def resolve_preset(name: str, settings: Settings) -> dict | None:
    validate_name(name)
    key = normalize_name(name)
    for entry in load_presets(str(settings.fixtures_dir)):
        if any(normalize_name(alias) == key for alias in [entry["name"], entry["identity"]["displayName"], entry["identity"]["canonicalDesignation"], *entry["aliases"]]):
            return {k: entry[k] for k in ("name", "ra", "dec", "identity", "positionProvenance")}
    return None


def partial_preset_names(name: str, settings: Settings) -> list[str]:
    key = normalize_name(name)
    if len(key) < 2:
        return []
    return [entry["identity"]["displayName"] for entry in load_presets(str(settings.fixtures_dir))
            if any(key in normalize_name(alias) for alias in
                   [entry["name"], entry["identity"]["displayName"], entry["identity"]["canonicalDesignation"], *entry["aliases"]])]


@lru_cache(maxsize=4)
def load_gaia_identities(directory: str) -> dict[str, dict]:
    """Component-level enrichment is not a new target preset or search alias."""
    data = json.loads((Path(directory) / "presets.json").read_text(encoding="utf-8"))
    identities = [entry["identity"] for entry in load_presets(directory)] + data.get("sourceIdentities", [])
    index = {}
    for identity in identities:
        ObjectIdentity.model_validate(identity)
        for reference in identity["catalogIds"]:
            if reference["catalog"] != "Gaia" or reference["dataRelease"] != "DR3":
                continue
            source_id = reference["id"]
            if source_id in index and index[source_id]["objectId"] != identity["objectId"]:
                raise ValueError(f"Conflicting Gaia DR3 identity: {source_id}")
            index[source_id] = identity
    return index


def gaia_identity(source_id: str, settings: Settings) -> ObjectIdentity | None:
    # Fixture astrometry is synthetic even when its ID resembles a real source.
    if not settings.live:
        return None
    identity = load_gaia_identities(str(settings.fixtures_dir)).get(source_id)
    return ObjectIdentity.model_validate(identity) if identity else None
