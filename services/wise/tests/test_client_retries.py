"""Retry behaviour of the WISE archive client against a mocked IRSA. No archive access."""
from io import StringIO

from astropy.io import ascii as ascii_tables
from astropy.table import Table
import httpx
import pytest

from services.archive.models import ArchiveError
from services.wise import client as wise_client
from services.wise.client import WiseClient
from services.wise.models import Exposure, WiseConfig, WiseFieldRequest


FIELD = WiseFieldRequest(ra=150.0, dec=20.0, fovArcmin=4, band=2)


def search_table():
    table = Table({"band": [2], "scan_id": ["01234r"], "scangrp": ["4r"], "frame_num": [12], "mjd_obs": [57000.5]})
    out = StringIO()
    ascii_tables.write(table, out, format="ipac")
    return "\\QUERY_STATUS = 'OK'\n" + out.getvalue()


def make_client(tmp_path, handler):
    sleeps = []
    client = WiseClient(WiseConfig(), tmp_path / "cache", transport=httpx.MockTransport(handler),
                        sleep=sleeps.append, jitter=lambda: 1.0)
    return client, sleeps


def test_search_rides_out_a_run_of_instant_502s(tmp_path):
    calls = {}

    def handler(request):
        path = request.url.path
        calls[path] = calls.get(path, 0) + 1
        if calls[path] <= 5:
            return httpx.Response(502, text="Proxy Error")
        return httpx.Response(200, text=search_table())

    client, sleeps = make_client(tmp_path, handler)
    discovery = client.discover(FIELD)
    assert discovery.failures == []
    # One exposure per mission phase; each phase answered on its sixth try.
    assert len(discovery.observations) == 1
    assert set(calls.values()) == {6}
    # Growing backoff between tries: 1, 2, 4, 8, 16 s per phase.
    assert sorted(set(sleeps)) == [1.0, 2.0, 4.0, 8.0, 16.0]


def test_search_reports_failure_after_its_attempt_limit(tmp_path):
    client, sleeps = make_client(tmp_path, lambda request: httpx.Response(503))
    with pytest.raises(ArchiveError) as raised:
        client.discover(FIELD)
    assert raised.value.details["attempts"] == wise_client.SEARCH_ATTEMPTS
    assert max(sleeps) == wise_client.SEARCH_BACKOFF_MAX_SECONDS


def test_a_hanging_search_is_tried_twice_only(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        raise httpx.ReadTimeout("stalled", request=request)

    client, _ = make_client(tmp_path, handler)
    with pytest.raises(ArchiveError) as raised:
        client.discover(FIELD)
    assert raised.value.details["category"] == "timeout"
    assert raised.value.details["attempts"] == wise_client.SEARCH_TIMEOUT_ATTEMPTS
    assert len(calls) == len(wise_client.DATASETS) * wise_client.SEARCH_TIMEOUT_ATTEMPTS


def test_a_rejected_search_is_not_retried(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(400)

    client, sleeps = make_client(tmp_path, handler)
    with pytest.raises(ArchiveError):
        client.discover(FIELD)
    assert len(calls) == len(wise_client.DATASETS)
    assert sleeps == []


def test_timed_out_cutouts_get_a_second_round_after_a_pause(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) <= wise_client.CUTOUT_ATTEMPTS:
            raise httpx.ReadTimeout("stalled", request=request)
        return httpx.Response(200, content=b"SIMPLE  =                    T")

    client, sleeps = make_client(tmp_path, handler)
    exposure = Exposure(exposure_id="01234r012-w2", dataset="neowiser", release="neowise-r", band=2,
                        scan_id="01234r", scangrp="4r", frame_num=12, mjd_obs=57000.5,
                        source_url="https://irsa.ipac.caltech.edu/ibe/data/synthetic/01234r012-w2-int-1b.fits")
    settled = []
    result = client.retrieve([exposure], FIELD, 0.1, on_done=lambda: settled.append(1))
    assert [e.exposure_id for e, _ in result.cutouts] == [exposure.exposure_id]
    assert result.failures == []
    assert len(calls) == wise_client.CUTOUT_ATTEMPTS + 1
    assert wise_client.SECOND_ROUND_PAUSE_SECONDS in sleeps
    assert settled == [1]
