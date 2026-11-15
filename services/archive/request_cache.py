"""Mutable request-to-evidence index; the referenced evidence remains immutable.

Only successful pairs are indexed. A caller can explicitly refresh discovery. Keys
include the exact field, survey/band, resolved policy and implementation, so no
nearby field or obsolete processing result can silently stand in for a request.
"""
import json
import os
from pathlib import Path
import tempfile

from .storage import canonical, digest


class RequestCache:
    def __init__(self, pipeline, implementation):
        self.store = pipeline.store
        self.root = Path(self.store.root) / "requests" if hasattr(self.store, "root") else None
        self.policy = {"config": pipeline.config.model_dump(mode="json"),
                       "implementation": implementation,
                       "kind": getattr(pipeline.client, "evidence_kind", None),
                       "scope": getattr(pipeline.client, "discovery_scope", None)}

    def key(self, field):
        return digest(canonical({"field": field.model_dump(mode="json"), **self.policy}))

    def get(self, field):
        if self.root is None:
            return None
        key = self.key(field)
        try:
            entry = json.loads((self.root / f"{key}.json").read_bytes())
            if not isinstance(entry, dict):
                return None
            checksum = entry.pop("sha256")
            if entry["key"] != key or digest(canonical(entry)) != checksum:
                return None
        except (OSError, ValueError, KeyError, TypeError):
            return None
        # Missing/corrupt evidence is an explicit error, never repaired by refetching.
        return self.store.load_raw(entry["comparisonId"])

    def put(self, field, response):
        if self.root is None or response.status != "ready" or response.comparison is None:
            return
        key = self.key(field)
        entry = {"key": key, "comparisonId": response.comparison.id}
        entry["sha256"] = digest(canonical(entry))
        self.root.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.root, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(canonical(entry))
            handle.flush()
            os.fsync(handle.fileno())
        try:
            temporary.replace(self.root / f"{key}.json")
        finally:
            temporary.unlink(missing_ok=True)
