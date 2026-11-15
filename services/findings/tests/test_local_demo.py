"""Local demo point scoring: same rules as the live service, no Supabase, nothing stored in a
database. The live rules now need a real saved WISE blink, so the demo does too."""
import copy
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
from services.findings.api import LOCAL_DEMO_NOTE, create_local_demo_router  # noqa: E402
from services.findings.cutouts import Frame, SourceResult  # noqa: E402
from services.findings.main import create_app, saved_comparison  # noqa: E402
from services.findings.spectral_store import SpectralStore  # noqa: E402
from test_point_reviews import DEC, RA, image, report  # noqa: E402
from test_spectral_points import evidence_directory, wise_blink  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SAVED = json.loads((ROOT / "fixtures/archive/real-barnard/response.json").read_text())
BLINK, ASSETS = wise_blink(change=1)
BRIGHT = [SourceResult("wise", "ok", [Frame("WISE", "u", image(40))]),
          SourceResult("dss", "ok", [Frame("DSS", "u", image(40))])]


class LocalDemoTests(unittest.TestCase):
    def setUp(self):
        self.directory = evidence_directory()
        self.store = SpectralStore(self.directory.__enter__())

    def tearDown(self):
        self.directory.__exit__(None, None, None)

    def client(self, catalog, sources):
        async def catalogs(*_):
            return copy.deepcopy(catalog)

        async def cutouts(*_):
            return sources

        async def wise(identifier):
            # The WISE service's envelope, unwrapped as the real loader does.
            body = {"status": "ready", "comparison": copy.deepcopy(BLINK), "diagnostics": {}} if identifier == BLINK["id"] else None
            return saved_comparison(body)

        async def spherex(identifier):
            return None

        app = FastAPI()
        app.include_router(create_local_demo_router(spherex, load_wise_comparison=wise, load_catalog_review=catalogs,
                                                    load_cutouts=cutouts, load_asset=ASSETS, spectral_store=self.store))
        return TestClient(app)

    def score(self, catalog, sources, **body):
        return self.client(catalog, sources).post("/api/findings/demo/points/review",
                                                  json={"ra": RA, "dec": DEC, "wiseComparisonId": BLINK["id"], **body})

    def test_bright_uncatalogued_point_scores_twenty_without_sign_in(self):
        response = self.score(report(), BRIGHT)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["classification"], body["score"]), ("uncatalogued", 20))
        self.assertEqual(body["scoreVersion"], "point-check-v4")
        self.assertIsNone(body["duplicate"])
        self.assertEqual(body["limitations"][0], LOCAL_DEMO_NOTE)
        self.assertTrue(any(m["bright"] for m in body["brightness"]))

    def test_faint_point_scores_zero_and_known_object_ten(self):
        faint = [SourceResult("wise", "ok", [Frame("WISE", "u", image(0))])]
        self.assertEqual(self.score(report(), faint).json()["score"], 0)
        known = report()
        known["checks"][1].update(status="candidates", rows=[{"main_id": "Example", "ra": RA, "dec": DEC}])
        self.assertEqual(self.score(known, None).json()["classification"], "known")

    def test_gaia_outage_does_not_block_the_demo(self):
        catalog = report(**{"Gaia DR3": "unavailable", "SIMBAD": "unavailable", "CatWISE2020": "unavailable"})
        body = self.score(catalog, BRIGHT).json()
        self.assertEqual((body["classification"], body["score"]), ("uncatalogued", 20))
        self.assertTrue(any("Gaia DR3 could not be checked" in reason for reason in body["reasons"]))

    def test_the_wise_blink_is_required_as_in_the_live_service(self):
        response = self.client(report(), BRIGHT).post("/api/findings/demo/points/review", json={"ra": RA, "dec": DEC})
        self.assertEqual((response.status_code, response.json()["code"]), (422, "wise_blink_required"))
        response = self.score(report(), BRIGHT, wiseComparisonId="missing")
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
