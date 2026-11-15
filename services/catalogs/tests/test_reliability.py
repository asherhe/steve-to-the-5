"""Archive failover, deadlines, cooldown, caching and provenance. No network: archives are faked."""
from __future__ import annotations

import time

import pytest

from app.config import get_settings
from app.errors import ApiError
from app.gaia import tap
from app.gaia.provider import SourceNotFound, UpstreamError
from app.reliability import AllEndpointsDown, BoundedCache, Endpoint, EndpointDown, Failover, parse_endpoints
from app.routes import resolve as resolver
from app.tap_http import QueryRejected

ESA = Endpoint("ESA Gaia Archive", "https://esa.invalid/tap")
AIP = Endpoint("AIP Gaia mirror (Potsdam)", "https://gaia.aip.de/tap")
NEARBY_COLUMNS = ["source_id", "ra", "dec", "ref_epoch", "pmra", "pmdec", "parallax", "phot_g_mean_mag", "sep_deg"]
DETAIL_COLUMNS = NEARBY_COLUMNS[:-1] + [
    "ra_error", "dec_error", "pmra_error", "pmdec_error", "parallax_error",
    "radial_velocity", "radial_velocity_error", "phot_bp_mean_mag", "phot_rp_mean_mag",
]
BARNARD = [4472832130942575872, 269.4485, 4.7394, 2016.0, -801.551, 10362.394, 546.976, 8.194]


@pytest.fixture(autouse=True)
def no_network_and_clean_state(monkeypatch):
    import httpx

    def fail(*args, **kwargs):
        raise AssertionError("Tests must not access the network")

    monkeypatch.setattr(httpx.AsyncClient, "post", fail)
    tap.nearby_cache.clear()
    tap.detail_cache.clear()
    resolver._cache.clear()
    resolver.failover_for(get_settings()).reset()
    yield
    tap.nearby_cache.clear()
    tap.detail_cache.clear()
    resolver._cache.clear()
    resolver.failover_for(get_settings()).reset()


def votable(columns, rows, int_columns=("source_id",)) -> bytes:
    from astropy.io.votable import from_table
    from astropy.table import Table
    import io

    data = {name: [row[i] for row in rows] for i, name in enumerate(columns)}
    table = Table(data, dtype=["i8" if name in int_columns else "f8" for name in columns]) if rows else Table(
        names=columns, dtype=["i8" if name in int_columns else "f8" for name in columns])
    buffer = io.BytesIO()
    from_table(table).to_xml(buffer)
    return buffer.getvalue()


ERROR_DOCUMENT = (
    b'<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">'
    b'<RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">Column nope not found.</INFO></RESOURCE></VOTABLE>'
)


class FakeArchives:
    """Maps endpoint URL to a response, an exception, or a callable; records every call."""

    def __init__(self, **behaviour):
        self.behaviour = {ESA.url: behaviour.get("esa"), AIP.url: behaviour.get("aip")}
        self.calls: list[str] = []

    def __call__(self, url, adql, timeout):
        self.calls.append(url)
        outcome = self.behaviour[url]
        if callable(outcome):
            outcome = outcome()
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def provider(archives, failover=None):
    return tap.TapGaiaProvider(endpoints=(ESA, AIP), failover=failover or Failover(1.0, 2.0, 60.0), fetch=archives)


# ---- Gaia failover -------------------------------------------------------------------------

def test_first_archive_fails_and_second_answers():
    archives = FakeArchives(esa=EndpointDown("HTTP 502"), aip=votable(NEARBY_COLUMNS, [BARNARD + [0.0001]]))
    rows = provider(archives).nearby(269.4485, 4.7394, 30, 200)
    assert [row.source_id for row in rows] == ["4472832130942575872"]
    assert rows[0].separation_arcsec == pytest.approx(0.36)
    assert archives.calls == [ESA.url, AIP.url]
    assert rows.provenance.served_by == AIP.name
    assert rows.provenance.data_release == "Gaia DR3"  # the dataset identity never changes
    assert rows.provenance.from_cache is False


def test_both_archives_failing_is_an_outage_naming_each_archive():
    archives = FakeArchives(esa=EndpointDown("timed out after 1 s"), aip=EndpointDown("HTTP 503"))
    with pytest.raises(UpstreamError) as error:
        provider(archives).nearby(1.0, 2.0, 30, 200)
    assert ESA.name in str(error.value) and AIP.name in str(error.value)
    assert len(tap.nearby_cache) == 0  # an outage is never cached as an empty result


# Deadline, cancellation and capacity behaviour is tested against a real local server in
# test_transport.py: a sleeping fake cannot show that a request is actually cancelled.


def test_cooldown_skips_a_failed_archive_then_recovers(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    failover = Failover(1.0, 2.0, 60.0)
    archives = FakeArchives(esa=EndpointDown("HTTP 502"), aip=votable(NEARBY_COLUMNS, []))
    gaia = provider(archives, failover)
    gaia.nearby(1.0, 2.0, 30, 200)
    assert archives.calls == [ESA.url, AIP.url] and failover.cooling(ESA)
    gaia.nearby(1.1, 2.0, 30, 200)
    assert archives.calls[2:] == [AIP.url]  # ESA skipped while cooling
    archives.behaviour[ESA.url] = votable(NEARBY_COLUMNS, [])
    now[0] += 61
    rows = gaia.nearby(1.2, 2.0, 30, 200)
    assert archives.calls[3:] == [ESA.url] and rows.provenance.served_by == ESA.name
    assert not failover.cooling(ESA)


def test_manual_retry_probes_an_archive_in_cooldown():
    failover = Failover(1.0, 2.0, 60.0)
    archives = FakeArchives(esa=EndpointDown("HTTP 502"), aip=votable(NEARBY_COLUMNS, []))
    gaia = provider(archives, failover)
    gaia.nearby(1.0, 2.0, 30, 200)
    archives.behaviour[ESA.url] = votable(NEARBY_COLUMNS, [])
    rows = gaia.nearby(1.3, 2.0, 30, 200, probe=True)
    assert archives.calls[2:] == [ESA.url] and rows.provenance.served_by == ESA.name


def test_every_archive_cooling_is_still_tried():
    failover = Failover(1.0, 2.0, 60.0)
    archives = FakeArchives(esa=EndpointDown("down"), aip=EndpointDown("down"))
    gaia = provider(archives, failover)
    with pytest.raises(UpstreamError):
        gaia.nearby(1.0, 2.0, 30, 200)
    archives.behaviour[AIP.url] = votable(NEARBY_COLUMNS, [])
    assert gaia.nearby(1.0, 2.0, 30, 200).provenance.served_by == AIP.name


def test_valid_empty_result_does_not_fall_back_or_cool_down():
    failover = Failover(1.0, 2.0, 60.0)
    archives = FakeArchives(esa=votable(NEARBY_COLUMNS, []), aip=AssertionError("must not be asked"))
    rows = provider(archives, failover).nearby(83.8, 9.9, 30, 200)
    assert list(rows) == [] and archives.calls == [ESA.url] and not failover.cooling(ESA)
    assert rows.provenance.served_by == ESA.name


@pytest.mark.parametrize("outcome", [QueryRejected("HTTP 400"), ERROR_DOCUMENT])
def test_rejected_query_does_not_fall_back_or_cool_down(outcome):
    failover = Failover(1.0, 2.0, 60.0)
    archives = FakeArchives(esa=outcome, aip=AssertionError("must not be asked"))
    with pytest.raises(UpstreamError, match="rejected"):
        provider(archives, failover).nearby(1.0, 2.0, 30, 200)
    assert archives.calls == [ESA.url] and not failover.cooling(ESA)


def test_unreadable_table_counts_as_unavailable():
    archives = FakeArchives(esa=b"<html>maintenance</html>", aip=votable(NEARBY_COLUMNS, []))
    assert provider(archives).nearby(1.0, 2.0, 30, 200).provenance.served_by == AIP.name


# ---- Gaia cache and provenance -------------------------------------------------------------

def test_cache_hit_survives_an_outage_and_keeps_original_provenance():
    archives = FakeArchives(esa=EndpointDown("HTTP 502"), aip=votable(NEARBY_COLUMNS, [BARNARD + [0.0]]))
    gaia = provider(archives)
    first = gaia.nearby(269.4485, 4.7394, 30, 200)
    archives.behaviour[AIP.url] = EndpointDown("HTTP 503")
    again = gaia.nearby(269.4485, 4.7394, 30, 200)
    assert len(archives.calls) == 2  # no further request
    assert [row.source_id for row in again] == [row.source_id for row in first]
    assert again.provenance.from_cache is True
    assert again.provenance.served_by == AIP.name
    assert again.provenance.retrieved_at_utc == first.provenance.retrieved_at_utc
    with pytest.raises(UpstreamError):
        gaia.nearby(10.0, 10.0, 30, 200)  # an unseen field cannot be served from cache


def test_detail_provenance_cache_and_archive_links():
    row = BARNARD + [0.027, 0.034, 0.031, 0.042, 0.04, -110.353, 0.123, 9.978, 6.964]
    archives = FakeArchives(esa=EndpointDown("down"), aip=votable(DETAIL_COLUMNS, [row]))
    gaia = provider(archives)
    detail = gaia.detail("4472832130942575872")
    assert detail.parallax_mas == pytest.approx(546.976) and detail.bp_mag == pytest.approx(9.978)
    assert detail.provenance.served_by == AIP.name and detail.provenance.from_cache is False
    assert detail.provenance.source_detail_url.startswith("https://gaia.aip.de/")
    cached = gaia.detail("4472832130942575872")
    assert cached.provenance.from_cache is True and len(archives.calls) == 2
    assert cached.provenance.retrieved_at_utc == detail.provenance.retrieved_at_utc


def test_missing_source_is_not_found_and_not_cached():
    archives = FakeArchives(esa=votable(DETAIL_COLUMNS, []))
    with pytest.raises(SourceNotFound):
        provider(archives).detail("12345")
    assert len(tap.detail_cache) == 0


def test_routes_expose_provenance_and_forward_retry(client, monkeypatch):
    from app.models import NearbySource
    from app.routes import nearby
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    seen = []
    class Live:
        def nearby(self, ra, dec, radius, max_rows, probe=False):
            seen.append(probe)
            from app.gaia.provider import NearbyResult
            return NearbyResult([NearbySource(source_id="1", ra=ra, dec=dec, ref_epoch=2016, separation_arcsec=0)],
                                tap._provenance(AIP, "2026-11-15T00:00:00Z", False))
    monkeypatch.setattr(nearby, "get_provider", lambda _: Live())
    body = client.get("/api/catalogs/nearby?ra=1&dec=2&radiusArcsec=30").json()
    assert body["provenance"]["servedBy"] == AIP.name and body["provenance"]["dataRelease"] == "Gaia DR3"
    client.get("/api/catalogs/nearby?ra=1&dec=2&radiusArcsec=30&retry=true")
    assert seen == [False, True]


def test_fixture_mode_responses_stay_valid_without_provenance(client):
    body = client.get("/api/catalogs/nearby?ra=269.4521&dec=4.6933&radiusArcsec=30").json()
    assert body["provenance"] is None and body["sources"]


# ---- shared helpers ------------------------------------------------------------------------

def test_bounded_cache_expiry_bound_and_namespaces(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    names, gaia = BoundedCache(2), BoundedCache(2)
    names.put("a", 1, 10)
    assert gaia.get("a") is None and names.get("a") == 1  # namespaces never mix
    now[0] = 11
    assert names.get("a") is None
    for key in "xyz":
        names.put(key, key, 10)
    assert len(names) == 2 and names.get("x") is None


def test_endpoint_list_configuration():
    defaults = (ESA, AIP)
    assert parse_endpoints("", defaults) == defaults
    assert parse_endpoints("not a list", defaults) == defaults
    assert parse_endpoints("Mirror=https://m.example/tap/, ESA=https://e.example/tap", defaults) == (
        Endpoint("Mirror", "https://m.example/tap"), Endpoint("ESA", "https://e.example/tap"))


def test_failover_reports_every_failure():
    with pytest.raises(AllEndpointsDown) as error:
        Failover(1, 2, 60).run((ESA, AIP), lambda endpoint, timeout: (_ for _ in ()).throw(EndpointDown("HTTP 502")))
    assert [name for name, _ in error.value.failures] == [ESA.name, AIP.name]


# ---- SIMBAD --------------------------------------------------------------------------------

CDS = "https://simbad.cds.unistra.fr/simbad/sim-tap"
HARVARD = "https://simbad.harvard.edu/simbad/sim-tap"


def simbad_csv(rows) -> bytes:
    return ("oid,main_id,ra,dec,id\n" + "".join(
        f'{oid},"{main}",{ra},{dec},"{ident}"\n' for oid, main, ra, dec, ident in rows)).encode()


VEGA = [(1, "* alf Lyr", 279.2347, 38.7837, ident) for ident in ("* alf Lyr", "HD 172167", "NAME Vega", "HIP 91262")]


class FakeSimbad:
    def __init__(self, cds, harvard):
        self.behaviour = {CDS: cds, HARVARD: harvard}
        self.calls: list[str] = []
        self.queries: list[str] = []

    def __call__(self, url, adql, timeout):
        self.calls.append(url)
        self.queries.append(adql)
        outcome = self.behaviour[url]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def test_simbad_primary_fails_and_mirror_answers_with_a_common_name():
    servers = FakeSimbad(EndpointDown("HTTP 404"), simbad_csv(VEGA))
    result = resolver._resolve_external("vega", fetch=servers)
    assert servers.calls == [CDS, HARVARD]
    assert result.name == "Vega" and result.identity.common_name == "Vega" and result.identity.display_name == "Vega"
    assert result.identity.canonical_designation == "* alf Lyr"  # SIMBAD's main identifier is kept
    assert result.identity.provenance[0].served_by == "SIMBAD mirror (CfA Harvard)"
    assert "CfA Harvard" in result.position_provenance.source
    assert result.identity.provenance[0].url == "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=%2A%20alf%20Lyr"


def test_simbad_both_servers_failing_is_an_outage():
    with pytest.raises(ApiError) as error:
        resolver._resolve_external("vega", fetch=FakeSimbad(EndpointDown("HTTP 404"), EndpointDown("timed out")))
    assert error.value.code == "upstream_unavailable" and error.value.status_code == 503
    assert "not responding" in error.value.message and "coordinate" in error.value.message


def test_mirror_only_miss_is_worded_and_scoped_to_the_mirror(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    servers = FakeSimbad(EndpointDown("HTTP 404"), simbad_csv([]))
    original = resolver._resolve_external
    monkeypatch.setattr(resolver, "_resolve_external", lambda name, probe=False: original(name, probe=probe, fetch=servers))
    first = client.get("/api/resolve", params={"name": "New Object 2026"})
    assert first.status_code == 404 and first.json()["code"] == "not_found_in_mirror"
    assert first.json()["message"].startswith("No match in the available SIMBAD mirror")
    client.get("/api/resolve", params={"name": "New Object 2026"})
    assert servers.calls == [CDS, HARVARD]  # served from the brief mirror-miss entry while CDS is cooling
    # Once the main server is reachable again the mirror's miss no longer applies.
    servers.behaviour[CDS] = simbad_csv([(9, "New Object 2026", 10.0, 20.0, "New Object 2026")])
    resolver.failover_for(get_settings()).reset()
    recovered = client.get("/api/resolve", params={"name": "New Object 2026"})
    assert recovered.status_code == 200 and recovered.json()["name"] == "New Object 2026"


def test_authoritative_miss_is_plain_not_found(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    servers = FakeSimbad(simbad_csv([]), AssertionError("mirror must not be asked after an authoritative answer"))
    original = resolver._resolve_external
    monkeypatch.setattr(resolver, "_resolve_external", lambda name, probe=False: original(name, probe=probe, fetch=servers))
    response = client.get("/api/resolve", params={"name": "zzzz nothing"})
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert response.json()["message"].startswith("No object with that name in SIMBAD")


def test_lookup_switched_off_is_distinct_from_an_outage(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    body = client.get("/api/resolve", params={"name": "Vega"}).json()
    assert body["code"] == "resolver_disabled" and "switched off" in body["message"]


def test_bundled_targets_and_ambiguity_checks_run_before_simbad(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    def forbidden(*args, **kwargs):
        raise AssertionError("SIMBAD must not be asked")
    monkeypatch.setattr(resolver, "_resolve_external", forbidden)
    assert client.get("/api/resolve", params={"name": "Barnard's Star"}).json()["identity"]["objectId"] == "barnards-star"
    assert client.get("/api/resolve", params={"name": "epsilon indi"}).json()["code"] == "ambiguous_name"
    assert client.get("/api/resolve", params={"name": "eps ind b"}).json()["code"] == "ambiguous_name"
    assert client.get("/api/resolve", params={"name": "RW Aur"}).json()["identity"]["objectId"] == "rw-aurigae"


def test_common_name_choice_is_deterministic():
    from app.simbad import common_name
    several = ["GJ 699", "NAME Barnard's Star", "NAME Barnard Star", "NAME Velox Barnardi"]
    assert common_name(several, "velox barnardi") == "Velox Barnardi"  # what the user typed
    assert common_name(several, "GJ 699") == "Barnard Star"  # otherwise the shortest
    assert common_name(list(reversed(several)), "GJ 699") == "Barnard Star"  # order independent
    assert common_name(["GJ 699", "NAME Vega"], "x") == "Vega"
    assert common_name(["HD 123", "HIP 456"], "HD 123") is None


def test_main_identifier_that_is_a_name_displays_without_the_prefix():
    rows = [(3, "NAME Proxima Centauri", 217.4289, -62.6795, ident) for ident in ("NAME Proxima Centauri", "GJ 551")]
    result = resolver._resolve_external("proxima centauri", fetch=FakeSimbad(simbad_csv(rows), None))
    assert result.name == "Proxima Centauri" and result.identity.canonical_designation == "NAME Proxima Centauri"


def test_quotes_in_names_are_escaped_in_adql():
    servers = FakeSimbad(simbad_csv([]), None)
    with pytest.raises(ApiError):
        resolver._resolve_external("O'Neil' OR 1=1 --", fetch=servers)
    assert "WHERE i.id = 'O''Neil'' OR 1=1 --'" in servers.queries[0]
