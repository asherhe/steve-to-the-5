"""Cancellable synchronous-facing TAP request shared by the Gaia and SIMBAD clients.

A plain HTTP POST to `<base>/sync` is used instead of a full TAP client so that no
capability discovery happens outside the deadline, and so each archive is addressed
explicitly rather than through library-wide settings.

Deadlines are real. Requests run on one background event loop that owns one shared
`httpx.AsyncClient`. Each request is wrapped in an enclosing timeout that covers connection,
redirects, response headers and the complete body, and on expiry the request task is
cancelled, which closes its connection. httpx's own read timeout measures inactivity, not
total time, so it is only a backstop here. Synchronous callers hand the coroutine to the
loop and wait, so no worker thread is ever left running an abandoned request.
"""
from __future__ import annotations

import asyncio
import threading
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass

from app.reliability import EndpointDown

DEFAULT_CONNECT_TIMEOUT_S = 3.0


class QueryRejected(Exception):
    """The archive answered and refused the query. Not an availability failure."""


@dataclass(frozen=True)
class TapResponse:
    content: bytes
    # Lower-cased media type without parameters, for example "text/csv" or "application/xml".
    media_type: str


_lock = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None
_client = None
_pending = 0


def _event_loop() -> asyncio.AbstractEventLoop:
    """Start the transport loop on first use. A daemon thread: it never blocks shutdown."""
    global _loop
    with _lock:
        if _loop is None or _loop.is_closed():
            loop = asyncio.new_event_loop()
            threading.Thread(target=loop.run_forever, name="tap-transport", daemon=True).start()
            _loop = loop
        return _loop


def pending_requests() -> int:
    """Requests currently running on the transport loop (for tests and diagnostics)."""
    return _pending


async def _post(url: str, data: dict, deadline_s: float, connect_timeout_s: float) -> TapResponse:
    import httpx  # runtime dependency of the service; imported lazily for offline startup

    global _client, _pending
    if _client is None:
        _client = httpx.AsyncClient(follow_redirects=True)
    timeout = httpx.Timeout(deadline_s, connect=min(connect_timeout_s, deadline_s))

    async def request() -> TapResponse:
        response = await _client.post(url, data=data, timeout=timeout)  # reads the whole body
        status = response.status_code
        # 404/408/429 from a TAP sync URL mean the service is missing or overloaded, not a bad query.
        if status >= 500 or status in (404, 408, 429):
            raise EndpointDown(f"HTTP {status}")
        if status >= 400:
            raise QueryRejected(f"HTTP {status}")
        media_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
        return TapResponse(response.content, media_type)

    _pending += 1
    try:
        # One deadline for connect, redirects, headers and the full body. Cancels on expiry.
        return await asyncio.wait_for(request(), deadline_s)
    except asyncio.TimeoutError as exc:
        raise EndpointDown(f"no complete response within {deadline_s:.0f} s") from exc
    except httpx.TimeoutException as exc:
        raise EndpointDown("connection or response timed out") from exc
    except httpx.HTTPError as exc:
        raise EndpointDown(f"connection failed ({type(exc).__name__})") from exc
    finally:
        _pending -= 1


def tap_sync(
    base_url: str,
    adql: str,
    deadline_s: float,
    response_format: str | None = None,
    connect_timeout_s: float = DEFAULT_CONNECT_TIMEOUT_S,
) -> TapResponse:
    """Run one ADQL query within `deadline_s` in total.

    Raises EndpointDown for network, timeout and server errors, QueryRejected when the
    archive refuses the query. Callers validate the media type and table structure.
    """
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "QUERY": adql}
    if response_format:
        data["FORMAT"] = response_format
    future = asyncio.run_coroutine_threadsafe(
        _post(f"{base_url}/sync", data, deadline_s, connect_timeout_s), _event_loop()
    )
    try:
        # The coroutine enforces the deadline itself; the margin only guards a stuck loop.
        return future.result(timeout=deadline_s + 2.0)
    except FutureTimeout as exc:
        future.cancel()  # cancels the task on the loop, unlike a thread-pool future
        raise EndpointDown(f"no complete response within {deadline_s:.0f} s") from exc
