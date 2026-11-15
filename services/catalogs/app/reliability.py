"""Shared reliability helpers for upstream archives: a bounded cache and endpoint failover.

Both the Gaia TAP provider and the SIMBAD resolver use these, so they share one deadline,
cooldown and caching discipline. Nothing here knows about astronomy.

Cache: each namespace is its own `BoundedCache` instance, so payload types, expiry and
negative-result rules never mix. Entries live in process memory only: they are lost on
restart and can only answer a request that was already made.

Failover: `Failover.run` tries an ordered list of endpoints.
- Timing. A non-final attempt gets `request_timeout_s`; the last endpoint actually being
  tried gets all the time left in `total_timeout_s`, because cutting the last chance short
  only produces a failure. The deadline handed to `call` is a total for that attempt and
  the transport must enforce it (see tap_http.py, which cancels the request).
- Availability. A connection failure, timeout, server error or unusable response
  (`EndpointDown`) puts that endpoint in cooldown and moves on. Any other exception (a
  rejected query) propagates unchanged: it is not an availability problem.
- Capacity. Each endpoint has a small concurrency limit and no queue. A saturated endpoint
  is skipped at once and is NOT put in cooldown: being busy says nothing about its health.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Generic, Hashable, Sequence, TypeVar

T = TypeVar("T")

_MISSING = object()


class BoundedCache(Generic[T]):
    """Thread-safe least-recently-used cache with a per-entry time to live."""

    def __init__(self, max_entries: int) -> None:
        self._max = max_entries
        self._data: OrderedDict[Hashable, tuple[float, T]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable, default=None):
        """Return the cached value, or `default` when absent or expired."""
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(key, _MISSING)
            if entry is _MISSING:
                return default
            expires, value = entry
            if expires <= now:
                del self._data[key]
                return default
            self._data.move_to_end(key)
            return value

    def put(self, key: Hashable, value: T, ttl_s: float) -> None:
        with self._lock:
            self._data[key] = (time.monotonic() + ttl_s, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


@dataclass(frozen=True)
class Endpoint:
    """One upstream server. `name` is what provenance and messages show."""

    name: str
    url: str


class EndpointDown(Exception):
    """The endpoint could not answer: connection failure, timeout or server error."""


class AllEndpointsDown(Exception):
    """Every endpoint failed or the overall deadline ran out. Carries per-endpoint reasons."""

    def __init__(self, failures: list[tuple[str, str]], busy: bool = False) -> None:
        self.failures = failures
        # True when no endpoint was even attempted because every one was at capacity.
        self.busy = busy
        detail = "; ".join(f"{name}: {reason}" for name, reason in failures) or "no endpoint configured"
        super().__init__(detail)


class Failover:
    """Ordered endpoint failover with attempt and overall deadlines, cooldown and capacity."""

    def __init__(
        self,
        request_timeout_s: float,
        total_timeout_s: float,
        cooldown_s: float,
        connect_timeout_s: float = 3.0,
        max_concurrent: int = 4,
    ) -> None:
        self.request_timeout_s = request_timeout_s
        self.total_timeout_s = total_timeout_s
        self.cooldown_s = cooldown_s
        self.connect_timeout_s = connect_timeout_s
        self.max_concurrent = max_concurrent
        self._down_until: dict[str, float] = {}
        self._active: dict[str, int] = {}
        self._lock = threading.Lock()

    def cooling(self, endpoint: Endpoint) -> bool:
        with self._lock:
            return self._down_until.get(endpoint.url, 0.0) > time.monotonic()

    def active(self, endpoint: Endpoint) -> int:
        """Requests currently in flight to this endpoint."""
        with self._lock:
            return self._active.get(endpoint.url, 0)

    def reset(self) -> None:
        with self._lock:
            self._down_until.clear()

    def _mark(self, endpoint: Endpoint, down: bool) -> None:
        with self._lock:
            if down:
                self._down_until[endpoint.url] = time.monotonic() + self.cooldown_s
            else:
                self._down_until.pop(endpoint.url, None)

    def _acquire(self, endpoint: Endpoint) -> bool:
        with self._lock:
            if self._active.get(endpoint.url, 0) >= self.max_concurrent:
                return False
            self._active[endpoint.url] = self._active.get(endpoint.url, 0) + 1
            return True

    def _release(self, endpoint: Endpoint) -> None:
        with self._lock:
            self._active[endpoint.url] = max(0, self._active.get(endpoint.url, 0) - 1)

    def run(
        self,
        endpoints: Sequence[Endpoint],
        call: Callable[[Endpoint, float], T],
        *,
        probe: bool = False,
    ) -> tuple[Endpoint, T]:
        """Return (endpoint, result) from the first endpoint that answers.

        `call(endpoint, deadline_s)` must return or raise within `deadline_s` and raise
        `EndpointDown` for availability failures. Endpoints in cooldown are skipped while
        another is usable. With `probe=True` (a manual retry) cooling endpoints are tried
        once in their normal order. If every endpoint is cooling they are all tried, so
        the service never refuses to look.
        """
        usable = [e for e in endpoints if not self.cooling(e)]
        candidates = list(endpoints) if probe or not usable else usable
        started = time.monotonic()
        failures: list[tuple[str, str]] = []
        busy = 0
        for index, endpoint in enumerate(candidates):
            remaining = self.total_timeout_s - (time.monotonic() - started)
            if remaining <= 0:
                failures.append((endpoint.name, "not tried: overall deadline reached"))
                continue
            if not self._acquire(endpoint):
                busy += 1
                failures.append((endpoint.name, "busy with other requests"))
                continue
            final = index == len(candidates) - 1
            deadline = remaining if final else min(self.request_timeout_s, remaining)
            try:
                result = call(endpoint, deadline)
            except EndpointDown as exc:
                self._mark(endpoint, down=True)
                failures.append((endpoint.name, str(exc) or "unavailable"))
                continue
            finally:
                self._release(endpoint)
            self._mark(endpoint, down=False)
            return endpoint, result
        raise AllEndpointsDown(failures, busy=bool(candidates) and busy == len(candidates))


def parse_endpoints(raw: str | None, defaults: Sequence[Endpoint]) -> tuple[Endpoint, ...]:
    """Parse `NAME=url,NAME=url` (order is priority). Blank or malformed input uses defaults."""
    if not raw or not raw.strip():
        return tuple(defaults)
    parsed = []
    for part in raw.split(","):
        name, sep, url = part.strip().partition("=")
        if not sep or not name.strip() or not url.strip().startswith(("http://", "https://")):
            return tuple(defaults)
        parsed.append(Endpoint(name.strip(), url.strip().rstrip("/")))
    return tuple(parsed)
