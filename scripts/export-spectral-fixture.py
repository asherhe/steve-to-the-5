"""Generate a synthetic representative v4 response; never contacts live services."""
import asyncio
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'services/findings/tests')]
from test_spectral_points import evidence_directory, water_source, wise_blink, RA, DEC
from services.findings.models import PointReviewInput
from services.findings.point_review import prepare_point_review
from services.findings.spectral_store import SpectralStore


async def main():
    old = json.loads((ROOT / 'services/findings/fixtures/point-flow.json').read_text(encoding='utf-8'))
    catalog = copy.deepcopy(old['known']['catalogReview'])
    catalog.update(ra=RA, dec=DEC, radiusArcsec=30, observedAtUtc=None)
    catalog['checks'][0].update(status='candidates', rows=[{'sourceId':'synthetic-42', 'ra':RA, 'dec':DEC}])
    async def catalogs(*_): return catalog
    async def cutouts(*_): return [water_source()]
    comparison, loader = wise_blink(change=4)
    request = PointReviewInput(ra=RA, dec=DEC, wiseComparisonId=comparison['id'])
    with evidence_directory() as directory:
        review, _, _ = await prepare_point_review(request, catalogs, cutouts, spectral_store=SpectralStore(directory), wise_comparison=comparison, asset_loader=loader)
        output = review.model_dump(mode='json')
        output.update(id='88888888-8888-4888-8888-888888888888', reviewedAtUtc='2026-11-15T18:00:00Z')
        target = ROOT / 'services/findings/fixtures/spectral-flow.json'
        target.write_text(json.dumps({'evidenceKind':'synthetic_fixture', 'request':request.model_dump(mode='json'), 'review':output}, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        print(f'Synthetic v4 fixture: {output["score"]} points')


asyncio.run(main())
