from __future__ import annotations

import time

import httpx
import pytest

from app.chain.core import CatalogRow, ChainQuery, match_rows
from app.chain.live import (
    SimbadStep,
    SkybotStep,
    UltracoolStep,
    VizierInfraredStep,
)
from app.chain.runner import run_chain
from app.gaia.provider import UpstreamError

BARNARD = (269.4521, 4.6933)
WISE0855 = (133.7951, -7.2451)
EMPTY = (83.8221, 9.9357)
ASTEROID = (10.0, 5.0)
UNAVAILABLE = (359.999, 89.999)
OBSERVED = "2025-04-15T06:00:00Z"
ORDER = ["gaia_dr3", "simbad", "catwise2020", "ultracoolsheet", "skybot", "vizier"]


def _check(client, ra, dec, **params):
    return client.get("/api/catalogs/check-chain", params={"ra": ra, "dec": dec, **params})


def _steps(body):
    return {s["id"]: s for s in body["steps"]}


def test_fast_mover_matches_only_after_propagation(client):
    resp = _check(client, *BARNARD, epochUtc=OBSERVED)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert resp.headers["X-SPHEREx-Catalog-Mode"] == "fixture"
    assert [s["id"] for s in body["steps"]] == ORDER
    steps = _steps(body)
    assert steps["gaia_dr3"]["status"] == "match"
    assert steps["gaia_dr3"]["matches"][0]["positionPredicted"] is True
    assert steps["simbad"]["status"] == "match"
    assert steps["catwise2020"]["status"] == "match"
    # 2MASS has no proper motion: the old position stays outside the radius, with a caveat.
    assert steps["vizier"]["status"] == "no_match"
    assert "proper motion" in steps["vizier"]["message"]
    assert body["verdict"] == "catalogued"
    assert body["epochKind"] == "observation"


def test_without_epoch_fast_mover_is_not_matched_and_result_is_incomplete(client):
    body = _check(client, *BARNARD).json()
    steps = _steps(body)
    assert steps["gaia_dr3"]["status"] == "no_match"
    assert steps["skybot"]["status"] == "skipped"
    assert body["verdict"] == "incomplete"
    assert "SkyBoT" in body["verdictMessage"]


def test_cold_object_listed_by_ultracool(client):
    body = _check(client, *WISE0855, epochUtc=OBSERVED).json()
    steps = _steps(body)
    assert steps["ultracoolsheet"]["status"] == "match"
    assert steps["ultracoolsheet"]["matches"][0]["positionPredicted"] is False
    assert body["verdict"] == "catalogued"


def test_empty_field_with_observation_is_candidate(client):
    body = _check(client, *EMPTY, epochUtc=OBSERVED).json()
    assert {s["status"] for s in body["steps"]} == {"no_match"}
    assert body["verdict"] == "uncatalogued_candidate"
    assert "not a confirmed discovery" in body["verdictMessage"]


def test_mosaic_epoch_is_approximate_and_skips_asteroids(client):
    body = _check(client, *EMPTY, epochUtc=OBSERVED, epochKind="approximate").json()
    assert _steps(body)["skybot"]["status"] == "skipped"
    assert body["verdict"] == "incomplete"


def test_known_asteroid_needs_dated_frame(client):
    dated = _check(client, *ASTEROID, epochUtc=OBSERVED).json()
    assert _steps(dated)["skybot"]["status"] == "match"
    assert dated["verdict"] == "catalogued"
    undated = _check(client, *ASTEROID).json()
    assert _steps(undated)["skybot"]["status"] == "skipped"
    assert undated["verdict"] == "incomplete"


def test_upstream_failure_is_unavailable_not_no_match(client):
    body = _check(client, *UNAVAILABLE, epochUtc=OBSERVED).json()
    assert {s["status"] for s in body["steps"]} == {"unavailable"}
    assert body["verdict"] == "incomplete"


def test_matches_are_bounded_and_sorted(client):
    body = _check(client, *WISE0855, radiusArcsec=30).json()
    gaia = _steps(body)["gaia_dr3"]
    seps = [m["separationArcsec"] for m in gaia["matches"]]
    assert seps == sorted(seps) and len(seps) <= 5
    assert gaia["matchCount"] >= len(seps)


@pytest.mark.parametrize("params", [
    {"radiusArcsec": 1000},
    {"radiusArcsec": 0},
    {"epochUtc": "yesterday"},
    {"epochUtc": "1850-01-01T00:00:00Z"},
    {"epochKind": "observation"},
    {"epochUtc": OBSERVED, "epochKind": "guess"},
])
def test_invalid_requests(client, params):
    resp = _check(client, *EMPTY, **params)
    assert resp.status_code in (400, 422)
    if resp.status_code == 400:
        assert resp.json()["code"] == "invalid_request"


def test_invalid_coordinates(client):
    resp = _check(client, 400.0, 0.0)
    assert resp.status_code == 400


# --- core -----------------------------------------------------------------------------

def _query(epoch_year=None, radius=10.0):
    return ChainQuery(ra=0.0, dec=0.0, radius_arcsec=radius, motion_pad_arcsec=120.0,
                      epoch_utc=None, epoch_year=epoch_year,
                      epoch_kind="observation" if epoch_year else None)


def test_match_rows_propagates_only_with_epoch_and_motion():
    row = CatalogRow(name="mover", ra=0.0, dec=-0.01, ref_epoch=2000.0,
                     pm_ra_cos_dec_mas_yr=0.0, pm_dec_mas_yr=1440.0)  # 36" in 25 yr
    assert match_rows([row], _query()) == []
    [m] = match_rows([row], _query(epoch_year=2025.0))
    assert m.position_predicted and m.separation_arcsec < 1.0


def test_slow_step_times_out_as_unavailable():
    class Slow:
        id, label, catalog, reference_url = "slow", "Slow", "slow", None
        requires_observation_epoch, caveat = False, None

        def fetch(self, query):
            time.sleep(1.0)
            return []

    result = run_chain(_query(), [Slow()], timeout_s=0.05, live=True)
    assert result.steps[0].status == "unavailable"
    assert result.verdict == "incomplete"


# --- live adapters against mocked HTTP --------------------------------------------------

def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_simbad_csv_mapping():
    def handler(request):
        assert b"FORMAT=csv" in request.content
        return httpx.Response(200, text=(
            "main_id,ra,dec,pmra,pmdec,otype\n"
            '"Test star",0.001,0.0,10.0,,PM*\n'
        ), headers={"content-type": "text/csv"})

    [row] = SimbadStep(_client(handler), 50).fetch(_query())
    assert row.name == "Test star" and row.ref_epoch == 2000.0
    assert row.pm_ra_cos_dec_mas_yr == 10.0 and row.pm_dec_mas_yr is None
    assert row.detail == "type PM*"


@pytest.mark.parametrize("response", [
    httpx.Response(503, text="down"),
    httpx.Response(404, text="<!doctype html><title>Page unavailable</title>",
                   headers={"content-type": "text/html"}),
    httpx.Response(200, text="<VOTABLE><INFO name='QUERY_STATUS' value='ERROR'/></VOTABLE>",
                   headers={"content-type": "text/xml"}),
])
def test_simbad_failures_raise_upstream(response):
    with pytest.raises(UpstreamError):
        SimbadStep(_client(lambda request: response), 50).fetch(_query())


def test_skybot_json_and_empty():
    payload = [{"Num": 37529, "Name": "Ama-Miyayama", "RA (hms)": "00 00 0.1",
                "DEC (dms)": "+00 00 01.0", "Class": "MB>Middle", "VMag (mag)": 21.3,
                "ssodnet": {"ssocard": "https://example.invalid/card"}}]
    [row] = SkybotStep(_client(lambda r: httpx.Response(200, json=payload))).fetch(_query())
    assert row.name == "Ama-Miyayama"
    assert abs(row.ra - 0.1 * 15 / 3600) < 1e-9 and abs(row.dec - 1 / 3600) < 1e-9
    assert SkybotStep(_client(lambda r: httpx.Response(204))).fetch(_query()) == []


def test_vizier_tsv_parsing():
    text = (
        "#RESOURCE=yCat_2246\n#Name: II/246\n\n"
        "_RAJ2000\t_DEJ2000\t2MASS\n"
        "deg\tdeg\t\n"
        "----------\t----------\t----------------\n"
        "000.000100\t+00.000100\t00000002+0000003\n"
    )
    step = VizierInfraredStep(_client(lambda r: httpx.Response(200, text=text)), 50)
    rows = step.fetch(_query())
    assert rows[0].name == "2MASS 00000002+0000003"
    assert abs(rows[0].ra - 0.0001) < 1e-9


def test_ultracool_not_configured_and_csv(tmp_path):
    from app.chain.core import StepNotConfigured

    with pytest.raises(StepNotConfigured):
        UltracoolStep(None).fetch(_query())
    path = tmp_path / "ucs.csv"
    path.write_text("name,ra_j2000_formula,dec_j2000_formula,spt_opt\nTest BD,0.0005,0.0,L5\n"
                    "Far BD,10.0,10.0,T2\n")
    [row] = UltracoolStep(path).fetch(_query())
    assert row.name == "Test BD" and row.detail == "SpT L5"
