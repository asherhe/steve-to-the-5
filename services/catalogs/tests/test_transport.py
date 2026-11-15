"""Transport, deadline, capacity and response-validation tests against a local HTTP server.

Instant-returning fakes cannot show that a request is really cancelled, so these tests talk
to a real socket on 127.0.0.1. Timings are shortened; no external network is used.
"""
from __future__ import annotations

import io
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app import simbad, tap_http
from app.config import get_settings
from app.errors import ApiError
from app.gaia import tap
from app.gaia.adql import DETAIL_COLUMN_NAMES, NEARBY_COLUMN_NAMES
from app.gaia.provider import UpstreamError
from app.reliability import AllEndpointsDown, Endpoint, EndpointDown, Failover
from app.routes import resolve as resolver
from app.tap_http import QueryRejected, TapResponse, tap_sync

SIMBAD_HEADER = "oid,main_id,ra,dec,id\n"
VEGA_CSV = SIMBAD_HEADER + '1,"* alf Lyr",279.2347,38.7837,"NAME Vega"\n1,"* alf Lyr",279.2347,38.7837,"HD 172167"\n'
BARNARD = [4472832130942575872, 269.4485, 4.7394, 2016.0, -801.551, 10362.394, 546.976, 8.194]


def votable(columns, rows) -> bytes:
    from astropy.io.votable import from_table
    from astropy.table import Table

    dtypes = ["i8" if name == "source_id" else "f8" for name in columns]
    table = Table({name: [row[i] for row in rows] for i, name in enumerate(columns)}, dtype=dtypes) if rows else Table(
        names=list(columns), dtype=dtypes)
    buffer = io.BytesIO()
    from_table(table).to_xml(buffer)
    return buffer.getvalue()


NEARBY_OK = votable(NEARBY_COLUMN_NAMES, [BARNARD + [0.0]])
NEARBY_EMPTY = votable(NEARBY_COLUMN_NAMES, [])
ERROR_DOCUMENT = (
    b'<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3">'
    b'<RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">Column nope not found.</INFO></RESOURCE></VOTABLE>'
)


class Archive:
    """A local TAP-like server. `routes[name]` describes how `/<name>/sync` behaves."""

    def __init__(self) -> None:
        self.routes: dict[str, dict] = {}
        self.hits: list[str] = []
        self.release = threading.Event()
        archive = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):  # keep test output quiet
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                name = self.path.strip("/").split("/")[0]
                archive.hits.append(name)
                route = archive.routes[name]
                mode = route.get("mode", "respond")
                body = route.get("body", b"")
                try:
                    if mode == "stall":  # connected, then nothing at all
                        archive.release.wait(10)
                        return
                    if route.get("delay"):
                        archive.release.wait(route["delay"])
                    self.send_response(route.get("status", 200))
                    self.send_header("Content-Type", route.get("content_type", "application/xml"))
                    if mode == "trickle":  # headers, then one byte at a time, never finishing
                        self.send_header("Content-Length", "100000")
                        self.end_headers()
                        while not archive.release.wait(0.05):
                            self.wfile.write(b"x")
                            self.wfile.flush()
                        return
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # the client cancelled, which is what these tests provoke

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def endpoint(self, name: str, **route) -> Endpoint:
        self.routes[name] = route
        return Endpoint(name, f"http://127.0.0.1:{self.server.server_address[1]}/{name}")

    def close(self) -> None:
        self.release.set()
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture(scope="module")
def archive():
    server = Archive()
    yield server
    server.close()


@pytest.fixture(autouse=True)
def clean_state(archive):
    archive.hits.clear()
    archive.release.clear()
    tap.nearby_cache.clear()
    tap.detail_cache.clear()
    resolver._cache.clear()
    resolver.failover_for(get_settings()).reset()
    yield
    archive.release.set()  # let any stalled handler finish
    tap.nearby_cache.clear()
    tap.detail_cache.clear()
    resolver._cache.clear()
    resolver.failover_for(get_settings()).reset()


def wait_until(condition, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.02)
    return condition()


def gaia(endpoints, failover):
    return tap.TapGaiaProvider(endpoints=endpoints, failover=failover)


def policy(request=0.4, total=2.5, connect=0.3, concurrent=4):
    return Failover(request, total, 60.0, connect, concurrent)


# ---- Defect 1: timing policy ---------------------------------------------------------------

def test_slow_healthy_fallback_gets_the_remaining_time_and_is_not_cooled(archive):
    primary = archive.endpoint("esa", mode="stall")
    fallback = archive.endpoint("aip", body=NEARBY_OK, delay=0.7)  # slower than the 0.4 s non-final limit
    failover = policy()
    started = time.monotonic()
    rows = gaia((primary, fallback), failover).nearby(269.4485, 4.7394, 30, 200)
    elapsed = time.monotonic() - started
    assert rows.provenance.served_by == "aip" and len(rows) == 1
    assert 1.0 < elapsed < 1.6  # 0.4 s abandoned primary + 0.7 s fallback
    assert failover.cooling(primary) and not failover.cooling(fallback)


def test_single_endpoint_gets_the_whole_budget(archive):
    only = archive.endpoint("aip", body=NEARBY_OK, delay=0.7)
    assert gaia((only,), policy()).nearby(1.0, 2.0, 30, 200).provenance.served_by == "aip"


def test_connect_limit_is_separate_from_the_attempt_deadline(archive):
    # Nothing listens on port 9: the connection fails fast instead of using the attempt budget.
    dead = Endpoint("dead", "http://127.0.0.1:9/tap")
    fallback = archive.endpoint("aip", body=NEARBY_OK)
    started = time.monotonic()
    rows = gaia((dead, fallback), policy(request=5.0, total=8.0, connect=0.3)).nearby(1.0, 2.0, 30, 200)
    assert rows.provenance.served_by == "aip" and time.monotonic() - started < 1.0


# ---- Defect 2: cancellable transport and capacity ------------------------------------------

@pytest.mark.parametrize("behaviour", [
    {"mode": "stall"},                               # connects, then nothing
    {"body": NEARBY_OK, "delay": 3.0},               # headers arrive long after the deadline
    {"mode": "trickle"},                             # body dribbles in forever
])
def test_stalled_primary_is_abandoned_at_the_attempt_deadline(archive, behaviour):
    primary = archive.endpoint("esa", **behaviour)
    fallback = archive.endpoint("aip", body=NEARBY_OK)
    failover = policy()
    started = time.monotonic()
    rows = gaia((primary, fallback), failover).nearby(1.0, 2.0, 30, 200)
    elapsed = time.monotonic() - started
    assert rows.provenance.served_by == "aip"
    assert 0.35 < elapsed < 0.9  # abandoned at the 0.4 s attempt deadline, not later
    assert archive.hits == ["esa", "aip"]
    assert wait_until(lambda: tap_http.pending_requests() == 0)  # the request was really cancelled
    assert failover.active(primary) == 0


def test_whole_sequence_deadline_is_respected(archive):
    endpoints = (archive.endpoint("esa", mode="stall"), archive.endpoint("aip", mode="trickle"))
    started = time.monotonic()
    with pytest.raises(UpstreamError):
        gaia(endpoints, policy(request=0.4, total=0.9)).nearby(1.0, 2.0, 30, 200)
    assert 0.8 < time.monotonic() - started < 1.4
    assert wait_until(lambda: tap_http.pending_requests() == 0)


def test_capacity_is_released_after_cancelled_requests(archive):
    endpoint = archive.endpoint("esa", mode="stall")
    failover = policy(total=0.5, concurrent=2)
    provider = gaia((endpoint,), failover)
    errors = []
    def stalled(ra):
        try:
            provider.nearby(ra, 2.0, 30, 200)
        except UpstreamError as exc:
            errors.append(str(exc))
    threads = [threading.Thread(target=stalled, args=(float(i),)) for i in range(2)]
    for thread in threads:
        thread.start()
    assert wait_until(lambda: failover.active(endpoint) == 2)
    for thread in threads:
        thread.join(3)
    assert len(errors) == 2 and all("busy" not in error for error in errors)
    assert failover.active(endpoint) == 0
    assert wait_until(lambda: tap_http.pending_requests() == 0)  # no leaked request tasks
    archive.routes["esa"] = {"body": NEARBY_OK}
    failover.reset()
    assert provider.nearby(9.0, 2.0, 30, 200).provenance.served_by == "esa"


def test_saturated_primary_is_skipped_without_cooldown(archive):
    primary = archive.endpoint("esa", mode="stall")
    fallback = archive.endpoint("aip", body=NEARBY_OK)
    failover = policy(request=1.5, total=3.0, concurrent=2)
    provider = gaia((primary, fallback), failover)
    threads = [threading.Thread(target=lambda ra=ra: provider.nearby(ra, 2.0, 30, 200)) for ra in (1.0, 2.0)]
    for thread in threads:
        thread.start()
    assert wait_until(lambda: failover.active(primary) == 2)
    started = time.monotonic()
    rows = provider.nearby(3.0, 2.0, 30, 200)
    assert rows.provenance.served_by == "aip" and time.monotonic() - started < 0.5
    assert not failover.cooling(primary)  # busy is not unhealthy
    archive.release.set()
    for thread in threads:
        thread.join(4)


def test_every_endpoint_saturated_is_busy_and_cools_nothing(archive):
    endpoint = archive.endpoint("esa", mode="stall")
    failover = policy(request=1.5, total=1.5, concurrent=1)
    provider = gaia((endpoint,), failover)
    holder = threading.Thread(target=lambda: pytest.raises(UpstreamError, provider.nearby, 1.0, 2.0, 30, 200))
    holder.start()
    assert wait_until(lambda: failover.active(endpoint) == 1)
    started = time.monotonic()
    with pytest.raises(UpstreamError, match="busy"):
        provider.nearby(2.0, 2.0, 30, 200)
    assert time.monotonic() - started < 0.3 and not failover.cooling(endpoint)
    archive.release.set()
    holder.join(4)


def test_busy_simbad_keeps_the_existing_error_code():
    failover = Failover(1.0, 1.0, 60.0, 0.3, 1)
    endpoint = simbad.DEFAULT_SIMBAD_ENDPOINTS[0]
    assert failover._acquire(endpoint)
    with pytest.raises(AllEndpointsDown) as error:
        simbad.lookup("vega", (endpoint,), failover, fetch=lambda *args: pytest.fail("must not be called"))
    assert error.value.busy and not failover.cooling(endpoint)


def test_transport_reports_media_type_and_maps_statuses(archive):
    ok = archive.endpoint("csv", body=VEGA_CSV.encode(), content_type="text/csv;charset=UTF-8")
    assert tap_sync(ok.url, "SELECT 1", 1.0, "csv") == TapResponse(VEGA_CSV.encode(), "text/csv")
    with pytest.raises(EndpointDown, match="HTTP 502"):
        tap_sync(archive.endpoint("bad", status=502).url, "SELECT 1", 1.0)
    with pytest.raises(EndpointDown, match="HTTP 404"):
        tap_sync(archive.endpoint("gone", status=404).url, "SELECT 1", 1.0)
    with pytest.raises(QueryRejected):
        tap_sync(archive.endpoint("refused", status=400, body=ERROR_DOCUMENT).url, "SELECT 1", 1.0)


# ---- Defect 3: validate before accepting or caching ----------------------------------------

def test_simbad_header_only_table_is_a_valid_miss():
    assert simbad.parse_rows(SIMBAD_HEADER.encode(), "text/csv") is None
    assert simbad.parse_rows(VEGA_CSV.encode(), "text/csv").main_id == "* alf Lyr"


@pytest.mark.parametrize("content, media_type", [
    (b"", "text/csv"),                                                      # empty body
    (b"\n", "text/csv"),
    (b"main_id,ra,dec\n", "text/csv"),                                       # wrong header
    (b"<html>maintenance</html>", "text/csv"),
    ((SIMBAD_HEADER + '1,"* alf Lyr",279.2').encode(), "text/csv"),          # truncated row
    (VEGA_CSV.encode(), "text/html"),                                        # wrong media type
    (VEGA_CSV.encode(), ""),
])
def test_simbad_malformed_responses_are_failures_not_misses(content, media_type):
    with pytest.raises(EndpointDown):
        simbad.parse_rows(content, media_type)


def test_malformed_simbad_response_falls_back_and_is_never_cached(client, monkeypatch, archive):
    monkeypatch.setenv("CATALOGS_LIVE", "1")
    monkeypatch.setenv("CATALOGS_EXTERNAL_RESOLVE", "1")
    cds = archive.endpoint("cds", body=b"", content_type="text/csv")
    harvard = archive.endpoint("harvard", body=VEGA_CSV.encode(), content_type="text/csv;charset=UTF-8")
    monkeypatch.setenv("CATALOGS_SIMBAD_TAP_URLS", f"cds={cds.url},harvard={harvard.url}")
    body = client.get("/api/resolve", params={"name": "Vega"}).json()
    assert body["name"] == "Vega" and body["identity"]["provenance"][0]["servedBy"] == "harvard"
    # Both malformed: an outage, and nothing is stored as a miss.
    resolver._cache.clear()
    resolver.failover_for(get_settings()).reset()
    archive.routes["harvard"] = {"body": b"main_id\n", "content_type": "text/csv"}
    response = client.get("/api/resolve", params={"name": "Sirius"})
    assert response.status_code == 503 and response.json()["code"] == "upstream_unavailable"
    assert len(resolver._cache) == 0
    # A correctly formed empty table from the main server IS an authoritative miss.
    resolver.failover_for(get_settings()).reset()
    archive.routes["cds"] = {"body": SIMBAD_HEADER.encode(), "content_type": "text/csv"}
    assert client.get("/api/resolve", params={"name": "Sirius"}).json()["code"] == "not_found"
    assert len(resolver._cache) == 1


def test_gaia_zero_row_table_with_correct_columns_is_valid(archive):
    rows = gaia((archive.endpoint("esa", body=NEARBY_EMPTY),), policy()).nearby(83.8, 9.9, 30, 200)
    assert list(rows) == [] and rows.provenance.served_by == "esa" and len(tap.nearby_cache) == 1


@pytest.mark.parametrize("route", [
    {"body": votable(["source_id", "ra"], [])},                              # zero rows, wrong columns
    {"body": votable(NEARBY_COLUMN_NAMES[:-1], [BARNARD])},                  # rows, missing sep_deg
    {"body": NEARBY_OK, "content_type": "text/html"},                        # wrong media type
    {"body": b"", "content_type": "application/xml"},                        # empty body
    {"body": b"<html>maintenance</html>", "content_type": "application/xml"},
])
def test_gaia_malformed_responses_fall_back_and_are_never_cached(archive, route):
    primary = archive.endpoint("esa", **route)
    fallback = archive.endpoint("aip", body=NEARBY_OK)
    failover = policy()
    rows = gaia((primary, fallback), failover).nearby(1.0, 2.0, 30, 200)
    assert rows.provenance.served_by == "aip" and failover.cooling(primary)
    tap.nearby_cache.clear()
    failover.reset()
    archive.routes["aip"] = dict(route)
    with pytest.raises(UpstreamError):
        gaia((primary, fallback), failover).nearby(1.0, 2.0, 30, 200)
    assert len(tap.nearby_cache) == 0


def test_gaia_detail_columns_are_validated(archive):
    partial = archive.endpoint("esa", body=votable(NEARBY_COLUMN_NAMES[:-1], [BARNARD]))
    with pytest.raises(UpstreamError):
        gaia((partial,), policy()).detail("4472832130942575872")
    assert len(tap.detail_cache) == 0
    row = BARNARD + [0.027, 0.034, 0.031, 0.042, 0.04, -110.353, 0.123, 9.978, 6.964]
    full = archive.endpoint("aip", body=votable(DETAIL_COLUMN_NAMES, [row]))
    detail = gaia((full,), policy()).detail("4472832130942575872")
    assert detail.source_id == "4472832130942575872"  # exact integer ID, not a rounded float


@pytest.mark.parametrize("route", [
    {"status": 400, "body": ERROR_DOCUMENT},
    {"status": 200, "body": ERROR_DOCUMENT},
])
def test_tap_error_document_is_a_rejected_query_without_fallback_or_cooldown(archive, route):
    primary = archive.endpoint("esa", **route)
    fallback = archive.endpoint("aip", body=NEARBY_OK)
    failover = policy()
    with pytest.raises(UpstreamError, match="rejected"):
        gaia((primary, fallback), failover).nearby(1.0, 2.0, 30, 200)
    assert archive.hits == ["esa"] and not failover.cooling(primary)
