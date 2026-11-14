"""Every fixture must validate against the response models and use only documented fields.

This keeps fixtures, models and the documented contract in sync. Keys beginning with "_" are
documentation-only annotations and are stripped before validation.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.models import ErrorBody, GaiaDetail, NearbySource

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "catalogs"


def _strip_meta(obj):
    if isinstance(obj, dict):
        return {k: _strip_meta(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [_strip_meta(v) for v in obj]
    return obj


@pytest.mark.parametrize("name", ["nearby_known.json", "nearby_ambiguous.json", "nearby_unmatched.json"])
def test_nearby_fixtures_validate(name):
    data = _strip_meta(json.loads((FIXTURES / name).read_text(encoding="utf-8")))
    for row in data["sources"]:
        model = NearbySource.model_validate(row)
        # Round-trip serializes back to the exact documented camelCase keys.
        dumped = model.model_dump(by_alias=True)
        assert set(dumped.keys()) == set(row.keys())


@pytest.mark.parametrize("name", ["detail_known.json", "detail_partial.json"])
def test_detail_fixtures_validate(name):
    data = _strip_meta(json.loads((FIXTURES / name).read_text(encoding="utf-8")))
    GaiaDetail.model_validate(data)


def test_unavailable_fixture_is_error_body():
    data = _strip_meta(json.loads((FIXTURES / "unavailable.json").read_text(encoding="utf-8")))
    body = ErrorBody.model_validate(data)
    assert body.code == "upstream_unavailable"


def test_presets_cover_five_targets():
    data = json.loads((FIXTURES / "presets.json").read_text(encoding="utf-8"))
    assert len(data["presets"]) == 5
