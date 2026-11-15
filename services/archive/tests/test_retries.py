"""IRSA answers a share of requests with an instant 502, so the served app retries more."""
import httpx
import pytest

from services.archive.client import IRSAClient
from services.archive.models import ArchiveError, ProcessingConfig


def flaky(failures):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(502) if calls["n"] <= failures else httpx.Response(200, content=b"ok")
    return httpx.MockTransport(handler), calls


def test_search_retries_through_intermittent_502s_with_a_higher_attempt_limit(tmp_path):
    # Default policy: three attempts, so four 502s in a row end as an upstream error.
    transport, calls = flaky(4)
    plain = IRSAClient(ProcessingConfig(), tmp_path, transport=transport, sleep=lambda s: None)
    with pytest.raises(ArchiveError) as error:
        plain._get("https://irsa.ipac.caltech.edu/SIA")
    assert error.value.message == "IRSA request failed after bounded retries" and calls["n"] == 3
    # With the production search limit the same four 502s are survived, and the attempt count is reported.
    transport, calls = flaky(4)
    patient = IRSAClient(ProcessingConfig(), tmp_path, transport=transport, sleep=lambda s: None, search_attempts=6)
    assert patient._get("https://irsa.ipac.caltech.edu/SIA", attempts=patient.search_attempts) == (b"ok", 5)
    # A persistent outage still ends, after the limit and no more.
    transport, calls = flaky(99)
    patient = IRSAClient(ProcessingConfig(), tmp_path, transport=transport, sleep=lambda s: None, search_attempts=6)
    with pytest.raises(ArchiveError):
        patient._get("https://irsa.ipac.caltech.edu/SIA", attempts=patient.search_attempts)
    assert calls["n"] == 6
