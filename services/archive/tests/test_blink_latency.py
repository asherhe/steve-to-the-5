"""Offline regressions for work avoided by the interactive blink path."""
from pathlib import Path

from fastapi.testclient import TestClient
import httpx
import pytest

from services.archive.api import create_app
from services.archive.client import IRSAClient
from services.archive.candidates import footprint_position, order_candidates
from services.archive.fixtures import FixtureClient, synthetic_cutout
from services.archive.models import ArchiveError, FieldRequest, ProcessingConfig
from services.archive.pipeline import Pipeline
from services.archive.request_cache import RequestCache
from services.archive.storage import LocalStore
from services.archive.tests.test_archive import votable


FIELD = FieldRequest(ra=10, dec=20, fovArcmin=6)


def pipeline(root, count=24):
    return Pipeline(FixtureClient([synthetic_cutout()] * count), LocalStore(root), ProcessingConfig())


def test_first_pair_does_not_wait_for_24_downloads(tmp_path):
    built = pipeline(tmp_path)
    batches = []
    original = built.client.retrieve

    def retrieve(observations, *args):
        batches.append(len(observations))
        return original(observations, *args)
    built.client.retrieve = retrieve
    response = built.build(FIELD)
    assert response.status == "ready"
    assert batches == [6]
    assert response.diagnostics["retrieval"]["notRequestedExposureCount"] == 18
    assert response.diagnostics["complete"] is False


def test_cache_survives_restart_and_refresh_builds_without_mutating_replay(tmp_path):
    built = pipeline(tmp_path)
    params = FIELD.model_dump(by_alias=True)
    first = TestClient(create_app(built)).get("/api/comparisons", params=params)
    assert first.headers["X-Comparison-Source"] == "archive"
    restarted = pipeline(tmp_path)

    def offline(*args):
        raise ArchiveError("UPSTREAM_ERROR", "offline")
    restarted.client.discover = offline
    app = TestClient(create_app(restarted))
    warm = app.get("/api/comparisons", params=params)
    assert warm.headers["X-Comparison-Source"] == "saved-cache"
    assert warm.json() == first.json()
    assert app.get("/api/comparisons", params={**params, "refresh": True}).json()["status"] == "upstream_unavailable"
    assert app.get("/api/comparisons", params=params).json() == first.json()
    assert app.get("/api/comparisons/" + first.json()["comparison"]["id"]).json() == first.json()


def test_cache_keys_exact_field_policy_implementation_and_preserves_corruption_error(tmp_path):
    built = pipeline(tmp_path, 2)
    response = built.build(FIELD)
    cache = RequestCache(built, {"version": "one"})
    cache.put(FIELD, response)
    assert cache.get(FIELD)["comparison"]["id"] == response.comparison.id
    for change in ({"ra": 10.000001}, {"dec": 20.000001}, {"fov_arcmin": 5}):
        assert cache.get(FIELD.model_copy(update=change)) is None
    assert RequestCache(built, {"version": "two"}).get(FIELD) is None
    built.config = built.config.model_copy(update={"wavelength_tolerance_bandwidth": 0.1})
    assert RequestCache(built, {"version": "one"}).get(FIELD) is None
    image = response.comparison.frames[0]
    (tmp_path / "blobs" / built.store.asset(response.comparison.id, f"{image.id}.png")[1]).write_bytes(b"corrupt")
    with pytest.raises(ArchiveError, match="corrupt"):
        cache.get(FIELD)


def test_png_delivery_reads_only_its_blob_but_replay_verifies_every_blob(tmp_path, monkeypatch):
    built = pipeline(tmp_path, 2)
    response = built.build(FIELD)
    frame = response.comparison.frames[0]
    read, original = [], Path.read_bytes

    def read_bytes(path):
        if path.parent.name == "blobs":
            read.append(path.name)
        return original(path)
    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    built.store.asset(response.comparison.id, f"{frame.id}.png")
    assert len(read) == 1
    read.clear()
    built.store.load_raw(response.comparison.id)
    assert len(read) == 2 * len(response.comparison.frames)


def test_sia_retry_reuses_valid_discovery_and_explicit_refresh_requeries(tmp_path):
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(200, content=votable([]))
    client = IRSAClient(ProcessingConfig(), tmp_path, httpx.MockTransport(handle))
    try:
        assert client.discover(FIELD).observations == []
        assert len(calls) == 2
        assert client.discover(FIELD).observations == []
        assert len(calls) == 2
        client.refresh_discovery(FIELD)
        client.discover(FIELD)
        assert len(calls) == 4
    finally:
        client.close()


def test_spherex_cancel_releases_slot_without_publishing(tmp_path):
    built = pipeline(tmp_path)
    app = TestClient(create_app(built))
    original = built.client.retrieve
    def retrieve(*args):
        progress = app.get("/api/comparisons/progress/cancel-blink-1").json()
        assert progress["stage"] == "retrieval"
        assert app.delete("/api/comparisons/progress/cancel-blink-1").status_code == 200
        return original(*args)
    built.client.retrieve = retrieve
    result = app.get("/api/comparisons", params={**FIELD.model_dump(by_alias=True), "progressId": "cancel-blink-1"})
    assert result.status_code == 409 and result.json()["code"] == "BUILD_CANCELLED"
    assert not list(tmp_path.glob("manifests/*"))
    built.client.retrieve = original
    assert app.get("/api/comparisons", params=FIELD.model_dump(by_alias=True)).json()["status"] == "ready"


def test_geometry_schedules_a_later_pair_without_weakening_wavelength_checks(tmp_path):
    regions = ["POLYGON ICRS 8 18 11 18 11 22 8 22",
               "POLYGON ICRS 9 18 12 18 12 22 9 22",
               "POLYGON ICRS 8 18 12 18 12 22 8 22",
               "POLYGON ICRS 8 18 12 18 12 22 8 22"]
    class Located(FixtureClient):
        def discover(self, field, deadline=None):
            result = super().discover(field, deadline)
            result.observations = [o.model_copy(update={"footprint_icrs": regions[i]})
                                   for i, o in enumerate(result.observations)]
            return result
    config = ProcessingConfig(batch_size=2, max_cutouts=2)
    client = Located([synthetic_cutout(wavelength=w) for w in (1.5, 2.0, 1.25, 1.25)])
    response = Pipeline(client, LocalStore(tmp_path), config).build(FIELD)
    assert response.status == "ready"
    assert {f.observation_id for f in response.comparison.frames} == {"synthetic-2", "synthetic-3"}
    assert response.diagnostics["retrieval"]["requestedCutouts"] == 2
    # Matching footprints alone never make incompatible spectral images comparable.
    client.cutouts[3] = synthetic_cutout(wavelength=3)
    with pytest.raises(ArchiveError, match="No pair found"):
        Pipeline(client, LocalStore(tmp_path), config).build(FIELD)


def test_footprints_handle_ra_wrap_and_bad_metadata_without_losing_candidates():
    near_wrap = FieldRequest(ra=359.99, dec=20)
    position = footprint_position("POLYGON ICRS 358 18 1 18 1 22 358 22 358 18", near_wrap)
    assert position is not None and all(abs(position) < 0.2)
    for invalid in (None, "", "CIRCLE ICRS 10 20 2", "POLYGON ICRS nan 1", "POLYGON ICRS 1 1 1 1 1 1 1 1"):
        assert footprint_position(invalid, FIELD) is None
    observations = FixtureClient([b""] * 10).discover(FIELD).observations
    ordered = order_candidates(observations, FIELD, ProcessingConfig())
    assert [o.observation_id for o in ordered[:2]] == ["synthetic-0", "synthetic-9"]
    assert sorted(o.observation_id for o in ordered) == sorted(o.observation_id for o in observations)
