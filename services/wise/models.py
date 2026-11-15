from typing import Literal

from pydantic import Field, model_validator

from services.archive.models import Model


# Isophotal wavelength and bandwidth (µm), Jarrett et al. 2011, ApJ 735, 112, Table 1.
BANDS = {1: {"name": "W1", "wavelength_um": 3.3526, "bandwidth_um": 0.6626},
         2: {"name": "W2", "wavelength_um": 4.6028, "bandwidth_um": 1.0423}}


class WiseFieldRequest(Model):
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    # Every exposure of a visit is downloaded at full resolution, so the field is kept
    # small: at 12 arcmin a build already moves about 60 MB from the archive.
    fov_arcmin: float = Field(default=6, ge=1, le=12)
    band: Literal[1, 2] = 2


class WiseConfig(Model):
    """Resolved quick-look settings. Every value is serialized into the manifest."""
    index_release: Literal["unwise-neo11"] = "unwise-neo11"
    index_center_radius_deg: float = Field(default=0.25, gt=0, le=0.25)
    pixel_scale_arcsec: float = Field(default=2.75, gt=0)
    # A new epoch starts after this gap, or once an epoch would span more than the limit.
    epoch_gap_days: float = Field(default=10, gt=0)
    max_epoch_span_days: float = Field(default=15, gt=0)
    # A few visits spread over the whole baseline are enough to see motion, and each
    # one costs several downloads. The first and last visit are always among them.
    max_epochs: int = Field(default=6, ge=2, le=40)
    exposures_per_epoch: int = Field(default=5, ge=1, le=12)
    min_exposures_per_epoch: int = Field(default=2, ge=1, le=12)
    # A pixel is valid when this many exposures cover it (or all of them, if fewer).
    min_pixel_exposures: int = Field(default=2, ge=1, le=12)
    min_qual_frame: int = Field(default=1, ge=0, le=10)
    # Provisional engineering thresholds over all output grid pixels.
    min_valid_coverage: float = Field(default=0.80, gt=0, le=1)
    target_region_radius_pixels: float = Field(default=5, gt=0, le=50)
    max_candidates: int = Field(default=20000, ge=1, le=100000)
    max_download_bytes: int = Field(default=20_000_000, gt=0)
    timeout_seconds: float = Field(default=30, gt=0)
    # Healthy image-metadata searches can take 30–80 seconds. Do not cut them off early.
    search_timeout_seconds: float = Field(default=100, gt=0)
    attempts: int = Field(default=3, ge=1, le=5)
    backoff_base_seconds: float = Field(default=0.5, gt=0, le=10)
    backoff_max_seconds: float = Field(default=8, gt=0, le=60)
    build_deadline_seconds: float = Field(default=360, gt=0, le=900)
    concurrency: int = Field(default=3, ge=1, le=8)
    lower_percentile: float = Field(default=3, ge=0, lt=100)
    upper_percentile: float = Field(default=99.7, gt=0, le=100)
    asinh_softening: float = Field(default=0.25, gt=0)
    cutout_padding_arcsec: float = Field(default=20, ge=0, le=120)
    epoch_policy: Literal["split_on_gap_or_max_span"] = "split_on_gap_or_max_span"
    epoch_eligibility_policy: Literal["at_least_min_exposures_per_epoch"] = "at_least_min_exposures_per_epoch"
    epoch_sampling_policy: Literal["evenly_spaced_including_first_and_last"] = "evenly_spaced_including_first_and_last"
    exposure_selection_policy: Literal["evenly_spaced_in_time_within_epoch"] = "evenly_spaced_in_time_within_epoch"
    combine_policy: Literal["per_pixel_median_of_background_subtracted_exposures"] = "per_pixel_median_of_background_subtracted_exposures"
    background_policy: Literal["subtract_per_exposure_median_of_finite_cutout_pixels"] = "subtract_per_exposure_median_of_finite_cutout_pixels"
    mask_policy: Literal["finite_pixels_only_no_bitmask_no_uncertainty"] = "finite_pixels_only_no_bitmask_no_uncertainty"
    photometric_policy: Literal["native_dn_no_zero_point_scaling"] = "native_dn_no_zero_point_scaling"
    alignment_policy: Literal["background_centroids_min3_mutual_within_2px_median_le_0.5px_target_excluded"] = "background_centroids_min3_mutual_within_2px_median_le_0.5px_target_excluded"
    timestamp_policy: Literal["midpoint_of_first_and_last_contributing_mid_exposure_times"] = "midpoint_of_first_and_last_contributing_mid_exposure_times"
    resampling: Literal["bilinear_with_full_geometric_support"] = "bilinear_with_full_geometric_support"

    @model_validator(mode="after")
    def check_values(self):
        if self.lower_percentile >= self.upper_percentile:
            raise ValueError("Lower percentile must precede upper percentile")
        if self.min_exposures_per_epoch > self.exposures_per_epoch:
            raise ValueError("Minimum exposures per epoch exceeds the number requested")
        return self


class Exposure(Model):
    """One dated single-exposure (Level 1b) frame."""
    exposure_id: str
    dataset: str
    release: str
    band: int
    scan_id: str
    scangrp: str
    frame_num: int
    # Mid-point of the frame observation, UTC (IRSA `mjd_obs`).
    mjd_obs: float
    source_url: str
    magzp: float | None = None
    qual_frame: int | None = None
