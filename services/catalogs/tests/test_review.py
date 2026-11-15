from collections import Counter
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
import json
from pathlib import Path
from app import review
from app.config import get_settings
from app.reliability import EndpointDown


def test_offline_review_never_queries_archives(monkeypatch):
    monkeypatch.setattr(review, "get_provider", lambda *_: pytest.fail("Unexpected live query"))
    result = review.run_review(0, 0, 120, "2026-01-01T00:00:00Z", replace(get_settings(), live=False))
    assert result.mode == "offline"
    assert len(result.checks) == 6
    assert all(c.status == "skipped" for c in result.checks)


def test_review_fixture_matches_contract():
    fixture = Path(__file__).resolve().parents[3] / "fixtures/catalogs/review-offline.json"
    result = review.CatalogReview.model_validate(json.loads(fixture.read_text(encoding="utf-8")))
    assert result.mode == "offline" and len(result.checks) == 6


def test_independent_checks_keep_failures_distinct(monkeypatch):
    monkeypatch.setattr(review, "get_provider", lambda *_: SimpleNamespace(nearby=lambda *args: []))
    def tap(name, scope, endpoints, query, required, settings):
        if name == "SIMBAD":
            raise EndpointDown("outage")
        return review.CatalogCheck(catalog=name, status="no_candidates", scope=scope, sourceUrl=endpoints[0].url)
    monkeypatch.setattr(review, "tap_check", tap)
    monkeypatch.setattr(review, "ultracool", lambda *args: review.CatalogCheck(catalog="UltracoolSheet", status="partial", scope="bounded", sourceUrl=""))
    monkeypatch.setattr(review, "skybot", lambda *args: review.CatalogCheck(catalog="SkyBoT", status="candidates", scope="predictions", sourceUrl="", rows=[{"name": "asteroid"}]))
    result = review.run_review(359.9, -7, 120, "2026-01-01T00:00:00Z", replace(get_settings(), live=True))
    assert [c.catalog for c in result.checks] == list(review.CATALOGS)
    assert [c.status for c in result.checks] == ["no_candidates", "unavailable", "no_candidates", "partial", "candidates", "no_candidates"]
    assert "only" in result.checks[-1].scope


def test_live_route_reuses_each_catalog_and_retries_failures(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    monkeypatch.setattr(review, "_check_caches", {
        name: review.BoundedCache(8) for name in review._check_caches
    })
    monkeypatch.setattr(review, "get_provider", lambda *_: SimpleNamespace(nearby=lambda *args: []))
    calls = Counter()

    def check(name, status="no_candidates"):
        calls[name] += 1
        if name == "SIMBAD" and calls[name] == 1:
            raise EndpointDown("temporary outage")
        return review.CatalogCheck(catalog=name, status=status, scope="test cone", sourceUrl="",
                                   retrievedAtUtc=f"2026-01-01T00:00:0{calls[name]}Z")

    monkeypatch.setattr(review, "tap_check", lambda name, *args: check(name))
    monkeypatch.setattr(review, "ultracool", lambda *args: check("UltracoolSheet", "partial"))
    monkeypatch.setattr(review, "skybot", lambda *args: check("SkyBoT", "candidates"))

    params = {"ra": 12.3, "dec": -4.5, "radiusArcsec": 30, "observedAtUtc": "2026-01-01T00:00:00Z"}

    def fetch(**changes):
        response = client.get("/api/catalogs/review", params=params | changes)
        assert response.status_code == 200, response.text
        return {item["catalog"]: item for item in response.json()["checks"]}

    first = fetch()
    assert first["SIMBAD"]["status"] == "unavailable"
    second = fetch()
    assert second["SIMBAD"]["status"] == "no_candidates"
    for name in review._check_caches.keys() - {"SIMBAD"}:
        assert calls[name] == 1
        assert second[name] == first[name]

    later = fetch(observedAtUtc="2026-01-02T00:00:00Z")
    assert calls == {"SIMBAD": 2, "CatWISE2020": 1, "UltracoolSheet": 1, "SkyBoT": 2, "VizieR": 1}
    assert later["SIMBAD"] == second["SIMBAD"]
    assert later["SkyBoT"]["retrievedAtUtc"] != second["SkyBoT"]["retrievedAtUtc"]

    fetch(radiusArcsec=60)
    fetch(ra=12.4)
    assert calls == {"SIMBAD": 4, "CatWISE2020": 3, "UltracoolSheet": 3, "SkyBoT": 4, "VizieR": 3}


def votable(info="", rows=""):
    return f'''<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE>
    {info}<TABLE><FIELD name="ra" datatype="double" unit="deg"/><DATA><TABLEDATA>{rows}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>'''.encode()


def test_empty_valid_table_and_overflow_are_different():
    columns, rows, partial = review.table_result(votable(), "application/x-votable+xml", ("ra",))
    assert columns[0]["unit"] == "deg" and rows == [] and not partial
    assert review.table_result(votable('<INFO name="QUERY_STATUS" value="OVERFLOW"/>'), "application/xml")[2]
    with pytest.raises(EndpointDown):
        review.table_result(votable('<INFO name="Error" value="failure"/>'), "application/xml")
    with pytest.raises(EndpointDown):
        review.table_result(votable(), "application/xml", ("wrong_column",))


def test_skybot_empty_cone_quirk_does_not_hide_other_errors():
    empty = votable('<INFO name="QUERY_STATUS" value="ERROR">No solar system object was found in the requested FOV: RA DEC EPOCH</INFO>')
    assert review.skybot_table(empty, "text/xml") == ([], [], False)
    with pytest.raises(EndpointDown):
        review.skybot_table(votable('<INFO name="QUERY_STATUS" value="ERROR">Database unavailable</INFO>'), "text/xml")


def test_ultracool_cone_handles_ra_wrap_and_retains_full_row():
    review._sheet_cache.put("2.1.0", ([{"name": "Fixture only", "ra_j2000_formula": "359.999", "dec_j2000_formula": "0", "original_reference": "example"}], "2026-01-01T00:00:00Z", "a" * 64), 60)
    try:
        result = review.ultracool(0.001, 0, 10)
        assert result.status == "candidates"
        assert result.rows[0]["original_reference"] == "example"
        assert result.rows[0]["separationArcsec"] == pytest.approx(7.2)
    finally:
        review._sheet_cache.clear()


def test_route_requires_observation_timezone(client):
    assert client.get("/api/catalogs/review", params={"ra": 0, "dec": 0, "observedAtUtc": "2026-01-01"}).status_code == 400
    result = client.get("/api/catalogs/review", params={"ra": 0, "dec": 0, "observedAtUtc": "2026-01-01T00:00:00Z"})
    assert result.status_code == 200 and result.json()["mode"] == "offline"
    assert client.get("/api/catalogs/review", params={"ra": 360, "dec": 0, "observedAtUtc": "2026-01-01T00:00:00Z"}).status_code == 422


def test_undated_point_skips_skybot_without_guessing_a_time(monkeypatch):
    monkeypatch.setattr(review, "get_provider", lambda *_: SimpleNamespace(nearby=lambda *args: []))
    monkeypatch.setattr(review, "tap_check", lambda name, scope, endpoints, *args: review.CatalogCheck(catalog=name, status="no_candidates", scope=scope, sourceUrl=""))
    monkeypatch.setattr(review, "ultracool", lambda *args: review.CatalogCheck(catalog="UltracoolSheet", status="no_candidates", scope="", sourceUrl=""))
    monkeypatch.setattr(review, "skybot", lambda *args: pytest.fail("SkyBoT needs an observation time"))
    result = review.run_review(10, 10, 30, None, replace(get_settings(), live=True))
    assert result.observedAtUtc is None
    skybot = next(c for c in result.checks if c.catalog == "SkyBoT")
    assert skybot.status == "skipped" and "observation time" in skybot.scope


def test_route_accepts_a_point_without_observation_time(client):
    result = client.get("/api/catalogs/review", params={"ra": 10, "dec": 10, "radiusArcsec": 30})
    assert result.status_code == 200
    assert result.json()["observedAtUtc"] is None
