"""Immutable local evidence store. Deploy on durable storage, not an ephemeral disk."""
import hashlib
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from .supabase import ApiError


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


class SpectralStore:
    def __init__(self, root):
        self.root = Path(root)

    def _path(self, identifier, suffix):
        if not re.fullmatch(r"[a-f0-9]{64}", identifier):
            raise ApiError(404, "evidence_not_found", "Spectral evidence not found.")
        return self.root / (identifier + suffix)

    def put(self, content, suffix):
        identifier = hashlib.sha256(content).hexdigest()
        destination = self._path(identifier, suffix)
        self.root.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.read_bytes() != content:
                raise ApiError(500, "evidence_corrupt", "Saved spectral evidence failed its integrity check.")
            return identifier
        name = self.root / f"pending-{uuid4().hex}"
        try:
            with name.open("xb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            # Atomic no-overwrite publication. Concurrent identical writers are safe.
            try:
                os.link(name, destination)
            except FileExistsError:
                if destination.read_bytes() != content:
                    raise ApiError(500, "evidence_corrupt", "Saved spectral evidence failed its integrity check.")
        finally:
            Path(name).unlink(missing_ok=True)
        return identifier

    def read(self, identifier, suffix):
        try:
            content = self._path(identifier, suffix).read_bytes()
        except FileNotFoundError:
            raise ApiError(404, "evidence_not_found", "Spectral evidence not found.")
        if hashlib.sha256(content).hexdigest() != identifier:
            raise ApiError(500, "evidence_corrupt", "Saved spectral evidence failed its integrity check.")
        return content

    def save(self, report, frames, ra, dec):
        for frame in frames:
            self.put(frame.fits, ".fits")
        snapshot = report.model_dump(mode="json")
        snapshot.update(evidenceId=None, manifestUrl=None)
        for sample in snapshot["samples"]:
            sample["assetUrl"] = None
        payload = {"schemaVersion": "spectral-evidence-v1", "ra": ra, "dec": dec,
                   "coordinateFrame": "ICRS", "report": snapshot}
        identifier = self.put(canonical(payload), ".json")
        report.evidenceId = identifier
        report.manifestUrl = f"/api/findings/spectral/{identifier}"
        for sample in report.samples:
            sample.assetUrl = f"/api/findings/spectral/{identifier}/assets/{sample.sourceSha256}.fits"
        return report

    def asset(self, identifier, sha):
        payload = json.loads(self.read(identifier, ".json"))
        if not any(s["sourceSha256"] == sha for s in payload["report"]["samples"]):
            raise ApiError(404, "evidence_not_found", "Spectral evidence not found.")
        return self.read(sha, ".fits")
