"""SPHEREx catalog service (task 3).

Name resolution, bounded Gaia DR3 cone search and exact source-ID detail.
Offline-capable by default; live Gaia TAP access is opt-in via CATALOGS_LIVE=1.
"""

__all__ = ["create_app"]

from app.main import create_app
