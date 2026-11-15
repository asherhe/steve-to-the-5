"""point-check-v3 scoring: server-side catalog chain and cutout brightness, no saved comparison."""
import asyncio
import copy
import io
import json
import unittest
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from services.findings.cutouts import Frame, SourceResult
from services.findings.models import PointReviewInput
from services.findings.point_review import known_identity, prepare_point_review
from services.findings.supabase import ApiError

ROOT = Path(__file__).resolve().parents[3]
NAMES = ("Gaia DR3", "SIMBAD", "CatWISE2020", "UltracoolSheet", "SkyBoT", "VizieR")
RA, DEC = 133.8, -7.25


def image(amplitude, extra=None):
    """A TAN-WCS single-image FITS (DSS/WISE/NEOSSat style) with noise and an optional source."""
    wcs = WCS(naxis=2)
    wcs.wcs.ctype, wcs.wcs.crval, wcs.wcs.crpix = ["RA---TAN", "DEC--TAN"], [RA, DEC], [31, 31]
    wcs.wcs.cdelt = [-1.5 / 3600, 1.5 / 3600]
    rows, cols = np.indices((61, 61))
    data = 100 + np.random.default_rng(2).normal(0, 1, (61, 61)) + amplitude * np.exp(-((cols - 30) ** 2 + (rows - 30) ** 2) / 4.0)
    out = io.BytesIO()
    fits.PrimaryHDU(data.astype(np.float32), wcs.to_header()).writeto(out)
    return out.getvalue()


def report(observed=None, **statuses):
    checks = [{"catalog": name, "status": statuses.get(name, "no_candidates"), "rows": []} for name in NAMES]
    if observed is None:
        checks[4]["status"] = statuses.get("SkyBoT", "skipped")
    return {"mode": "live", "ra": RA, "dec": DEC, "radiusArcsec": 30, "observedAtUtc": observed, "checks": checks}


class PointReviewTests(unittest.TestCase):
    def run_review(self, catalog, sources, **body):
        async def catalogs(*_):
            return copy.deepcopy(catalog)
        async def cutouts(*_):
            return sources
        return asyncio.run(prepare_point_review(PointReviewInput(ra=RA, dec=DEC, **body), catalogs, cutouts))

    def test_bright_in_two_surveys_scores_twenty_without_saved_frames(self):
        sources = [SourceResult("spherex", "unavailable", message="IRSA 502"),
                   SourceResult("wise", "ok", [Frame("WISE W2", "https://irsa.example/w2", image(40))]),
                   SourceResult("dss", "ok", [Frame("DSS2 red", "https://dss.example", image(40))]),
                   SourceResult("neossat", "no_coverage")]
        response, _, key = self.run_review(report(), sources)
        self.assertEqual((response.classification, response.score, key), ("uncatalogued", 20, None))
        self.assertEqual({m.survey for m in response.brightness if m.bright}, {"wise", "dss"})
        self.assertIn("SkyBoT", response.reasons[-1])

    def test_bright_in_one_survey_scores_zero_and_names_the_gaps(self):
        sources = [SourceResult("spherex", "unavailable", message="IRSA 502"),
                   SourceResult("wise", "ok", [Frame("WISE W2", "u", image(40))]),
                   SourceResult("dss", "ok", [Frame("DSS2 red", "u", image(0))]),
                   SourceResult("neossat", "no_coverage")]
        response, _, _ = self.run_review(report(), sources)
        self.assertEqual(response.score, 0)
        self.assertIn("1 of the 2", response.reasons[0])
        self.assertIn("SPHEREx, NEOSSat", response.reasons[0])

    def test_known_object_scores_ten_without_any_cutout(self):
        catalog = report()
        catalog["checks"][1].update(status="candidates", rows=[{"main_id": "* tst 1", "ra": RA, "dec": DEC + 2 / 3600}])
        response, candidate_key, key = self.run_review(catalog, None)
        self.assertEqual((response.classification, response.score), ("known", 10))
        self.assertEqual((response.identity.catalog, response.identity.name), ("SIMBAD", "* tst 1"))
        self.assertEqual(candidate_key, key)
        self.assertEqual(response.brightness, [])

    def test_up_to_two_unavailable_catalogs_allow_candidate_brightness(self):
        sources = [SourceResult("wise", "ok", [Frame("WISE", "u", image(40))]),
                   SourceResult("dss", "ok", [Frame("DSS", "u", image(40))])]
        required = NAMES[1:]  # Gaia DR3 is optional; see the Gaia test below.
        for count in range(4):
            with self.subTest(count=count):
                catalog = report(**{name: "unavailable" for name in required[:count]})
                response, _, _ = self.run_review(catalog, sources)
                self.assertEqual((response.classification, response.score),
                                 ("uncatalogued", 20) if count <= 2 else ("incomplete", 0))
                if count:
                    self.assertIn("Unavailable", response.reasons[-1])

    def test_gaia_is_not_required_for_twenty_points(self):
        sources = [SourceResult("wise", "ok", [Frame("WISE", "u", image(40))]),
                   SourceResult("dss", "ok", [Frame("DSS", "u", image(40))])]
        for gaia in ("unavailable", "partial", "skipped"):
            with self.subTest(gaia=gaia):
                # Gaia not checked, plus two other outages: still within the allowance.
                catalog = report(**{"Gaia DR3": gaia, "SIMBAD": "unavailable", "CatWISE2020": "unavailable"})
                response, _, _ = self.run_review(catalog, sources)
                self.assertEqual((response.classification, response.score), ("uncatalogued", 20))
                self.assertTrue(any("Gaia DR3 could not be checked. It is not required for points." in r
                                    for r in response.reasons))
        # A third outage among the required catalogs still blocks points.
        catalog = report(**{"Gaia DR3": "unavailable", "SIMBAD": "unavailable", "CatWISE2020": "unavailable",
                            "VizieR": "unavailable"})
        response, _, _ = self.run_review(catalog, sources)
        self.assertEqual((response.classification, response.score), ("incomplete", 0))

    def test_a_gaia_match_still_makes_a_known_object(self):
        catalog = report()
        catalog["checks"][0].update(status="candidates", rows=[{"sourceId": "1", "ra": RA, "dec": DEC, "separationArcsec": 0.5}])
        response, _, _ = self.run_review(catalog, None)
        self.assertEqual((response.classification, response.score), ("known", 10))
        self.assertFalse(any("not required for points" in r for r in response.reasons))

    def test_partial_empty_is_incomplete_and_actual_match_overrides_outages(self):
        response, _, _ = self.run_review(report(**{"SIMBAD": "partial"}), None)
        self.assertEqual((response.classification, response.score), ("incomplete", 0))
        catalog = report(**{name: "unavailable" for name in NAMES[:3]})
        catalog["checks"][-1].update(status="partial", rows=[{"AllWISE": "example", "RAJ2000": RA, "DEJ2000": DEC}])
        response, _, _ = self.run_review(catalog, None)
        self.assertEqual((response.classification, response.score), ("known", 10))

    def test_identity_uses_predicted_position_and_retains_catalog_id(self):
        checks = report()["checks"]
        checks[0].update(status="candidates", rows=[{"sourceId": "moving", "ra": RA+1, "dec": DEC,
                                                    "predictedRa": RA, "predictedDec": DEC}])
        identity = known_identity(checks, RA, DEC)
        self.assertEqual((identity.name, identity.separationArcsec), ("moving", 0))

    def test_identity_prefers_gaia_then_nearest_row(self):
        checks = report()["checks"]
        checks[0].update(status="candidates", rows=[{"sourceId": "far", "ra": RA, "dec": DEC + 10 / 3600},
                                                    {"sourceId": "near", "ra": RA, "dec": DEC + 1 / 3600}])
        checks[4].update(status="candidates", rows=[{"Name": "asteroid", "RA": "08 55 12", "DEC": "-07 15 00"}])
        self.assertEqual(known_identity(checks, RA, DEC).name, "near")
        checks[0].update(status="no_candidates", rows=[])
        self.assertEqual(known_identity(checks, RA, DEC).catalog, "SkyBoT")

    def test_frame_time_requires_real_saved_evidence(self):
        comparison = json.loads((ROOT / "fixtures/archive/real/response.json").read_text())["comparison"]
        frame = comparison["frames"][0]
        point = {"ra": comparison["field"]["ra"], "dec": comparison["field"]["dec"]}
        async def loader(*_):
            return copy.deepcopy(comparison)
        async def catalogs(ra, dec, radius, observed):
            self.assertEqual(observed, frame["observedAtUtc"])
            return {**report(observed), "ra": ra, "dec": dec}
        body = PointReviewInput(**point, frame={"survey": "spherex", "comparisonId": comparison["id"], "frameId": frame["id"]})
        response, _, _ = asyncio.run(prepare_point_review(body, catalogs, lambda *_: asyncio.sleep(0, []), loader))
        self.assertEqual(response.observedAtUtc, frame["observedAtUtc"])
        comparison["provenance"]["evidenceKind"] = "synthetic_fixture"
        with self.assertRaises(ApiError):
            asyncio.run(prepare_point_review(body, catalogs, None, loader))
