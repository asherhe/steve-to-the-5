from __future__ import annotations


def test_each_preset_resolves(client):
    for name in [
        "Barnard's Star",
        "Epsilon Indi B",
        "WISE 0855-0714",
        "RW Aurigae",
        "R Draconis",
    ]:
        resp = client.get("/api/resolve", params={"name": name})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == name
        assert 0.0 <= body["ra"] < 360.0
        assert -90.0 <= body["dec"] <= 90.0


def test_alias_resolves_case_insensitive(client):
    resp = client.get("/api/resolve", params={"name": "  gj 699 "})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Barnard's Star"


def test_unknown_name_is_not_found(client):
    resp = client.get("/api/resolve", params={"name": "Planet Nine"})
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "not_found"
    assert "message" in body


def test_empty_name_is_invalid(client):
    # FastAPI min_length=1 rejects empty before our handler; both are acceptable 4xx.
    resp = client.get("/api/resolve", params={"name": "   "})
    assert resp.status_code in (400, 422)
