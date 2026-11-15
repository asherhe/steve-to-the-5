"""Server-calculated points for a marked sky point (point-check-v4).

- 10 points: a known object. Any of the six catalogs lists a source in the cone.
- 20 points: no returned catalog matches, at most two of the other catalogs unavailable, and the
  point is bright
  (brightness.BRIGHT_SNR) in at least MIN_BRIGHT_SURVEYS of SPHEREx, WISE, DSS and NEOSSat,
  measured here on cutouts this service fetches itself (cutouts.py).
- 0 points otherwise; the point can still be posted for discussion.

The API requires a real saved WISE blink. Known and unlisted sources can add 10
for a usable SPHEREx aperture signal, 5 each for tentative water/methane/hydrogen
patterns, and 5 for possible WISE variability. Bonuses require retained evidence.

Gaia DR3 is not required for 20 points: a Gaia check that could not complete neither blocks
them nor counts toward the two unavailable catalogs. A Gaia source in the cone still makes the
point a known object.

Without an observation time (a point on the undated mosaic) SkyBoT cannot run. Its expected
skip is excluded from the incomplete-check gate. Brightness across surveys does not
establish a common source or rule out chance alignments.

One leaderboard entry per object: the catalog identity (for known objects) and the position
(DUPLICATE_RADIUS_ARCSEC) are checked here for an early answer and again, atomically, when the
finding is created (spherex_submit_point_finding).
"""
from __future__ import annotations

import asyncio
import hashlib
import math
from datetime import datetime, timezone
from uuid import uuid4

from . import brightness, spectral, wise_variability
from .cutouts import SURVEY_LABELS
from .models import CatalogIdentity, PointReviewInput, PointReviewResponse, SourceMeasurement, ScorePart, SpectralReview
from .review import CATALOG_NAMES, REAL_EVIDENCE, evidence_position, valid_frames
from .supabase import ApiError

# Catalogs whose check may fail without blocking points. A match in them still counts.
OPTIONAL_CATALOGS = frozenset({"Gaia DR3"})
SCORE_VERSION = "point-check-v4"
MIN_BRIGHT_SURVEYS = 2
DUPLICATE_RADIUS_ARCSEC = 15.0

# Catalog order for naming a known object, and where each catalog keeps its name and position.
IDENTITY_COLUMNS = (
    ("Gaia DR3", ("sourceId", "source_id"), (("ra", "dec"),)),
    ("SIMBAD", ("main_id",), (("ra", "dec"),)),
    ("CatWISE2020", ("source_name",), (("ra", "dec"),)),
    ("VizieR", ("AllWISE",), (("RAJ2000", "DEJ2000"),)),
    ("UltracoolSheet", ("name",), (("ra_j2000_formula", "dec_j2000_formula"),)),
    ("SkyBoT", ("Name", "Num"), (("RA", "DEC"),)),
)


def separation_arcsec(ra1, dec1, ra2, dec2) -> float:
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    a = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600


def row_position(row: dict, pairs) -> tuple[float, float] | None:
    for ra_key, dec_key in pairs:
        ra, dec = row.get(ra_key), row.get(dec_key)
        try:
            return float(ra), float(dec)
        except (TypeError, ValueError):
            pass
        if isinstance(ra, str) and isinstance(dec, str):
            try:  # SkyBoT gives sexagesimal RA (hours) and Dec.
                from astropy import units as u
                from astropy.coordinates import SkyCoord
                coord = SkyCoord(ra, dec, unit=(u.hourangle, u.deg))
                return float(coord.ra.deg), float(coord.dec.deg)
            except ValueError:
                pass
    return None


def known_identity(checks: list[dict], ra: float, dec: float) -> CatalogIdentity | None:
    """The nearest listed source in the first catalog (by IDENTITY_COLUMNS order) that lists one."""
    by_name = {check.get("catalog"): check for check in checks}
    for catalog, name_keys, position_keys in IDENTITY_COLUMNS:
        check = by_name.get(catalog) or {}
        if check.get("status") not in ("candidates", "partial"):
            continue
        best = None
        for row in check.get("rows") or []:
            name = next((str(row[k]).strip() for k in name_keys if row.get(k) not in (None, "")), None)
            position = row_position(row, (("predictedRa", "predictedDec"), *position_keys))
            if not name or position is None:
                continue
            distance = separation_arcsec(ra, dec, *position)
            if best is None or distance < best[0]:
                best = (distance, name, position)
        if best:
            return CatalogIdentity(catalog=catalog, name=best[1], ra=best[2][0] % 360, dec=best[2][1],
                                   separationArcsec=round(best[0], 2))
    return None


def object_key(identity: CatalogIdentity | None) -> str | None:
    return hashlib.sha256(f"{identity.catalog}:{identity.name}".encode()).hexdigest() if identity else None


def position_key(ra: float, dec: float) -> str:
    return hashlib.sha256(f"point:{ra:.5f}:{dec:.5f}".encode()).hexdigest()


async def measure_sources(results, ra: float, dec: float) -> list[SourceMeasurement]:
    measurements = []
    for result in results:
        if result.status != "ok":
            measurements.append(SourceMeasurement(survey=result.survey, label=SURVEY_LABELS[result.survey],
                                                  status=result.status, message=result.message))
            continue
        for frame in result.frames:
            base = dict(survey=result.survey, label=frame.label, sourceUrl=frame.source_url, observedAtUtc=frame.observed_at_utc,
                        message=result.message)
            try:
                value = await asyncio.to_thread(brightness.measure, frame.fits, result.survey, ra, dec)
            except Exception:
                measurements.append(SourceMeasurement(**base, status="unmeasurable"))
                continue
            measurements.append(SourceMeasurement(**base, status=value["status"], snr=value["snr"], bright=value["bright"]))
    return measurements


async def prepare_point_review(data: PointReviewInput, catalog_loader, cutout_loader, frame_loader=None, spectral_store=None, wise_comparison=None, asset_loader=None):
    """Returns (response, candidate_key, object_key). Duplicate detection is left to the caller."""
    observed = None
    if data.frame is not None:
        if frame_loader is None:
            raise ApiError(503, "comparison_unavailable", "Saved evidence is not configured.")
        comparison = await frame_loader(data.frame.comparisonId, data.frame.survey)
        if comparison.get("provenance", {}).get("evidenceKind") not in REAL_EVIDENCE:
            raise ApiError(422, "not_real_evidence", "Points need real observations; synthetic data cannot earn points.")
        evidence_position(comparison, data)
        frame = next((f for f in valid_frames(comparison) if f.get("id") == data.frame.frameId), None)
        if frame is None:
            raise ApiError(422, "invalid_frame", "Choose a frame from the saved comparison.")
        observed = frame.get("observedAtUtc")
        if not isinstance(observed, str):
            raise ApiError(422, "invalid_evidence", "The selected frame has no observation time.")

    report = await catalog_loader(data.ra, data.dec, data.radiusArcsec, observed)
    if not isinstance(report, dict) or not isinstance(report.get("checks"), list):
        raise ApiError(503, "catalog_review_invalid", "The catalog review response is invalid.")
    if report.get("mode") != "live":
        raise ApiError(503, "catalogs_offline", "Live catalog review is disabled. Offline fixtures cannot earn points.")
    checks = report["checks"]
    names = [check.get("catalog") for check in checks]
    if ((report.get("ra"), report.get("dec"), report.get("radiusArcsec")) != (data.ra, data.dec, data.radiusArcsec)
            or len(names) != 6 or set(names) != CATALOG_NAMES or report.get("observedAtUtc") != observed):
        raise ApiError(503, "catalog_review_invalid", "The catalog review is incomplete or invalid.")

    radius = f"{data.radiusArcsec:g}″"
    listed = [c["catalog"] for c in checks if c.get("status") in ("candidates", "partial") and c.get("rows")]
    # Gaia matches still count above; an incomplete Gaia check is not required for points.
    required = [c for c in checks if c["catalog"] not in OPTIONAL_CATALOGS]
    optional_unchecked = [c["catalog"] for c in checks if c["catalog"] in OPTIONAL_CATALOGS
                          and c.get("status") != "no_candidates" and c["catalog"] not in listed]
    # SkyBoT is skipped only when there is no observation time; see the module docstring.
    unavailable = [c["catalog"] for c in required if c.get("status") == "unavailable"]
    unchecked = [c["catalog"] for c in required if c.get("status") != "no_candidates"
                 and c.get("status") != "unavailable"
                 and not (c["catalog"] == "SkyBoT" and c.get("status") == "skipped" and observed is None)]
    if len(unavailable) > 2:
        unchecked += unavailable
    identity, measurements = None, []
    sources = []
    if listed or not unchecked:
        sources = await cutout_loader(data.ra, data.dec) or []
        measurements = await measure_sources(sources, data.ra, data.dec)
    if listed:
        classification, score = "known", 10
        identity = known_identity(checks, data.ra, data.dec)
        named = f" Nearest: {identity.catalog} {identity.name} at {identity.separationArcsec:g}″." if identity else ""
        reasons = [f"+10: known object. {', '.join(listed)} {'lists' if len(listed) == 1 else 'list'} a source within {radius}.{named}"]
    elif unchecked:
        classification, score = "incomplete", 0
        reasons = [f"+0: no catalog lists a source so far, but {', '.join(unchecked)} could not be checked. Check again for points."]
    else:
        classification = "uncatalogued"
        bright = [s for s in SURVEY_LABELS if any(m.bright for m in measurements if m.survey == s)]
        names_bright = " and ".join(SURVEY_LABELS[s] for s in bright) or "none"
        if len(bright) >= MIN_BRIGHT_SURVEYS:
            score = 20
            reasons = [f"+20: no catalog lists a source within {radius}, and the point is bright (at least "
                       f"{brightness.BRIGHT_SNR:g}σ above its surroundings) in {names_bright}."]
        else:
            score = 0
            missing = [SURVEY_LABELS[m.survey] for m in measurements if m.status in ("no_coverage", "unavailable")]
            gaps = f" Not measured: {', '.join(dict.fromkeys(missing))}." if missing else ""
            reasons = [f"+0: no catalog lists a source within {radius}, but the point is bright in "
                       f"{len(bright)} of the {MIN_BRIGHT_SURVEYS} surveys needed ({names_bright}).{gaps}"]
        if observed is None:
            reasons.append("SkyBoT (known asteroids) needs an observation time and was not run; "
                           "brightness across surveys does not verify identity or rule out chance alignments.")

    if optional_unchecked and not listed:
        reasons.append(f"{', '.join(optional_unchecked)} could not be checked. It is not required for points.")
    breakdown = [ScorePart(key="base", points=score, reason=reasons[0])]
    if classification == "incomplete":
        spectrum = SpectralReview(status="not_eligible", message="Complete the applicable catalog checks before spectral scoring.")
    else:
        source = next((s for s in sources if s.survey == "spherex"), None)
        spectrum = await asyncio.to_thread(spectral.analyze, source, data.ra, data.dec)
        if spectrum.samples:
            if spectral_store is None:
                raise ApiError(503, "evidence_unavailable", "Durable spectral evidence storage is not configured.")
            try:
                spectrum = await asyncio.to_thread(spectral_store.save, spectrum, source.frames, data.ra, data.dec)
            except OSError as error:
                raise ApiError(503, "evidence_unavailable", "Spectral evidence could not be saved. Retry before claiming points.") from error
    detected = spectrum.sourceDetected
    breakdown.append(ScorePart(key="spherex", points=10 if detected else 0,
        reason="+10: SPHEREx aperture signal passes the 5σ screen; spectral bonuses are eligible." if detected else "+0: no usable SPHEREx aperture signal above 5σ; spectral bonuses are not yet eligible."))
    for feature in spectrum.features:
        breakdown.append(ScorePart(key=feature.key, points=feature.points,
            reason=f"+5: possible {feature.label} absorption pattern; both required regions pass. Follow-up is needed." if feature.points else
            f"+0: {feature.label} pattern {'lacks suitable wavelength coverage' if feature.status == 'insufficient' else 'does not pass the screen'}."))
    wise_result = await wise_variability.analyze(wise_comparison, data, asset_loader) if wise_comparison else None
    if wise_result:
        wise_result.points = 5 if detected and wise_result.status == "candidate" else 0
        breakdown.append(ScorePart(key="wise_variability", points=wise_result.points,
            reason="+5: possible variable brightness across the saved WISE blink." if wise_result.points else
            f"+0: WISE variability — {wise_result.message}" + (" SPHEREx eligibility is also required." if not detected else "")))
    score = sum(part.points for part in breakdown)
    reasons.extend(part.reason for part in breakdown[1:])
    if unavailable:
        reasons.append(f"Unavailable: {', '.join(unavailable)}. Up to two unavailable catalogs are allowed only when no returned rows list a source; these missing checks do not establish novelty.")

    key = object_key(identity)
    response = PointReviewResponse(
        **data.model_dump(), id=uuid4(), observedAtUtc=observed,
        reviewedAtUtc=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        scoreVersion=SCORE_VERSION, score=score, classification=classification, reasons=reasons,
        identity=identity, catalogReview=report, brightness=measurements,
        scoreBreakdown=breakdown, spectral=spectrum, wiseVariability=wise_result,
        limitations=[
            "Points sort submitted points for discussion. They are not a measure of scientific significance, and 20 points is not a discovery.",
            "Uncatalogued candidate means no returned catalog matches, with at most two unavailable catalogs; missing checks, depth, epoch and coverage limit this classification.",
            f"Bright means a local peak at least {brightness.BRIGHT_SNR:g}σ above the surrounding pixels in a cutout's FITS. "
            "It is not a photometric detection, a flux, a temperature or evidence of variability.",
            "Survey measurements use the marked sky coordinate; source motion between survey dates is not tracked.",
            "A cold brown dwarf is usually invisible in optical DSS and NEOSSat images; SPHEREx and WISE are the infrared surveys.",
        ])
    return response, key or position_key(data.ra, data.dec), key
