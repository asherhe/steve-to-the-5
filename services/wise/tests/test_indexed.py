"""Synthetic static-index tests, separate from the opt-in live coverage log."""
from io import BytesIO

from astropy.io import fits
from astropy.table import Table
import httpx
import pytest

from services.archive.models import ArchiveError, Discovery, FieldRequest
from services.archive.processing import make_grid
from services.archive.storage import LocalStore, digest
from services.wise.client import WiseClient
from services.wise.indexed import IndexedWiseClient, exposures_from_index, nearest_tile
from services.wise.models import WiseConfig
from services.wise.pipeline import WisePipeline, prepare_exposure
from services.wise.tests.test_wise import FIELD, cutout, visits


def fits_table(rows):
    output = BytesIO()
    Table(rows=rows).write(output, format="fits")
    return output.getvalue()


def index_row(exposure):
    e = exposure
    group = e.scan_id[-2:]
    return dict(scan_id=e.scan_id, scangrp=group, frame_num=e.frame_num, band=e.band,
                mjd=e.mjd_obs, ra=FIELD.ra, dec=FIELD.dec, qual_frame=10, included=1, use=1,
                intfn=f"/source/wise/neowiser/p1bm_frm/{group}/{e.scan_id}/{e.frame_num:03d}/"
                      f"{e.exposure_id}-int-1b.fits")


def test_index_bypasses_search_and_retains_metadata_and_original_exposures(tmp_path):
    items = visits(count=4)
    tiles = fits_table([dict(coadd_id="1500p200", ra=150., dec=20.)])
    frames = fits_table([index_row(e) for e, _ in items])
    calls = []
    def handler(request):
        calls.append(str(request.url))
        if request.url.path.endswith("tiles.fits"):
            data = tiles
        elif request.url.path.endswith("frames.fits"):
            data = frames
        else:
            assert "/ibe/data/" in request.url.path
            e, data = next((e, data) for e, data in items if e.exposure_id in request.url.path)
            with fits.open(BytesIO(data)) as hdus:
                hdus[0].header["MJD_OBS"] = e.mjd_obs
                hdus[0].header["SCAN"] = e.scan_id
                hdus[0].header["FRNUM"] = e.frame_num
                output = BytesIO(); hdus.writeto(output); data = output.getvalue()
        return httpx.Response(200, content=data)
    config = WiseConfig(max_epochs=2, exposures_per_epoch=3)
    client = IndexedWiseClient(config, tmp_path / "cache", httpx.MockTransport(handler))
    store = LocalStore(tmp_path / "evidence")
    response = WisePipeline(client, store, config).build(FIELD)
    assert response.status == "ready" and len(response.comparison.frames) == 2
    assert len(calls) == 8 and not any("/search/" in url for url in calls)
    assert response.diagnostics["discovery"]["complete"] is False
    assert "index_candidate_subset" in response.diagnostics["incompleteStages"]
    assert response.comparison.provenance["discoveryScope"].startswith("unwise_neo11_nearest")
    for raw in (tiles, frames):
        assert store.asset(response.comparison.id, f"{digest(raw)}.fits")[0] == raw
    assert len(response.comparison.provenance["inputs"][0]["exposures"]) == 3
    # Reopening evidence never uses metadata or image network access.
    assert store.load(response.comparison.id) == response
    assert client.discover(FIELD).observations and len(calls) == 8
    client.close()


def test_index_filters_quality_and_distance_and_validates_paths():
    base = index_row(visits(1)[0][0])
    rows = [base, {**base, "included": 0}, {**base, "use": 0},
            {**base, "qual_frame": 0}, {**base, "ra": 155.}, {**base, "band": 1}]
    found = exposures_from_index(fits_table(rows), FIELD, WiseConfig())
    assert len(found) == 1
    with pytest.raises(ValueError):
        exposures_from_index(fits_table([{**base, "intfn": "https://example.invalid/image"}]), FIELD, WiseConfig())
    with pytest.raises(ValueError):
        exposures_from_index(fits_table([{**base, "mjd": float("nan")}]), FIELD, WiseConfig())
    wrapped = FIELD.model_copy(update={"ra": 359.99, "dec": 0.})
    tiles = fits_table([dict(coadd_id="0000p000", ra=0.01, dec=0.),
                        dict(coadd_id="3590p000", ra=359., dec=0.)])
    assert nearest_tile(tiles, wrapped) == "0000p000"


def test_failed_static_index_falls_back_but_cancel_never_does(tmp_path, monkeypatch):
    fallback = []
    def discover(*args, **kwargs):
        fallback.append(True)
        return Discovery([])
    monkeypatch.setattr(WiseClient, "discover", discover)
    client = IndexedWiseClient(WiseConfig(attempts=1), tmp_path,
                               httpx.MockTransport(lambda request: httpx.Response(502)))
    assert client.discover(FIELD).observations == [] and len(fallback) == 1
    def cancelled(*args, **kwargs):
        raise ArchiveError("BUILD_CANCELLED", "cancelled", 409)
    monkeypatch.setattr(client, "_cached", cancelled)
    with pytest.raises(ArchiveError, match="cancelled"):
        client.discover(FIELD)
    assert len(fallback) == 1
    client.close()


@pytest.mark.parametrize("key,value", [("MJD_OBS", 60000.), ("SCAN", "wrong"), ("FRNUM", 999)])
def test_discovery_dates_and_identity_must_agree_with_pixels(key, value):
    e, data = visits(1)[0]
    with fits.open(BytesIO(data)) as hdus:
        hdus[0].header[key] = value
        output = BytesIO(); hdus.writeto(output)
    grid, wcs = make_grid(FieldRequest(ra=FIELD.ra, dec=FIELD.dec, fov_arcmin=FIELD.fov_arcmin), WiseConfig())
    with pytest.raises(ArchiveError):
        prepare_exposure(e, output.getvalue(), FIELD, grid, wcs)
