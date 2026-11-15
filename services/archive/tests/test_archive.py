from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path

from astropy.io import fits
from astropy.io.votable import from_table, writeto
from astropy.table import Table
from fastapi.testclient import TestClient
import httpx
import numpy as np
from PIL import Image
import pytest

from services.archive.api import create_app
from services.archive.client import IRSAClient
from services.archive.fixtures import FixtureClient, synthetic_cutout
from services.archive.models import ArchiveError, FieldRequest, ProcessingConfig
from services.archive.pipeline import Pipeline
from services.archive.processing import compatible, make_grid, prepare, render, shared_stretch
from services.archive.storage import LocalStore, canonical


@pytest.fixture
def field():
    return FieldRequest(ra=10,dec=20,fovArcmin=6)


@pytest.fixture
def config():
    return ProcessingConfig(attempts=1)


def make_pipeline(tmp_path, config, cutouts=None):
    return Pipeline(FixtureClient(cutouts), LocalStore(tmp_path), config)


def test_bundled_example_replays_through_default_app(tmp_path, monkeypatch):
    monkeypatch.setenv("SPHEREX_STORAGE_DIR", str(tmp_path))
    example = Path(__file__).resolve().parents[3] / "fixtures" / "archive" / "real"
    response = json.loads((example / "response.json").read_bytes())
    comparison = response["comparison"]
    with TestClient(create_app()) as client:
        saved = client.get(f"/api/comparisons/{comparison['id']}")
        assert saved.status_code == 200
        assert saved.json() == response
        for frame in comparison["frames"]:
            image = client.get(frame["imageUrl"])
            assert image.status_code == 200
            assert image.headers["content-type"] == "image/png"
            assert Image.open(BytesIO(image.content)).size == (
                comparison["grid"]["width"], comparison["grid"]["height"])


def prepared(field, config, cutout):
    grid,wcs=make_grid(field,config)
    observation=FixtureClient([cutout]).discover(field).observations[0]
    return prepare(observation,cutout,field,grid,wcs,config)


def test_ready_replay_and_assets_survive_restart_defaults_and_network_failure(tmp_path,field,config):
    pipeline=make_pipeline(tmp_path,config)
    response=pipeline.build(field)
    assert response.status=='ready'
    comparison=response.comparison
    assert len(comparison.frames)==2
    assert comparison.provenance['evidenceKind']=='synthetic_fixture'
    assert comparison.frames[0].observation_start_utc.year==2025
    store=LocalStore(tmp_path)
    replay=store.load(comparison.id)
    assert replay==response
    asset_name=comparison.frames[0].image_url.split('/')[-1]
    original,sha=store.asset(comparison.id,asset_name)
    changed=make_pipeline(tmp_path,config.model_copy(update={'asinh_softening':0.2}))
    assert changed.store.load(comparison.id)==response
    assert original==changed.store.asset(comparison.id,asset_name)[0]
    new=changed.build(field)
    assert new.comparison.id!=comparison.id
    assert pipeline.build(field).comparison.id==comparison.id
    assert Image.open(BytesIO(original)).size==(comparison.grid.width,comparison.grid.height)


@pytest.mark.parametrize('cutouts,expected',[
    ([], 'no_coverage'),([synthetic_cutout()], 'single_epoch'),
    ([synthetic_cutout(),synthetic_cutout(wavelength=2)], 'no_comparable_pair'),
    ([synthetic_cutout(bad=True),synthetic_cutout(bad=True)], 'no_comparable_pair'),
])
def test_domain_states(tmp_path,field,config,cutouts,expected):
    assert make_pipeline(tmp_path,config,cutouts).build(field).status==expected


def test_source_flag_is_not_a_bad_pixel_and_zodi_subtraction_is_explicit(field,config):
    frame=prepared(field,config,synthetic_cutout())
    assert frame.valid.mean()>0.99
    assert frame.quality['flaggedInputPixels']>0
    assert frame.quality['qualityRejectedInputPixels']==0
    assert np.nanmedian(frame.image)<1e-5


def test_spatial_wavelength_mismatch_even_with_same_target_wavelength(field,config):
    a=prepared(field,config,synthetic_cutout(slope=0.00001))
    b=prepared(field,config,synthetic_cutout(slope=0.01))
    b.observation=b.observation.model_copy(update={'start_mjd':61200,'end_mjd':61200.1})
    assert abs(a.target_wavelength-b.target_wavelength)<1e-8
    assert compatible(a,b,config)==(False,'wavelength_mismatch')


def test_rotated_grid_and_moving_target_preserve_sky_motion(tmp_path,field,config):
    response=make_pipeline(tmp_path,config,[synthetic_cutout(),synthetic_cutout(shift=2,rotation=20)]).build(field)
    assert response.status=='ready'
    a=prepared(field,config,synthetic_cutout())
    b=prepared(field,config,synthetic_cutout(shift=2,rotation=20))
    # Original central star at (44,44); motion must remain approximately two pixels.
    pa=np.unravel_index(np.nanargmax(a.image[24:35,24:35]),(11,11))
    pb=np.unravel_index(np.nanargmax(b.image[24:35,24:35]),(11,11))
    assert abs((pb[1]-pa[1])-2)<=1
    assert abs(pb[0]-pa[0])<=1
    checks=response.comparison.provenance['alignmentChecks']
    first,second=[checks[f.source_sha256] for f in response.comparison.frames]
    assert first=={'status':'reference_frame'}
    assert second['status']=='verified' and second['medianResidualPixels']<=0.5
    assert second['referenceSourceSha256']==response.comparison.frames[0].source_sha256


def test_shared_stretch_and_transparent_invalid_pixels(field,config):
    a=prepared(field,config,synthetic_cutout())
    b=prepared(field,config,synthetic_cutout(shift=2))
    stretch=shared_stretch([a,b],config)
    a.image[0,0]=b.image[0,0]=2
    a.valid[0,1]=False
    png_a=np.array(Image.open(BytesIO(render(a,stretch))))
    png_b=np.array(Image.open(BytesIO(render(b,stretch))))
    assert np.array_equal(png_a[-1,0],png_b[-1,0])
    assert png_a[-1,1,3]==0


def test_invalid_variance_and_missing_crop_rejected(field,config):
    raw=synthetic_cutout()
    with fits.open(BytesIO(raw)) as h:
        h['VARIANCE'].data[:]=np.nan
        out=BytesIO();h.writeto(out)
    assert not prepared(field,config,out.getvalue()).valid.any()
    with pytest.raises(ArchiveError,match='Cannot prepare'):
        prepared(field.model_copy(update={'ra':100}),config,raw)


def test_saved_evidence_corruption_and_overwrite_conflict(tmp_path,field,config):
    pipeline=make_pipeline(tmp_path,config)
    response=pipeline.build(field)
    cid=response.comparison.id
    with pytest.raises(ArchiveError) as exc:
        pipeline.store.publish(response,{response.comparison.frames[0].id+'.png':b'different'})
    assert exc.value.code=='EVIDENCE_CONFLICT'
    record=json.loads((tmp_path/'manifests'/f'{cid}.json').read_text())
    blob=tmp_path/'blobs'/next(iter(record['assets'].values()))
    blob.write_bytes(b'corrupt')
    with pytest.raises(ArchiveError) as exc:
        pipeline.store.load(cid)
    assert exc.value.code=='EVIDENCE_CORRUPT'


def test_concurrent_publish(tmp_path,field,config):
    pipeline=make_pipeline(tmp_path,config)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:pipeline.build(field),range(2)))
    assert results[0].comparison.id==results[1].comparison.id
    assert pipeline.store.load(results[0].comparison.id)==results[0]


def test_api_validation_replay_unknown_id_and_headers(tmp_path,config):
    client=TestClient(create_app(make_pipeline(tmp_path,config)))
    for params in ({'ra':'NaN','dec':20},{'ra':360,'dec':20},{'ra':10,'dec':91},
                   {'ra':10,'dec':20,'fovArcmin':31},{'dec':20}):
        response=client.get('/api/comparisons',params=params)
        assert response.status_code==422
        assert set(response.json())=={'code','message'}
    response=client.get('/api/comparisons',params={'ra':10,'dec':20})
    assert response.status_code==200
    body=response.json();cid=body['comparison']['id']
    assert body==client.get(f'/api/comparisons/{cid}').json()
    image=client.get(body['comparison']['frames'][0]['imageUrl'])
    assert image.status_code==200
    assert image.headers['content-type']=='image/png'
    assert 'immutable' in image.headers['cache-control']
    assert client.get('/api/comparisons/'+'f'*64).status_code==404
    assert client.get(f'/api/comparisons/{cid}/assets/unknown.png').status_code==404


def test_upstream_failure_is_not_no_coverage(tmp_path,field,config):
    pipeline=make_pipeline(tmp_path,config)
    def fail(field,deadline=None):raise ArchiveError('UPSTREAM_ERROR','offline')
    pipeline.client.discover=fail
    response=pipeline.build(field)
    assert response.status=='upstream_unavailable'
    assert response.comparison is None
    assert response.diagnostics['complete'] is False


def votable(rows, status='OK'):
    columns=['obs_id','energy_bandpassname','access_url','t_min','t_max']
    table=Table(rows=rows,names=columns,dtype=['U50','U20','U250','f8','f8'])
    document=from_table(table)
    from astropy.io.votable.tree import Info
    document.resources[0].infos.append(Info(name='QUERY_STATUS',value=status))
    output=BytesIO();writeto(document,output)
    return output.getvalue()


def test_sia_discovery_cutout_parameters_cache_and_both_releases(tmp_path,field,config):
    calls=[]
    url='https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/a.fits'
    def handler(request):
        calls.append(request)
        if request.url.path=='/SIA':
            release=request.url.params['COLLECTION']
            rows=[('one','SPHEREx-D2',url,61000,61000.1)] if release=='spherex_dr1' else []
            return httpx.Response(200,content=votable(rows))
        assert request.url.params['center']=='10.0,20.0d'
        assert float(request.url.params['size'])==0.2
        return httpx.Response(200,content=synthetic_cutout())
    client=IRSAClient(config,tmp_path,httpx.MockTransport(handler))
    observations=client.discover(field).observations
    assert len(observations)==1
    assert {r.url.params['COLLECTION'] for r in calls}=={'spherex_dr1','spherex_qr3'}
    first=client.retrieve(observations,field,0.2)
    assert len(first.cutouts)==1 and not first.failures
    count=len(calls)
    assert first==client.retrieve(observations,field,0.2)
    assert len(calls)==count


@pytest.mark.parametrize('status', ['OVERFLOW','ERROR'])
def test_sia_incomplete_results_fail_explicitly(tmp_path,field,config,status):
    client=IRSAClient(config,tmp_path,httpx.MockTransport(lambda _:httpx.Response(200,content=votable([],status))))
    with pytest.raises(ArchiveError):client.discover(field)


def test_retries_bytes_and_source_url_restrictions(tmp_path,config):
    attempts=[]
    retry_config=config.model_copy(update={'attempts':2})
    def handler(request):
        attempts.append(request)
        return httpx.Response(503)
    client=IRSAClient(retry_config,tmp_path,httpx.MockTransport(handler),sleep=lambda _:None)
    with pytest.raises(ArchiveError):client._get(client.endpoint)
    assert len(attempts)==2
    for url in ['http://irsa.ipac.caltech.edu/ibe/data/spherex/a.fits',
                'https://example.org/a.fits','https://irsa.ipac.caltech.edu:123/ibe/data/spherex/a.fits']:
        with pytest.raises(ArchiveError):client._source_url(url)
    client=IRSAClient(config.model_copy(update={'max_download_bytes':10}),tmp_path,
                      httpx.MockTransport(lambda _:httpx.Response(200,content=b'x'*11)))
    with pytest.raises(ArchiveError) as exc:client._get(client.endpoint)
    assert exc.value.code=='PROCESSING_LIMIT'


def test_bounded_sample_is_labelled_and_no_pair_is_not_false_absence(tmp_path,field,config):
    cutouts=[synthetic_cutout(),synthetic_cutout(shift=2),synthetic_cutout(shift=3)]
    limited=config.model_copy(update={'batch_size':2,'max_cutouts':2})
    response=make_pipeline(tmp_path,limited,cutouts).build(field)
    assert response.status=='ready'
    assert response.diagnostics['complete'] is False
    assert response.diagnostics['selectionScope']=='bounded_footprint_time_detector_sample'
    assert response.diagnostics['processedExposureCount']==2
    cutouts=[synthetic_cutout(wavelength=w) for w in (1,2,3)]
    with pytest.raises(ArchiveError) as exc:make_pipeline(tmp_path,limited,cutouts).build(field)
    assert exc.value.code=='PROCESSING_LIMIT'


def test_invalid_channel_and_same_time_do_not_compare(field,config):
    a=prepared(field,config,synthetic_cutout())
    b=prepared(field,config,synthetic_cutout())
    assert compatible(a,b,config)==(False,'same_observation_time')
    b.observation=b.observation.model_copy(update={'detector':6})
    assert compatible(a,b,config)==(False,'different_detector')


def test_manifest_tampering_is_detected(tmp_path,field,config):
    pipeline=make_pipeline(tmp_path,config)
    response=pipeline.build(field)
    path=tmp_path/'manifests'/f'{response.comparison.id}.json'
    record=json.loads(path.read_text())
    record['response']['comparison']['frames'][0]['wavelengthUm']=99
    path.write_bytes(canonical(record))
    with pytest.raises(ArchiveError) as exc:pipeline.store.load(response.comparison.id)
    assert exc.value.code=='EVIDENCE_CORRUPT'


def test_malformed_upstream_html_never_becomes_cached_fits(tmp_path,field,config):
    client=IRSAClient(config,tmp_path,httpx.MockTransport(lambda _:httpx.Response(200,content=b'<html>error</html>')))
    observation=FixtureClient().discover(field).observations[0].model_copy(update={
        'source_url':'https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/a.fits'})
    with pytest.raises(ArchiveError) as exc:client.cutout(observation,field,0.2)
    assert exc.value.code=='UPSTREAM_DATA'
    assert not list(tmp_path.glob('*.fits'))


def test_nonfinite_and_invalid_configuration_are_rejected():
    from pydantic import ValidationError
    from services.archive.models import Observation
    with pytest.raises(ValidationError):ProcessingConfig(lowerPercentile=90,upperPercentile=10)
    with pytest.raises(ValidationError):Observation(
        observationId='bad',detector=1,release='dr1',sourceUrl='https://example.invalid',
        startMjd=2,endMjd=1)


def test_roundtrip_ra_wrap_and_polar_grid(config):
    from astropy.wcs import WCS
    for field in [FieldRequest(ra=359.99,dec=20),FieldRequest(ra=0,dec=89.9)]:
        grid,wcs=make_grid(field,config)
        x,y=wcs.world_to_pixel_values(field.ra,field.dec)
        assert abs(x-(grid.width-1)/2)<1e-8
        assert abs(y-(grid.height-1)/2)<1e-8
        restored=WCS(fits.Header(grid.fits_header))
        ra,dec=restored.pixel_to_world_values(x,y)
        assert abs(((ra-field.ra+180)%360)-180)<1e-8
        assert abs(dec-field.dec)<1e-8


def test_explicit_defaults_and_omitted_defaults_have_identical_identity(tmp_path):
    omitted=ProcessingConfig()
    explicit=ProcessingConfig(maxCandidates=1000,timeoutSeconds=30,attempts=3,batchSize=6)
    assert canonical(omitted.model_dump())==canonical(explicit.model_dump())
    first=make_pipeline(tmp_path,omitted).build(FieldRequest(ra=10,dec=20))
    second=make_pipeline(tmp_path,explicit).build(FieldRequest(ra=10.,dec=20.,fovArcmin=6.))
    assert first.comparison.id==second.comparison.id
