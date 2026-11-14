from dataclasses import dataclass
from io import BytesIO
import math
import re
import warnings

from astropy import units as u
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_scales
import numpy as np
from PIL import Image
from reproject import reproject_interp
from scipy.ndimage import maximum_filter
from scipy.spatial import cKDTree

from .models import ArchiveError, Grid, Stretch
from .storage import digest


@dataclass
class Prepared:
    observation: object
    raw: bytes
    sha256: str
    version: str
    image: np.ndarray
    valid: np.ndarray
    wavelength: np.ndarray
    bandwidth: np.ndarray
    target_wavelength: float
    target_bandwidth: float
    quality: dict
    coverage: dict
    footprint: np.ndarray


def make_grid(field, config):
    size = math.ceil(field.fov_arcmin * 60 / config.pixel_scale_arcsec)
    if not 1 <= size <= 1024:
        raise ArchiveError("INVALID_CROP", "Requested output exceeds grid limits", 422)
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.radesys = "ICRS"
    wcs.wcs.crval = [field.ra, field.dec]
    wcs.wcs.crpix = [(size + 1) / 2, (size + 1) / 2]
    wcs.wcs.cdelt = [-config.pixel_scale_arcsec / 3600, config.pixel_scale_arcsec / 3600]
    grid = Grid(width=size, height=size, pixel_scale_arcsec=config.pixel_scale_arcsec,
                fits_header=dict(wcs.to_header()))
    return grid, wcs


def _grid_boundary(grid):
    """Outer pixel-edge coordinates of the output grid, sampled along each side."""
    xs = np.linspace(-0.5, grid.width - 0.5, 65)
    ys = np.linspace(-0.5, grid.height - 0.5, 65)
    return (np.concatenate([xs, xs, np.full(65, -0.5), np.full(65, grid.width - 0.5)]),
            np.concatenate([np.full(65, -0.5), np.full(65, grid.height - 0.5), ys, ys]))


def cutout_size_deg(grid, output_wcs, config, native_wcs=None):
    """Side of the detector-aligned square cutout needed to cover the output grid.

    The request is made before any detector WCS is known, so the default is the
    conservative bound: a square circumscribing the circle through the farthest
    corner of the ACTUAL rounded output grid, which covers every detector rotation.
    With a detector WCS the exact extent for that orientation is returned instead.
    Padding covers bilinear support, cutout centre rounding and distortion.
    """
    bx, by = _grid_boundary(grid)
    pad = config.cutout_padding_arcsec / 3600
    if native_wcs is None:
        centre = output_wcs.pixel_to_world((grid.width - 1) / 2, (grid.height - 1) / 2)
        # Detector pixels are laid out on a tangent plane, where a sky angle t spans
        # tan(t); use that so the bound is not short on wide fields.
        half = float(np.degrees(np.tan(centre.separation(output_wcs.pixel_to_world(bx, by)).max().rad)))
    else:
        centre = output_wcs.pixel_to_world_values((grid.width - 1) / 2, (grid.height - 1) / 2)
        cx, cy = native_wcs.world_to_pixel_values(*centre)
        nx, ny = native_wcs.world_to_pixel_values(*output_wcs.pixel_to_world_values(bx, by))
        scale = float(np.max(proj_plane_pixel_scales(native_wcs)))
        half = float(max(np.abs(nx - cx).max(), np.abs(ny - cy).max())) * scale
    return math.ceil(2 * (half + pad) * 1e6) / 1e6


def prepare(observation, raw, field, grid, output_wcs, config):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=Warning)
            with fits.open(BytesIO(raw), memmap=False) as hdus:
                science = np.array(hdus["IMAGE"].data, dtype=float)
                flags = np.array(hdus["FLAGS"].data)
                variance = np.array(hdus["VARIANCE"].data, dtype=float)
                zodi = np.array(hdus["ZODI"].data, dtype=float)
                if (science.ndim != 2 or science.size > 2040**2
                        or any(a.shape != science.shape for a in (flags, variance, zodi))):
                    raise ValueError("Invalid image dimensions")
                unit = u.Unit(hdus["IMAGE"].header["BUNIT"])
                factor = unit.to(u.MJy / u.sr)
                zodi_factor = u.Unit(hdus["ZODI"].header.get("BUNIT", str(unit))).to(u.MJy / u.sr)
                for keyword, expected in (("DETECTOR", observation.detector), ("OBSID", observation.observation_id)):
                    if keyword in hdus["IMAGE"].header and hdus["IMAGE"].header[keyword] != expected:
                        raise ValueError("Cutout disagrees with discovery metadata")
                native_wcs = WCS(hdus["IMAGE"].header).celestial
                spectral_header = hdus["IMAGE"].header.copy()
                for key in list(spectral_header):
                    if key in ("A_ORDER", "B_ORDER", "AP_ORDER", "BP_ORDER") or re.fullmatch(r"(?:A|B|AP|BP)_\d+_\d+", key):
                        del spectral_header[key]
                spectral_wcs = WCS(spectral_header, fobj=hdus, key="W")
                spectral_wcs.sip = None
                version = str(hdus[0].header["VERSION"])
                x, y = native_wcs.world_to_pixel_values(field.ra, field.dec)
                if not (0 <= x < science.shape[1] and 0 <= y < science.shape[0]):
                    raise ValueError("Requested centre outside image")
                target_wave, target_band = spectral_wcs.pixel_to_world(x, y)
                # Evaluate spectral response at every output sky position, retaining
                # spatial dependence rather than broadcasting the centre wavelength.
                yy, xx = np.indices((grid.height, grid.width))
                sky = output_wcs.pixel_to_world(xx, yy)
                nx, ny = native_wcs.world_to_pixel(sky)
                wave, band = spectral_wcs.pixel_to_world(nx, ny)
                wave = wave.to_value(u.um)
                band = band.to_value(u.um)
                informational = 0
                for key in hdus["FLAGS"].header:
                    if key.startswith("MSKN") and hdus["FLAGS"].header[key] in ("SOURCE", "FULLSAMPLE"):
                        informational |= 1 << int(key[4:])
                quality_bad = (flags.astype(np.uint32) & np.uint32(0xFFFFFFFF ^ informational)) != 0
                valid = (np.isfinite(science) & np.isfinite(variance) & (variance > 0)
                         & np.isfinite(zodi) & ~quality_bad)
                image = science * factor - zodi * zodi_factor
                image[~valid] = 0
                shape = (grid.height, grid.width)
                projected, footprint = reproject_interp((image, native_wcs), output_wcs,
                                                        shape_out=shape, order="bilinear")
                support, _ = reproject_interp((valid.astype(float), native_wcs), output_wcs,
                                              shape_out=shape, order="bilinear")
                # Geometric coverage: the four native pixels supporting the bilinear
                # sample all lie inside the cutout array. Detector-edge truncation
                # therefore shows up here and is never filled.
                inside = (np.isfinite(nx) & np.isfinite(ny) & (nx >= 0) & (ny >= 0)
                          & (nx <= science.shape[1] - 1) & (ny <= science.shape[0] - 1))
                # Valid coverage additionally needs every supporting pixel to pass
                # the quality mask; flags are never interpolated.
                good = (inside & (footprint > 0) & (support >= 1 - 1e-8) & np.isfinite(projected)
                        & np.isfinite(wave) & np.isfinite(band) & (band > 0))
                projected[~good] = np.nan
                cy, cx = (grid.height - 1) / 2, (grid.width - 1) / 2
                near = (xx - cx) ** 2 + (yy - cy) ** 2 <= config.target_region_radius_pixels ** 2
                coverage = {
                    "outputPixels": int(good.size),
                    "geometricFraction": float(inside.mean()),
                    "validFraction": float(good.mean()),
                    "validFractionOfGeometric": float(good.sum() / inside.sum()) if inside.any() else 0.0,
                    "targetRegionRadiusPixels": config.target_region_radius_pixels,
                    "targetRegionPixels": int(near.sum()),
                    "targetRegionValidFraction": float(good[near].mean()),
                }
                return Prepared(observation, raw, digest(raw), version, projected, good,
                                wave, band, float(target_wave.to_value(u.um)),
                                float(target_band.to_value(u.um)), {
                                    "inputPixels": int(science.size),
                                    "flaggedInputPixels": int(np.count_nonzero(flags)),
                                    "qualityRejectedInputPixels": int(np.count_nonzero(quality_bad)),
                                    "informationalFlagMask": informational,
                                    "invalidInputPixels": int(np.count_nonzero(~valid)),
                                    "invalidOutputPixels": int(np.count_nonzero(~good)),
                                }, coverage, inside)
    except Exception as exc:
        raise ArchiveError("INVALID_CUTOUT", f"Cannot prepare {observation.observation_id}: {type(exc).__name__}", 422) from exc


def frame_ref(frame):
    return {"observationId": frame.observation.observation_id, "detector": frame.observation.detector}


def frame_key(frame):
    return (frame.sha256, frame.observation.observation_id, frame.observation.detector)


def compatible(a, b, config):
    if a.observation.detector != b.observation.detector:
        return False, "different_detector"
    if a.observation.start_mjd == b.observation.start_mjd:
        return False, "same_observation_time"
    common = a.valid & b.valid
    if common.mean() < config.min_common_valid_coverage:
        return False, "insufficient_common_coverage"
    delta = np.abs(a.wavelength[common] - b.wavelength[common])
    allowed = config.wavelength_tolerance_bandwidth * np.minimum(a.bandwidth[common], b.bandwidth[common])
    if not np.all(delta <= allowed):
        return False, "wavelength_mismatch"
    return True, "compatible"


def select(frames, config, cache=None):
    """Choose mutually comparable frames, reselecting around alignment failures.

    Returns (chosen, diagnostics, alignment). `cache` memoizes pair checks between
    calls as later batches add frames. A measured alignment failure belongs to a
    PAIR: it removes that relationship, never a frame globally, because the check
    cannot tell which of the two frames is wrong.
    """
    cache = {} if cache is None else cache

    def pair(kind, function, a, b):
        key = (kind, frame_key(a), frame_key(b))
        if key not in cache:
            cache[key] = function(a, b)
        return cache[key]

    def comparable(a, b):
        a, b = sorted((a, b), key=order)
        return pair("compatible", lambda x, y: compatible(x, y, config), a, b)

    def aligned(a, b):
        a, b = sorted((a, b), key=order)
        return pair("alignment", alignment_check, a, b)

    order = lambda f: (f.observation.start_mjd, f.observation.observation_id, f.sha256)
    eligible, excluded = [], []
    for frame in frames:
        if frame.coverage["geometricFraction"] < config.min_geometric_coverage:
            reason = "insufficient_geometric_coverage"
        elif frame.coverage["validFraction"] < config.min_valid_coverage:
            reason = "insufficient_valid_coverage"
        else:
            eligible.append(frame)
            continue
        excluded.append({**frame_ref(frame), "reason": reason,
                         "geometricFraction": frame.coverage["geometricFraction"],
                         "validFraction": frame.coverage["validFraction"]})
    eligible.sort(key=order)
    pairs, reasons = [], {}
    for i, a in enumerate(eligible):
        for j in range(i + 1, len(eligible)):
            b = eligible[j]
            ok, reason = comparable(a, b)
            reasons[reason] = reasons.get(reason, 0) + 1
            if ok:
                pairs.append((-(b.observation.start_mjd - a.observation.start_mjd),
                              -float((a.valid & b.valid).mean()),
                              abs(a.target_wavelength - b.target_wavelength),
                              a.observation.observation_id, b.observation.observation_id, i, j))
    diagnostics = {"rejectedObservations": excluded, "pairChecks": reasons,
                   "usableExposureCount": len(eligible), "alignmentFailures": []}
    if not pairs:
        return (eligible[:1] if len(eligible) == 1 else []), diagnostics, {}

    failures, recorded = [], set()

    def record_failure(a, b):
        # One entry per failed relationship, however often it is encountered.
        a, b = sorted((a, b), key=order)
        if (frame_key(a), frame_key(b)) in recorded:
            return
        recorded.add((frame_key(a), frame_key(b)))
        check = aligned(a, b)
        failures.append({"a": frame_ref(a), "b": frame_ref(b), "matchedSources": check["matchedSources"],
                         "medianResidualPixels": check["medianResidualPixels"],
                         "acceptancePixels": check["acceptancePixels"]})

    diagnostics["selectionPolicy"] = "longest_baseline_then_coverage_then_wavelength_then_id_skipping_failed_alignment_pairs"
    diagnostics["candidatePairCount"] = len(pairs)
    for attempt, (*_, i, j) in enumerate(sorted(pairs), start=1):
        a, b = eligible[i], eligible[j]
        if aligned(a, b)["status"] == "failed":
            record_failure(a, b)
            continue
        chosen = [a, b]
        for frame in eligible:
            if len(chosen) >= config.max_frames:
                break
            if any(frame is f for f in chosen) or not all(comparable(frame, f)[0] for f in chosen):
                continue
            conflicts = [f for f in chosen if aligned(frame, f)["status"] == "failed"]
            if conflicts:
                for f in conflicts:
                    record_failure(frame, f)
                continue
            chosen.append(frame)
        chosen.sort(key=order)
        reference = chosen[0]
        alignment = {reference.sha256: {"status": "reference_frame"}}
        for frame in chosen[1:]:
            alignment[frame.sha256] = {**aligned(reference, frame), "referenceSourceSha256": reference.sha256}
        diagnostics["alignmentFailures"] = failures
        diagnostics["candidatePairsTried"] = attempt
        # Observation IDs repeat across detectors, so entries carry both.
        diagnostics["notSelectedExposures"] = [frame_ref(f) for f in eligible
                                               if all(f is not selected for selected in chosen)]
        return chosen, diagnostics, alignment
    # Every compatible pair measurably failed alignment: no acceptable pair in this sample.
    diagnostics["alignmentFailures"] = failures
    diagnostics["candidatePairsTried"] = len(pairs)
    return [], diagnostics, {}


def common_coverage(frames, config):
    common = np.logical_and.reduce([frame.valid for frame in frames])
    yy, xx = np.indices(common.shape)
    cy, cx = (common.shape[0] - 1) / 2, (common.shape[1] - 1) / 2
    near = (xx - cx) ** 2 + (yy - cy) ** 2 <= config.target_region_radius_pixels ** 2
    pairwise = [float((a.valid & b.valid).mean()) for i, a in enumerate(frames) for b in frames[i + 1:]]
    return {"outputPixels": int(common.size), "allFramesCommonValidFraction": float(common.mean()),
            "minPairwiseCommonValidFraction": min(pairwise) if pairwise else None,
            "targetRegionRadiusPixels": config.target_region_radius_pixels,
            "targetRegionPixels": int(near.sum()),
            "targetRegionCommonValidFraction": float(common[near].mean())}


def shared_stretch(frames, config):
    values = np.concatenate([frame.image[frame.valid] for frame in frames])
    low, high = np.percentile(values, [config.lower_percentile, config.upper_percentile])
    if high <= low:
        high = low + max(abs(low) * 1e-6, 1e-6)
    return Stretch(lower=float(low), upper=float(high), softening=config.asinh_softening)


def render(frame, stretch):
    normalized = np.clip((np.nan_to_num(frame.image, nan=stretch.lower) - stretch.lower)
                         / (stretch.upper - stretch.lower), 0, 1)
    values = np.arcsinh(normalized / stretch.softening) / np.arcsinh(1 / stretch.softening)
    gray = np.round(values * 255).astype(np.uint8)
    rgba = np.stack([gray, gray, gray, frame.valid.astype(np.uint8) * 255], axis=-1)
    output = BytesIO()
    # Conventional FITS y increases north. PNG row zero is the top (north) row.
    Image.fromarray(np.flipud(rgba)).save(output, format="PNG")
    return output.getvalue()


def source_centroids(frame):
    image = frame.image
    values = image[frame.valid]
    if not len(values):
        return np.empty((0, 2))
    median = np.median(values)
    noise = max(float(1.4826 * np.median(np.abs(values - median))), 1e-8)
    work = np.where(frame.valid, image, -np.inf)
    peaks = (work == maximum_filter(work, size=5)) & (work > median + 8 * noise)
    points = []
    cy, cx = (np.array(image.shape) - 1) / 2
    for y, x in np.argwhere(peaks):
        if y < 2 or x < 2 or y >= image.shape[0]-2 or x >= image.shape[1]-2:
            continue
        if (x-cx)**2 + (y-cy)**2 <= 25:
            continue  # Exclude the central target; never align away its motion.
        patch = image[y-2:y+3, x-2:x+3]
        if not np.isfinite(patch).all():
            continue
        weight = np.maximum(patch - median, 0)
        if weight.sum() <= 0:
            continue
        yy, xx = np.indices(weight.shape)
        points.append((x-2 + (weight*xx).sum()/weight.sum(),
                       y-2 + (weight*yy).sum()/weight.sum()))
    return np.asarray(points).reshape(-1, 2)


def alignment_check(reference, frame):
    a, b = source_centroids(reference), source_centroids(frame)
    if len(a) < 3 or len(b) < 3:
        return {"status": "wcs_only_not_empirically_verified", "matchedSources": 0,
                "reason": "fewer_than_3_detected_background_sources"}
    distance, index = cKDTree(b).query(a)
    _, reverse = cKDTree(a).query(b)
    good = (distance < 2) & (reverse[index] == np.arange(len(a)))
    if good.sum() < 3:
        return {"status": "wcs_only_not_empirically_verified", "matchedSources": int(good.sum()),
                "reason": "fewer_than_3_mutual_matches"}
    residual = float(np.median(distance[good]))
    return {"status": "verified" if residual <= 0.5 else "failed",
            "matchedSources": int(good.sum()), "medianResidualPixels": residual,
            "acceptancePixels": 0.5}
