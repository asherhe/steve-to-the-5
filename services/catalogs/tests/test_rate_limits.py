"""HTTP 429 handling and plain reasons for unavailable catalog checks. Local server only."""
from __future__ import annotations

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import review as rv
from app.gaia.provider import UpstreamError
from app.reliability import AllEndpointsDown, Endpoint, EndpointThrottled, Failover, THROTTLE_COOLDOWN_S
from app.tap_http import QueryRejected, retry_after_s, tap_sync

CSV = b"oid,main_id,ra,dec,id\n"


class Server:
    """Answers `/<name>/sync` from a queue of statuses (the last one repeats)."""

    def __init__(self):
        self.plans: dict[str, list[tuple[int, dict]]] = {}
        self.hits: dict[str, list[float]] = {}
        server = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                name = self.path.strip("/").split("/")[0]
                server.hits.setdefault(name, []).append(time.monotonic())
                plan = server.plans[name]
                status, headers = plan.pop(0) if len(plan) > 1 else plan[0]
                body = CSV if status == 200 else b""
                self.send_response(status)
                self.send_header("Content-Type", "text/csv")
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def endpoint(self, name, *plan):
        self.plans[name] = list(plan)
        return Endpoint(name, f"http://127.0.0.1:{self.httpd.server_address[1]}/{name}")


@pytest.fixture(scope="module")
def server():
    s = Server()
    yield s
    s.httpd.shutdown()
    s.httpd.server_close()


def test_retry_after_header_is_bounded():
    assert retry_after_s(None) == 2.0
    assert retry_after_s("1") == 1.0
    assert retry_after_s("120") == 10.0
    assert retry_after_s("Wed, 21 Oct 2026 07:28:00 GMT") == 2.0
    assert retry_after_s("-5") == 0.0


def test_one_429_is_retried_after_the_requested_wait(server):
    endpoint = server.endpoint("once", (429, {"Retry-After": "1"}), (200, {}))
    started = time.monotonic()
    response = tap_sync(endpoint.url, "SELECT 1", 6.0, "csv")
    assert response.content == CSV
    hits = server.hits["once"]
    assert len(hits) == 2 and hits[1] - hits[0] >= 0.9
    assert time.monotonic() - started < 3


def test_repeated_429_is_throttled_with_a_short_cooldown_and_falls_back(server):
    busy = server.endpoint("busy", (429, {"Retry-After": "0"}))
    healthy = server.endpoint("healthy", (200, {}))
    failover = Failover(3.0, 6.0, 180.0)
    endpoint, response = failover.run((busy, healthy), lambda e, d: tap_sync(e.url, "SELECT 1", d, "csv"))
    assert endpoint == healthy and response.content == CSV
    assert len(server.hits["busy"]) == 2  # the original try and one retry
    assert failover.cooling(busy)
    remaining = failover._down_until[busy.url] - time.monotonic()
    assert 0 < remaining <= THROTTLE_COOLDOWN_S < 180


def test_no_retry_when_the_wait_does_not_fit_the_deadline(server):
    endpoint = server.endpoint("late", (429, {"Retry-After": "5"}), (200, {}))
    with pytest.raises(EndpointThrottled):
        tap_sync(endpoint.url, "SELECT 1", 3.0, "csv")
    assert len(server.hits["late"]) == 1


@pytest.mark.parametrize("error, reason", [
    (UpstreamError("No Gaia archive responded (ESA Gaia Archive: connection or response timed out; "
                   "AIP Gaia mirror (Potsdam): HTTP 429 (too many requests))."), "limiting how many requests"),
    (UpstreamError("No Gaia archive responded (ESA Gaia Archive: connection or response timed out)."), "did not respond in time"),
    (AllEndpointsDown([("IRSA", "busy with other requests")], busy=True), "busy with other checks"),
    (AllEndpointsDown([("IRSA", "HTTP 502")]), "server error"),
    (QueryRejected("HTTP 400"), "rejected the query"),
    (TimeoutError(), "did not respond in time"),
    (AllEndpointsDown([("CDS", "connection failed (ConnectError)")]), "could not be reached"),
    (ValueError("unexpected"), "did not complete"),
])
def test_unavailable_reasons_are_plain_and_specific(error, reason):
    assert reason in rv.unavailable_reason(error)


def test_unavailable_check_carries_its_reason(monkeypatch):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    from app.config import get_settings

    class Throttled:
        def nearby(self, *args, **kwargs):
            raise UpstreamError("No Gaia archive responded (AIP Gaia mirror (Potsdam): HTTP 429 (too many requests)).")

    skipped = lambda name: rv.CatalogCheck(catalog=name, status="no_candidates", scope="stub", sourceUrl="")
    monkeypatch.setattr(rv, "get_provider", lambda settings: Throttled())
    monkeypatch.setattr(rv, "tap_check", lambda name, *a, **k: skipped(name))
    monkeypatch.setattr(rv, "ultracool", lambda *a: skipped("UltracoolSheet"))
    monkeypatch.setattr(rv, "skybot_undated", lambda: skipped("SkyBoT"))
    for cache in rv._check_caches.values():
        cache.clear()
    gaia = next(c for c in rv.run_review(10.0, 20.0, 30, None, get_settings()).checks if c.catalog == "Gaia DR3")
    assert gaia.status == "unavailable"
    assert gaia.scope == "Not checked: the archive is limiting how many requests it accepts. Try again in a minute."
    assert any("No absence was established" in note for note in gaia.limitations)
