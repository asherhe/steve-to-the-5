import importlib.metadata
from pathlib import Path
import platform
import time

from astropy.time import Time
from datetime import UTC

from .client import observation_ref
from .models import (ArchiveError, Comparison, ComparisonResponse, Deadline, Frame,
                     ProcessingConfig)
from .processing import (common_coverage, cutout_size_deg, make_grid, prepare, render,
                         select, shared_stretch)
from .storage import canonical, digest


ACKNOWLEDGEMENT = (
    "This publication makes use of data products from the Spectro-Photometer for the "
    "History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which "
    "is a joint project of the Jet Propulsion Laboratory and the California Institute "
    "of Technology, and is funded by the National Aeronautics and Space Administration."
)


def implementation_identity():
    sources = {p.name: digest(p.read_bytes()) for p in sorted(Path(__file__).parent.glob("*.py"))}
    return {"sourceSha256": digest(canonical(sources)), "python": platform.python_version(),
            "packages": {name: importlib.metadata.version(name)
                         for name in ("numpy", "astropy", "reproject", "pillow")}}


def utc(mjd):
    return Time(mjd, format="mjd", scale="utc").to_datetime(timezone=UTC)


def iso(mjd):
    return utc(mjd).isoformat().replace("+00:00", "Z")


def summarize_discovery(discovery, scope):
    """Counts and available time ranges, recorded before any cutout is requested."""
    observations = discovery.observations
    by_release, by_detector, by_both, ranges = {}, {}, {}, {}
    for o in observations:
        by_release[o.release] = by_release.get(o.release, 0) + 1
        by_detector[f"D{o.detector}"] = by_detector.get(f"D{o.detector}", 0) + 1
        key = f"{o.release}:D{o.detector}"
        by_both[key] = by_both.get(key, 0) + 1
        low, high = ranges.get(o.release, (o.start_mjd, o.end_mjd))
        ranges[o.release] = (min(low, o.start_mjd), max(high, o.end_mjd))
    return {"scope": scope, "totalExposures": len(observations),
            "byRelease": dict(sorted(by_release.items())),
            "byDetector": dict(sorted(by_detector.items())),
            "byReleaseDetector": dict(sorted(by_both.items())),
            "observedTimeRangeUtc": {release: {"start": iso(low), "end": iso(high)}
                                     for release, (low, high) in sorted(ranges.items())},
            "failedReleaseQueries": discovery.failures,
            "complete": not discovery.failures}


class Pipeline:
    def __init__(self, client, store, config=None, clock=time.monotonic):
        self.config = config or ProcessingConfig()
        self.client, self.store, self.clock = client, store, clock
        self.last_timings = {}

    def build(self, field):
        """Run one bounded build. Errors carry the diagnostics gathered so far in
        `details["diagnostics"]` for logs; the public error body stays {code, message}."""
        config = self.config
        diagnostics = {"schemaVersion": 2, "complete": False, "incompleteStages": [],
                       "coverageThresholds": {
                           "minGeometricCoverage": config.min_geometric_coverage,
                           "minValidCoverage": config.min_valid_coverage,
                           "minCommonValidCoverage": config.min_common_valid_coverage,
                           "denominator": "all_output_grid_pixels"}}
        self.last_timings = {}
        try:
            return self._build(field, Deadline(config.build_deadline_seconds, self.clock), diagnostics)
        except ArchiveError as exc:
            if (exc.details or {}).get("limit") and exc.details["limit"] not in diagnostics["incompleteStages"]:
                diagnostics["incompleteStages"].append(exc.details["limit"])
            diagnostics.update({"complete": False, "code": exc.code, "message": exc.message})
            exc.details = {**(exc.details or {}), "diagnostics": diagnostics}
            raise

    def _unavailable(self, diagnostics, code, message):
        diagnostics.update({"code": code, "message": message, "complete": False})
        return ComparisonResponse(status="upstream_unavailable", diagnostics=diagnostics)

    def _build(self, field, deadline, diagnostics):
        config, started = self.config, self.clock()
        try:
            discovery = self.client.discover(field, deadline)
        except ArchiveError as exc:
            if exc.code == "PROCESSING_LIMIT" or exc.http_status < 500:
                raise
            diagnostics["incompleteStages"].append("discovery")
            return self._unavailable(diagnostics, exc.code, exc.message)
        observations = discovery.observations
        self.last_timings["discoverySeconds"] = self.clock() - started
        diagnostics["discovery"] = summarize_discovery(discovery, self.client.discovery_scope)
        diagnostics["discoveredExposureCount"] = len(observations)
        if discovery.failures:
            diagnostics["incompleteStages"].append("discovery")
        if not observations:
            if discovery.failures:
                return self._unavailable(diagnostics, "INCOMPLETE_DISCOVERY",
                                         "A release query failed and the others returned no exposures; absence of coverage is not established")
            diagnostics["complete"] = True
            return ComparisonResponse(status="no_coverage", diagnostics=diagnostics)
        # Round-robin detector bands and alternate earliest/latest observations.
        # Search a bounded sample first; never claim it is an exhaustive search.
        groups = {}
        for observation in observations:
            groups.setdefault(observation.detector, []).append(observation)
        ordered = []
        while any(groups.values()):
            for detector in sorted(groups):
                group = groups[detector]
                if group:
                    ordered.append(group.pop(0))
                if group:
                    ordered.append(group.pop())
        grid, wcs = make_grid(field, config)
        size_deg = cutout_size_deg(grid, wcs, config)
        prepared, rejected, failures, selected, alignment = [], [], [], [], {}
        selection, cache, requested, received = {}, {}, 0, 0
        budget = min(len(ordered), config.max_cutouts)
        retrieval = {"cutoutSizeDeg": size_deg, "requestedCutouts": 0, "succeededCutouts": 0,
                     "failedCutouts": 0, "failureCategories": {}, "failures": failures,
                     "notRequestedExposureCount": len(observations)}
        diagnostics["retrieval"] = retrieval
        diagnostics["invalidCutouts"] = rejected
        downloading = self.clock()
        for offset in range(0, budget, config.batch_size):
            deadline.check("retrieval")
            batch = ordered[offset:min(offset + config.batch_size, budget)]
            result = self.client.retrieve(batch, field, size_deg, deadline)
            requested += len(batch)
            received += len(result.cutouts)
            failures += result.failures
            categories = {}
            for item in failures:
                categories[item["category"]] = categories.get(item["category"], 0) + 1
            retrieval.update({"requestedCutouts": requested, "succeededCutouts": received,
                              "failedCutouts": len(failures),
                              "failureCategories": dict(sorted(categories.items())),
                              "notRequestedExposureCount": len(observations) - requested})
            for observation, raw in result.cutouts:
                deadline.check("preparation")
                try:
                    prepared.append(prepare(observation, raw, field, grid, wcs, config))
                except ArchiveError as exc:
                    rejected.append({**observation_ref(observation), "reason": exc.message})
            deadline.check("selection")
            selected, selection, alignment = select(prepared, config, cache)
            # Keep the latest selection record even if a later stage hits a limit.
            diagnostics.update(selection)
            diagnostics["preparedExposureCount"] = len(prepared)
            if len(selected) >= 2:
                break
        self.last_timings["retrievalAndPreparationSeconds"] = self.clock() - downloading
        diagnostics.update(selection)
        if failures:
            diagnostics["incompleteStages"].append("retrieval")
        if requested < len(observations):
            diagnostics["incompleteStages"].append("sampling")
        complete = not diagnostics["incompleteStages"]
        diagnostics["processedExposureCount"] = received
        diagnostics["preparedExposureCount"] = len(prepared)
        diagnostics["complete"] = complete
        diagnostics["selectionScope"] = ("all_discovered_exposures" if complete else
                                         "bounded_time_detector_sample" if requested < len(observations)
                                         else "discovered_exposures_minus_failed_retrievals")
        diagnostics["sampledExposures"] = [{"observationId": f.observation.observation_id,
                                            "detector": f.observation.detector} for f in prepared]
        if failures and not received:
            return self._unavailable(diagnostics, failures[0]["code"],
                                     f"All {requested} requested cutouts failed")
        if len(selected) < 2 and not complete:
            # A negative result from an incomplete search is never reported as absence.
            if requested < len(observations):
                raise ArchiveError("PROCESSING_LIMIT", "No pair found within cutout budget; archive search is not exhaustive",
                                   details={"limit": "cutout_budget"})
            return self._unavailable(diagnostics, "INCOMPLETE_RETRIEVAL",
                                     "Some archive requests failed and no comparable pair was found among "
                                     "the exposures retrieved; absence of a pair is not established")
        if not selected:
            return ComparisonResponse(status="no_comparable_pair", diagnostics=diagnostics)
        deadline.check("rendering")
        stretch = shared_stretch(selected, config)
        provenance = {"schemaVersion": 2, "implementation": implementation_identity(),
                      "evidenceKind": self.client.evidence_kind,
                      "discoveryScope": self.client.discovery_scope,
                      "inputs": [{"observation": frame.observation.model_dump(by_alias=True),
                                  "sourceSha256": frame.sha256} for frame in selected],
                      "acknowledgement": ACKNOWLEDGEMENT,
                      "releaseDocumentation": "https://irsa.ipac.caltech.edu/Missions/spherex.html",
                      "timestampPolicy": "midpoint_of_SIA_UTC_MJD_bounds",
                      "alignmentChecks": alignment}
        coverage = common_coverage(selected, config)
        resolved = config.model_dump(mode="json", by_alias=True)
        # The identity covers the whole saved record: inputs, resolved settings,
        # implementation, and the search record (including which inputs were missing).
        identity = {"field": field.model_dump(), "config": config.model_dump(),
                    "grid": grid.model_dump(), "stretch": stretch.model_dump(),
                    "inputs": [{"observation": frame.observation.model_dump(),
                                "sourceSha256": frame.sha256, "processingVersion": frame.version}
                               for frame in selected], "provenance": provenance,
                    "coverage": coverage, "selectionDiagnostics": diagnostics}
        comparison_id = digest(canonical(identity))
        frames, assets = [], {}
        for frame in selected:
            observation = frame.observation
            frame_id = digest(canonical({"source": frame.sha256, "observation": observation.model_dump()}))
            png_name = f"{frame_id}.png"
            assets[png_name] = render(frame, stretch)
            assets[f"{frame_id}.fits"] = frame.raw
            frames.append(Frame(
                id=frame_id, observation_id=observation.observation_id,
                observed_at_utc=utc((observation.start_mjd + observation.end_mjd)/2),
                observation_start_utc=utc(observation.start_mjd),
                observation_end_utc=utc(observation.end_mjd),
                wavelength_um=frame.target_wavelength, bandwidth_um=frame.target_bandwidth,
                release=observation.release, source_url=observation.source_url,
                source_sha256=frame.sha256, processing_version=frame.version,
                image_url=f"/api/comparisons/{comparison_id}/assets/{png_name}",
                valid_fraction=frame.coverage["validFraction"], quality_flags=frame.quality,
                alignment=alignment.get(frame.sha256, {"status": "single_frame_not_applicable"})["status"],
                detector=observation.detector, coverage=frame.coverage))
        wave_low = min(frame.target_wavelength - frame.target_bandwidth/2 for frame in selected)
        wave_high = max(frame.target_wavelength + frame.target_bandwidth/2 for frame in selected)
        limitations = [
            "Quick-look visualization, not significant motion or variability measurement.",
            "Selection scope and completeness are recorded in diagnostics; bounded or incomplete samples do not prove absence or maximize the full-archive time baseline.",
            "No PSF homogenization or precision photometry; one exposure per frame.",
            "Only SOURCE/FULLSAMPLE flags allowed; ZODI subtracted, no frame-wise normalization.",
            "Coverage thresholds are provisional engineering choices; masked pixels are transparent and never filled. Check target-region validity before interpreting the centre.",
            "Alignment is WCS reprojection only; the stationary-source check labels frames and applies no correction.",
            "Wavelength labels describe the target; response varies spatially.",
            "PNG rows are flipped relative to FITS: fitsY=height-1-pngY (zero-based)."]
        if not complete:
            limitations.append("Archive search incomplete (see diagnostics.incompleteStages); some discovered exposures were not retrieved or not requested.")
        comparison = Comparison(
            id=comparison_id, field=field, wavelength_range_um=(wave_low, wave_high),
            stretch=stretch, grid=grid, frames=frames, config=resolved, provenance=provenance,
            limitations=limitations, coverage=coverage)
        response = ComparisonResponse(status="ready" if len(frames) > 1 else "single_epoch",
                                      comparison=comparison, diagnostics=diagnostics)
        deadline.check("publication")
        self.store.publish(response, assets)
        self.last_timings["totalSeconds"] = self.clock() - started
        return response
