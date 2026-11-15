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
        self.wise = AsyncMock(side_effect=lambda *_: copy.deepcopy(self.comparison))
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
        app.include_router(create_router(self.db, self.loader, load_wise_comparison=self.wise, load_catalog_review=self.catalogs))
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
        self.assertEqual(review["score"], 50)
        self.assertEqual(self.finding(review["id"]).status_code, 201)
        self.assertEqual(self.writes[0]["review_id"], review["id"])
        self.assertEqual(self.comparison, COMPARISON)
        self.assertEqual(self.catalogs.await_args.args[-1], COMPARISON["frames"][0]["observedAtUtc"])

    def test_unmatched_and_matched_get_same_points_outages_do_not(self):
        self.report["checks"][0].update(status="candidates", rows=[{"sourceId": "123"}])
        self.assertEqual(self.review().json()["score"], 50)
        self.report["checks"][0]["status"] = "unavailable"
        self.report["checks"][1]["status"] = "partial"
        self.assertEqual(self.review().json()["score"], 40)

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
