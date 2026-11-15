from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import random
import re
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

from astropy.io.votable import parse
import httpx

from .models import ArchiveError, Discovery, Observation, Retrieval
from .storage import digest


# Retried with backoff. Other statuses are answered once and reported.
TRANSIENT_STATUS = (502, 503, 504)


def observation_ref(observation):
    return {"observationId": observation.observation_id, "detector": observation.detector,
            "release": observation.release}


def failure_record(exc):
    details = exc.details or {}
    record = {"category": details.get("category", "other"), "code": exc.code,
              "attempts": details.get("attempts", 0)}
    if details.get("httpStatus") is not None:
        record["httpStatus"] = details["httpStatus"]
    return record


class IRSAClient:
    evidence_kind = "real_archive"
    discovery_scope = "wide_survey_dr1_qr3"

    endpoint = "https://irsa.ipac.caltech.edu/SIA"
    releases = ("dr1", "qr3")

    def __init__(self, config, cache_dir, transport=None, sleep=time.sleep, jitter=random.random,
                 search_attempts=None, cutout_attempts=None):
        """`search_attempts` and `cutout_attempts` raise the retry count for those requests
        above `config.attempts` without changing the resolved config saved in manifests.
        IRSA answers a share of requests with an instant 502 or 503, so retrying is cheap."""
        self.search_attempts, self.cutout_attempts = search_attempts, cutout_attempts
        self.config = config
        self.cache_dir = cache_dir
        self.transport = transport
        self.sleep, self.jitter = sleep, jitter

    @staticmethod
    def _failure(code, message, category, attempts, status=None):
        return ArchiveError(code, message, details={
            "category": category, "attempts": attempts, "httpStatus": status})

    def _get(self, url, params=None, deadline=None, attempts=None):
        """Return (content, attempts). Failures carry category and attempt count."""
        limit = max(attempts or 0, self.config.attempts)
        attempt = 0
        while True:
            if deadline is not None and deadline.expired():
                raise self._failure("PROCESSING_LIMIT", "Build deadline reached before the archive request completed",
                                    "deadline", attempt)
            attempt += 1
            timeout = self.config.timeout_seconds
            if deadline is not None:
                timeout = max(0.001, min(timeout, deadline.remaining()))
            status = None
            try:
                with httpx.Client(timeout=timeout, transport=self.transport,
                                  follow_redirects=False) as client:
                    with client.stream("GET", url, params=params) as response:
                        status = response.status_code
                        if status == 200:
                            chunks, size = [], 0
                            for chunk in response.iter_bytes():
                                size += len(chunk)
                                if size > self.config.max_download_bytes:
                                    raise self._failure("PROCESSING_LIMIT", "Archive response exceeded byte limit",
                                                        "byte_limit", attempt, status)
                                if deadline is not None and deadline.expired():
                                    raise self._failure("PROCESSING_LIMIT", "Build deadline reached during download",
                                                        "deadline", attempt, status)
                                chunks.append(chunk)
                            return b"".join(chunks), attempt
                if status not in TRANSIENT_STATUS:
                    raise self._failure("UPSTREAM_ERROR", f"IRSA answered HTTP {status}",
                                        "http_rejected" if status < 500 else "http_server_error", attempt, status)
                category = "transient_http"
            except httpx.TimeoutException:
                category = "timeout"
            except httpx.TransportError:
                category = "transport"
            if attempt >= limit:
                raise self._failure("UPSTREAM_ERROR", "IRSA request failed after bounded retries",
                                    category, attempt, status)
            # Exponential backoff with jitter in [0.5, 1.0) of the step, never
            # sleeping past the build deadline.
            delay = min(self.config.backoff_max_seconds,
                        self.config.backoff_base_seconds * 2 ** (attempt - 1)) * (0.5 + 0.5 * self.jitter())
            if deadline is not None:
                delay = min(delay, max(0.0, deadline.remaining()))
            self.sleep(delay)

    def _discover_release(self, release, field, deadline):
        radius_deg = field.fov_arcmin / 60 / 2 * 2**0.5
        content, _ = self._get(self.endpoint, {
            "COLLECTION": f"spherex_{release}",
            "POS": f"CIRCLE {field.ra} {field.dec} {radius_deg}",
            "MAXREC": self.config.max_candidates + 1,
        }, deadline, attempts=self.search_attempts)
        observations = []
        try:
            document = parse(BytesIO(content))
            if any(info.value in ("ERROR", "OVERFLOW") for resource in document.resources
                   for info in resource.infos):
                raise ArchiveError("PROCESSING_LIMIT", "SIA query returned ERROR or OVERFLOW; results are incomplete")
            tables = list(document.iter_tables())
            if not tables:
                raise ValueError("Missing SIA table")
            table = tables[0].to_table(use_names_over_ids=True)
            if len(table) > self.config.max_candidates:
                raise ArchiveError("PROCESSING_LIMIT", "Too many candidates; narrow the requested field")
            for row in table:
                url = str(row["access_url"])
                self._source_url(url)
                band = str(row["energy_bandpassname"])
                detector = re.search(r"D([1-6])", band)
                if detector is None:
                    raise ValueError("Missing detector metadata")
                observations.append(Observation(
                    observation_id=str(row["obs_id"]), detector=int(detector[1]),
                    release=release, source_url=url,
                    start_mjd=float(row["t_min"]), end_mjd=float(row["t_max"])))
        except ArchiveError:
            raise
        except Exception as exc:
            raise ArchiveError("UPSTREAM_METADATA", "IRSA returned incomplete or unsupported SIA metadata",
                               details={"category": "invalid_metadata", "attempts": 1}) from exc
        return observations

    def discover(self, field, deadline=None):
        """Query every release at once. One release failing does not discard the other."""
        def one(release):
            try:
                return self._discover_release(release, field, deadline), None
            except ArchiveError as exc:
                return [], exc
        with ThreadPoolExecutor(max_workers=len(self.releases)) as pool:
            results = list(pool.map(one, self.releases))
        observations, failures, errors = [], [], []
        for release, (found, exc) in zip(self.releases, results):
            observations += found
            if exc is not None:
                if exc.code == "PROCESSING_LIMIT":
                    raise exc
                errors.append(exc)
                failures.append({"release": release, **failure_record(exc)})
        if len(errors) == len(self.releases):
            raise errors[0]
        unique = {(o.observation_id, o.detector): o for o in observations}
        result = sorted(unique.values(), key=lambda o: (o.start_mjd, o.detector, o.observation_id))
        if len(result) > self.config.max_candidates:
            raise ArchiveError("PROCESSING_LIMIT", "Too many candidates; narrow the requested field")
        return Discovery(result, failures)

    @staticmethod
    def _source_url(url):
        parts = urlsplit(url)
        if (parts.scheme != "https" or parts.netloc != "irsa.ipac.caltech.edu"
                or not parts.path.startswith("/ibe/data/spherex/") or parts.query or parts.fragment):
            raise ArchiveError("UPSTREAM_METADATA", "Unsupported archive source URL",
                               details={"category": "invalid_metadata", "attempts": 0})
        return parts

    def cutout(self, observation, field, size_deg, deadline=None):
        """Return (bytes, attempts). Zero attempts means a cache hit."""
        parts = self._source_url(observation.source_url)
        query = urlencode({"center": f"{field.ra},{field.dec}d", "size": size_deg})
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))
        key = digest(url.encode())
        path = self.cache_dir / f"{key}.fits"
        if path.exists():
            return path.read_bytes(), 0
        data, attempts = self._get(url, deadline=deadline, attempts=self.cutout_attempts)
        # Never cache an HTML error page as a successful FITS response.
        if not data.startswith(b"SIMPLE"):
            raise self._failure("UPSTREAM_DATA", "IRSA did not return an uncompressed FITS cutout",
                                "invalid_content", attempts, 200)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_dir / f"{key}.{time.time_ns()}.tmp"
        try:
            temporary.write_bytes(data)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        return data, attempts

    def retrieve(self, observations, field, size_deg, deadline=None):
        """Fetch a batch. Successes are kept when other downloads fail."""
        def one(observation):
            try:
                return observation, self.cutout(observation, field, size_deg, deadline)[0], None
            except ArchiveError as exc:
                return observation, None, {**observation_ref(observation), **failure_record(exc)}
        with ThreadPoolExecutor(max_workers=self.config.concurrency) as pool:
            # map() yields in request order regardless of completion order.
            results = list(pool.map(one, observations))
        return Retrieval([(o, data) for o, data, failure in results if failure is None],
                         [failure for _, _, failure in results if failure is not None])
