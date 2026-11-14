"""Deterministic synthetic exposures for offline integration and regression checks."""
from io import BytesIO
import json
from pathlib import Path

from astropy.io import fits
from astropy.wcs import WCS
import numpy as np

from .models import ArchiveError, Discovery, FieldRequest, Observation, Retrieval
from .storage import digest


def synthetic_cutout(shift=0, wavelength=1.25, rotation=0, bad=False, slope=0.00001, n=90,
                     bad_block=None, star_offset=0.0):
    """n is the detector-aligned side in pixels; bad_block=(y0, y1, x0, x1) flags a region;
    star_offset shifts only the background stars in x, imitating a wrong WCS."""
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [10, 20]
    wcs.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    angle = np.deg2rad(rotation)
    scale = 6.2/3600
    wcs.wcs.cd = np.array([[-np.cos(angle), np.sin(angle)],
                          [np.sin(angle), np.cos(angle)]]) * scale
    header = wcs.to_header()
    header["BUNIT"] = "MJy/sr"
    # Linear synthetic spectral axes deliberately differ from real WAVE-TAB data.
    for key, value in {"WCSAXESW": 2, "CTYPE1W": "WAVE", "CTYPE2W": "WAVE",
                       "CUNIT1W": "um", "CUNIT2W": "um", "CRPIX1W": (n + 1) / 2,
                       "CRPIX2W": (n + 1) / 2, "CRVAL1W": wavelength, "CRVAL2W": 0.03,
                       "CDELT1W": slope, "CDELT2W": 1e-9}.items():
        header[key] = value
    yy, xx = np.indices((n,n))
    data = np.full((n,n), 5.)
    # These positions describe stars on a fixed sky, even with a rotated detector.
    base = WCS(naxis=2)
    base.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    base.wcs.crval = [10,20]
    base.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    base.wcs.cdelt = [-scale,scale]
    for dx, dy in [(-17.5+star_offset,-17.5), (15.5+star_offset,-17.5), (-17.5+star_offset,15.5),
                   (15.5+star_offset,15.5), (shift-0.5,-0.5)]:
        ra, dec = base.pixel_to_world_values((n - 1) / 2 + dx, (n - 1) / 2 + dy)
        nx, ny = wcs.world_to_pixel_values(ra,dec)
        data += 20*np.exp(-((xx-nx)**2+(yy-ny)**2)/2)
    flags = np.full((n,n), 1<<21, dtype=np.int32)
    if bad:
        flags[:] |= 1<<6
    if bad_block:
        y0, y1, x0, x1 = bad_block
        flags[y0:y1, x0:x1] |= 1<<6
    flags_hdu = fits.ImageHDU(flags, name="FLAGS")
    flags_hdu.header["MSKN0021"] = "SOURCE"
    flags_hdu.header["MSKN0012"] = "FULLSAMPLE"
    flags_hdu.header["MSKN0006"] = "NONFUNC"
    primary = fits.PrimaryHDU()
    primary.header["VERSION"] = "synthetic-v1"
    output = BytesIO()
    fits.HDUList([primary, fits.ImageHDU(data.astype('float32'), header, name="IMAGE"),
                  flags_hdu, fits.ImageHDU(np.ones((n,n)), name="VARIANCE"),
                  fits.ImageHDU(np.full((n,n),5.), name="ZODI")]).writeto(output)
    return output.getvalue()


class FixtureClient:
    evidence_kind = "synthetic_fixture"
    discovery_scope = "synthetic_fixture_inputs"

    def __init__(self, cutouts=None):
        self.cutouts = cutouts if cutouts is not None else [synthetic_cutout(), synthetic_cutout(shift=2)]

    def discover(self, field, deadline=None):
        return Discovery([Observation(observationId=f"synthetic-{i}", detector=2, release="dr1",
                                      sourceUrl=f"https://example.invalid/synthetic-{i}.fits",
                                      startMjd=61000+i*180, endMjd=61000+i*180+0.001)
                          for i in range(len(self.cutouts))])

    def retrieve(self, observations, field, size_deg=None, deadline=None):
        """A cutout entry that is an ArchiveError simulates that download failing."""
        cutouts, failures = [], []
        for observation in observations:
            item = self.cutouts[int(observation.observation_id.split("-")[-1])]
            if isinstance(item, ArchiveError):
                failures.append({"observationId": observation.observation_id,
                                 "detector": observation.detector, "release": observation.release,
                                 "category": (item.details or {}).get("category", "transient_http"),
                                 "code": item.code, "attempts": (item.details or {}).get("attempts", 1)})
            else:
                cutouts.append((observation, item))
        return Retrieval(cutouts, failures)


class RecordedClient:
    """Replay retained real inputs; never describe them as a fresh archive query."""

    evidence_kind = "saved_real_example"
    discovery_scope = "curated_recorded_subset_not_exhaustive"

    def __init__(self, record_path):
        record_path = Path(record_path)
        self.record = json.loads(record_path.read_text())
        self.base = record_path.parent
        self.entries = self.record["sources"]

    def discover(self, field, deadline=None):
        if field != FieldRequest.model_validate(self.record["field"]):
            raise ArchiveError("INVALID_REQUEST", "Saved example is available only at its recorded field", 422)
        return Discovery([Observation.model_validate(entry["observation"]) for entry in self.entries])

    def retrieve(self, observations, field, size_deg=None, deadline=None):
        result = []
        by_id = {(entry["observation"]["observationId"], entry["observation"]["detector"]): entry
                 for entry in self.entries}
        for observation in observations:
            entry = by_id[(observation.observation_id, observation.detector)]
            path = (self.base / entry["path"]).resolve()
            if not path.is_relative_to(self.base.resolve()):
                raise ArchiveError("INVALID_FIXTURE", "Recorded input path escapes fixture directory", 422)
            data = path.read_bytes()
            if digest(data) != entry["sha256"]:
                raise ArchiveError("EVIDENCE_CORRUPT", "Recorded source hash mismatch", 500)
            result.append((observation, data))
        return Retrieval(result)
