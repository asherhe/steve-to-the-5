"""Local demo point scoring: same rules as the live service, no Supabase, nothing stored."""
import copy
import json
import os
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.findings.api import LOCAL_DEMO_NOTE, create_local_demo_router
from services.findings.cutouts import Frame, SourceResult
from services.findings.main import create_app, saved_comparison
from services.findings.tests.test_point_reviews import DEC, RA, image, report

ROOT = Path(__file__).resolve().parents[3]
SAVED = json.loads((ROOT / "fixtures/archive/real-barnard/response.json").read_text())


def demo_client(catalog, sources, comparisons=None):
    comparisons = comparisons or {}

    async def catalogs(*_):
        return copy.deepcopy(catalog)

    async def cutouts(*_):
        return sources

    async def spherex(identifier):
        return saved_comparison(copy.deepcopy(comparisons.get(identifier)))

    app = FastAPI()
    app.include_router(create_local_demo_router(spherex, load_wise_comparison=spherex,
                                                load_catalog_review=catalogs, load_cutouts=cutouts))
    return TestClient(app)


BRIGHT = [SourceResult("wise", "ok", [Frame("WISE", "u", image(40))]),
          SourceResult("dss", "ok", [Frame("DSS", "u", image(40))])]


class LocalDemoTests(unittest.TestCase):
    def test_bright_uncatalogued_point_scores_twenty_without_sign_in(self):
        response = demo_client(report(), BRIGHT).post("/api/findings/demo/points/review", json={"ra": RA, "dec": DEC})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["classification"], body["score"]), ("uncatalogued", 20))
        self.assertEqual(body["scoreVersion"], "point-check-v3")
        self.assertIsNone(body["duplicate"])
        self.assertEqual(body["limitations"][0], LOCAL_DEMO_NOTE)
        self.assertTrue(any(m["bright"] for m in body["brightness"]))

    def test_faint_point_scores_zero_and_known_object_ten(self):
        faint = [SourceResult("wise", "ok", [Frame("WISE", "u", image(0))])]
        self.assertEqual(demo_client(report(), faint).post(
            "/api/findings/demo/points/review", json={"ra": RA, "dec": DEC}).json()["score"], 0)
        known = report()
        known["checks"][1].update(status="candidates", rows=[{"main_id": "Example", "ra": RA, "dec": DEC}])
        self.assertEqual(demo_client(known, None).post(
            "/api/findings/demo/points/review", json={"ra": RA, "dec": DEC}).json()["score"], 10)

    def test_frame_time_comes_from_the_wrapped_saved_comparison(self):
        comparison = SAVED["comparison"]
        frame = comparison["frames"][1]
        field = comparison["field"]
        catalog = report(observed=frame["observedAtUtc"], SkyBoT="no_candidates")
        catalog.update(ra=field["ra"], dec=field["dec"])
        client = demo_client(catalog, BRIGHT, {comparison["id"]: SAVED})  # archive shape: {status, comparison, ...}
        body = client.post("/api/findings/demo/points/review", json={
            "ra": field["ra"], "dec": field["dec"],
            "frame": {"survey": "spherex", "comparisonId": comparison["id"], "frameId": frame["id"]}}).json()
        self.assertEqual(body.get("observedAtUtc"), frame["observedAtUtc"], body)

    def test_errors_match_the_live_service(self):
        client = demo_client(report(), BRIGHT)
        response = client.post("/api/findings/demo/points/review", json={
            "ra": RA, "dec": DEC, "frame": {"survey": "wise", "comparisonId": "missing", "frameId": "x"}})
        self.assertEqual((response.status_code, response.json()["code"]), (422, "invalid_comparison"))

    def test_saved_comparison_unwraps_only_the_service_envelope(self):
        self.assertEqual(saved_comparison(SAVED)["id"], SAVED["comparison"]["id"])
        bare = {"id": "abc", "frames": []}
        self.assertIs(saved_comparison(bare), bare)
        self.assertIsNone(saved_comparison(None))

    def test_demo_mode_needs_no_supabase_and_exposes_only_scoring(self):
        with mock.patch.dict(os.environ, {"FINDINGS_LOCAL_DEMO": "1"}, clear=True):
            paths = [p for p in create_app().openapi()["paths"] if p.startswith("/api")]
        self.assertEqual(paths, ["/api/findings/demo/points/review"])
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                create_app()  # without the flag the live service still requires Supabase


if __name__ == "__main__":
    unittest.main()
