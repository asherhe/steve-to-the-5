"""Local demo uses real measurement code; inputs here are explicitly synthetic."""
import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.findings.api import create_router
from services.findings.main import create_demo_app
from services.findings.spectral_store import SpectralStore
from test_spectral_points import evidence_directory, water_source, wise_blink, RA, DEC
from test_point_reviews import report


class DemoScoringTests(unittest.TestCase):
    def test_factory_needs_no_supabase_and_exposes_no_public_writes(self):
        with patch.dict(os.environ, {}, clear=True), TestClient(create_demo_app()) as client:
            paths = client.get('/openapi.json').json()['paths']
            self.assertEqual(set(paths), {'/api/findings/points/review',
                '/api/findings/spectral/{evidence_id}', '/api/findings/spectral/{evidence_id}/assets/{sha}.fits'})
            self.assertEqual(client.post('/api/findings', json={}).status_code, 404)

    def test_anonymous_demo_measures_bonuses_retains_evidence_and_requires_wise(self):
        comparison, assets = wise_blink(change=4)
        catalog = report()
        catalog['checks'][0].update(status='candidates', rows=[{'sourceId': '42', 'ra': RA, 'dec': DEC}])
        async def catalogs(*_): return catalog
        async def cutouts(*_): return [water_source()]
        async def saved(identifier): return comparison if identifier == comparison['id'] else None
        with evidence_directory() as directory:
            app = FastAPI()
            app.include_router(create_router(None, saved, load_wise_comparison=saved,
                load_catalog_review=catalogs, load_cutouts=cutouts, load_asset=assets,
                spectral_store=SpectralStore(directory), local_demo=True))
            with TestClient(app) as client:
                body = {'ra': RA, 'dec': DEC}
                self.assertEqual(client.post('/api/findings/points/review', json=body).json()['code'], 'wise_blink_required')
                body['wiseComparisonId'] = comparison['id']
                response = client.post('/api/findings/points/review', json=body)
                self.assertEqual(response.status_code, 201, response.text)
                review = response.json()
                self.assertEqual(review['score'], 30)
                self.assertEqual(review['scoreVersion'], 'point-check-v4')
                self.assertIn('LOCAL DEMO', review['limitations'][0])
                self.assertEqual(review['wiseVariability']['points'], 5)
                self.assertEqual(client.get(review['spectral']['manifestUrl']).status_code, 200)
                self.assertEqual(client.get(review['spectral']['samples'][0]['assetUrl']).status_code, 200)
                comparison['provenance']['evidenceKind'] = 'synthetic_fixture'
                self.assertEqual(client.post('/api/findings/points/review', json=body).status_code, 422)

    def test_public_mode_still_requires_authentication(self):
        app = FastAPI()
        app.include_router(create_router(None, None))
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/findings/points/review', json={'ra': RA, 'dec': DEC}).status_code, 401)
