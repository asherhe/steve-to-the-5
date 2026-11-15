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
    def tap(name, scope, endpoints, query, required, settings, **kwargs):
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
    monkeypatch.setattr(review, "tap_check", lambda name, scope, endpoints, *args, **kwargs: review.CatalogCheck(catalog=name, status="no_candidates", scope=scope, sourceUrl=""))
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


def test_motion_filter_recovers_entering_sources_and_rejects_departing_sources():
    rows = [{"ra": 0, "dec": -40/3600, "pmra": 0, "pmdec": 2000, "name": "enter"},
            {"ra": 0, "dec": 0, "pmra": 0, "pmdec": 2000, "name": "leave"}]
    result = review.at_observation(rows, 0, 0, 10, "2020-01-01T12:00:00Z", 2000)
    assert [row["name"] for row in result] == ["enter"]
    assert result[0]["dec"] == -40/3600  # retain original measurement
    assert result[0]["separationArcsec"] < .01
    assert result[0]["positionAtUtc"].startswith("2020")
    assert review.motion_radius(10, "2020-01-01T12:00:00Z", 2000) > 300


def test_motion_filter_wrap_poles_missing_motion_and_catwise_units():
    row = {"ra": 359.999, "dec": 0, "pmra": 1000, "pmdec": 0}
    [result] = review.at_observation([row], .00177778, 0, 1, "2010-01-01T00:00:00Z", 2000)
    assert 0 <= result["predictedRa"] < 1
    [pole] = review.at_observation([{"ra": 0, "dec": 89.999, "pmra": 0, "pmdec": 2000}], 180, 89.9954, 2, "2010-01-01T00:00:00Z", 2000)
    assert pole["predictedDec"] < 90
    [missing] = review.at_observation([{"ra": 0, "dec": 0}], 0, 0, 1, "2010-01-01T00:00:00Z", 2000)
    assert "predictedRa" not in missing
    [catwise] = review.at_observation([{"ra_pm": 0, "dec_pm": -.01, "pmra": 0, "pmdec": 3.6}], 0, 0, 1,
        "2010-01-01T00:00:00Z", 2000, ra_key="ra_pm", dec_key="dec_pm", motion_scale=1000)
    assert catwise["separationArcsec"] < .01


def test_gaia_motion_search_fetches_outside_original_cone(monkeypatch):
    from app.models import NearbySource
    calls = []
    def nearby(ra, dec, radius, limit):
        calls.append((radius, limit))
        return [NearbySource(sourceId="123", ra=0, dec=-40/3600, refEpoch=2016,
                             pmRaCosDecMasYr=0, pmDecMasYr=4000, separationArcsec=40)]
    monkeypatch.setattr(review, "get_provider", lambda *_: SimpleNamespace(nearby=nearby))
    monkeypatch.setattr(review, "tap_check", lambda name, *args, **kwargs: review.CatalogCheck(catalog=name, status="no_candidates", scope="", sourceUrl=""))
    monkeypatch.setattr(review, "ultracool", lambda *args: review.CatalogCheck(catalog="UltracoolSheet", status="no_candidates", scope="", sourceUrl=""))
    monkeypatch.setattr(review, "skybot", lambda *args: review.CatalogCheck(catalog="SkyBoT", status="no_candidates", scope="", sourceUrl=""))
    result = review.run_review(0, 0, 10, "2026-01-01T00:00:00Z", replace(get_settings(), live=True))
    assert calls[0][0] > 150 and calls[0][1] == review.MOTION_ROWS
    assert result.checks[0].status == "candidates"
    assert result.checks[0].rows[0]["separationArcsec"] < .02


def test_truncated_motion_search_stays_partial_after_all_rows_move_out(monkeypatch):
    monkeypatch.setattr(review, "tap_sync", lambda *args: SimpleNamespace(content=b"fixture", media_type="application/xml"))
    monkeypatch.setattr(review, "table_result", lambda *args: ([], [{"ra": 0, "dec": 0, "pmra": 0, "pmdec": 10000}], True))
    endpoint = review.Endpoint("fixture", "https://fixture.example/tap")
    class Policy:
        connect_timeout_s = 1
        def run(self, endpoints, fetch):
            return endpoint, fetch(endpoint, 1)
    monkeypatch.setattr(review, "failover_for", lambda *_: Policy())
    value = review.tap_check("SIMBAD", "fixture", [endpoint], "fixture query", (), get_settings(),
        motion=dict(ra=0, dec=0, radius=10, observed="2020-01-01T00:00:00Z", epoch=2000))
    assert value.status == "partial" and value.rows == []
    assert any("limit" in note for note in value.limitations)
