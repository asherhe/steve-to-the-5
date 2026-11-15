"""Synthetic physics/quality tests; not validation of chemical identifications."""
import asyncio
import copy
import hashlib
import io
import json
import shutil
from contextlib import contextmanager
from uuid import uuid4
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

from services.findings import spectral, wise_variability
from services.findings.cutouts import Frame, SourceResult
from services.findings.models import PointReviewInput, SpectralSample
from services.findings.point_review import prepare_point_review
from services.findings.spectral_store import SpectralStore
from services.findings.supabase import ApiError
from test_point_reviews import report, RA, DEC

TEST_TEMP = Path(__file__).resolve().parents[3] / '.local-test-temp'
TEST_TEMP.mkdir(exist_ok=True)


@contextmanager
def evidence_directory():
    directory = TEST_TEMP / ('spectral-' + uuid4().hex)
    directory.mkdir()
    try:
        yield directory
    finally:
        if directory.resolve().is_relative_to(TEST_TEMP.resolve()):
            shutil.rmtree(directory)


def spectral_frame(wave=1.3, signal=50, flag=0, slope=0.00001, day=1, detector=2):
    wcs = WCS(naxis=2)
    wcs.wcs.ctype, wcs.wcs.crval, wcs.wcs.crpix = ['RA---TAN', 'DEC--TAN'], [RA, DEC], [21, 21]
    wcs.wcs.cdelt = [-6.2/3600, 6.2/3600]
    header = wcs.to_header()
    header['BUNIT'], header['DETECTOR'], header['OBSID'] = 'MJy/sr', detector, f'test-{wave}-{day}'
    for key, value in {'WCSAXESW': 2, 'CTYPE1W': 'WAVE', 'CTYPE2W': 'WAVE', 'CUNIT1W': 'um', 'CUNIT2W': 'um',
                       'CRPIX1W': 21, 'CRPIX2W': 21, 'CRVAL1W': wave, 'CRVAL2W': .02,
                       'CDELT1W': slope, 'CDELT2W': 1e-9}.items(): header[key] = value
    yy, xx = np.indices((41, 41))
    values = 10 + np.random.default_rng(4).normal(0, .01, (41, 41)) + signal * np.exp(-((xx-20)**2+(yy-20)**2)/2)
    primary = fits.PrimaryHDU(); primary.header['VERSION'] = 'synthetic-v1'
    flags = np.zeros((41, 41), dtype='int32'); flags[20, 20] = flag
    out = io.BytesIO()
    fits.HDUList([primary, fits.ImageHDU(values, header, name='IMAGE'), fits.ImageHDU(flags, name='FLAGS'),
                  fits.ImageHDU(np.ones((41, 41))*.01, name='VARIANCE'), fits.ImageHDU(np.full((41, 41), 10.), name='ZODI')]).writeto(out)
    return Frame('synthetic', f'https://example.invalid/{wave}-{day}.fits', out.getvalue(), f'2026-01-{day:02}T00:00:00Z', f'2026-01-{day:02}T00:01:00Z', header['OBSID'], 'dr1')


def water_source():
    return SourceResult('spherex', 'ok', [spectral_frame(wave, signal, detector=detector)
        for wave, signal, detector in [(1.29, 100, 2), (1.41, 10, 2), (1.55, 100, 2), (1.71, 100, 3), (1.91, 10, 3), (2.12, 100, 3)]], 'Synthetic spectral fixture')


def wise_blink(change=1, zp_change=0):
    wcs = WCS(naxis=2)
    wcs.wcs.ctype, wcs.wcs.crval, wcs.wcs.crpix = ['RA---TAN', 'DEC--TAN'], [RA, DEC], [31, 31]
    wcs.wcs.cdelt = [-2.75/3600, 2.75/3600]
    header = wcs.to_header(); header['BAND'], header['BUNIT'], header['MAGZPUNC'] = 2, 'DN', .007
    yy, xx = np.indices((61, 61)); frames, groups, assets = [], [], {}
    for visit, day in enumerate((1, 20)):
        originals = []
        for index in range(2):
            zp = 20 + (zp_change if visit else 0); header['MAGZP'] = zp
            amplitude = 20 * (change if visit else 1) * 10**(.4*(zp-20))
            values = 100 + np.random.default_rng(index).normal(0, .05, (61, 61)) + amplitude*np.exp(-((xx-30)**2+(yy-30)**2)/3)
            out = io.BytesIO(); fits.PrimaryHDU(values, header).writeto(out)
            raw = out.getvalue(); sha = hashlib.sha256(raw).hexdigest(); assets[f'{sha}.fits'] = raw
            originals.append({'sourceSha256': sha, 'observedAtUtc': f'2026-01-{day:02}T00:0{index}:00Z',
                              'exposure': {'band': 2, 'qualFrame': 10, 'sourceUrl': 'https://example.invalid/wise.fits'}})
        frame = {'id': f'visit-{visit}', 'sourceSha256': f'group-{visit}', 'observedAtUtc': f'2026-01-{day:02}T00:00:00Z', 'alignment': 'reference_frame' if visit == 0 else 'verified'}
        frames.append(frame); groups.append({'frameSourceSha256': frame['sourceSha256'], 'exposures': originals})
    comparison = {'id': 'synthetic-wise-blink', 'grid': {'width': 61, 'height': 61, 'fitsHeader': dict(wcs.to_header())}, 'frames': frames,
                  'config': {'band': 'W2'}, 'provenance': {'survey': 'WISE synthetic test transport', 'evidenceKind': 'real_archive', 'inputs': groups}}
    async def loader(survey, identifier, name): return assets[name]
    return comparison, loader


class SpectralTests(unittest.TestCase):
    def test_measurement_uses_local_spectral_wcs_uncertainties_and_quality(self):
        sample = spectral.measure(spectral_frame(), RA, DEC)
        self.assertEqual(sample.status, 'measured')
        self.assertAlmostEqual(sample.wavelengthUm, 1.3, places=4)
        self.assertGreater(sample.snr, 5)
        self.assertEqual(spectral.measure(spectral_frame(flag=1), RA, DEC).status, 'rejected')
        self.assertEqual(spectral.measure(spectral_frame(slope=.1), RA, DEC).status, 'rejected')
        self.assertEqual(spectral.measure(spectral_frame(), RA+1, DEC).status, 'rejected')

    def test_two_water_regions_award_once_and_do_not_invent_other_species(self):
        value = spectral.analyze(water_source(), RA, DEC)
        self.assertTrue(value.sourceDetected)
        self.assertEqual([(f.key, f.points) for f in value.features], [('water', 5), ('methane', 0), ('hydrogen', 0)])
        self.assertEqual(len(value.features[0].bands), 2)

    def test_flat_missing_temporally_incompatible_and_bad_samples_award_no_features(self):
        for source in [SourceResult('spherex', 'ok', [spectral_frame(w, detector=2 if w<1.6 else 3) for w in [1.29,1.41,1.55,1.71,1.91,2.12]]),
                       SourceResult('spherex', 'ok', water_source().frames[:3]),
                       SourceResult('spherex', 'ok', [spectral_frame(1.29,100,day=20), *water_source().frames[1:]]),
                       SourceResult('spherex', 'ok', [spectral_frame(1.29,100,flag=1), *water_source().frames[1:]])]:
            with self.subTest(source=source.message): self.assertEqual(sum(f.points for f in spectral.analyze(source,RA,DEC).features), 0)

    def test_duplicate_wavelengths_do_not_count_as_independent_channels(self):
        sample = spectral.measure(spectral_frame(), RA, DEC)
        self.assertEqual(len(spectral.independent([sample, sample, sample.model_copy(update={'wavelengthUm': 1.301})])), 1)

    def test_hydrogen_and_methane_require_their_own_two_regions(self):
        for key, values in [('hydrogen', [(1.22,100,2),(1.282,10,2),(1.34,100,2),(2.06,100,3),(2.166,10,3),(2.28,100,3)]),
                            ('methane', [(2.10,100,3),(2.24,10,3),(2.37,100,3),(3.10,100,4),(3.30,10,4),(3.57,100,4)])]:
            source = SourceResult('spherex','ok',[spectral_frame(w,a,detector=d) for w,a,d in values])
            result = spectral.analyze(source,RA,DEC)
            self.assertEqual(next(f.points for f in result.features if f.key==key),5)
            source.frames = source.frames[:3]
            self.assertEqual(sum(f.points for f in spectral.analyze(source,RA,DEC).features),0)

    def test_cross_detector_continuum_cannot_create_a_feature(self):
        source = water_source(); source.frames[0] = spectral_frame(1.29,100,detector=3)
        self.assertEqual(sum(f.points for f in spectral.analyze(source,RA,DEC).features),0)

    def test_store_is_immutable_content_addressed_and_detects_corruption(self):
        with evidence_directory() as directory:
            store = SpectralStore(directory); source = water_source()
            result = store.save(spectral.analyze(source,RA,DEC), source.frames, RA, DEC)
            identifier = result.evidenceId
            self.assertEqual(store.save(result, source.frames,RA,DEC).evidenceId, identifier)
            original = store.read(identifier,'.json')
            with patch.dict(spectral.CONFIG, {'sourceSnr': 999}): self.assertEqual(store.read(identifier,'.json'), original)
            self.assertEqual(store.asset(identifier, result.samples[0].sourceSha256), source.frames[0].fits)
            Path(directory, identifier+'.json').write_bytes(b'corrupt')
            with self.assertRaises(ApiError): store.read(identifier,'.json')

    def test_known_objects_can_earn_spectral_and_wise_points(self):
        catalog = report(); catalog['checks'][0].update(status='candidates', rows=[{'sourceId':'42','ra':RA,'dec':DEC}])
        comparison, asset_loader = wise_blink(change=4)
        async def catalogs(*_): return catalog
        async def cutouts(*_): return [water_source()]
        with evidence_directory() as directory:
            value, _, _ = asyncio.run(prepare_point_review(PointReviewInput(ra=RA, dec=DEC, wiseComparisonId=comparison['id']), catalogs, cutouts,
                spectral_store=SpectralStore(directory), wise_comparison=comparison, asset_loader=asset_loader))
            self.assertEqual(value.score, 30) # 10 base + 10 SPHEREx + 5 water + 5 WISE
            self.assertEqual(value.score, sum(p.points for p in value.scoreBreakdown))
            self.assertIsNotNone(value.spectral.evidenceId)


class WiseVariabilityTests(unittest.TestCase):
    def run_blink(self, change=1, zp_change=0):
        comparison, loader = wise_blink(change, zp_change)
        return asyncio.run(wise_variability.analyze(comparison, PointReviewInput(ra=RA,dec=DEC), loader))

    def test_calibrated_variable_source_and_constant_source(self):
        self.assertEqual(self.run_blink(4).status, 'candidate')
        self.assertEqual(self.run_blink().status, 'stable')

    def test_zero_point_change_alone_does_not_award_variability(self):
        value = self.run_blink(zp_change=1)
        self.assertEqual(value.status, 'stable')
        self.assertLess(value.fractionalChange, .01)

    def test_unverified_alignment_and_missing_calibration_are_explicit(self):
        comparison, loader = wise_blink(4)
        comparison['frames'][1]['alignment'] = 'wcs_only_not_empirically_verified'
        value = asyncio.run(wise_variability.analyze(comparison, PointReviewInput(ra=RA,dec=DEC),loader))
        self.assertEqual(value.status,'insufficient'); self.assertEqual(value.points,0)
        comparison, loader = wise_blink(4)
        async def missing_calibration(survey, identifier, name):
            raw = await loader(survey, identifier, name)
            # A corrupted retained file must never be scored as an exposure.
            return raw + b'changed'
        value = asyncio.run(wise_variability.analyze(comparison, PointReviewInput(ra=RA,dec=DEC),missing_calibration))
        self.assertEqual(value.status,'insufficient'); self.assertEqual(value.points,0)

    def test_requires_two_real_visits_covering_point(self):
        comparison,_ = wise_blink()
        comparison['provenance']['evidenceKind']='synthetic_fixture'
        with self.assertRaises(ApiError): wise_variability.validate_blink(comparison,PointReviewInput(ra=RA,dec=DEC))
        comparison['provenance']['evidenceKind']='real_archive'; comparison['frames']=comparison['frames'][:1]
        with self.assertRaises(ApiError): wise_variability.validate_blink(comparison,PointReviewInput(ra=RA,dec=DEC))
