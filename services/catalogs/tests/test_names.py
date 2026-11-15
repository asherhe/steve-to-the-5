from __future__ import annotations
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import pytest
from app.config import get_settings
from app.errors import ApiError
from app.models import ResolveResult
from app.presets import gaia_identity, load_gaia_identities, load_presets, normalize_name, resolve_preset
from app.routes import resolve as module

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def fail(*args, **kwargs): raise AssertionError("Tests must not access the network")
    try:
        import requests
    except ImportError:
        return
    monkeypatch.setattr(requests.sessions.Session, "request", fail)

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "fixtures/catalogs/name-vectors.json").read_text())

@pytest.mark.parametrize("vector", VECTORS)
def test_shared_name_vectors(vector):
    assert normalize_name(vector["query"]) == vector["normalized"]
    match = resolve_preset(vector["query"], get_settings())
    assert (match["identity"]["objectId"] if match else None) == vector["target"]

@pytest.mark.parametrize("name", ["epsilon indi", "EPS IND", "epsilon indi b", "ε Indi b"])
def test_component_ambiguity_is_not_silently_folded(client, name):
    response = client.get("/api/resolve", params={"name": name})
    assert response.status_code == 409
    assert response.json()["code"] == "ambiguous_name"


def test_only_one_common_name_and_verified_gaia_join():
    settings = get_settings()
    entries = load_presets(str(settings.fixtures_dir))
    assert [e["identity"]["commonName"] for e in entries] == ["Barnard’s Star", None, None, None, None]
    live = replace(settings, live=True)
    assert gaia_identity("4472832130942575872", settings) is None  # synthetic mode
    assert gaia_identity("4472832130942575872", live).object_id == "barnards-star"
    assert gaia_identity("5726817071037876736", live) is None  # nearby WISE field star
    assert gaia_identity("6412595290592307840", live) is None  # Epsilon Indi A, never B


def test_alias_collision_is_rejected(tmp_path):
    entries = json.loads((get_settings().fixtures_dir / "presets.json").read_text())
    entries["presets"][1]["aliases"].append("GJ 699")
    (tmp_path / "presets.json").write_text(json.dumps(entries))
    with pytest.raises(ValueError, match="collision"):
        load_presets(str(tmp_path))


def test_snapshot_contract_and_representative_responses():
    from app.main import create_app
    assert json.loads((ROOT / "fixtures/catalogs/openapi.json").read_text()) == create_app().openapi()
    expected = [ResolveResult.model_validate({k: e[k] for k in ("name", "ra", "dec", "identity", "positionProvenance")}).model_dump(by_alias=True) for e in load_presets(str(get_settings().fixtures_dir))]
    assert json.loads((ROOT / "fixtures/catalogs/resolved-targets.json").read_text()) == expected


def test_current_simbad_degrees_and_canonical_identity(monkeypatch):
    from astropy.table import Table
    Simbad = pytest.importorskip("astroquery.simbad").SimbadClass
    monkeypatch.setattr(Simbad, "query_object", lambda *args, **kwargs: Table({"ra": [42.25], "dec": [-8.5], "main_id": ["HD 123"]}))
    monkeypatch.setattr(Simbad, "query_objectids", lambda *args, **kwargs: Table({"id": ["HD 123", "HIP 456"]}))
    result = module._resolve_external("other alias")
    assert result.name == "HD 123" and result.ra == 42.25 and result.dec == -8.5
    assert result.identity.aliases == ["HD 123", "HIP 456"]
    assert result.identity.common_name is None

@pytest.mark.parametrize("rows, code", [([], "not_found"), ([{"ra": float("nan"), "dec": 1, "main_id": "X"}], "upstream_unavailable"), ([{"ra": 360, "dec": 1, "main_id": "X"}], "upstream_unavailable"), ([{"ra": 1, "dec": 2, "main_id": "X"}]*2, "ambiguous_name")])
def test_simbad_empty_invalid_and_ambiguous(monkeypatch, rows, code):
    Simbad = pytest.importorskip("astroquery.simbad").SimbadClass
    monkeypatch.setattr(Simbad, "query_object", lambda *args, **kwargs: rows)
    with pytest.raises(ApiError) as error:
        module._resolve_external("unknown")
    assert error.value.code == code


def test_timeout_is_an_outage_not_unknown(monkeypatch):
    Simbad = pytest.importorskip("astroquery.simbad").SimbadClass
    def fail(*args, **kwargs): raise TimeoutError()
    monkeypatch.setattr(Simbad, "query_object", fail)
    with pytest.raises(ApiError) as error:
        module._resolve_external("unknown")
    assert error.value.code == "upstream_unavailable"


def test_cache_ttl_modes_misses_outages_and_bound(client, monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    module._cache.clear()
    now = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    calls = []
    def query(name):
        calls.append(name)
        if name == "missing": raise ApiError("not_found", "No identifier", 404)
        if name == "down": raise ApiError("upstream_unavailable", "Unavailable", 503)
        return ResolveResult(name=name, ra=1, dec=2)
    monkeypatch.setattr(module, "_resolve_external", query)
    for _ in range(2): assert client.get("/api/resolve", params={"name": "HD 123"}).status_code == 200
    assert calls == ["HD 123"]
    for _ in range(2): assert client.get("/api/resolve", params={"name": "missing"}).status_code == 404
    assert calls.count("missing") == 1
    now[0] += 301
    client.get("/api/resolve", params={"name": "missing"})
    assert calls.count("missing") == 2
    for _ in range(2): assert client.get("/api/resolve", params={"name": "down"}).status_code == 503
    assert calls.count("down") == 2
    now[0] += 86401
    client.get("/api/resolve", params={"name": "HD 123"})
    assert calls.count("HD 123") == 2
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "0")
    assert client.get("/api/resolve", params={"name": "HD 123"}).json()["code"] == "resolver_disabled"
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    for i in range(257): client.get("/api/resolve", params={"name": f"source {i}"})
    assert len(module._cache) == 256
    module._cache.clear()


def test_live_enrichment_uses_source_id_not_position(client, monkeypatch):
    from app.routes import nearby, detail
    from app.models import NearbySource, GaiaDetail, SourceProvenance
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    wrong = NearbySource(source_id="123", ra=269.4521, dec=4.6933, ref_epoch=2016, separation_arcsec=0)
    correct = NearbySource(source_id="4472832130942575872", ra=269.45, dec=4.74, ref_epoch=2016, separation_arcsec=120)
    provider = SimpleNamespace(nearby=lambda *args: [wrong, correct], detail=lambda sid: GaiaDetail(source_id=sid,ra=1,dec=2,ref_epoch=2016,provenance=SourceProvenance(catalog="Gaia",data_release="DR3")))
    monkeypatch.setattr(nearby, "get_provider", lambda _: provider)
    monkeypatch.setattr(detail, "get_provider", lambda _: provider)
    rows = client.get("/api/catalogs/nearby?ra=269.45&dec=4.69&radiusArcsec=200").json()["sources"]
    assert rows[0]["identity"] is None
    assert rows[1]["identity"]["objectId"] == "barnards-star"
    assert client.get("/api/catalogs/gaia/4472832130942575872").json()["identity"]["objectId"] == "barnards-star"


def test_high_proper_motion_against_astropy():
    import warnings
    u = pytest.importorskip("astropy.units")
    from astropy.coordinates import SkyCoord
    from astropy.time import Time
    from app.astrometry.propagate import propagate
    args = (269.45, 4.74, 2016.0, 2026.0, -801.551, 10362.394)
    predicted = propagate(*args)
    origin = SkyCoord(ra=args[0]*u.deg, dec=args[1]*u.deg, pm_ra_cosdec=args[4]*u.mas/u.yr, pm_dec=args[5]*u.mas/u.yr, obstime=Time(args[2], format="jyear"), frame="icrs")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        reference = origin.apply_space_motion(new_obstime=Time(args[3], format="jyear"))
    linear = SkyCoord(predicted.ra*u.deg, predicted.dec*u.deg)
    assert linear.separation(reference).arcsec < 0.1  # angular model only; not image registration


def test_http_transport_has_explicit_timeout(monkeypatch):
    requests = pytest.importorskip("requests")
    seen = []
    monkeypatch.setattr(requests.Session, "request", lambda *args, **kwargs: seen.append(kwargs))
    with module._resolver_session() as session:
        session.get("https://example.invalid", timeout=None)
    assert len(seen) == 1 and seen[0]["timeout"] == 8


def test_offline_startup_without_live_dependencies():
    import subprocess
    import sys
    result = subprocess.run([sys.executable, "-c", """
import sys
from importlib.abc import MetaPathFinder
class NoLiveDependencies(MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'requests', 'astroquery'}:
            raise ModuleNotFoundError(fullname)
sys.meta_path.insert(0, NoLiveDependencies())
sys.path.insert(0, 'services/catalogs')
from app.main import create_app
from app.routes.resolve import resolve
create_app()
assert resolve("GJ699").identity.object_id == 'barnards-star'
"""], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("query", ["barnard", "HIP879", "0855", "aur", "drac"])
@pytest.mark.parametrize("external", [False, True])
def test_direct_partial_query_requires_selection(client, monkeypatch, query, external):
    if external:
        monkeypatch.setenv("CATALOGS_LIVE", "1")
        monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    def forbidden(*args): raise AssertionError("Partial names must not query upstream")
    monkeypatch.setattr(module, "_resolve_external", forbidden)
    response = client.get("/api/resolve", params={"name":query})
    assert response.status_code == 400
    assert response.json()["code"] == "incomplete_name"
    assert "Choose a matching target" in response.json()["message"]


def test_partial_error_matches_shared_fixture(client):
    fixture = json.loads((ROOT / "fixtures/catalogs/errors/incomplete-name.json").read_text())
    response = client.get("/api/resolve", params={"name":"barnard"})
    assert response.status_code == fixture["httpStatus"]
    assert response.json() == fixture["body"]


def test_new_source_enrichment_has_verified_component_scope():
    settings = get_settings()
    live = replace(settings, live=True)
    assert gaia_identity("1648328016354496384", live).object_id == "r-draconis"
    assert gaia_identity("1648328016352398848", live) is None  # different DR2 ID
    ba = gaia_identity("6412596012146801152", live)
    assert ba.object_id == "epsilon-indi-ba"
    assert ba.display_name == "Epsilon Indi Ba"
    assert ba.common_name is None
    assert ba.object_id != resolve_preset("Epsilon Indi B", settings)["identity"]["objectId"]
    for source_id in ["1648328016354496384", "6412596012146801152", "156430822114424576", "156430817820015232"]:
        assert gaia_identity(source_id, settings) is None  # fixture mode stays synthetic
    for source_id in ["156430822114424576", "156430817820015232", "6412595290592307840"]:
        assert gaia_identity(source_id, live) is None  # conflicting RW IDs / Epsilon A


def test_component_enrichment_fixture_and_duplicate_binding_rejection(tmp_path):
    data = json.loads((get_settings().fixtures_dir / "presets.json").read_text())
    expected = json.loads((ROOT / "fixtures/catalogs/source-identities.json").read_text())
    from app.models import ObjectIdentity
    assert expected == [ObjectIdentity.model_validate(value).model_dump(by_alias=True) for value in data["sourceIdentities"]]
    data["sourceIdentities"][0]["catalogIds"] = [{"catalog":"Gaia","dataRelease":"DR3","id":"4472832130942575872"}]
    (tmp_path / "presets.json").write_text(json.dumps(data))
    with pytest.raises(ValueError, match="Conflicting Gaia"):
        load_gaia_identities(str(tmp_path))


def test_live_route_enriches_r_dra_and_ba_without_inheriting_system(client, monkeypatch):
    from app.routes import detail
    from app.models import GaiaDetail, SourceProvenance
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    provider = SimpleNamespace(detail=lambda sid: GaiaDetail(source_id=sid,ra=1,dec=2,ref_epoch=2016,provenance=SourceProvenance(catalog="Gaia",data_release="DR3")))
    monkeypatch.setattr(detail, "get_provider", lambda _: provider)
    assert client.get("/api/catalogs/gaia/1648328016354496384").json()["identity"]["displayName"] == "R Draconis"
    assert client.get("/api/catalogs/gaia/6412596012146801152").json()["identity"]["displayName"] == "Epsilon Indi Ba"
    assert client.get("/api/catalogs/gaia/156430822114424576").json()["identity"] is None
