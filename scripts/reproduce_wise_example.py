"""Reprocess the retained real WISE example without any network access.

Run: services/archive/.venv/Scripts/python.exe -m scripts.reproduce_wise_example
Saved replay preserves the original ID. Reprocessing records current code and a
new evidence ID; this check compares dates, grids and pixels, not those IDs.
"""
import argparse
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image

from services.archive.models import ArchiveError, Retrieval
from services.archive.storage import LocalStore, digest
from services.wise.indexed import IndexedDiscovery, exposures_from_index
from services.wise.models import WiseConfig, WiseFieldRequest
from services.wise.pipeline import WisePipeline

ROOT = Path(__file__).resolve().parents[1] / "fixtures/wise/real-wise0855"


class RecordedWiseClient:
    evidence_kind = "saved_real_example"
    discovery_scope = "retained_unwise_index_and_original_wise_cutouts"

    def __init__(self, config, store, response):
        self.config, self.store, self.response = config, store, response
        self.comparison = response["comparison"]
        self.field = WiseFieldRequest(**self.comparison["field"], band=2)

    def discover(self, field, deadline=None, on_done=None):
        if field != self.field:
            raise ArchiveError("INVALID_REQUEST", "Recorded example requires its exact field", 422)
        sources = self.response["diagnostics"]["discovery"]["metadataSources"]
        assets = {item["asset"]: self.store.asset(self.comparison["id"], item["asset"])[0] for item in sources}
        index = next(item for item in sources if item["url"].endswith("-frames.fits"))
        found = exposures_from_index(assets[index["asset"]], field, self.config)
        return IndexedDiscovery(found, metadata=sources, assets=assets,
                                scope=self.response["diagnostics"]["discovery"]["scope"])

    def retrieve(self, exposures, field, size_deg, deadline=None, on_done=None):
        inputs = {item["exposure"]["exposureId"]: item["sourceSha256"]
                  for frame in self.comparison["provenance"]["inputs"] for item in frame["exposures"]}
        result = []
        for exposure in exposures:
            if exposure.exposure_id not in inputs:
                raise ArchiveError("INVALID_REQUEST", "Changed policy requires an exposure not retained", 422)
            data, sha = self.store.asset(self.comparison["id"], f"{inputs[exposure.exposure_id]}.fits")
            assert digest(data) == sha == inputs[exposure.exposure_id]
            result.append((exposure, data))
            if on_done:
                on_done()
        return Retrieval(result)


def reproduce(output):
    example = json.loads((ROOT / "example.json").read_text())
    original = LocalStore(ROOT / "evidence")
    saved = original.load_raw(example["comparisonId"])
    config = WiseConfig.model_validate({k: v for k, v in saved["comparison"]["config"].items() if k != "band"})
    recorded = RecordedWiseClient(config, original, saved)
    destination = LocalStore(output)
    response = WisePipeline(recorded, destination, config).build(recorded.field)
    assert response.status == "ready"
    assert response.comparison.grid.model_dump(by_alias=True) == saved["comparison"]["grid"]
    differences = []
    for frame, old in zip(response.comparison.frames, saved["comparison"]["frames"], strict=True):
        current = frame.model_dump(mode="json", by_alias=True)
        for key in ("observedAtUtc", "observationStartUtc", "observationEndUtc", "sourceSha256"):
            assert current[key] == old[key], key
        new_pixels = np.array(Image.open(BytesIO(destination.asset(response.comparison.id, f"{frame.id}.png")[0])))
        old_pixels = np.array(Image.open(BytesIO(original.asset(example["comparisonId"], old["imageUrl"].split("/")[-1])[0])))
        delta = int(np.max(np.abs(new_pixels.astype(int) - old_pixels.astype(int))))
        # Across numerical environments allow one 8-bit display level. Exact replay
        # always serves the original bytes and has no such tolerance.
        assert delta <= 1, delta
        differences.append(delta)
    return {"status": "ready", "network": "unused", "savedComparisonId": example["comparisonId"],
            "reprocessedComparisonId": response.comparison.id, "maxPngLevelDifference": differences}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".cache/wise-example-reproduction"))
    print(json.dumps(reproduce(parser.parse_args().output), indent=2))
