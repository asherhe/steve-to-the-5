from dataclasses import dataclass, field as dataclass_field
from datetime import datetime
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True,
                              allow_inf_nan=False, validate_default=True, extra="forbid")


class ErrorBody(Model):
    code: str
    message: str


class FieldRequest(Model):
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    fov_arcmin: float = Field(default=6, ge=1, le=30)


class ProcessingConfig(Model):
    """Resolved quick-look settings. Every value is serialized into the manifest."""
    pixel_scale_arcsec: float = Field(default=6.2, gt=0)
    # Provisional engineering thresholds, not detection-significance criteria.
    # All three fractions use the full output grid (width*height) as denominator.
    min_geometric_coverage: float = Field(default=0.98, gt=0, le=1)
    min_valid_coverage: float = Field(default=0.80, gt=0, le=1)
    min_common_valid_coverage: float = Field(default=0.75, gt=0, le=1)
    target_region_radius_pixels: float = Field(default=5, gt=0, le=50)
    wavelength_tolerance_bandwidth: float = Field(default=0.25, gt=0, le=1)
    max_frames: int = Field(default=12, ge=2, le=12)
    max_candidates: int = Field(default=1000, ge=1, le=10000)
    max_cutouts: int = Field(default=120, ge=2, le=1000)
    # Check for a usable pair after two network waves, instead of waiting for 24 cutouts.
    batch_size: int = Field(default=6, ge=2, le=120)
    candidate_order_policy: Literal["footprint_similarity_then_time_detector"] = "footprint_similarity_then_time_detector"
    footprint_priority_cutouts: int = Field(default=24, ge=2, le=120)
    priority_min_baseline_days: float = Field(default=30, ge=0)
    max_download_bytes: int = Field(default=20_000_000, gt=0)
    timeout_seconds: float = Field(default=30, gt=0)
    attempts: int = Field(default=3, ge=1, le=5)
    backoff_base_seconds: float = Field(default=0.5, gt=0, le=10)
    backoff_max_seconds: float = Field(default=8, gt=0, le=60)
    build_deadline_seconds: float = Field(default=180, gt=0, le=900)
    concurrency: int = Field(default=3, ge=1, le=8)
    lower_percentile: float = Field(default=1, ge=0, lt=100)
    upper_percentile: float = Field(default=99.5, gt=0, le=100)
    asinh_softening: float = Field(default=0.1, gt=0)
    cutout_padding_arcsec: float = Field(default=20, ge=0, le=120)
    cutout_extent_policy: Literal["circumscribed_output_footprint_plus_padding"] = "circumscribed_output_footprint_plus_padding"
    coverage_policy: Literal["full_bilinear_support_over_all_output_pixels"] = "full_bilinear_support_over_all_output_pixels"
    alignment_policy: Literal["background_centroids_min3_mutual_within_2px_median_le_0.5px_target_excluded"] = "background_centroids_min3_mutual_within_2px_median_le_0.5px_target_excluded"
    mask_policy: Literal["allow_source_fullsample_finite_positive_variance"] = "allow_source_fullsample_finite_positive_variance"
    background_policy: Literal["subtract_zodi"] = "subtract_zodi"
    resampling: Literal["bilinear_with_full_valid_support"] = "bilinear_with_full_valid_support"


    @model_validator(mode="after")
    def check_percentiles(self):
        if self.lower_percentile >= self.upper_percentile:
            raise ValueError("Lower percentile must precede upper percentile")
        return self


class Observation(Model):
    observation_id: str
    detector: int = Field(ge=1, le=6)
    release: Literal["dr1", "qr3"]
    source_url: str
    start_mjd: float
    end_mjd: float
    # SIA scheduling hint only. Compatibility is always checked on actual pixels.
    footprint_icrs: str | None = None


    @model_validator(mode="after")
    def check_times(self):
        if self.end_mjd < self.start_mjd:
            raise ValueError("Observation end precedes its start")
        return self


class Grid(Model):
    width: int
    height: int
    pixel_scale_arcsec: float
    projection: Literal["TAN"] = "TAN"
    coordinate_frame: Literal["ICRS"] = "ICRS"
    row_origin: Literal["top"] = "top"
    fits_header: dict


class Stretch(Model):
    type: Literal["asinh"] = "asinh"
    lower: float
    upper: float
    softening: float
    unit: str = "MJy/sr"


class Frame(Model):
    id: str
    observation_id: str
    observed_at_utc: datetime
    observation_start_utc: datetime
    observation_end_utc: datetime
    wavelength_um: float
    bandwidth_um: float
    release: str
    image_url: str
    source_url: str
    source_sha256: str
    processing_version: str
    valid_fraction: float
    quality_flags: dict[str, int]
    alignment: str = "wcs_only_not_empirically_verified"
    # Added in manifest schema 2; absent (null) in schema-1 evidence.
    detector: int | None = None
    coverage: dict | None = None


Status = Literal["ready", "single_epoch", "no_coverage", "no_comparable_pair", "upstream_unavailable"]


class Comparison(Model):
    id: str
    field: FieldRequest
    wavelength_range_um: tuple[float, float]
    stretch: Stretch
    grid: Grid
    frames: list[Frame]
    # Resolved settings exactly as saved. Kept untyped so evidence written under an
    # earlier policy (different setting names) still validates and replays.
    config: dict
    provenance: dict
    limitations: list[str]
    coverage: dict | None = None


class ComparisonResponse(Model):
    status: Status
    comparison: Comparison | None = None
    diagnostics: dict = Field(default_factory=dict)


class BuildProgressResponse(Model):
    stage: Literal["discovery", "retrieval", "combination", "publication"]
    done: int = Field(ge=0)
    total: int = Field(ge=1)
    fraction: float = Field(ge=0, le=1)
    elapsed_seconds: float = Field(ge=0)


class BuildCancelledResponse(Model):
    cancelled: Literal[True] = True


@dataclass
class ArchiveError(Exception):
    code: str
    message: str
    http_status: int = 503
    # Internal context (failure category, attempts, build diagnostics). Never sent
    # in the public {code, message} error body.
    details: dict | None = None

    def __str__(self):
        return self.message


class Deadline:
    """Overall wall-clock budget for one build, on an injectable monotonic clock."""

    def __init__(self, seconds, clock=time.monotonic):
        self.seconds, self.clock = seconds, clock
        self.expires = clock() + seconds

    def remaining(self):
        return self.expires - self.clock()

    def expired(self):
        return self.remaining() <= 0

    def check(self, stage):
        if self.expired():
            raise ArchiveError(
                "PROCESSING_LIMIT",
                f"Build deadline of {self.seconds:g} s reached during {stage}; nothing was published",
                details={"limit": "build_deadline", "stage": stage})


@dataclass
class Discovery:
    observations: list
    # One entry per release query that failed: {release, category, code, attempts}.
    failures: list = dataclass_field(default_factory=list)


@dataclass
class Retrieval:
    # (Observation, bytes) in request order, successes only.
    cutouts: list
    # Structured failures in request order.
    failures: list = dataclass_field(default_factory=list)
