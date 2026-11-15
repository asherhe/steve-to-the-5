from concurrent.futures import ThreadPoolExecutor
import math
import time
from urllib.parse import urlencode

from astropy.io import ascii as ascii_tables

from services.archive.client import IRSAClient, failure_record
from services.archive.models import ArchiveError, Discovery, Retrieval
from services.archive.storage import digest

from .models import Exposure


IBE = "https://irsa.ipac.caltech.edu/ibe"
# (dataset, IBE path, release label). Single-exposure image sets holding W1 and W2
# across the cryogenic, post-cryogenic and reactivation phases.
DATASETS = (
    ("allsky_4band", "wise/allsky/4band_p1bm_frm", "wise-allsky"),
    ("cryo_3band", "wise/cryo_3band/3band_p1bm_frm", "wise-3band"),
    ("postcryo_2band", "wise/postcryo/2band_p1bm_frm", "wise-postcryo"),
    ("neowiser", "wise/neowiser/p1bm_frm", "neowise-r"),
)


def exposure_ref(exposure):
    return {"exposureId": exposure.exposure_id, "dataset": exposure.dataset}


def parse_search(text, dataset, path, release, band):
    """Rows of an IBE image-metadata table as exposures of one band."""
    if "QUERY_STATUS = 'OK'" not in text and 'QUERY_STATUS = "OK"' not in text:
        raise ValueError("Search did not report success")
    table = ascii_tables.read(text, format="ipac", guess=False)
    exposures = []
    for row in table:
        if int(row["band"]) != band:
            continue
        scan_id, scangrp, frame = str(row["scan_id"]), str(row["scangrp"]), int(row["frame_num"])
        mjd = float(row["mjd_obs"])
        if not math.isfinite(mjd):
            raise ValueError("Missing observation time")
        name = f"{scan_id}{frame:03d}"

        def optional(column, convert):
            if column not in table.colnames:
                return None
            value = row[column]
            try:
                value = convert(value)
            except (TypeError, ValueError):
                return None
            return value if math.isfinite(value) else None

        exposures.append(Exposure(
            exposure_id=f"{name}-w{band}", dataset=dataset, release=release, band=band,
            scan_id=scan_id, scangrp=scangrp, frame_num=frame, mjd_obs=mjd,
            source_url=f"{IBE}/data/{path}/{scangrp}/{scan_id}/{frame:03d}/{name}-w{band}-int-1b.fits",
            magzp=optional("magzp", float), qual_frame=optional("qual_frame", int)))
    return exposures


class WiseClient:
    evidence_kind = "real_archive"
    discovery_scope = "wise_neowise_single_exposures_all_mission_phases"

    def __init__(self, config, cache_dir, transport=None, sleep=time.sleep, **kwargs):
        self.config, self.cache_dir = config, cache_dir
        # The archive client supplies bounded streaming, retries, backoff and deadlines.
        self.http = IRSAClient(config, cache_dir, transport, sleep, **kwargs)
        # A search that hangs is tried twice at most, so an archive outage is reported
        # well inside the build deadline instead of using all of it.
        self.search_http = IRSAClient(
            config.model_copy(update={"timeout_seconds": config.search_timeout_seconds,
                                      "attempts": min(2, config.attempts)}),
            cache_dir, transport, sleep, **kwargs)

    def close(self):
        self.http.close()
        self.search_http.close()

    def _cached(self, folder, url, suffix, fetch, valid):
        """Return (bytes, attempts); zero attempts is a cache hit. Only validated
        responses are cached. The mission's image sets are final, so they do not change."""
        path = self.cache_dir / folder / f"{digest(url.encode())}.{suffix}"
        if path.exists():
            data = path.read_bytes()
            if valid(data):
                return data, 0
            path.unlink()
        data, attempts = fetch(url)
        if not valid(data):
            raise ArchiveError("UPSTREAM_DATA", "IRSA returned an unexpected response",
                               details={"category": "invalid_content", "attempts": attempts, "httpStatus": 200})
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f"{path.name}.{time.time_ns()}.tmp")
        try:
            temporary.write_bytes(data)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        return data, attempts

    def _discover_dataset(self, dataset, path, release, field, deadline):
        pad = self.config.cutout_padding_arcsec / 3600
        query = urlencode({"POS": f"{field.ra},{field.dec}",
                           "SIZE": round(field.fov_arcmin / 60 + 2 * pad, 6),
                           "INTERSECT": "COVERS", "where": f"band={field.band}"})
        def valid(data):
            try:
                parse_search(data.decode("utf-8", "replace"), dataset, path, release, field.band)
                return True
            except Exception:
                return False

        content, _ = self._cached(
            "search", f"{IBE}/search/{path}?{query}", "tbl",
            lambda url: self.search_http._get(url, deadline=deadline),
            valid)
        try:
            return parse_search(content.decode("utf-8", "replace"), dataset, path, release, field.band)
        except Exception as exc:
            raise ArchiveError("UPSTREAM_METADATA", "IRSA returned incomplete or unsupported image metadata",
                               details={"category": "invalid_metadata", "attempts": 1}) from exc

    def discover(self, field, deadline=None, on_done=None):
        """Query every mission phase. One phase failing does not discard the others.
        `on_done` is called as each phase answers, from worker threads."""
        def one(entry):
            try:
                return self._discover_dataset(*entry, field, deadline), None
            except ArchiveError as exc:
                return [], exc
            finally:
                if on_done is not None:
                    on_done()
        with ThreadPoolExecutor(max_workers=len(DATASETS)) as pool:
            results = list(pool.map(one, DATASETS))
        exposures, failures, errors = [], [], []
        for (dataset, *_), (found, error) in zip(DATASETS, results):
            exposures += found
            if error is not None:
                if error.code == "PROCESSING_LIMIT":
                    raise error
                errors.append(error)
                failures.append({"dataset": dataset, **failure_record(error)})
        if len(errors) == len(DATASETS):
            raise errors[0]
        unique = {e.exposure_id: e for e in exposures}
        result = sorted(unique.values(), key=lambda e: (e.mjd_obs, e.exposure_id))
        if len(result) > self.config.max_candidates:
            raise ArchiveError("PROCESSING_LIMIT", "Too many candidate exposures; narrow the requested field")
        return Discovery(result, failures)

    def cutout(self, exposure, field, size_deg, deadline=None):
        query = urlencode({"center": f"{field.ra},{field.dec}", "size": f"{size_deg}deg", "gzip": "false"})
        return self._cached("cutouts", f"{exposure.source_url}?{query}", "fits",
                            lambda url: self.http._get(url, deadline=deadline),
                            lambda data: data.startswith(b"SIMPLE"))

    def retrieve(self, exposures, field, size_deg, deadline=None, on_done=None):
        """Fetch cutouts. Successes are kept when other downloads fail.
        `on_done` is called once per exposure settled, from worker threads."""
        def one(exposure):
            try:
                return exposure, self.cutout(exposure, field, size_deg, deadline)[0], None
            except ArchiveError as exc:
                return exposure, None, {**exposure_ref(exposure), **failure_record(exc)}

        def first_round(exposure):
            result = one(exposure)
            # A rate-limited download is settled by the second round below.
            if on_done is not None and (result[2] is None or result[2]["category"] != "transient_http"):
                on_done()
            return result
        with ThreadPoolExecutor(max_workers=self.config.concurrency) as pool:
            results = list(pool.map(first_round, exposures))
        # IRSA answers 503 when requests arrive too quickly. Those downloads get one
        # more round, one at a time, so a build does not depend on the rate limiter.
        for index, (exposure, _, failure) in enumerate(results):
            if failure is not None and failure["category"] == "transient_http":
                if deadline is None or not deadline.expired():
                    results[index] = one(exposure)
                if on_done is not None:
                    on_done()
        return Retrieval([(e, data) for e, data, failure in results if failure is None],
                         [failure for _, _, failure in results if failure is not None])
