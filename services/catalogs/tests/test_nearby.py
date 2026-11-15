from __future__ import annotations

# Scenario anchor coordinates mirrored from the fixture provider.
KNOWN = (269.4521, 4.6933)
AMBIGUOUS = (133.7951, -7.2451)
UNMATCHED = (83.8221, 9.9357)
UNAVAILABLE = (359.999, 89.999)

FIELDS = {
    "identity",
    "sourceId",
    "ra",
    "dec",
    "refEpoch",
    "pmRaCosDecMasYr",
    "pmDecMasYr",
    "parallaxMas",
    "gMag",
    "separationArcsec",
}


def _get(client, ra, dec, radius=120.0):
    return client.get(
        "/api/catalogs/nearby",
        params={"ra": ra, "dec": dec, "radiusArcsec": radius},
    )


def test_known_single_match(client):
    resp = _get(client, *KNOWN)
    assert resp.status_code == 200, resp.text
    assert resp.headers["X-SPHEREx-Catalog-Mode"] == "fixture"
    sources = resp.json()["sources"]
    assert len(sources) == 1
    assert set(sources[0].keys()) == FIELDS
    assert sources[0]["refEpoch"] == 2016.0


def test_ambiguous_multiple_matches(client):
    resp = _get(client, *AMBIGUOUS)
    sources = resp.json()["sources"]
    assert len(sources) >= 2
    # Sorted by separation.
    seps = [s["separationArcsec"] for s in sources]
    assert seps == sorted(seps)


def test_unmatched_is_empty_not_error(client):
    resp = _get(client, *UNMATCHED)
    assert resp.status_code == 200
    assert resp.json()["sources"] == []


def test_upstream_failure_distinct_from_empty(client):
    resp = _get(client, *UNAVAILABLE)
    assert resp.status_code == 503
    body = resp.json()
    assert body["code"] == "upstream_unavailable"


def test_invalid_coordinate_rejected(client):
    resp = _get(client, 400.0, 0.0)
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_request"


def test_radius_bound_enforced(client):
    resp = _get(client, *KNOWN, radius=10000.0)
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_request"


def test_radius_filters_rows(client):
    # A tiny radius drops the known match (sep ~0.42"), so still one; use even smaller.
    resp = _get(client, *KNOWN, radius=0.1)
    assert resp.status_code == 200
    assert resp.json()["sources"] == []
