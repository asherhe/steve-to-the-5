from dataclasses import dataclass
import importlib.metadata
import threading
from io import BytesIO
from pathlib import Path
import platform
import time
import warnings

from astropy.io import fits
from astropy.wcs import WCS
import numpy as np
from reproject import reproject_interp

from services.archive.builds import CancellableDeadline
from services.archive.models import (ArchiveError, Comparison, ComparisonResponse,
                                     FieldRequest, Frame)
from services.archive.pipeline import iso, utc
from services.archive.processing import (alignment_check, common_coverage, cutout_size_deg,
                                         make_grid, render, shared_stretch)
from services.archive.storage import canonical, digest

from .client import DATASETS, exposure_ref
from .models import BANDS, WiseConfig

# Share of the progress bar given to each stage, in order. Discovery is one slow
# archive query per mission phase and usually takes longest.
STAGES = (("discovery", 0.45), ("retrieval", 0.40), ("combination", 0.12), ("publication", 0.03))


class Progress:
    """Thread-safe build progress for display. It never affects the result."""

    def __init__(self, report=None):
        self.report, self.lock = report, threading.Lock()
        self.stage, self.done, self.total = "discovery", 0, 1

    def start(self, stage, total):
        with self.lock:
            self.stage, self.done, self.total = stage, 0, max(1, total)
        self._send()

    def step(self):
        with self.lock:
            self.done = min(self.total, self.done + 1)
        self._send()

    def _send(self):
        if self.report is None:
            return
        with self.lock:
            before = sum(share for name, share in STAGES[:[n for n, _ in STAGES].index(self.stage)])
            share = dict(STAGES)[self.stage]
            state = {"stage": self.stage, "done": self.done, "total": self.total,
                     "fraction": round(before + share * self.done / self.total, 4)}
        self.report(state)


ACKNOWLEDGEMENT = (
    "This publication makes use of data products from the Wide-field Infrared Survey "
    "Explorer, which is a joint project of the University of California, Los Angeles, and "
    "the Jet Propulsion Laboratory/California Institute of Technology, funded by the "
    "National Aeronautics and Space Administration, and from NEOWISE, which is a project "
    "of the Jet Propulsion Laboratory/California Institute of Technology, funded by the "
    "Planetary Science Division of the National Aeronautics and Space Administration."
)
DOCUMENTATION = "https://irsa.ipac.caltech.edu/Missions/wise.html"


def implementation_identity():
    """Fingerprint of this package and the archive modules it reuses."""
    here = Path(__file__).parent
    paths = sorted(here.glob("*.py")) + sorted((here.parent / "archive").glob("*.py"))
    sources = {f"{p.parent.name}/{p.name}": digest(p.read_bytes()) for p in paths}
    return {"sourceSha256": digest(canonical(sources)), "python": platform.python_version(),
            "packages": {name: importlib.metadata.version(name)
                         for name in ("numpy", "astropy", "reproject", "pillow")}}


@dataclass
class PreparedExposure:
    exposure: object
    raw: bytes
    sha256: str
    image: np.ndarray
    inside: np.ndarray
    background_dn: float
    processing_version: str


@dataclass
class EpochFrame:
    """One combined frame. Field names match what the archive's stretch, render,
    coverage and alignment helpers read."""
    exposures: list
    discovered: int
    image: np.ndarray
    valid: np.ndarray
    sha256: str
    coverage: dict


def group_epochs(exposures, config):
    """Split time-ordered exposures into visits. Returns lists of exposures."""
    epochs = []
    for exposure in sorted(exposures, key=lambda e: (e.mjd_obs, e.exposure_id)):
        current = epochs[-1] if epochs else None
        if (current is None or exposure.dataset != current[-1].dataset
                or exposure.mjd_obs - current[-1].mjd_obs > config.epoch_gap_days
                or exposure.mjd_obs - current[0].mjd_obs > config.max_epoch_span_days):
            epochs.append([exposure])
        else:
            current.append(exposure)
    return epochs


def spaced(items, count):
    """Up to `count` items, evenly spaced by index and keeping both ends."""
    if len(items) <= count:
        return list(items)
    if count == 1:
        return [items[len(items) // 2]]
    indices = sorted({round(i * (len(items) - 1) / (count - 1)) for i in range(count)})
    return [items[i] for i in indices]


def prepare_exposure(exposure, raw, field, grid, output_wcs):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=Warning)
            with fits.open(BytesIO(raw), memmap=False) as hdus:
                header = hdus[0].header
                science = np.array(hdus[0].data, dtype=float)
                if science.ndim != 2 or science.size > 1100**2:
                    raise ValueError("Invalid image dimensions")
                if "BAND" in header and int(header["BAND"]) != exposure.band:
                    raise ValueError("Cutout disagrees with discovery metadata")
                for key, expected in (("SCAN", exposure.scan_id), ("FRNUM", exposure.frame_num)):
                    if key in header and str(header[key]).strip() != str(expected):
                        raise ValueError("Cutout exposure identity disagrees with metadata")
                if "MJD_OBS" in header and (not np.isfinite(float(header["MJD_OBS"])) or
                        abs(float(header["MJD_OBS"]) - exposure.mjd_obs) > 1e-6):
                    raise ValueError("Cutout observation time disagrees with metadata")
                native_wcs = WCS(header).celestial
                x, y = native_wcs.world_to_pixel_values(field.ra, field.dec)
                if not (0 <= x <= science.shape[1] - 1 and 0 <= y <= science.shape[0] - 1):
                    raise ValueError("Requested centre outside image")
                finite = np.isfinite(science)
                if not finite.any():
                    raise ValueError("No finite pixels")
                background = float(np.median(science[finite]))
                shape = (grid.height, grid.width)
                projected, footprint = reproject_interp((science - background, native_wcs), output_wcs,
                                                        shape_out=shape, order="bilinear")
                yy, xx = np.indices(shape)
                nx, ny = native_wcs.world_to_pixel_values(*output_wcs.pixel_to_world_values(xx, yy))
                # Geometric coverage: the bilinear support lies inside the cutout array.
                inside = (np.isfinite(nx) & np.isfinite(ny) & (nx >= 0) & (ny >= 0)
                          & (nx <= science.shape[1] - 1) & (ny <= science.shape[0] - 1))
                projected[~(inside & (footprint > 0) & np.isfinite(projected))] = np.nan
                return PreparedExposure(exposure, raw, digest(raw), projected, inside, background,
                                        str(header.get("WRELEASE", "unknown")))
    except Exception as exc:
        raise ArchiveError("INVALID_CUTOUT", f"Cannot prepare {exposure.exposure_id}: {type(exc).__name__}", 422) from exc


def combine(prepared, discovered, config):
    stack = np.stack([p.image for p in prepared])
    count = np.isfinite(stack).sum(axis=0)
    valid = count >= min(config.min_pixel_exposures, len(prepared))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        image = np.nanmedian(stack, axis=0)
    image[~valid] = np.nan
    yy, xx = np.indices(valid.shape)
    cy, cx = (valid.shape[0] - 1) / 2, (valid.shape[1] - 1) / 2
    near = (xx - cx) ** 2 + (yy - cy) ** 2 <= config.target_region_radius_pixels ** 2
    inside = np.logical_or.reduce([p.inside for p in prepared])
    coverage = {"outputPixels": int(valid.size), "geometricFraction": float(inside.mean()),
                "validFraction": float(valid.mean()),
                "minExposuresPerValidPixel": int(count[valid].min()) if valid.any() else 0,
                "targetRegionRadiusPixels": config.target_region_radius_pixels,
                "targetRegionPixels": int(near.sum()),
                "targetRegionValidFraction": float(valid[near].mean())}
    sha = digest(canonical([p.sha256 for p in prepared]))
    return EpochFrame(prepared, discovered, image, valid, sha, coverage)


def combined_fits(frame, grid, band, unit):
    """The combined image on the output grid, with its WCS and input list."""
    header = fits.Header(grid.fits_header)
    header["BUNIT"] = unit
    header["BAND"] = band
    header["NEXP"] = len(frame.exposures)
    header["MJD-BEG"] = min(p.exposure.mjd_obs for p in frame.exposures)
    header["MJD-END"] = max(p.exposure.mjd_obs for p in frame.exposures)
    for p in frame.exposures:
        header["HISTORY"] = f"{p.exposure.exposure_id} sha256 {p.sha256}"
    output = BytesIO()
    fits.PrimaryHDU(frame.image.astype(np.float32), header).writeto(output)
    return output.getvalue()


class WisePipeline:
    def __init__(self, client, store, config=None, clock=time.monotonic):
        self.config = config or WiseConfig()
        self.client, self.store, self.clock = client, store, clock
        self.last_timings = {}

    def build(self, field, report=None, cancel=None):
        """Run one bounded build. `report` receives progress dictionaries for display;
        setting the `cancel` event stops the build."""
        self.progress = Progress(report)
        diagnostics = {"schemaVersion": 1, "complete": False, "incompleteStages": [],
                       "coverageThresholds": {"minValidCoverage": self.config.min_valid_coverage,
                                              "denominator": "all_output_grid_pixels"}}
        self.last_timings = {}
        try:
            deadline = CancellableDeadline(self.config.build_deadline_seconds, self.clock, cancel or threading.Event())
            return self._build(field, deadline, diagnostics)
        except ArchiveError as exc:
            if (exc.details or {}).get("limit") == "build_deadline":
                # Finished downloads stay in the cache, so the next attempt resumes from them.
                exc.message += ". Downloads so far are cached; retry to continue from them"
            diagnostics.update({"complete": False, "code": exc.code, "message": exc.message})
            exc.details = {**(exc.details or {}), "diagnostics": diagnostics}
            raise

    def _unavailable(self, diagnostics, code, message):
        diagnostics.update({"code": code, "message": message, "complete": False})
        return ComparisonResponse(status="upstream_unavailable", diagnostics=diagnostics)

    def _build(self, field, deadline, diagnostics):
        config, started = self.config, self.clock()
        band = BANDS[field.band]
        progress = self.progress
        progress.start("discovery", len(DATASETS))
        try:
            discovery = self.client.discover(field, deadline, on_done=progress.step)
        except ArchiveError as exc:
            if deadline.cancel.is_set():
                deadline.check("discovery")
            if exc.code == "PROCESSING_LIMIT" or exc.http_status < 500:
                raise
            diagnostics["incompleteStages"].append("discovery")
            return self._unavailable(diagnostics, exc.code, exc.message)
        self.last_timings["discoverySeconds"] = self.clock() - started
        deadline.check("discovery")
        found = discovery.observations
        indexed = bool(getattr(discovery, "metadata", None))
        scope = getattr(discovery, "scope", "wise_neowise_single_exposures_all_mission_phases"
                        if self.client.discovery_scope == "unwise_neo11_index_then_ibe"
                        else self.client.discovery_scope)
        usable = [e for e in found if e.qual_frame is None or e.qual_frame >= config.min_qual_frame]
        by_dataset = {}
        for e in found:
            by_dataset[e.dataset] = by_dataset.get(e.dataset, 0) + 1
        diagnostics["discovery"] = {
            "scope": scope, "band": band["name"],
            "totalExposures": len(found), "byDataset": dict(sorted(by_dataset.items())),
            "rejectedByFrameQuality": len(found) - len(usable),
            "observedTimeRangeUtc": ({"start": iso(found[0].mjd_obs), "end": iso(found[-1].mjd_obs)}
                                     if found else None),
            "failedDatasetQueries": discovery.failures, "complete": not discovery.failures and not indexed}
        if indexed:
            diagnostics["discovery"]["metadataSources"] = discovery.metadata
            diagnostics["incompleteStages"].append("index_candidate_subset")
        if discovery.failures:
            diagnostics["incompleteStages"].append("discovery")
        if not usable:
            if discovery.failures:
                return self._unavailable(diagnostics, "INCOMPLETE_DISCOVERY",
                                         "A mission-phase query failed and the others returned no usable "
                                         "exposures; absence of coverage is not established")
            diagnostics["complete"] = True
            return ComparisonResponse(status="no_coverage", diagnostics=diagnostics)

        epochs = group_epochs(usable, config)
        eligible = [epoch for epoch in epochs if len(epoch) >= config.min_exposures_per_epoch]
        sampled = spaced(eligible, config.max_epochs)
        chosen = [spaced(epoch, config.exposures_per_epoch) for epoch in sampled]
        diagnostics["epochs"] = {"discovered": len(epochs), "sampled": len(sampled),
                                 "tooFewExposures": len(epochs) - len(eligible),
                                 "exposuresRequested": sum(len(c) for c in chosen),
                                 "exposuresNotRequested": len(usable) - sum(len(c) for c in chosen)}
        diagnostics["selectionScope"] = ("all_discovered_visits" if len(sampled) == len(epochs)
                                         else "bounded_visit_sample")

        # The grid model is shared with the SPHEREx archive; only the pixel scale differs.
        grid, wcs = make_grid(FieldRequest(ra=field.ra, dec=field.dec, fovArcmin=field.fov_arcmin), config)
        size_deg = cutout_size_deg(grid, wcs, config)
        downloading = self.clock()
        deadline.check("retrieval")
        requested = [e for group in chosen for e in group]
        progress.start("retrieval", len(requested))
        result = self.client.retrieve(requested, field, size_deg, deadline, on_done=progress.step)
        raw = {exposure.exposure_id: data for exposure, data in result.cutouts}
        categories = {}
        for item in result.failures:
            categories[item["category"]] = categories.get(item["category"], 0) + 1
        diagnostics["retrieval"] = {"cutoutSizeDeg": size_deg, "requestedCutouts": sum(len(c) for c in chosen),
                                    "succeededCutouts": len(raw), "failedCutouts": len(result.failures),
                                    "failureCategories": dict(sorted(categories.items())),
                                    "failures": result.failures}
        if result.failures:
            diagnostics["incompleteStages"].append("retrieval")
        if result.failures and not raw:
            return self._unavailable(diagnostics, result.failures[0]["code"],
                                     f"All {len(result.failures)} requested cutouts failed")

        frames, invalid, rejected = [], [], []
        progress.start("combination", len(sampled))
        for index, (epoch, group) in enumerate(zip(sampled, chosen)):
            if index:
                progress.step()
            deadline.check("preparation")
            prepared = []
            for exposure in group:
                if exposure.exposure_id not in raw:
                    continue
                try:
                    prepared.append(prepare_exposure(exposure, raw[exposure.exposure_id], field, grid, wcs))
                except ArchiveError as exc:
                    invalid.append({**exposure_ref(exposure), "reason": exc.message})
            window = {"start": iso(epoch[0].mjd_obs), "end": iso(epoch[-1].mjd_obs)}
            if len(prepared) < config.min_exposures_per_epoch:
                rejected.append({**window, "reason": "too_few_usable_exposures", "usableExposures": len(prepared)})
                continue
            frame = combine(prepared, len(epoch), config)
            if frame.coverage["validFraction"] < config.min_valid_coverage:
                rejected.append({**window, "reason": "insufficient_valid_coverage",
                                 "validFraction": frame.coverage["validFraction"]})
                continue
            frames.append(frame)
        # Alignment is checked against the earliest frame; a measured failure removes
        # the later frame and is recorded. Nothing is shifted to fit.
        alignment = {}
        if frames:
            alignment[frames[0].sha256] = {"status": "reference_frame" if len(frames) > 1
                                           else "single_frame_not_applicable"}
            for frame in frames[1:]:
                alignment[frame.sha256] = alignment_check(frames[0], frame)
            for frame in [f for f in frames if alignment[f.sha256]["status"] == "failed"]:
                rejected.append({"start": iso(frame.exposures[0].exposure.mjd_obs),
                                 "end": iso(frame.exposures[-1].exposure.mjd_obs),
                                 "reason": "alignment_check_failed", **alignment[frame.sha256]})
            frames = [f for f in frames if alignment[f.sha256]["status"] != "failed"]
        self.last_timings["retrievalAndPreparationSeconds"] = self.clock() - downloading
        diagnostics["invalidCutouts"] = invalid
        diagnostics["rejectedEpochs"] = rejected
        diagnostics["usableEpochCount"] = len(frames)
        complete = not diagnostics["incompleteStages"]
        diagnostics["complete"] = complete
        if not frames:
            if indexed and not result.failures and not discovery.failures:
                raise ArchiveError("PROCESSING_LIMIT", "The indexed exposure subset did not produce a usable "
                                   "frame; this does not establish absence of WISE coverage")
            if not complete:
                return self._unavailable(diagnostics, "INCOMPLETE_RETRIEVAL",
                                         "Some archive requests failed and no usable epoch was built from "
                                         "the exposures retrieved; absence of coverage is not established")
            if len(sampled) < len(eligible):
                raise ArchiveError("PROCESSING_LIMIT", "The sampled visits did not produce a usable frame. "
                                   "Try the longer time-lapse; other visits have not been checked",
                                   details={"limit": "epoch_sample"})
            return ComparisonResponse(status="no_comparable_pair", diagnostics=diagnostics)

        deadline.check("rendering")
        progress.start("publication", 1)
        stretch = shared_stretch(frames, config).model_copy(update={"unit": "DN"})
        resolved = {**config.model_dump(mode="json", by_alias=True), "band": band["name"]}
        inputs = [{"frameSourceSha256": frame.sha256,
                   "exposures": [{"exposure": p.exposure.model_dump(by_alias=True), "sourceSha256": p.sha256,
                                  "observedAtUtc": iso(p.exposure.mjd_obs),
                                  "backgroundDn": p.background_dn,
                                  "processingVersion": p.processing_version} for p in frame.exposures]}
                  for frame in frames]
        provenance = {"schemaVersion": 1, "survey": "WISE/NEOWISE single-exposure (Level 1b) images",
                      "implementation": implementation_identity(),
                      "evidenceKind": self.client.evidence_kind,
                      "discoveryScope": scope,
                      "inputs": inputs, "acknowledgement": ACKNOWLEDGEMENT,
                      "releaseDocumentation": DOCUMENTATION,
                      "timestampPolicy": config.timestamp_policy,
                      "alignmentChecks": alignment}
        coverage = common_coverage(frames, config)
        identity = {"field": field.model_dump(), "config": config.model_dump(),
                    "grid": grid.model_dump(), "stretch": stretch.model_dump(),
                    "provenance": provenance, "coverage": coverage, "selectionDiagnostics": diagnostics}
        comparison_id = digest(canonical(identity))
        output, assets = [], dict(getattr(discovery, "assets", {}))
        for frame in frames:
            exposures = [p.exposure for p in frame.exposures]
            frame_id = digest(canonical({"band": field.band, "source": frame.sha256,
                                         "exposures": [e.exposure_id for e in exposures]}))
            assets[f"{frame_id}.png"] = render(frame, stretch)
            assets[f"{frame_id}.fits"] = combined_fits(frame, grid, field.band, stretch.unit)
            for p in frame.exposures:
                assets[f"{p.sha256}.fits"] = p.raw
            first, last = exposures[0].mjd_obs, exposures[-1].mjd_obs
            output.append(Frame(
                id=frame_id, observation_id=f"{exposures[0].exposure_id}..{exposures[-1].exposure_id}",
                observed_at_utc=utc((first + last) / 2),
                observation_start_utc=utc(first), observation_end_utc=utc(last),
                wavelength_um=band["wavelength_um"], bandwidth_um=band["bandwidth_um"],
                release=exposures[0].release, source_url=exposures[0].source_url,
                source_sha256=frame.sha256,
                processing_version=",".join(sorted({p.processing_version for p in frame.exposures})),
                image_url=f"/api/wise/comparisons/{comparison_id}/assets/{frame_id}.png",
                valid_fraction=frame.coverage["validFraction"],
                quality_flags={"combinedExposures": len(exposures),
                               "exposuresAvailableInEpoch": frame.discovered,
                               "invalidOutputPixels": int(np.count_nonzero(~frame.valid))},
                alignment=alignment[frame.sha256]["status"], coverage=frame.coverage))
        limitations = [
            "Quick-look visualization, not a significant motion or variability measurement.",
            f"Each frame is the per-pixel median of up to {config.exposures_per_epoch} single exposures from one "
            "visit; the displayed time is the midpoint of the first and last exposure used. Changes within a visit are averaged away.",
            "Each exposure has its own median level subtracted, which removes background differences between "
            "visits and also any uniform extended emission. Values are raw DN without zero-point scaling; this is not photometry.",
            "No bad-pixel bitmask or uncertainty image is applied. The median rejects isolated artefacts, but "
            "diffraction spikes, latents, scattered moonlight and saturated cores remain.",
            f"{len(sampled)} of the {len(epochs)} visits found are sampled, evenly spaced through the eligible "
            "visits and including their first and last. Each requires the configured minimum exposure count. "
            "The others were not downloaded, so short-lived changes between frames are not shown.",
            "Alignment is WCS reprojection only; the stationary-source check labels frames and applies no correction.",
            f"{band['name']} is a broad filter ({band['wavelength_um']:.2f} µm, {band['bandwidth_um']:.2f} µm wide). "
            "It is not comparable with a SPHEREx spectral channel.",
            "PNG rows are flipped relative to FITS: fitsY=height-1-pngY (zero-based)."]
        if not complete:
            limitations.append("Archive search incomplete (see diagnostics.incompleteStages); some visits or exposures were not retrieved or not requested.")
        if indexed:
            limitations.append("Candidates come from the nearest unWISE neo11 tile's input-exposure table, "
                               f"restricted to included, usable frames centred within {config.index_center_radius_deg} degrees. "
                               "This is a conservative subset, not a complete archive search. Pixels are original WISE/NEOWISE "
                               "single exposures, not unWISE coadd images. Metadata tables are retained with their hashes. "
                               "Metadata credit: Lang (2014), Meisner, Lang & Schlegel (2017a,b); https://unwise.me/.")
        half = band["bandwidth_um"] / 2
        comparison = Comparison(
            id=comparison_id, field=FieldRequest(ra=field.ra, dec=field.dec, fovArcmin=field.fov_arcmin),
            wavelength_range_um=(band["wavelength_um"] - half, band["wavelength_um"] + half),
            stretch=stretch, grid=grid, frames=output, config=resolved, provenance=provenance,
            limitations=limitations, coverage=coverage)
        response = ComparisonResponse(status="ready" if len(output) > 1 else "single_epoch",
                                      comparison=comparison, diagnostics=diagnostics)
        deadline.check("publication")
        self.store.publish(response, assets)
        progress.step()
        self.last_timings["totalSeconds"] = self.clock() - started
        return response
