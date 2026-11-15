"""Synthetic checks for the WISE time-lapse backend. No archive access."""
from io import BytesIO

from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient
import numpy as np
import pytest

from services.archive.models import ArchiveError, Discovery, Retrieval
from services.archive.storage import LocalStore
from services.wise.api import create_app
from services.wise.client import parse_search
from services.wise.models import Exposure, WiseConfig, WiseFieldRequest
from services.wise.pipeline import WisePipeline, group_epochs, spaced


FIELD = WiseFieldRequest(ra=150.0, dec=20.0, fovArcmin=4, band=2)
STARS = [(150.02, 20.015, 400), (149.975, 19.985, 300), (150.01, 19.975, 350), (149.985, 20.02, 250)]


def exposure(index, mjd, dataset="neowiser"):
    name = f"{10000 + index}r{index % 200:03d}"
    return Exposure(exposure_id=f"{name}-w2", dataset=dataset, release="neowise-r", band=2,
                    scan_id=name[:6], scangrp="0r", frame_num=index % 200, mjd_obs=mjd,
                    source_url=f"https://irsa.ipac.caltech.edu/ibe/data/synthetic/{name}-w2-int-1b.fits",
                    magzp=19.6, qual_frame=10)


def cutout(seed, target_offset_deg=0.0, background=40.0, cosmic_ray=False, size=121, band=2):
    """A synthetic single exposure: fixed stars, a movable central source, noise."""
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---SIN", "DEC--SIN"]
    wcs.wcs.crval = [150.0, 20.0]
    wcs.wcs.crpix = [(size + 1) / 2 + 0.3, (size + 1) / 2 - 0.2]
    wcs.wcs.cdelt = [-2.75 / 3600, 2.75 / 3600]
    image = background + np.random.default_rng(seed).normal(0, 1, (size, size))
    yy, xx = np.indices(image.shape)
    for ra, dec, flux in STARS + [(150.0 + target_offset_deg, 20.0, 500)]:
        x, y = wcs.world_to_pixel_values(ra, dec)
        image += flux * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 1.1 ** 2))
    if cosmic_ray:
        image[30, 30] += 5000
    header = wcs.to_header()
    header["BUNIT"], header["BAND"], header["WRELEASE"] = "DN", band, "synthetic-v1"
    output = BytesIO()
    fits.PrimaryHDU(image.astype(np.float32), header).writeto(output)
    return output.getvalue()


class FakeClient:
    evidence_kind = "synthetic_fixture"
    discovery_scope = "synthetic_exposures"

    def __init__(self, items, discovery_failures=(), discovery_error=None, retrieval_failures=()):
        self.items = items  # [(Exposure, bytes)]
        self.discovery_failures = list(discovery_failures)
        self.discovery_error = discovery_error
        self.retrieval_failures = set(retrieval_failures)

    def discover(self, field, deadline=None, on_done=None):
        if self.discovery_error:
            raise self.discovery_error
        for _ in range(4):
            on_done and on_done()
        return Discovery(sorted((e for e, _ in self.items), key=lambda e: e.mjd_obs), self.discovery_failures)

    def retrieve(self, exposures, field, size_deg, deadline=None, on_done=None):
        for _ in exposures:
            on_done and on_done()
        data = {e.exposure_id: raw for e, raw in self.items}
        wanted = [e for e in exposures if e.exposure_id not in self.retrieval_failures]
        failed = [{"exposureId": e.exposure_id, "dataset": e.dataset, "category": "transient_http",
                   "code": "UPSTREAM_ERROR", "attempts": 3}
                  for e in exposures if e.exposure_id in self.retrieval_failures]
        return Retrieval([(e, data[e.exposure_id]) for e in wanted], failed)


def visits(count=3, per_visit=3, step_deg=0.0, **options):
    """`count` visits half a year apart, each of `per_visit` exposures two hours apart."""
    items = []
    for visit in range(count):
        for shot in range(per_visit):
            index = visit * 20 + shot
            items.append((exposure(index, 57000 + 182.6 * visit + shot / 12),
                          cutout(index, target_offset_deg=step_deg * visit, **options)))
    return items


def pipeline(tmp_path, items, config=None, **options):
    return WisePipeline(FakeClient(items, **options), LocalStore(tmp_path / "evidence"), config or WiseConfig())


def test_epochs_split_on_gap_and_on_long_span():
    config = WiseConfig()
    times = [0, 0.1, 0.2, 180, 180.1, 400, 409, 418, 427]
    epochs = group_epochs([exposure(i, 57000 + t) for i, t in enumerate(times)], config)
    assert [len(e) for e in epochs] == [3, 2, 2, 2]
    # A change of mission phase always starts a new epoch.
    mixed = [exposure(0, 57000), exposure(1, 57000.1, dataset="postcryo_2band")]
    assert len(group_epochs(mixed, config)) == 2


def test_spaced_keeps_both_ends():
    assert spaced(list(range(10)), 4) == [0, 3, 6, 9]
    assert spaced(list(range(3)), 5) == [0, 1, 2]
    assert spaced(list(range(9)), 1) == [4]


def test_search_table_is_parsed_into_dated_exposures():
    text = "\n".join([
        "\\fixlen = T", "\\RowsRetrieved = 2", "\\QUERY_STATUS = 'OK'",
        "|band|scan_id|scangrp|frame_num|       mjd_obs|   magzp|qual_frame|",
        "| int|   char|   char|      int|        double|  double|       int|",
        "    2  60993r      3r        75 60418.39640918 19.64350         10 ",
        "    1  60993r      3r        75 60418.39640918 20.50000         10 ", ""])
    found = parse_search(text, "neowiser", "wise/neowiser/p1bm_frm", "neowise-r", 2)
    assert len(found) == 1
    assert found[0].exposure_id == "60993r075-w2" and found[0].mjd_obs == 60418.39640918
    assert found[0].source_url == ("https://irsa.ipac.caltech.edu/ibe/data/wise/neowiser/p1bm_frm/"
                                   "3r/60993r/075/60993r075-w2-int-1b.fits")
    with pytest.raises(ValueError):
        parse_search("\\QUERY_STATUS = 'ERROR'\n", "neowiser", "x", "neowise-r", 2)


def test_ready_time_lapse_records_every_contributing_exposure(tmp_path):
    items = visits()
    response = pipeline(tmp_path, items).build(FIELD)
    assert response.status == "ready" and response.diagnostics["complete"] is True
    comparison = response.comparison
    assert len(comparison.frames) == 3
    assert comparison.stretch.unit == "DN" and comparison.grid.pixel_scale_arcsec == 2.75
    assert comparison.provenance["evidenceKind"] == "synthetic_fixture"
    for visit, (frame, record) in enumerate(zip(comparison.frames, comparison.provenance["inputs"])):
        mjds = [e.mjd_obs for e, _ in items[visit * 3:visit * 3 + 3]]
        # Displayed time is the midpoint of the first and last exposure used.
        assert frame.observed_at_utc.isoformat() == comparison.frames[visit].observed_at_utc.isoformat()
        assert abs((frame.observation_end_utc - frame.observation_start_utc).total_seconds()
                   - (mjds[-1] - mjds[0]) * 86400) < 1e-3
        assert frame.observation_start_utc <= frame.observed_at_utc <= frame.observation_end_utc
        assert frame.quality_flags["combinedExposures"] == 3
        assert [x["exposure"]["exposureId"] for x in record["exposures"]] == [e.exposure_id for e, _ in items[visit * 3:visit * 3 + 3]]
        assert all(len(x["sourceSha256"]) == 64 for x in record["exposures"])
        assert frame.image_url.startswith(f"/api/wise/comparisons/{comparison.id}/assets/")
    assert comparison.frames[0].alignment == "reference_frame"
    assert all(frame.alignment == "verified" for frame in comparison.frames[1:])


def test_replay_returns_the_saved_manifest_and_assets(tmp_path):
    built = pipeline(tmp_path, visits())
    response = built.build(FIELD)
    saved = built.store.load_raw(response.comparison.id)
    assert saved == response.model_dump(mode="json", by_alias=True)
    frame = response.comparison.frames[0]
    png, _ = built.store.asset(response.comparison.id, f"{frame.id}.png")
    assert png.startswith(b"\x89PNG")
    # Every contributing source cutout is retained under its content hash.
    for record in response.comparison.provenance["inputs"][0]["exposures"]:
        raw, sha = built.store.asset(response.comparison.id, f"{record['sourceSha256']}.fits")
        assert sha == record["sourceSha256"] and raw.startswith(b"SIMPLE")
    # Replay does not consult current defaults: a different configuration still loads it.
    other = WisePipeline(FakeClient([]), built.store, WiseConfig(exposuresPerEpoch=2, maxEpochs=2))
    assert other.store.load_raw(response.comparison.id) == saved


def test_identity_is_stable_and_follows_scientific_inputs(tmp_path):
    first = pipeline(tmp_path, visits()).build(FIELD).comparison.id
    assert pipeline(tmp_path, visits()).build(FIELD).comparison.id == first
    assert pipeline(tmp_path, visits(background=41.0)).build(FIELD).comparison.id != first
    assert pipeline(tmp_path, visits(), WiseConfig(exposuresPerEpoch=2)).build(FIELD).comparison.id != first
    wider = WiseFieldRequest(ra=150.0, dec=20.0, fovArcmin=4.5, band=2)
    assert pipeline(tmp_path, visits()).build(wider).comparison.id != first


def test_median_rejects_a_single_exposure_artefact_and_keeps_motion(tmp_path):
    step = 3 * 2.75 / 3600  # three pixels per visit, eastward on the sky
    items = visits(step_deg=step / np.cos(np.radians(20.0)))
    items[1] = (items[1][0], cutout(1, cosmic_ray=True))
    built = pipeline(tmp_path, items)
    response = built.build(FIELD)
    peaks = []
    for frame in response.comparison.frames:
        raw, _ = built.store.asset(response.comparison.id, f"{frame.id}.fits")
        image = fits.getdata(BytesIO(raw))
        centre = image.shape[0] // 2
        assert np.nanmax(image[20:40, 20:40]) < 50  # the artefact is not in the combined frame
        row = image[centre - 3:centre + 4].sum(axis=0)
        peaks.append(int(np.nanargmax(row[centre - 12:centre + 13])) - 12)
    # The target is not aligned away: east is toward lower x, three pixels per visit.
    # (The grid is even-sized, so the centre falls between two pixels.)
    assert peaks[0] in (-1, 0) and np.diff(peaks).tolist() == [-3, -3]


def test_only_a_few_evenly_spaced_visits_are_built(tmp_path):
    items = visits(count=10)
    response = pipeline(tmp_path, items).build(FIELD)
    frames = response.comparison.frames
    assert WiseConfig().max_epochs == 6 and len(frames) == 6
    # The first and last visit are always kept, so the baseline is the full one.
    assert frames[0].observation_id.startswith(items[0][0].exposure_id)
    assert frames[-1].observation_id.endswith(items[-1][0].exposure_id)
    assert response.diagnostics["epochs"] == {"discovered": 10, "sampled": 6, "exposuresRequested": 18,
                                              "exposuresNotRequested": 12, "tooFewExposures": 0}
    # Choosing a few visits is the design, not a failed search.
    assert response.diagnostics["complete"] is True
    assert any(text.startswith("6 of the 10 visits found are sampled") for text in response.comparison.limitations)


def test_progress_runs_through_every_stage_and_never_goes_back(tmp_path):
    seen = []
    response = pipeline(tmp_path, visits()).build(FIELD, seen.append)
    assert response.status == "ready"
    assert [s["stage"] for s in seen if s["done"] == 0] == ["discovery", "retrieval", "combination", "publication"]
    fractions = [s["fraction"] for s in seen]
    assert fractions == sorted(fractions) and fractions[0] == 0 and fractions[-1] == 1
    downloads = [s for s in seen if s["stage"] == "retrieval"]
    assert downloads[-1]["done"] == downloads[-1]["total"] == 9
    # Reporting is display only: the saved evidence is the same with and without it.
    assert pipeline(tmp_path, visits()).build(FIELD).comparison.id == response.comparison.id


def test_single_epoch_and_no_coverage_are_reported_states(tmp_path):
    assert pipeline(tmp_path, visits(count=1)).build(FIELD).status == "single_epoch"
    empty = pipeline(tmp_path, []).build(FIELD)
    assert empty.status == "no_coverage" and empty.comparison is None and empty.diagnostics["complete"] is True


def test_upstream_failures_are_never_reported_as_absence(tmp_path):
    down = ArchiveError("UPSTREAM_ERROR", "IRSA request failed after bounded retries",
                        details={"category": "timeout", "attempts": 3})
    assert pipeline(tmp_path, [], discovery_error=down).build(FIELD).status == "upstream_unavailable"
    partial = pipeline(tmp_path, [], discovery_failures=[{"dataset": "neowiser", "category": "timeout"}]).build(FIELD)
    assert partial.status == "upstream_unavailable" and partial.diagnostics["code"] == "INCOMPLETE_DISCOVERY"
    items = visits()
    lost = pipeline(tmp_path, items, retrieval_failures={e.exposure_id for e, _ in items}).build(FIELD)
    assert lost.status == "upstream_unavailable" and lost.comparison is None
    # Losing one exposure still builds, and the manifest says the search was incomplete.
    some = pipeline(tmp_path, items, retrieval_failures={items[0][0].exposure_id}).build(FIELD)
    assert some.status == "ready" and some.diagnostics["incompleteStages"] == ["retrieval"]
    assert some.comparison.frames[0].quality_flags["combinedExposures"] == 2
    assert any("incomplete" in text for text in some.comparison.limitations)


def test_truncated_coverage_rejects_the_epoch(tmp_path):
    items = visits(count=2)
    # The second visit's cutouts stop short of the field edge.
    items[3:] = [(e, cutout(i, size=61)) for i, (e, _) in enumerate(items[3:])]
    response = pipeline(tmp_path, items).build(FIELD)
    assert response.status == "single_epoch"
    assert response.diagnostics["rejectedEpochs"][0]["reason"] == "insufficient_valid_coverage"


def test_http_contract(tmp_path):
    built = pipeline(tmp_path, visits())
    client = TestClient(create_app(built))
    assert client.get("/api/wise/comparisons", params={"ra": 150, "dec": 20, "fovArcmin": 20}).status_code == 422
    assert client.get("/api/wise/comparisons", params={"ra": 150, "dec": 20, "band": 3}).json()["code"] == "INVALID_REQUEST"
    body = client.get("/api/wise/comparisons", params={"ra": 150, "dec": 20, "fovArcmin": 4, "band": 2}).json()
    assert body["status"] == "ready"
    comparison = body["comparison"]
    assert client.get(f"/api/wise/comparisons/{comparison['id']}").json() == body
    image = client.get(comparison["frames"][0]["imageUrl"])
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    missing = client.get(f"/api/wise/comparisons/{'0' * 64}")
    assert missing.status_code == 404 and missing.json()["code"] == "NOT_FOUND"


def test_progress_route_reports_a_running_build_only(tmp_path):
    built = pipeline(tmp_path, visits())
    client = TestClient(create_app(built))
    polled = []
    original = built.client.retrieve

    def retrieve(*args, **kwargs):
        result = original(*args, **kwargs)
        polled.append(client.get("/api/wise/comparisons/progress/progress-test-1"))
        return result
    built.client.retrieve = retrieve
    params = {"ra": 150, "dec": 20, "fovArcmin": 4, "band": 2}
    assert client.get("/api/wise/comparisons", params={**params, "progressId": "bad id"}).status_code == 422
    body = client.get("/api/wise/comparisons", params={**params, "progressId": "progress-test-1"}).json()
    assert body["status"] == "ready"
    state = polled[0].json()
    assert polled[0].status_code == 200 and state["stage"] == "retrieval" and state["done"] == state["total"] == 6
    assert 0.45 < state["fraction"] <= 0.85 and state["elapsedSeconds"] >= 0
    # Finished builds leave nothing behind.
    assert client.get("/api/wise/comparisons/progress/progress-test-1").status_code == 404


def test_cancel_stops_a_running_build_and_publishes_nothing(tmp_path):
    built = pipeline(tmp_path, visits())
    client = TestClient(create_app(built))
    original = built.client.retrieve

    def retrieve(*args, **kwargs):
        # The viewer's Cancel button arrives while downloads are under way.
        assert client.delete("/api/wise/comparisons/progress/cancel-test-1").json() == {"cancelled": True}
        return original(*args, **kwargs)
    built.client.retrieve = retrieve
    params = {"ra": 150, "dec": 20, "fovArcmin": 4, "band": 2, "progressId": "cancel-test-1"}
    response = client.get("/api/wise/comparisons", params=params)
    assert response.status_code == 409 and response.json()["code"] == "BUILD_CANCELLED"
    assert not list((tmp_path / "evidence").glob("manifests/*"))
    # The service is free again straight away, and an unknown ID is not found.
    assert client.delete("/api/wise/comparisons/progress/cancel-test-1").status_code == 404
    built.client.retrieve = original
    assert client.get("/api/wise/comparisons", params={**params, "progressId": "cancel-test-2"}).json()["status"] == "ready"
