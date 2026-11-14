"""Regression tests for partial retrieval, cutout geometry, separate coverage
policies, alignment reselection, bounded work and evidence preservation."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
import threading

from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient
import httpx
import numpy as np
from PIL import Image
import pytest

from services.archive.api import create_app
from services.archive.client import IRSAClient
from services.archive.fixtures import FixtureClient, RecordedClient, synthetic_cutout
from services.archive.models import (ArchiveError, Deadline, Discovery, FieldRequest,
                                     ProcessingConfig)
from services.archive.pipeline import Pipeline
from services.archive.processing import (compatible, cutout_size_deg, make_grid, prepare,
                                         render, select, shared_stretch)
from services.archive.storage import LocalStore

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "archive"
IRSA = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/"


@pytest.fixture
def field():
    return FieldRequest(ra=10, dec=20, fovArcmin=6)


@pytest.fixture
def config():
    return ProcessingConfig()


def failed(category="transient_http", attempts=3):
    return ArchiveError("UPSTREAM_ERROR", "simulated", details={"category": category, "attempts": attempts})


def make_pipeline(tmp_path, config, cutouts, **kwargs):
    return Pipeline(FixtureClient(cutouts), LocalStore(tmp_path), config, **kwargs)


def prepared(field, config, cutout, index=0, count=None):
    grid, wcs = make_grid(field, config)
    observation = FixtureClient([cutout] * (count or index + 1)).discover(field).observations[index]
    return prepare(observation, cutout, field, grid, wcs, config)


class FakeTime:
    def __init__(self):
        self.now, self.sleeps = 0.0, []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


# --- Partial retrieval ---------------------------------------------------

def test_partial_failure_keeps_successes_and_reports_missing_inputs(tmp_path, field, config):
    response = make_pipeline(tmp_path, config, [synthetic_cutout(), failed(), synthetic_cutout(shift=2)]).build(field)
    assert response.status == "ready"
    d = response.diagnostics
    assert d["complete"] is False and d["incompleteStages"] == ["retrieval"]
    assert d["selectionScope"] == "discovered_exposures_minus_failed_retrievals"
    assert d["retrieval"]["requestedCutouts"] == 3 and d["retrieval"]["succeededCutouts"] == 2
    assert d["retrieval"]["failures"] == [{"observationId": "synthetic-1", "detector": 2, "release": "dr1",
                                           "category": "transient_http", "code": "UPSTREAM_ERROR", "attempts": 3}]
    assert [f.observation_id for f in response.comparison.frames] == ["synthetic-0", "synthetic-2"]
    assert any("incomplete" in text for text in response.comparison.limitations)
    assert LocalStore(tmp_path).load(response.comparison.id) == response


def test_all_downloads_failing_is_upstream_failure_and_publishes_nothing(tmp_path, field, config):
    response = make_pipeline(tmp_path, config, [failed(), failed("timeout")]).build(field)
    assert response.status == "upstream_unavailable" and response.comparison is None
    assert response.diagnostics["retrieval"]["failureCategories"] == {"timeout": 1, "transient_http": 1}
    assert response.diagnostics["discovery"]["totalExposures"] == 2
    assert not (tmp_path / "manifests").exists()


def test_client_keeps_request_order_and_structures_failures(tmp_path, field):
    config = ProcessingConfig(attempts=2, concurrency=3)
    gate = threading.Event()

    def handler(request):
        name = request.url.path.rsplit("/", 1)[-1]
        if name == "a.fits":
            gate.wait(2)  # finishes last; order must still follow the request
            return httpx.Response(200, content=synthetic_cutout())
        gate.set()
        if name == "b.fits":
            return httpx.Response(404)
        if name == "c.fits":
            return httpx.Response(503)
        return httpx.Response(200, content=synthetic_cutout(shift=1))
    client = IRSAClient(config, tmp_path, httpx.MockTransport(handler), sleep=lambda _: None)
    observations = [o.model_copy(update={"source_url": IRSA + f"{n}.fits"})
                    for o, n in zip(FixtureClient([b""] * 4).discover(field).observations, "abcd")]
    result = client.retrieve(observations, field, 0.2)
    assert [o.observation_id for o, _ in result.cutouts] == ["synthetic-0", "synthetic-3"]
    assert [(f["observationId"], f["category"], f["attempts"], f["httpStatus"]) for f in result.failures] == [
        ("synthetic-1", "http_rejected", 1, 404), ("synthetic-2", "transient_http", 2, 503)]


def test_one_release_query_failing_keeps_the_other_and_is_reported(tmp_path, field):
    from services.archive.tests.test_archive import votable

    def handler(request):
        if request.url.params["COLLECTION"] == "spherex_qr3":
            return httpx.Response(502)
        return httpx.Response(200, content=votable([("one", "SPHEREx-D2", IRSA + "a.fits", 61000, 61000.1)]))
    client = IRSAClient(ProcessingConfig(attempts=2), tmp_path, httpx.MockTransport(handler), sleep=lambda _: None)
    discovery = client.discover(field)
    assert len(discovery.observations) == 1
    assert discovery.failures == [{"release": "qr3", "category": "transient_http", "code": "UPSTREAM_ERROR",
                                   "attempts": 2, "httpStatus": 502}]


# --- Retry and deadline --------------------------------------------------

def test_transient_statuses_retry_with_bounded_exponential_backoff(tmp_path):
    clock, calls = FakeTime(), []

    def handler(request):
        calls.append(request)
        return httpx.Response([503, 504, 200][len(calls) - 1], content=b"ok")
    config = ProcessingConfig(attempts=3, backoffBaseSeconds=0.5, backoffMaxSeconds=8)
    client = IRSAClient(config, tmp_path, httpx.MockTransport(handler), sleep=clock.sleep, jitter=lambda: 1.0)
    assert client._get(client.endpoint) == (b"ok", 3)
    assert clock.sleeps == [0.5, 1.0]
    # Jitter scales each step into [0.5, 1.0) of its exponential value.
    calls.clear(); clock.sleeps.clear()
    IRSAClient(config, tmp_path, httpx.MockTransport(handler), sleep=clock.sleep, jitter=lambda: 0.0)._get(client.endpoint)
    assert clock.sleeps == [0.25, 0.5]


def test_non_transient_status_is_not_retried(tmp_path):
    calls = []
    client = IRSAClient(ProcessingConfig(attempts=3), tmp_path,
                        httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(500)), sleep=lambda _: None)
    with pytest.raises(ArchiveError) as exc:
        client._get(client.endpoint)
    assert len(calls) == 1 and exc.value.details["category"] == "http_server_error"


def test_backoff_is_capped_by_remaining_deadline(tmp_path):
    clock, calls = FakeTime(), []
    config = ProcessingConfig(attempts=5, backoffBaseSeconds=0.5, backoffMaxSeconds=8)
    client = IRSAClient(config, tmp_path, httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(503)),
                        sleep=clock.sleep, jitter=lambda: 1.0)
    with pytest.raises(ArchiveError) as exc:
        client._get(client.endpoint, deadline=Deadline(1.2, clock.clock))
    assert exc.value.code == "PROCESSING_LIMIT" and exc.value.details["category"] == "deadline"
    assert clock.sleeps == [0.5, pytest.approx(0.7)]  # second wait cut from 1.0 to what was left
    assert len(calls) == 2 and clock.now == pytest.approx(1.2)


def test_build_deadline_stops_work_and_publishes_nothing(tmp_path, field):
    clock = FakeTime()

    class Slow(FixtureClient):
        def retrieve(self, observations, field, size_deg=None, deadline=None):
            clock.now += 200
            return super().retrieve(observations, field, size_deg, deadline)
    pipeline = Pipeline(Slow(), LocalStore(tmp_path), ProcessingConfig(buildDeadlineSeconds=180), clock=clock.clock)
    with pytest.raises(ArchiveError) as exc:
        pipeline.build(field)
    assert exc.value.code == "PROCESSING_LIMIT" and exc.value.http_status == 503
    assert exc.value.details["limit"] == "build_deadline"
    assert exc.value.details["diagnostics"]["discovery"]["totalExposures"] == 2
    assert not (tmp_path / "manifests").exists()
    # The same inputs inside the deadline do publish.
    assert Pipeline(FixtureClient(), LocalStore(tmp_path), ProcessingConfig(), clock=clock.clock).build(field).status == "ready"


# --- Cutout geometry -----------------------------------------------------

def simulated_service_pixels(size_deg):
    """Worst case: the service truncates the requested side to whole 6.2-arcsec pixels."""
    return int(size_deg * 3600 / 6.2)


@pytest.mark.parametrize("fov", [1, 6, 30])
@pytest.mark.parametrize("rotation", [0, 20, 45, 77, 135])
def test_requested_extent_covers_output_grid_at_every_rotation(config, fov, rotation):
    field = FieldRequest(ra=10, dec=20, fovArcmin=fov)
    grid, wcs = make_grid(field, config)
    size = cutout_size_deg(grid, wcs, config)
    diagonal = grid.width * config.pixel_scale_arcsec * 2 ** 0.5 / 3600  # flat-sky value
    assert size >= diagonal + 2 * config.cutout_padding_arcsec / 3600 - 1e-6
    raw = synthetic_cutout(rotation=rotation, n=simulated_service_pixels(size))
    frame = prepared(field, config, raw)
    assert frame.coverage["geometricFraction"] == 1.0
    assert frame.coverage["validFraction"] == 1.0
    assert frame.coverage["outputPixels"] == grid.width * grid.height
    with fits.open(BytesIO(raw)) as hdus:
        exact = cutout_size_deg(grid, wcs, config, WCS(hdus["IMAGE"].header).celestial)
    assert exact <= size + 1e-6  # WCS-exact need never exceeds the pre-download bound
    if rotation == 45:
        assert exact > 0.98 * size  # and the bound is tight where rotation is worst


@pytest.mark.parametrize("fov", [1, 6, 30])
def test_old_ten_percent_margin_clips_a_rotated_field_and_is_rejected(config, fov):
    field = FieldRequest(ra=10, dec=20, fovArcmin=fov)
    raw = synthetic_cutout(rotation=45, n=simulated_service_pixels(fov / 60 * 1.1))
    frame = prepared(field, config, raw)
    assert frame.coverage["geometricFraction"] < config.min_geometric_coverage
    chosen, diagnostics, _ = select([frame], config)
    assert chosen == []
    assert diagnostics["rejectedObservations"][0]["reason"] == "insufficient_geometric_coverage"


def test_detector_edge_truncation_stays_visible_as_missing_coverage(field, config):
    # A cutout cut off by the detector edge: full width, but only the lower rows exist.
    with fits.open(BytesIO(synthetic_cutout())) as hdus:
        for hdu in hdus[1:]:
            hdu.data = hdu.data[:60]
        out = BytesIO(); hdus.writeto(out)
    frame = prepared(field, config, out.getvalue())
    assert 0.7 < frame.coverage["geometricFraction"] < 0.8
    assert frame.coverage["validFraction"] <= frame.coverage["geometricFraction"]
    assert not frame.valid[-10:].any() and np.isnan(frame.image[-10:]).all()


# --- Separate coverage policies ------------------------------------------

def test_geometric_individual_and_common_coverage_are_separate(field, config):
    top = prepared(field, config, synthetic_cutout(bad_block=(16, 24, 0, 90)), 0, 3)
    bottom = prepared(field, config, synthetic_cutout(bad_block=(60, 68, 0, 90)), 1, 3)
    heavy = prepared(field, config, synthetic_cutout(bad_block=(16, 32, 0, 90)), 2, 3)
    for frame in (top, bottom, heavy):
        assert frame.coverage["geometricFraction"] == 1.0  # masks never reduce geometry
    assert config.min_valid_coverage <= top.coverage["validFraction"] < 0.9
    assert heavy.coverage["validFraction"] < config.min_valid_coverage
    _, diagnostics, _ = select([top, bottom, heavy], config)
    assert [(r["observationId"], r["reason"]) for r in diagnostics["rejectedObservations"]] == [
        ("synthetic-2", "insufficient_valid_coverage")]
    # Each passes alone; together their common valid area is too small.
    assert (top.valid & bottom.valid).mean() < config.min_common_valid_coverage
    assert compatible(top, bottom, config) == (False, "insufficient_common_coverage")
    assert diagnostics["pairChecks"] == {"insufficient_common_coverage": 1}
    relaxed = config.model_copy(update={"min_common_valid_coverage": 0.6})
    assert compatible(top, bottom, relaxed) == (True, "compatible")
    strict = config.model_copy(update={"min_valid_coverage": 0.9})
    assert select([top, bottom], strict)[1]["usableExposureCount"] == 0


def test_target_region_validity_is_reported_separately(field, config):
    frame = prepared(field, config, synthetic_cutout(bad_block=(42, 48, 42, 48)))
    assert frame.coverage["validFraction"] > 0.95
    assert frame.coverage["targetRegionValidFraction"] < 0.6
    assert frame.coverage["targetRegionPixels"] == 81 and frame.coverage["targetRegionRadiusPixels"] == 5
    clean = prepared(field, config, synthetic_cutout())
    assert clean.coverage["targetRegionValidFraction"] == 1.0


def test_wavelength_is_checked_over_common_valid_region_only(field, config):
    a = prepared(field, config, synthetic_cutout(slope=0.00001), 0, 2)
    b = prepared(field, config, synthetic_cutout(slope=0.0005), 1, 2)
    assert compatible(a, b, config) == (False, "wavelength_mismatch")
    # Masking the columns where the responses diverge leaves a compatible common region.
    b.valid[:, :22] = False
    b.valid[:, -22:] = False
    loose = config.model_copy(update={"min_common_valid_coverage": 0.2})
    assert compatible(a, b, loose) == (True, "compatible")


def test_rejected_pixels_stay_masked_through_reprojection_and_rendering(field, config):
    frame = prepared(field, config, synthetic_cutout(bad_block=(40, 50, 20, 30)))
    assert frame.quality["qualityRejectedInputPixels"] == 100
    # Native block x 20..29, y 40..49 sits at output x 4.5..13.5, y 24.5..33.5 (offset
    # 15.5). Every output pixel whose bilinear support touches it is invalid.
    block = np.zeros_like(frame.valid)
    block[24:35, 4:15] = True
    assert not frame.valid[block].any() and np.isnan(frame.image[block]).all()
    assert frame.valid[~block].all()
    png = np.array(Image.open(BytesIO(render(frame, shared_stretch([frame], config)))))
    alpha = np.flipud(png[..., 3])  # PNG row 0 is north; undo the flip
    assert (alpha[block] == 0).all() and (alpha[~block] == 255).all()


# --- Alignment reselection -----------------------------------------------

def test_alignment_failure_reselects_instead_of_rejecting_everything(tmp_path, field, config):
    shifted = synthetic_cutout(shift=3, star_offset=1.2)  # background stars 1.2 px off
    response = make_pipeline(tmp_path, config, [synthetic_cutout(), synthetic_cutout(shift=2), shifted]).build(field)
    assert response.status == "ready"
    assert [f.observation_id for f in response.comparison.frames] == ["synthetic-0", "synthetic-1"]
    assert [f.alignment for f in response.comparison.frames] == ["reference_frame", "verified"]
    failures = response.diagnostics["alignmentFailures"]
    assert [(f["a"]["observationId"], f["b"]["observationId"]) for f in failures][0] == ("synthetic-0", "synthetic-2")
    assert all(f["medianResidualPixels"] > 0.5 for f in failures)
    assert response.diagnostics["candidatePairsTried"] > 1
    assert response.diagnostics["notSelectedExposures"] == [{"observationId": "synthetic-2", "detector": 2}]
    # The longest-baseline preference still holds when alignment is fine.
    clean = make_pipeline(tmp_path, config, [synthetic_cutout(), synthetic_cutout(shift=2), synthetic_cutout(shift=3)]).build(field)
    assert len(clean.comparison.frames) == 3 and clean.diagnostics["alignmentFailures"] == []


def test_failed_relationship_does_not_blacklist_a_frame(tmp_path, field, config):
    # Frames 1 and 2 disagree with frame 0 but agree with each other; which side is
    # wrong is unknown, so they remain usable together.
    cutouts = [synthetic_cutout(), synthetic_cutout(shift=2, star_offset=1.2), synthetic_cutout(shift=3, star_offset=1.2)]
    response = make_pipeline(tmp_path, config, cutouts).build(field)
    assert response.status == "ready"
    assert [f.observation_id for f in response.comparison.frames] == ["synthetic-1", "synthetic-2"]
    assert len(response.diagnostics["alignmentFailures"]) == 2


def test_alignment_failure_continues_into_later_batches(tmp_path, field):
    config = ProcessingConfig(batchSize=2)
    cutouts = [synthetic_cutout(), synthetic_cutout(shift=2), synthetic_cutout(shift=3, star_offset=1.2)]
    response = make_pipeline(tmp_path, config, cutouts).build(field)  # first batch: frames 0 and 2
    assert response.status == "ready" and response.diagnostics["retrieval"]["requestedCutouts"] == 3
    assert [f.observation_id for f in response.comparison.frames] == ["synthetic-0", "synthetic-1"]
    # With only the disagreeing pair available the complete search reports no pair.
    only = make_pipeline(tmp_path, config, [synthetic_cutout(), synthetic_cutout(shift=3, star_offset=1.2)]).build(field)
    assert only.status == "no_comparable_pair" and len(only.diagnostics["alignmentFailures"]) == 1


def test_too_few_reference_stars_is_unverified_not_failed(tmp_path, config):
    field = FieldRequest(ra=10, dec=20, fovArcmin=1)  # background stars fall outside
    response = make_pipeline(tmp_path, config, [synthetic_cutout(), synthetic_cutout(shift=1)]).build(field)
    assert response.status == "ready"
    assert [f.alignment for f in response.comparison.frames] == ["reference_frame", "wcs_only_not_empirically_verified"]
    check = response.comparison.provenance["alignmentChecks"][response.comparison.frames[1].source_sha256]
    assert check["reason"] == "fewer_than_3_detected_background_sources"
    assert response.diagnostics["alignmentFailures"] == []


# --- Incomplete searches -------------------------------------------------

def test_incomplete_search_never_claims_absence(tmp_path, field, config):
    # No pair among retrieved frames, one download missing: not "no_comparable_pair".
    response = make_pipeline(tmp_path, config, [synthetic_cutout(), synthetic_cutout(wavelength=2), failed()]).build(field)
    assert response.status == "upstream_unavailable"
    assert response.diagnostics["code"] == "INCOMPLETE_RETRIEVAL" and response.diagnostics["complete"] is False
    assert response.diagnostics["pairChecks"] == {"wavelength_mismatch": 1}
    # One usable frame plus a missing download: not "single_epoch".
    assert make_pipeline(tmp_path, config, [synthetic_cutout(), failed()]).build(field).status == "upstream_unavailable"
    # The same inputs with nothing missing are a complete negative result.
    complete = make_pipeline(tmp_path, config, [synthetic_cutout(), synthetic_cutout(wavelength=2)]).build(field)
    assert complete.status == "no_comparable_pair" and complete.diagnostics["complete"] is True
    # Local budget exhaustion is an HTTP error, distinct from both.
    limited = config.model_copy(update={"batch_size": 2, "max_cutouts": 2})
    with pytest.raises(ArchiveError) as exc:
        make_pipeline(tmp_path, limited, [synthetic_cutout(wavelength=w) for w in (1, 2, 3)]).build(field)
    assert exc.value.code == "PROCESSING_LIMIT" and exc.value.details["limit"] == "cutout_budget"
    assert exc.value.details["diagnostics"]["incompleteStages"] == ["sampling"]


def test_failed_release_query_with_no_rows_is_not_no_coverage(tmp_path, field, config):
    class Partial(FixtureClient):
        def discover(self, field, deadline=None):
            return Discovery([], [{"release": "qr3", "category": "transient_http", "code": "UPSTREAM_ERROR", "attempts": 3}])
    response = Pipeline(Partial(), LocalStore(tmp_path), config).build(field)
    assert response.status == "upstream_unavailable" and response.diagnostics["code"] == "INCOMPLETE_DISCOVERY"
    empty = make_pipeline(tmp_path, config, []).build(field)
    assert empty.status == "no_coverage" and empty.diagnostics["complete"] is True


def test_discovery_summary_is_recorded_before_retrieval(tmp_path, field, config):
    response = make_pipeline(tmp_path, config, [failed(), failed()]).build(field)
    assert response.diagnostics["discovery"] == {
        "scope": "synthetic_fixture_inputs", "totalExposures": 2, "byRelease": {"dr1": 2},
        "byDetector": {"D2": 2}, "byReleaseDetector": {"dr1:D2": 2},
        "observedTimeRangeUtc": {"dr1": {"start": "2025-11-21T00:00:00Z", "end": "2026-05-20T00:01:26.400000Z"}},
        "failedReleaseQueries": [], "complete": True}


# --- Admission -----------------------------------------------------------

def test_one_build_at_a_time_without_blocking_replay_or_assets(tmp_path, field, config):
    saved = make_pipeline(tmp_path, config, None).build(field)
    entered, release = threading.Event(), threading.Event()

    class Blocking(FixtureClient):
        def retrieve(self, observations, field, size_deg=None, deadline=None):
            entered.set()
            assert release.wait(10)
            return super().retrieve(observations, field, size_deg, deadline)
    app = create_app(Pipeline(Blocking(), LocalStore(tmp_path), config))
    results = {}
    worker = threading.Thread(target=lambda: results.update(
        first=TestClient(app).get("/api/comparisons", params={"ra": 10, "dec": 20})))
    worker.start()
    try:
        assert entered.wait(10)
        client = TestClient(app)
        busy = client.get("/api/comparisons", params={"ra": 10, "dec": 20})
        assert busy.status_code == 429 and busy.json()["code"] == "BUILD_BUSY"
        assert set(busy.json()) == {"code", "message"} and busy.headers["retry-after"] == "30"
        replay = client.get(f"/api/comparisons/{saved.comparison.id}")
        assert replay.status_code == 200 and replay.json()["comparison"]["id"] == saved.comparison.id
        assert client.get(saved.comparison.frames[0].image_url).status_code == 200
        assert client.get("/api/comparisons", params={"ra": 400, "dec": 20}).status_code == 422
    finally:
        release.set()
        worker.join(10)
    assert results["first"].status_code == 200
    # The slot is released after the build, including after a failed one.
    assert TestClient(app).get("/api/comparisons", params={"ra": 10, "dec": 20}).status_code == 200


def test_processing_limit_is_an_http_error_not_a_domain_status(tmp_path, config):
    limited = config.model_copy(update={"batch_size": 2, "max_cutouts": 2})
    app = create_app(make_pipeline(tmp_path, limited, [synthetic_cutout(wavelength=w) for w in (1, 2, 3)]))
    for _ in range(2):  # the second call proves the slot was released after the error
        response = TestClient(app).get("/api/comparisons", params={"ra": 10, "dec": 20})
        assert response.status_code == 503 and response.json()["code"] == "PROCESSING_LIMIT"
        assert set(response.json()) == {"code", "message"}


# --- Identity and preserved evidence -------------------------------------

@pytest.mark.parametrize("change", [
    {"min_geometric_coverage": 0.97}, {"min_valid_coverage": 0.7}, {"min_common_valid_coverage": 0.7},
    {"cutout_padding_arcsec": 25}, {"target_region_radius_pixels": 4}, {"wavelength_tolerance_bandwidth": 0.2}])
def test_changed_processing_policy_creates_a_new_id(tmp_path, field, config, change):
    first = make_pipeline(tmp_path, config, None).build(field)
    again = make_pipeline(tmp_path, ProcessingConfig(), None).build(field)
    changed = make_pipeline(tmp_path, config.model_copy(update=change), None).build(field)
    assert first.comparison.id == again.comparison.id != changed.comparison.id
    assert LocalStore(tmp_path).load(first.comparison.id) == first  # the earlier ID is untouched
    key = next(iter(ProcessingConfig.model_validate(change).model_dump(by_alias=True, include=set(change))))
    assert changed.comparison.config[key] == next(iter(change.values()))


def test_baseline_evidence_is_byte_identical(tmp_path):
    baseline = json.loads((FIXTURES / "history" / "baseline-20261114.json").read_text())
    immutable = {name: sha for name, sha in baseline["sha256"].items() if "/evidence/" in name}
    assert len(immutable) == 16
    for name, sha in immutable.items():
        assert hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() == sha, name
    for original, copy in baseline["preservedCopies"].items():
        assert hashlib.sha256((FIXTURES / copy).read_bytes()).hexdigest() == baseline["sha256"][original]


def test_schema_1_evidence_replays_exactly_under_current_code(tmp_path):
    for kind in ("real", "synthetic"):
        store = LocalStore(FIXTURES / kind / "evidence")
        client = TestClient(create_app(Pipeline(FixtureClient(), store, ProcessingConfig())))
        for manifest in sorted((FIXTURES / kind / "evidence" / "manifests").glob("*.json")):
            saved = json.loads(manifest.read_text())["response"]
            if saved["comparison"]["provenance"]["schemaVersion"] != 1:
                continue
            body = client.get(f"/api/comparisons/{manifest.stem}")
            assert body.status_code == 200 and body.json() == saved  # no reshaping, no new defaults
            assert "minimumCoverage" in body.json()["comparison"]["config"]
            for frame in saved["comparison"]["frames"]:
                image = client.get(frame["imageUrl"])
                assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    tutorial = json.loads((FIXTURES / "real" / "response.json").read_text())
    replay = TestClient(create_app(Pipeline(FixtureClient(), LocalStore(FIXTURES / "real" / "evidence"), ProcessingConfig())))
    assert replay.get("/api/comparisons/" + tutorial["comparison"]["id"]).json() == tutorial


def test_tutorial_inputs_fail_current_geometry_policy_and_are_not_relaxed(tmp_path):
    # The retained tutorial cutouts were requested with the old 10% margin. Under the
    # current policy they are honestly rejected; the saved comparison above still replays.
    client = RecordedClient(FIXTURES / "real" / "sources.json")
    field = FieldRequest.model_validate(client.record["field"])
    response = Pipeline(client, LocalStore(tmp_path), ProcessingConfig()).build(field)
    assert response.status == "no_comparable_pair"
    assert {r["reason"] for r in response.diagnostics["rejectedObservations"]} == {"insufficient_geometric_coverage"}
    assert not (tmp_path / "manifests").exists()


class NoNetwork:
    evidence_kind = discovery_scope = "must_not_be_used"

    def discover(self, *args, **kwargs):
        raise AssertionError("replay must not query the archive")
    retrieve = discover


REAL_TARGET_FIXTURES = sorted(p.parent for p in FIXTURES.glob("real-*/sources.json"))


@pytest.mark.skipif(not REAL_TARGET_FIXTURES, reason="no challenge-target real fixture is retained")
@pytest.mark.parametrize("root", REAL_TARGET_FIXTURES, ids=lambda p: p.name)
def test_real_target_fixture_replays_after_restart_without_network(tmp_path, root):
    record = json.loads((root / "sources.json").read_text())
    saved = json.loads((root / "response.json").read_text())
    cid = record["originalComparisonId"]
    assert saved["comparison"]["provenance"]["evidenceKind"] == "real_archive"  # live-discovered
    assert saved["comparison"]["field"]["fovArcmin"] == 6
    # A fresh process with no archive access serves the identical saved evidence.
    client = TestClient(create_app(Pipeline(NoNetwork(), LocalStore(root / "evidence"), ProcessingConfig())))
    replay = client.get(f"/api/comparisons/{cid}")
    assert replay.status_code == 200 and replay.json() == saved
    for frame, source in zip(saved["comparison"]["frames"], record["sources"]):
        png = client.get(frame["imageUrl"])
        assert png.status_code == 200 and Image.open(BytesIO(png.content)).size == (59, 59)
        original = client.get(frame["imageUrl"].replace(".png", ".fits"))
        assert hashlib.sha256(original.content).hexdigest() == frame["sourceSha256"] == source["sha256"]
        assert frame["sourceUrl"].startswith("https://irsa.ipac.caltech.edu/ibe/data/spherex/")
    # Offline reprocessing of the retained cutouts is labelled differently, gets its
    # own ID, and reproduces the saved pixels in this environment.
    recorded = RecordedClient(root / "sources.json")
    config = ProcessingConfig.model_validate(saved["comparison"]["config"])
    again = Pipeline(recorded, LocalStore(tmp_path), config).build(FieldRequest.model_validate(record["field"]))
    assert again.status == "ready" and again.comparison.id != cid
    assert again.comparison.provenance["evidenceKind"] == "saved_real_example"
    assert [f.id for f in again.comparison.frames] == [f["id"] for f in saved["comparison"]["frames"]]
    for frame in again.comparison.frames:
        assert (LocalStore(tmp_path).asset(again.comparison.id, frame.id + ".png")[0]
                == LocalStore(root / "evidence").asset(cid, frame.id + ".png")[0])
