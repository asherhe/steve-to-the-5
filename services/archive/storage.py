import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Protocol

from .models import ArchiveError, ComparisonResponse


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(content: bytes):
    return hashlib.sha256(content).hexdigest()


class EvidenceStore(Protocol):
    def publish(self, response: ComparisonResponse, assets: dict[str, bytes]) -> None: ...
    def load(self, comparison_id: str) -> ComparisonResponse: ...
    def load_raw(self, comparison_id: str) -> dict: ...
    def asset(self, comparison_id: str, name: str) -> tuple[bytes, str]: ...


class LocalStore:
    """Immutable blobs; an atomic manifest is the publication/commit point."""

    def __init__(self, root: Path, examples: Path | None = None):
        self.root = Path(root)
        self.examples = tuple(Path(item) for item in examples) if isinstance(examples, (list, tuple)) else ((Path(examples),) if examples is not None else ())

    def _manifest(self, comparison_id):
        if not re.fullmatch(r"[a-f0-9]{64}", comparison_id):
            raise ArchiveError("NOT_FOUND", "Unknown comparison ID", 404)
        return self.root / "manifests" / f"{comparison_id}.json"

    def _write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            try:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        try:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != data:
                    raise ArchiveError("EVIDENCE_CONFLICT", "Refusing conflicting evidence", 409)
            if os.name != "nt":
                directory = os.open(path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)

    def publish(self, response, assets):
        if response.comparison is None:
            raise ValueError("Cannot publish empty evidence")
        manifest = self._manifest(response.comparison.id)
        references = {}
        for name, data in assets.items():
            if not re.fullmatch(r"[a-f0-9]{64}\.(png|fits)", name):
                raise ValueError("Invalid asset name")
            sha = digest(data)
            self._write(self.root / "blobs" / sha, data)
            references[name] = sha
        record = {"response": response.model_dump(mode="json", by_alias=True),
                  "assets": references}
        record["manifestSha256"] = digest(canonical(record))
        self._write(manifest, canonical(record))

    def _record(self, comparison_id, verify_assets=True):
        path = self._manifest(comparison_id)
        root = self.root
        if not path.exists():
            for example in self.examples:
                candidate = example / "manifests" / path.name
                if candidate.exists():
                    root, path = example, candidate
                    break
        if not path.exists():
            raise ArchiveError("NOT_FOUND", "Unknown comparison ID", 404)
        try:
            record = json.loads(path.read_bytes())
            if not isinstance(record, dict):
                raise ValueError("Manifest must be an object")
            expected = record.pop("manifestSha256")
            if digest(canonical(record)) != expected:
                raise ValueError("Manifest checksum mismatch")
            response = ComparisonResponse.model_validate(record["response"])
            if response.comparison is None or response.comparison.id != comparison_id:
                raise ValueError("Wrong manifest identity")
            for sha in record["assets"].values():
                if not re.fullmatch(r"[a-f0-9]{64}", sha):
                    raise ValueError("Invalid blob identity")
                if verify_assets:
                    content = (root / "blobs" / sha).read_bytes()
                    if digest(content) != sha:
                        raise ValueError("Invalid blob content")
            return record, root
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ArchiveError("EVIDENCE_CORRUPT", "Saved evidence is missing or corrupt", 500) from exc

    def matching_recorded_field(self, field, config_values=None):
        """Instant replay only for the exact reviewed field; other fields still query IRSA."""
        for example in self.examples:
            for path in (example / "manifests").glob("*.json"):
                response = self._record(path.stem, verify_assets=False)[0]["response"]
                saved = response.get("comparison") or {}
                if any(saved.get("config", {}).get(key) != value for key, value in (config_values or {}).items()):
                    continue
                previous = saved.get("field") or {}
                if (abs(previous.get("ra", -999) - field.ra) < 1e-8 and
                    abs(previous.get("dec", -999) - field.dec) < 1e-8 and
                    abs(previous.get("fovArcmin", -999) - field.fov_arcmin) < 1e-8):
                    return self.load_raw(path.stem)
        return None

    def load(self, comparison_id):
        return ComparisonResponse.model_validate(self.load_raw(comparison_id))

    def load_raw(self, comparison_id):
        """The saved response exactly as written, after integrity checks. Replay
        serves this so evidence from an earlier manifest schema is never reshaped
        by current models or defaults."""
        record, _ = self._record(comparison_id)
        return record["response"]

    def asset(self, comparison_id, name):
        # Replay verifies the complete evidence set once. Serving each PNG should
        # hash that PNG, not reread every original FITS in the entire comparison.
        record, root = self._record(comparison_id, verify_assets=False)
        sha = record["assets"].get(name)
        if sha is None:
            raise ArchiveError("NOT_FOUND", "Unknown asset", 404)
        try:
            content = (root / "blobs" / sha).read_bytes()
            if digest(content) != sha:
                raise ValueError("Invalid blob content")
        except (OSError, ValueError) as exc:
            raise ArchiveError("EVIDENCE_CORRUPT", "Saved evidence is missing or corrupt", 500) from exc
        return content, sha
