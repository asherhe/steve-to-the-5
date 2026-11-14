from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make `app` importable when running pytest from the service directory or repo root.
_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.deps import _build_provider  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(autouse=True)
def _offline_env(monkeypatch):
    # Ensure deterministic offline behaviour regardless of the host environment.
    monkeypatch.delenv("CATALOGS_LIVE", raising=False)
    monkeypatch.delenv("CATALOGS_EXTERNAL_RESOLVE", raising=False)
    get_settings.cache_clear() if hasattr(get_settings, "cache_clear") else None
    _build_provider.cache_clear()
    yield
    _build_provider.cache_clear()


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())
