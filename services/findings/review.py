"""Server-calculated participation points attached to an immutable catalog snapshot."""
import hashlib
import math
from datetime import datetime, timezone
from uuid import uuid4

from .models import ReviewInput, ReviewResponse
from .supabase import ApiError

SCORE_VERSION = "review-effort-v1"
CATALOG_NAMES = {"Gaia DR3", "SIMBAD", "CatWISE2020", "UltracoolSheet", "SkyBoT", "VizieR"}


def evidence_position(comparison, point):
    from astropy.wcs import WCS
    try:
        grid = comparison["grid"]
        x, y = WCS(grid["fitsHeader"]).celestial.world_to_pixel_values(point.ra, point.dec)
        if not (math.isfinite(x) and math.isfinite(y) and -0.5 <= x < grid["width"] - 0.5 and -0.5 <= y < grid["height"] - 0.5):
            raise ApiError(422, "outside_evidence", "Select a point inside the saved image footprint.")
        return int(math.floor(x + 0.5)), int(math.floor(y + 0.5))
    except ApiError:
        raise
    except (KeyError, ValueError, TypeError) as exc:
        raise ApiError(422, "invalid_evidence", "This evidence has no usable saved sky grid.") from exc


async def prepare_review(data: ReviewInput, comparison: dict, catalog_loader):
    position = evidence_position(comparison, data)
    if comparison.get("provenance", {}).get("evidenceKind") not in ("real_archive", "saved_real_example"):
        raise ApiError(422, "not_real_evidence", "Ranked reviews require saved real observations; synthetic or unlabelled data cannot earn points.")
    frames = comparison.get("frames", [])
    if not isinstance(frames, list) or not frames or any(not isinstance(f, dict) or not isinstance(f.get("id"), str) for f in frames):
        raise ApiError(422, "invalid_evidence", "The saved comparison has no usable frames.")
    if len({f["id"] for f in frames}) != len(frames):
        raise ApiError(422, "invalid_evidence", "The saved comparison has duplicate frame identifiers.")
    frame = next((f for f in frames if f.get("id") == data.frameId), None)
    if frame is None:
        raise ApiError(422, "invalid_frame", "Choose a frame from the saved comparison.")
    observed = frame.get("observedAtUtc")
    try:
        date = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if date.tzinfo is None:
            raise ValueError()
    except (ValueError, AttributeError):
        raise ApiError(422, "invalid_evidence", "The selected frame has no observation time.")
    report = await catalog_loader(data.ra, data.dec, data.radiusArcsec, observed)
    if not isinstance(report, dict) or not isinstance(report.get("checks"), list):
        raise ApiError(503, "catalog_review_invalid", "The catalog review response is invalid.")
    checks = report["checks"]
    if report.get("mode") != "live":
        raise ApiError(503, "catalogs_offline", "Live catalog review is disabled. Offline fixtures cannot earn points.")
    if (report.get("ra"), report.get("dec"), report.get("radiusArcsec")) != (data.ra, data.dec, data.radiusArcsec):
        raise ApiError(503, "catalog_review_invalid", "The catalog review answered for a different position.")
    try:
        same_time = datetime.fromisoformat(report["observedAtUtc"].replace("Z", "+00:00")) == date
        names = [check["catalog"] for check in checks]
        if not same_time or len(names) != 6 or set(names) != CATALOG_NAMES:
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        raise ApiError(503, "catalog_review_invalid", "The catalog review is incomplete or invalid.")
    reasons = ["+10: saved real dated image with a marked sky position"]
    score = 10
    if len({f.get("observedAtUtc") for f in frames if f.get("observedAtUtc")}) >= 2:
        score += 10
        reasons.append("+10: saved comparison contains at least two observation dates")
    for check in checks:
        if check.get("status") in ("candidates", "no_candidates"):
            score += 5
            reasons.append(f"+5: completed {check['catalog']} cone search (regardless of match count)")
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    response = ReviewResponse(**data.model_dump(), id=uuid4(), observedAtUtc=observed, reviewedAtUtc=now,
        scoreVersion=SCORE_VERSION, score=score, reasons=reasons, catalogReview=report,
        limitations=["Points reward documented review effort, not rarity, scientific significance or a discovery.",
                      "No element, molecule, physical temperature or novelty is inferred from image pixels.",
                      "No DSS, WISE or Gaia detection is required. An unavailable or partial catalog earns no points."])
    candidate_key = hashlib.sha256(f"{data.survey}:{data.comparisonId}:{position[0]}:{position[1]}".encode()).hexdigest()
    return response, candidate_key
