from __future__ import annotations

KNOWN_ID = "4472832130942575872"
PARTIAL_ID = "5726817066742913024"


def test_known_detail_full(client):
    resp = client.get(f"/api/catalogs/gaia/{KNOWN_ID}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sourceId"] == KNOWN_ID
    assert body["refEpoch"] == 2016.0
    assert body["radialVelocityKmS"] is not None
    assert body["bpMag"] is not None and body["rpMag"] is not None
    assert body["provenance"]["dataRelease"] == "Gaia DR3"


def test_partial_detail_has_nulls(client):
    resp = client.get(f"/api/catalogs/gaia/{PARTIAL_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["parallaxMas"] is None
    assert body["radialVelocityKmS"] is None
    assert body["bpMag"] is None
    # Required astrometry still present.
    assert body["ra"] is not None and body["dec"] is not None


def test_missing_source_is_not_found(client):
    resp = client.get("/api/catalogs/gaia/0000000000000000000")
    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"
