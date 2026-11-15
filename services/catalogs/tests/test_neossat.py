"""Synthetic transport checks for the manually refreshed NEOSSat reference panel."""
import json
from pathlib import Path

import httpx
import pytest

from app import neossat

HEADER = "observationID,productID,time_bounds_lower,uri\n"


def row(obs="test-1", product="raw", mjd="58820.05889074074"):
    return f"{obs},{product},{mjd},cadc:NEOSSAT/{obs}_{product}_prev.png\n"


def test_observation_times_deduplication_and_product_preference():
    images, truncated = neossat.parse_previews(HEADER + row() + row(product="cord") + row("test-2", mjd="58821"))
    assert [image.observation_id for image in images] == ["test-2", "test-1"]
    assert images[1].product == "cord"
    assert images[1].observed_at_utc == "2019-12-03T01:24:48.160Z"
    assert images[1].image_url == neossat.IMAGE_BASE + "test-1_cord_prev.png"
    assert not truncated


def test_bounds_and_empty_result_are_explicit():
    assert neossat.parse_previews(HEADER) == ([], False)
    images, truncated = neossat.parse_previews(HEADER + "".join(row(str(i)) for i in range(13)))
    assert len(images) == 12 and truncated
    # Many products for the same observation can fill the upstream cap too.
    assert neossat.parse_previews(HEADER + row() * 61)[1]


@pytest.mark.parametrize("body", ["<html>error</html>", HEADER + row(mjd="NaN"),
    HEADER + row(mjd="1e300"), HEADER + "bad,raw,58820,https://evil.test/image.png\n",
    HEADER + "test,raw\n", HEADER + row() * 62])
def test_bad_metadata_is_not_an_empty_search(body):
    with pytest.raises((ValueError, OverflowError)):
        neossat.parse_previews(body)


def test_position_query_uses_footprint_and_bounded_latest_previews():
    query = neossat.preview_query(359.9, -89.5)
    assert "TOP 61" in query and "CONTAINS(POINT('ICRS', 359.900000000000, -89.500000000000), p.position_bounds)" in query
    assert "a.productType = 'preview'" in query and "ORDER BY p.time_bounds_lower DESC" in query


def test_endpoint_validates_before_network_and_stays_offline_by_default(client, monkeypatch):
    async def unexpected(*args):
        raise AssertionError("Must not query CADC")
    monkeypatch.setattr(neossat, "fetch_previews", unexpected)
    for ra, dec in [(360, 0), (-1, 0), (0, 91), ("NaN", 0), (0, "inf")]:
        assert client.get("/api/catalogs/neossat", params={"ra": ra, "dec": dec}).status_code == 400
    response = client.get("/api/catalogs/neossat?ra=10&dec=20")
    assert response.status_code == 503 and response.json()["code"] == "upstream_unavailable"


def test_endpoint_contract_and_empty_success(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    calls = []
    async def fetch(ra, dec):
        calls.append((ra, dec))
        return [], False
    monkeypatch.setattr(neossat, "fetch_previews", fetch)
    response = client.get("/api/catalogs/neossat?ra=10&dec=20")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert response.json()["position"] == {"ra": 10, "dec": 20}
    assert response.json()["images"] == [] and calls == [(10, 20)]


@pytest.mark.parametrize("error", [httpx.ReadTimeout("private transport details"), ValueError("invalid CSV"), TimeoutError()])
def test_archive_failure_is_distinct_from_no_previews(client, monkeypatch, error):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    async def fetch(*args):
        raise error
    monkeypatch.setattr(neossat, "fetch_previews", fetch)
    response = client.get("/api/catalogs/neossat?ra=10&dec=20")
    assert response.status_code == 503 and response.json()["code"] == "upstream_unavailable"
    assert "private" not in response.text


def test_fixture_matches_model_and_exported_schema():
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((root / "fixtures/catalogs/neossat.json").read_text())
    neossat.NeossatResponse.model_validate(fixture)
    schema = json.loads((root / "fixtures/catalogs/openapi.json").read_text())
    assert "/api/catalogs/neossat" in schema["paths"]


def test_transport_bounds_content_and_query(monkeypatch):
    original = httpx.AsyncClient
    def factory(body=HEADER + row(), content_type="text/csv", status=200):
        def handler(request):
            assert request.url.host == "ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca"
            assert "CONTAINS" in request.url.params["QUERY"]
            return httpx.Response(status, text=body, headers={"content-type": content_type})
        return lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    import asyncio
    monkeypatch.setattr(neossat.httpx, "AsyncClient", factory())
    assert len(asyncio.run(neossat.fetch_previews(10, 20))[0]) == 1
    for body, kind in [("error", "text/html"), ("x" * (neossat.MAX_BYTES + 1), "text/csv")]:
        monkeypatch.setattr(neossat.httpx, "AsyncClient", factory(body, kind))
        with pytest.raises(ValueError):
            asyncio.run(neossat.fetch_previews(10, 20))
