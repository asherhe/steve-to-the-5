"""Synthetic visits; these tests do not assert live-archive latency."""
from fastapi.testclient import TestClient

from services.archive.models import ArchiveError
from services.wise.api import create_app
from services.wise.tests.test_wise import FIELD, pipeline, visits


def test_retained_real_demo_replays_offline_and_never_substitutes_another_band(tmp_path):
    import json
    from pathlib import Path
    from services.wise.api import create_store
    root = Path(__file__).resolve().parents[3] / "fixtures/wise/real-wise0855"
    example = json.loads((root / "example.json").read_text())
    built = pipeline(tmp_path, [], discovery_error=ArchiveError("UPSTREAM_ERROR", "offline"))
    built.store = create_store(tmp_path)
    client = TestClient(create_app(built))
    params = {**example["field"], "band": 2}
    response = client.get("/api/wise/comparisons", params=params)
    assert response.headers["X-Comparison-Source"] == "saved-example"
    assert response.json()["comparison"]["id"] == example["comparisonId"]
    replay = client.get(f"/api/wise/comparisons/{example['comparisonId']}")
    assert replay.json() == response.json()
    for frame in response.json()["comparison"]["frames"]:
        assert client.get(frame["imageUrl"]).content.startswith(b"\x89PNG")
    for change in ({"band": 1}, {"mode": "timeline"}, {"refresh": True}, {"fovArcmin": 5}):
        assert client.get("/api/wise/comparisons", params={**params, **change}).json()["status"] == "upstream_unavailable"


def test_blink_fetches_six_cutouts_and_longer_timeline_is_explicit(tmp_path):
    items = visits(count=6, per_visit=5)
    built = pipeline(tmp_path, items)
    app = TestClient(create_app(built))
    params = FIELD.model_dump(by_alias=True)
    blink = app.get("/api/wise/comparisons", params=params).json()
    assert blink["status"] == "ready"
    assert len(blink["comparison"]["frames"]) == 2
    assert blink["diagnostics"]["retrieval"]["requestedCutouts"] == 6
    assert blink["comparison"]["frames"][0]["observationId"].startswith(items[0][0].exposure_id)
    assert blink["comparison"]["frames"][-1]["observationId"].endswith(items[-1][0].exposure_id)
    assert all(f["qualityFlags"]["combinedExposures"] == 3 for f in blink["comparison"]["frames"])
    timeline = app.get("/api/wise/comparisons", params={**params, "mode": "timeline"}).json()
    assert len(timeline["comparison"]["frames"]) == 6
    assert timeline["diagnostics"]["retrieval"]["requestedCutouts"] == 30
    assert timeline["comparison"]["id"] != blink["comparison"]["id"]
    assert app.get("/api/wise/comparisons/" + blink["comparison"]["id"]).json() == blink
    assert app.get("/api/wise/comparisons", params=params).json() == blink


def test_blink_skips_endpoint_visit_with_only_one_exposure(tmp_path):
    items = visits(count=4, per_visit=3)
    items = items[:1] + items[3:]
    response = TestClient(create_app(pipeline(tmp_path, items))).get(
        "/api/wise/comparisons", params=FIELD.model_dump(by_alias=True)).json()
    assert response["status"] == "ready"
    assert response["diagnostics"]["epochs"]["tooFewExposures"] == 1
    assert all(f["qualityFlags"]["combinedExposures"] == 3 for f in response["comparison"]["frames"])
    assert response["comparison"]["frames"][0]["observationId"].startswith(items[1][0].exposure_id)


def test_wise_warm_field_survives_restart_outage_and_band_change(tmp_path):
    built = pipeline(tmp_path, visits())
    params = FIELD.model_dump(by_alias=True)
    first = TestClient(create_app(built)).get("/api/wise/comparisons", params=params)
    restarted = pipeline(tmp_path, visits(), discovery_error=ArchiveError("UPSTREAM_ERROR", "offline"))
    app = TestClient(create_app(restarted))
    warm = app.get("/api/wise/comparisons", params=params)
    assert warm.headers["X-Comparison-Source"] == "saved-cache" and warm.json() == first.json()
    for changes in ({"band": 1}, {"mode": "timeline"}, {"fovArcmin": 3}, {"refresh": True}):
        result = app.get("/api/wise/comparisons", params={**params, **changes})
        assert result.json()["status"] == "upstream_unavailable"
    assert app.get("/api/wise/comparisons", params=params).json() == first.json()
