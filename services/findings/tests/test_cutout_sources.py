"""Synthetic HTTP contracts for the four independent point-review image sources."""
import asyncio
import gzip
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from astropy.table import Table
from astropy.io.votable import from_table, writeto

from services.findings import cutouts
from services.findings.models import PointReviewInput, PointReviewResponse


def votable(rows):
    table = Table(rows=rows, names=['access_url', 't_min', 'energy_bandpassname'], dtype=['U200', 'f8', 'U20'])
    output = io.BytesIO(); writeto(from_table(table), output)
    return output.getvalue()


class CutoutSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_spherex_uses_sia_time_and_bounded_ibe_cutout(self):
        calls = []
        async def response(request):
            calls.append(request)
            if request.url.path == '/SIA':
                return httpx.Response(200, content=votable([('https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/image.fits', 60000, 'SPHEREx-D5')]))
            self.assertEqual(request.url.params['center'], '10,20')
            self.assertAlmostEqual(float(request.url.params['size']), 120 / 3600)
            return httpx.Response(200, content=b'SIMPLE  = synthetic FITS transport fixture')
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            result = await cutouts.spherex(client, 10, 20)
        self.assertEqual(result.status, 'ok')
        self.assertEqual(result.frames[0].observed_at_utc, '2023-02-25T00:00:00Z')
        self.assertEqual(len(calls), 2)

    async def test_wise_uses_allwise_w2_and_ibe_coadd_hierarchy(self):
        table = Table({'coadd_id': ['1234p567_ac51'], 'band': [2]})
        text = io.StringIO(); table.write(text, format='ascii.ipac')
        async def response(request):
            if '/search/' in request.url.path:
                self.assertEqual(request.url.params['where'], 'band=2')
                return httpx.Response(200, text=text.getvalue())
            self.assertIn('/12/1234/1234p567_ac51/1234p567_ac51-w2-int-3.fits', request.url.path)
            self.assertEqual(request.url.params['size'], '120arcsec')
            return httpx.Response(200, content=b'SIMPLE  = synthetic FITS transport fixture')
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            result = await cutouts.wise(client, 10, 20)
        self.assertEqual((result.status, len(result.frames)), ('ok', 1))

    async def test_capped_spherex_rows_are_usable_but_not_an_exhaustive_or_empty_search(self):
        for rows in [[('https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/sample.fits', 60000, 'SPHEREx-D5')], []]:
            content = votable(rows).replace(b'</RESOURCE>', b'<INFO name="QUERY_STATUS" value="OVERFLOW"/></RESOURCE>')
            def response(request):
                return httpx.Response(200, content=content if request.url.path == '/SIA' else b'SIMPLE  = synthetic FITS transport fixture')
            async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
                if rows:
                    result = await cutouts.spherex(client, 10, 20)
                    self.assertEqual(result.status, 'ok'); self.assertIn('not an exhaustive', result.message)
                else:
                    with self.assertRaises(cutouts.SourceUnavailable): await cutouts.spherex(client, 10, 20)

    async def test_dss_requests_fits_at_the_selected_position(self):
        def response(request):
            self.assertEqual((request.url.params['r'], request.url.params['d'], request.url.params['f']), ('10', '20', 'fits'))
            return httpx.Response(200, content=b'SIMPLE  = synthetic FITS transport fixture')
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            result = await cutouts.dss(client, 10, 20)
        self.assertEqual(result.status, 'ok')

    async def test_neossat_accepts_calibrated_gzip_fits_and_observation_time(self):
        def response(request):
            if request.url.path.endswith('/sync'):
                self.assertIn("p.productID IN ('cord', 'cor')", request.url.params['QUERY'])
                return httpx.Response(200, text='uri,time_bounds_lower\ncadc:NEOSSAT/test_cord.fits.gz,60000\n')
            return httpx.Response(200, content=gzip.compress(b'SIMPLE  = synthetic FITS transport fixture'))
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            result = await cutouts.neossat(client, 10, 20)
        self.assertEqual(result.frames[0].fits[:6], b'SIMPLE')
        self.assertEqual(result.frames[0].observed_at_utc, '2023-02-25T00:00:00Z')

    async def test_archive_errors_are_never_empty_coverage(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, text='<html>maintenance</html>'))) as client:
            for fetcher in (cutouts.neossat, cutouts.dss):
                with self.subTest(fetcher=fetcher.__name__), self.assertRaises(cutouts.SourceUnavailable):
                    await fetcher(client, 10, 20)
        error_xml = b'<VOTABLE version="1.3"><RESOURCE><INFO name="QUERY_STATUS" value="ERROR">unavailable</INFO></RESOURCE></VOTABLE>'
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=error_xml))) as client:
            with self.assertRaises(cutouts.SourceUnavailable): await cutouts.spherex(client, 10, 20)

    async def test_compressed_and_uncompressed_image_limits(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=gzip.compress(b'SIMPLE' + b' ' * 200)))) as client:
            with patch.object(cutouts, 'MAX_BYTES', 100), self.assertRaises(cutouts.SourceUnavailable):
                await cutouts.get_bytes(client, 'https://example.test/frame.fits.gz', fits=True)

    async def test_one_archive_failure_does_not_discard_other_survey_results(self):
        async def bad(*_): raise cutouts.SourceUnavailable('synthetic failure')
        async def empty(*_): return cutouts.SourceResult('dss', 'no_coverage')
        with patch.dict(cutouts.FETCHERS, {'spherex': bad, 'dss': empty}, clear=True):
            async with httpx.AsyncClient() as client:
                results = await cutouts.fetch_all(client, 10, 20)
        self.assertEqual([(r.survey, r.status) for r in results], [('spherex', 'unavailable'), ('dss', 'no_coverage')])


class PointFixtureTests(unittest.TestCase):
    def test_server_produced_point_fixtures_match_exported_models(self):
        root = Path(__file__).resolve().parents[3]
        fixture = json.loads((root / 'services/findings/fixtures/point-flow.json').read_text())
        PointReviewInput.model_validate(fixture['request'])
        for key in ('known', 'uncatalogued', 'zero', 'duplicate'):
            with self.subTest(key=key): PointReviewResponse.model_validate(fixture[key])
