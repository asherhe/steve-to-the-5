"""Find original WISE exposures through unWISE's small, static input tables.

No coadd pixels are displayed. This deliberately selects a conservative subset;
downloaded L1b WCS, coverage, dates and alignment still determine usable frames.
"""
from dataclasses import dataclass, field as data_field
from io import BytesIO
import re

from astropy.io import fits
import numpy as np

from services.archive.models import ArchiveError, Discovery
from services.archive.storage import digest
from .client import DATASETS, IBE, WiseClient
from .models import Exposure

TILES_URL = "https://unwise.me/data/allwise/unwise-coadds/fulldepth/tiles.fits"
INDEX_ROOT = "https://unwise.me/data/neo11/unwise-coadds/fulldepth"
SCOPE = "unwise_neo11_nearest_tile_central_exposure_subset"


@dataclass
class IndexedDiscovery(Discovery):
    metadata: list = data_field(default_factory=list)
    assets: dict = data_field(default_factory=dict)
    scope: str = SCOPE


def table(raw, columns):
    with fits.open(BytesIO(raw), memmap=False) as hdus:
        data = hdus[1].data
        if data is None or not set(columns).issubset(data.names):
            raise ValueError("Unsupported unWISE metadata table")
        return data.copy()


def separation(ra, dec, field):
    # Spherical distance handles RA wrap and polar fields.
    ra, dec = np.deg2rad(ra), np.deg2rad(dec)
    a, d = np.deg2rad([field.ra, field.dec])
    sine = np.sin((dec - d) / 2)**2 + np.cos(dec) * np.cos(d) * np.sin((ra - a) / 2)**2
    return np.rad2deg(2 * np.arcsin(np.sqrt(np.clip(sine, 0, 1))))


def nearest_tile(raw, field):
    rows = table(raw, ["coadd_id", "ra", "dec"])
    distance = separation(rows["ra"], rows["dec"], field)
    if not len(rows) or not np.isfinite(distance).all():
        raise ValueError("Invalid tile coordinates")
    tile = str(rows[np.argmin(distance)]["coadd_id"]).strip()
    if not re.fullmatch(r"\d{4}[pm]\d{3}", tile):
        raise ValueError("Invalid tile identity")
    return tile


def exposures_from_index(raw, field, config):
    rows = table(raw, ["scan_id", "frame_num", "band", "ra", "dec", "mjd", "scangrp",
                       "qual_frame", "included", "use", "intfn"])
    distance = separation(rows["ra"], rows["dec"], field)
    selected = rows[(distance <= config.index_center_radius_deg) & (rows["band"] == field.band)
                    & (rows["included"] > 0) & (rows["use"] > 0)
                    & (rows["qual_frame"] >= config.min_qual_frame)]
    found = {}
    for row in selected:
        scan, group, frame = str(row["scan_id"]).strip(), str(row["scangrp"]).strip(), int(row["frame_num"])
        mjd = float(row["mjd"])
        if (not re.fullmatch(r"\d{5}[a-z]", scan) or group != scan[-2:]
                or not 0 <= frame <= 999 or not np.isfinite(mjd)):
            raise ValueError("Invalid exposure identity or date")
        suffix = f"{group}/{scan}/{frame:03d}/{scan}{frame:03d}-w{field.band}-int-1b.fits"
        # Recognize only known archive datasets; never follow a URL from the table.
        matches = [(dataset, path, release) for dataset, path, release in DATASETS
                   if str(row["intfn"]).endswith(f"/{path.removeprefix('wise/')}/{suffix}")]
        if len(matches) != 1:
            raise ValueError("Unsupported original-image path")
        dataset, path, release = matches[0]
        item = Exposure(exposure_id=f"{scan}{frame:03d}-w{field.band}", dataset=dataset,
                        release=release, band=field.band, scan_id=scan, scangrp=group,
                        frame_num=frame, mjd_obs=mjd, qual_frame=int(row["qual_frame"]),
                        source_url=f"{IBE}/data/{path}/{suffix}")
        if item.exposure_id in found and found[item.exposure_id] != item:
            raise ValueError("Conflicting exposure metadata")
        found[item.exposure_id] = item
    return sorted(found.values(), key=lambda e: (e.mjd_obs, e.exposure_id))


class IndexedWiseClient(WiseClient):
    discovery_scope = "unwise_neo11_index_then_ibe"

    def discover(self, field, deadline=None, on_done=None):
        def fetch(url, validate):
            def valid(raw):
                try:
                    validate(raw)
                    return True
                except (ValueError, TypeError, KeyError, IndexError, OSError):
                    return False
            result = self._cached("index", url, "fits",
                                  lambda u: self.http._get(u, deadline=deadline), valid)[0]
            if on_done:
                on_done()
            return result

        try:
            catalog = fetch(TILES_URL, lambda raw: nearest_tile(raw, field))
            tile = nearest_tile(catalog, field)
            url = f"{INDEX_ROOT}/{tile[:3]}/{tile}/unwise-{tile}-w{field.band}-frames.fits"
            raw = fetch(url, lambda data: exposures_from_index(data, field, self.config))
            exposures = exposures_from_index(raw, field, self.config)
            if not exposures or len(exposures) > self.config.max_candidates:
                raise ValueError("No bounded central exposure subset")
            metadata = [{"url": u, "sha256": digest(data), "asset": f"{digest(data)}.fits"}
                        for u, data in [(TILES_URL, catalog), (url, raw)]]
            return IndexedDiscovery(exposures, metadata=metadata,
                                    assets={f"{digest(data)}.fits": data for data in (catalog, raw)})
        except ArchiveError as exc:
            if exc.code in ("BUILD_CANCELLED", "PROCESSING_LIMIT"):
                raise
        except (ValueError, TypeError, KeyError, IndexError, OSError):
            pass
        # Preserve the full archive search when static metadata is unavailable or
        # cannot represent the requested position. Never turn a failure into no coverage.
        return super().discover(field, deadline, on_done)
