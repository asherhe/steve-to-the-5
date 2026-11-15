import copy
import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.findings.api import create_router
from services.findings.supabase import ApiError, Author
from services.findings.models import ReviewInput, ReviewResponse, LeaderboardResult

ROOT = Path(__file__).resolve().parents[3]
COMPARISON = json.loads((ROOT / "fixtures/archive/real/response.json").read_text(encoding="utf-8"))["comparison"]
EVIDENCE = ROOT / "fixtures/archive/real/evidence"
BLOBS = json.loads((EVIDENCE / "manifests" / f"{COMPARISON['id']}.json").read_text(encoding="utf-8"))["assets"]


def spherex_fits(frame_id):
    return (EVIDENCE / "blobs" / BLOBS[f"{frame_id}.fits"]).read_bytes()


def brightest_point():
    """Sky position of the brightest valid pixel well inside the first saved SPHEREx frame."""
    import io
    import numpy as np
    from astropy.io import fits
    from astropy.wcs import WCS
    with fits.open(io.BytesIO(spherex_fits(COMPARISON["frames"][0]["id"]))) as hdus:
        image, wcs = hdus["IMAGE"].data.astype(float), WCS(hdus["IMAGE"].header).celestial
    grid = COMPARISON["grid"]
    grid_wcs = WCS(grid["fitsHeader"]).celestial
    for index in np.argsort(np.nan_to_num(image, nan=-np.inf), axis=None)[::-1]:
        y, x = np.unravel_index(index, image.shape)
        ra, dec = (float(v) for v in wcs.pixel_to_world_values(x, y))
        gx, gy = grid_wcs.world_to_pixel_values(ra, dec)
        # Inside the saved comparison footprint, as a marked point must be.
        if 0 <= gx < grid["width"] - 1 and 0 <= gy < grid["height"] - 1:
            return ra % 360, dec
    raise AssertionError("no pixel inside the saved footprint")


def wise_fits(ra, dec, amplitude):
    """A WISE-service-style combined frame (primary HDU, DN, TAN WCS) with noise and a source."""
    import io
    import numpy as np
    from astropy.io import fits
    from astropy.wcs import WCS
    wcs = WCS(naxis=2)
    wcs.wcs.ctype, wcs.wcs.crval, wcs.wcs.crpix = ["RA---TAN", "DEC--TAN"], [ra, dec], [21, 21]
    wcs.wcs.cdelt = [-2.75 / 3600, 2.75 / 3600]
    rows, cols = np.indices((41, 41))
    image = 100 + np.random.default_rng(1).normal(0, 1, (41, 41)) + amplitude * np.exp(-((cols - 20) ** 2 + (rows - 20) ** 2) / 2.0)
    header = wcs.to_header()
    header["BUNIT"] = "DN"
    output = io.BytesIO()
    fits.PrimaryHDU(image.astype(np.float32), header).writeto(output)
    return output.getvalue()
AUTHOR = "33333333-3333-4333-8333-333333333333"
NAMES = ("Gaia DR3", "SIMBAD", "CatWISE2020", "UltracoolSheet", "SkyBoT", "VizieR")


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.comparison = copy.deepcopy(COMPARISON)
        self.input = {"ra": COMPARISON["field"]["ra"], "dec": COMPARISON["field"]["dec"],
                      "comparisonId": COMPARISON["id"], "frameId": COMPARISON["frames"][0]["id"],
                      "radiusArcsec": 120, "survey": "spherex"}
        self.report = {"mode": "live", "ra": self.input["ra"], "dec": self.input["dec"], "radiusArcsec": 120,
                       "observedAtUtc": COMPARISON["frames"][0]["observedAtUtc"],
                       "checks": [{"catalog": name, "status": "no_candidates", "rows": []} for name in NAMES]}
        self.loader = AsyncMock(side_effect=lambda *_: copy.deepcopy(self.comparison))
        self.wise_comparison = {**copy.deepcopy(COMPARISON), "id": "wise-saved",
                                "frames": [{"id": "wise-frame", "observedAtUtc": "2014-05-01T00:00:00Z"}]}
        self.wise = AsyncMock(side_effect=lambda identifier: copy.deepcopy(
            self.wise_comparison if identifier == "wise-saved" else self.comparison))
        self.wise_amplitude = 0.0
        async def assets(survey, comparison_id, name):
            if survey == "wise":
                return wise_fits(self.input["ra"], self.input["dec"], self.wise_amplitude)
            return spherex_fits(name.removesuffix(".fits"))
        self.assets = AsyncMock(side_effect=assets)
        self.catalogs = AsyncMock(side_effect=lambda *_: copy.deepcopy(self.report))
        self.db = AsyncMock()
        self.db.user.return_value = Author(AUTHOR, "Observer")
        self.records = {}
        self.writes = []
        async def request(method, table, **kwargs):
            if method == "POST" and table == "spherex_candidate_reviews":
                row = kwargs["json"]
                self.records[row["id"]] = row
            elif method == "GET":
                row = self.records.get(kwargs["params"]["id"][3:])
                return [row] if row and kwargs["params"]["author_id"] == "eq." + row["author_id"] else []
            else:
                self.writes.append(kwargs["json"])
        self.db.request.side_effect = request
        self.db.rpc.return_value = []
        app = FastAPI()
        app.include_router(create_router(self.db, self.loader, load_wise_comparison=self.wise, load_catalog_review=self.catalogs,
                                         load_asset=self.assets))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {"Authorization": "Bearer fixture-session"}

    def review(self, **changes):
        return self.client.post("/api/findings/reviews", json={**self.input, **changes}, headers=self.headers)

    def finding(self, review_id, **changes):
        body = {"comparisonId": self.input["comparisonId"], "ra": self.input["ra"], "dec": self.input["dec"],
                "title": "Cold-object question", "note": "Please inspect these dated images.", "reviewId": review_id,
                "marks": [{"frameId": self.input["frameId"], "ra": self.input["ra"], "dec": self.input["dec"]}]}
        return self.client.post("/api/findings", json={**body, **changes}, headers=self.headers)

    def test_review_save_and_server_score_preserve_original_evidence(self):
        result = self.review()
        self.assertEqual(result.status_code, 201, result.text)
        review = result.json()
        # Uncatalogued, but only one survey was supplied, so it cannot be bright in two.
        self.assertEqual((review["scoreVersion"], review["classification"], review["score"]), ("point-check-v2", "uncatalogued", 0))
        self.assertEqual([m["frameId"] for m in review["brightness"]], [f["id"] for f in COMPARISON["frames"]])
        self.assertEqual(self.finding(review["id"]).status_code, 201)
        self.assertEqual(self.writes[0]["review_id"], review["id"])
        self.assertEqual(self.comparison, COMPARISON)
        self.assertEqual(self.catalogs.await_args.args[-1], COMPARISON["frames"][0]["observedAtUtc"])

    def test_known_object_scores_ten_and_incomplete_scores_zero(self):
        self.report["checks"][0].update(status="candidates", rows=[{"sourceId": "123"}])
        known = self.review().json()
        self.assertEqual((known["classification"], known["score"], known["brightness"]), ("known", 10, []))
        self.assets.assert_not_called()
        self.report["checks"][0].update(status="unavailable", rows=[])
        incomplete = self.review().json()
        self.assertEqual((incomplete["classification"], incomplete["score"]), ("incomplete", 0))
        # Zero-point reviews can still be posted for discussion.
        self.assertEqual(self.finding(incomplete["id"]).status_code, 201)

    def test_uncatalogued_point_bright_in_two_surveys_scores_twenty(self):
        ra, dec = brightest_point()
        self.input.update(ra=ra, dec=dec)
        self.report.update(ra=ra, dec=dec)
        evidence = [{"survey": "wise", "comparisonId": "wise-saved"}]
        self.wise_amplitude = 40.0
        bright = self.review(brightnessEvidence=evidence).json()
        self.assertEqual((bright["classification"], bright["score"]), ("uncatalogued", 20), bright)
        self.assertEqual({m["survey"] for m in bright["brightness"] if m["bright"]}, {"spherex", "wise"})
        self.wise_amplitude = 0.0
        faint_in_wise = self.review(brightnessEvidence=evidence).json()
        self.assertEqual(faint_in_wise["score"], 0)
        self.assertIn("1 of the 2 surveys", faint_in_wise["reasons"][0])

    def test_brightness_evidence_must_be_another_real_survey(self):
        self.assertEqual(self.review(brightnessEvidence=[{"survey": "spherex", "comparisonId": COMPARISON["id"]}]).json()["code"], "invalid_evidence")
        self.wise_comparison["provenance"]["evidenceKind"] = "synthetic_fixture"
        self.assertEqual(self.review(brightnessEvidence=[{"survey": "wise", "comparisonId": "wise-saved"}]).json()["code"], "not_real_evidence")
        self.assertEqual(self.review(brightness=[{"survey": "wise", "bright": True}]).status_code, 422)

    def test_synthetic_and_offline_cannot_rank(self):
        self.comparison["provenance"]["evidenceKind"] = "synthetic_fixture"
        self.assertEqual(self.review().json()["code"], "not_real_evidence")
        self.catalogs.assert_not_called()
        self.comparison = copy.deepcopy(COMPARISON)
        self.report["mode"] = "offline"
        self.assertEqual(self.review().json()["code"], "catalogs_offline")
        self.assertEqual(self.records, {})

    def test_auth_and_score_spoofing(self):
        self.assertEqual(self.client.post("/api/findings/reviews", json=self.input).status_code, 401)
        self.assertEqual(self.review(score=500).status_code, 422)
        self.assertEqual(self.review(authorId=AUTHOR).status_code, 422)
        self.loader.assert_not_called()

    def test_position_frame_and_snapshot_binding(self):
        self.assertEqual(self.review(ra=0).json()["code"], "outside_evidence")
        self.assertEqual(self.review(frameId="wrong").json()["code"], "invalid_frame")
        review = self.review().json()
        self.assertEqual(self.finding(review["id"], ra=0).json()["code"], "invalid_review")
        self.assertEqual(self.finding(review["id"], marks=[]).json()["code"], "invalid_review")
        self.records[review["id"]]["author_id"] = "44444444-4444-4444-8444-444444444444"
        self.assertEqual(self.finding(review["id"]).json()["code"], "invalid_review")
        self.assertEqual(self.writes, [])

    def test_wise_uses_its_own_saved_loader(self):
        self.assertEqual(self.review(survey="wise").status_code, 201)
        self.loader.assert_not_called()
        self.wise.assert_awaited_once()

    def test_mismatched_or_duplicate_catalog_response_fails_closed(self):
        self.report["ra"] = 0
        self.assertEqual(self.review().json()["code"], "catalog_review_invalid")
        self.report["ra"] = self.input["ra"]
        self.report["checks"][0]["catalog"] = "SIMBAD"
        self.assertEqual(self.review().json()["code"], "catalog_review_invalid")
        self.assertEqual(self.records, {})

    def test_public_leaderboard_is_not_a_placeholder(self):
        response = self.client.get("/api/findings/leaderboard?board=allTime")
        self.assertEqual(response.json(), {"board": "allTime", "placeholder": False, "entries": []})
        self.db.user.assert_not_called()
        self.assertEqual(self.client.get("/api/findings/leaderboard?board=wrong").status_code, 422)

    def test_shared_fixtures_and_openapi_match_backend(self):
        fixtures = ROOT / "services/findings/fixtures"
        data = json.loads((fixtures / "candidate-flow.json").read_text(encoding="utf-8"))
        ReviewInput.model_validate(data["request"])
        ReviewResponse.model_validate(data["review"])
        LeaderboardResult.model_validate(data["leaderboard"])
        self.assertEqual(json.loads((fixtures / "openapi.json").read_text(encoding="utf-8")), self.client.app.openapi())
