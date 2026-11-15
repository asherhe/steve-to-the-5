"""Server-calculated points attached to an immutable catalog snapshot.

point-check-v2:
- 10 points: a known object (any of the six catalogs lists a source in the cone);
- 20 points: all six catalogs searched and none lists a source, and the point is bright
  (brightness.BRIGHT_SNR) in saved dated frames of at least two surveys;
- 0 points otherwise (an incomplete search, or bright in fewer than two surveys).
Brightness is measured here on each frame's retained FITS; clients cannot supply it.
"""
import asyncio
import hashlib
import math
from datetime import datetime, timezone
from uuid import uuid4

from . import brightness
from .models import BrightnessMeasurement, ReviewInput, ReviewResponse
from .supabase import ApiError

SCORE_VERSION = "point-check-v2"
SURVEY_NAMES = {"spherex": "SPHEREx", "wise": "WISE"}
REAL_EVIDENCE = ("real_archive", "saved_real_example")
# Surveys whose saved frames can be measured. NEOSSat previews carry no FITS or WCS yet.
MIN_BRIGHT_SURVEYS = 2
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


def valid_frames(comparison: dict) -> list[dict]:
    frames = comparison.get("frames", [])
    if not isinstance(frames, list) or not frames or any(not isinstance(f, dict) or not isinstance(f.get("id"), str) for f in frames):
        raise ApiError(422, "invalid_evidence", "The saved comparison has no usable frames.")
    if len({f["id"] for f in frames}) != len(frames):
        raise ApiError(422, "invalid_evidence", "The saved comparison has duplicate frame identifiers.")
    return frames


async def measure_comparison(survey: str, comparison: dict, ra: float, dec: float, asset_loader) -> list[BrightnessMeasurement]:
    async def one(frame):
        base = dict(survey=survey, comparisonId=comparison["id"], frameId=frame["id"], observedAtUtc=frame.get("observedAtUtc"))
        try:
            raw = await asset_loader(survey, comparison["id"], f"{frame['id']}.fits")
            mask = int((frame.get("qualityFlags") or {}).get("informationalFlagMask") or 0)
            result = await asyncio.to_thread(brightness.measure, raw, survey, ra, dec, mask)
        except ApiError:
            return BrightnessMeasurement(**base, status="unavailable")
        except Exception:
            # A malformed or missing asset is never counted as bright.
            return BrightnessMeasurement(**base, status="unmeasurable")
        return BrightnessMeasurement(**base, status=result["status"], snr=result["snr"], bright=result["bright"])
    return list(await asyncio.gather(*(one(frame) for frame in valid_frames(comparison))))


async def prepare_review(data: ReviewInput, comparison: dict, catalog_loader, evidence_loader=None, asset_loader=None):
    position = evidence_position(comparison, data)
    surveys = [ref.survey for ref in data.brightnessEvidence]
    if data.survey in surveys or len(set(surveys)) != len(surveys):
        raise ApiError(422, "invalid_evidence", "Add at most one saved comparison from each other survey.")
    if comparison.get("provenance", {}).get("evidenceKind") not in REAL_EVIDENCE:
        raise ApiError(422, "not_real_evidence", "Ranked reviews require saved real observations; synthetic or unlabelled data cannot earn points.")
    frames = valid_frames(comparison)
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
    radius = f"{data.radiusArcsec:g}″"
    listed = [c["catalog"] for c in checks if c.get("status") in ("candidates", "partial")]
    unchecked = [c["catalog"] for c in checks if c.get("status") not in ("candidates", "partial", "no_candidates")]
    measurements: list[BrightnessMeasurement] = []
    if listed:
        classification, score = "known", 10
        reasons = [f"+10: known object. {', '.join(listed)} {'lists' if len(listed) == 1 else 'list'} a source within {radius}."]
    elif unchecked:
        classification, score = "incomplete", 0
        reasons = [f"+0: no catalog lists a source so far, but {', '.join(unchecked)} could not be checked. Retry for points."]
    else:
        classification = "uncatalogued"
        if asset_loader is None:
            raise ApiError(503, "brightness_unavailable", "Brightness measurement is not configured.")
        sets = [(data.survey, comparison)]
        for ref in data.brightnessEvidence:
            other = await evidence_loader(ref.comparisonId, ref.survey) if evidence_loader else None
            if other is None or other.get("provenance", {}).get("evidenceKind") not in REAL_EVIDENCE:
                raise ApiError(422, "not_real_evidence", f"The {SURVEY_NAMES[ref.survey]} comparison is not saved real evidence.")
            sets.append((ref.survey, other))
        for survey, saved in sets:
            measurements += await measure_comparison(survey, saved, data.ra, data.dec, asset_loader)
        bright = sorted({m.survey for m in measurements if m.bright}, key=list(SURVEY_NAMES).index)
        names = " and ".join(SURVEY_NAMES[s] for s in bright)
        if len(bright) >= MIN_BRIGHT_SURVEYS:
            score = 20
            reasons = [f"+20: no catalog lists a source within {radius}, and the point is bright "
                       f"(at least {brightness.BRIGHT_SNR:g}σ above its surroundings) in {names}."]
        else:
            score = 0
            measured = ", ".join(SURVEY_NAMES[s] for s, _ in sets)
            reasons = [f"+0: no catalog lists a source within {radius}, but the point is bright in "
                       f"{len(bright)} of the {MIN_BRIGHT_SURVEYS} surveys needed ({names or 'none'}; measured: {measured}). "
                       "Load a saved comparison from another survey covering this point."]
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    response = ReviewResponse(**data.model_dump(), id=uuid4(), observedAtUtc=observed, reviewedAtUtc=now,
        scoreVersion=SCORE_VERSION, score=score, classification=classification, reasons=reasons,
        catalogReview=report, brightness=measurements,
        limitations=["Points sort submitted points for discussion. They are not a measure of scientific significance, and 20 points is not a discovery.",
                      "Uncatalogued means none of six cone searches listed a source; catalogs have depth, epoch and coverage limits.",
                      f"Bright means a local peak at least {brightness.BRIGHT_SNR:g}σ above the surrounding pixels in a saved frame's FITS. It is not a photometric detection, a flux, a temperature or evidence of variability.",
                      "NEOSSat previews cannot be measured yet, so only SPHEREx and WISE count toward brightness."])
    candidate_key = hashlib.sha256(f"{data.survey}:{data.comparisonId}:{position[0]}:{position[1]}".encode()).hexdigest()
    return response, candidate_key
